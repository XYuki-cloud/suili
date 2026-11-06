import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CredentialStore, atomicJson } from './credential-store.mjs';
import { WebDavTransport, normalizeWebDavConfig } from '../shared/transports.mjs';

const blank=()=>({enabled:false,url:'',username:'',password:'',revision:0});
const issue=(status,message)=>Object.assign(new Error(message),{status});
function safeMessage(error,config){
 let message=String(error?.message||'WebDAV 同步失败，请检查连接后重试');
 for(const secret of [config.password,config.username,config.url])if(secret)message=message.split(secret).join('…');
 if(/https?:\/\/|Authorization|Bearer|Basic\s+[A-Za-z0-9+/=]+/i.test(message))return 'WebDAV 同步失败，请检查地址、账号和网络后重试';
 return message.slice(0,250);
}

/** Keeps cloud confirmation separate from the local HTTP service acknowledgment. */
export class WebDavService {
 static async create(options){const service=new WebDavService(options);await service.load();return service;}
 constructor({dataDir,credentialStore=new CredentialStore(dataDir),getSnapshot,mergeSnapshot,transportFactory=c=>new WebDavTransport(c),automatic=true}){
  this.credentials=credentialStore;this.statePath=join(dataDir,'webdav-state.json');this.getSnapshot=getSnapshot;this.mergeSnapshot=mergeSnapshot;this.transportFactory=transportFactory;this.automatic=automatic;
  this.config=blank();this.state={revision:0,ackIds:[],lastSync:null};this.knownRevision=0;this.lastError=null;this.active=null;this.settings=Promise.resolve();this.closed=false;
 }
 async load(){
  try{const saved=await this.credentials.load();if(saved){if(saved.url)normalizeWebDavConfig({url:saved.url,username:saved.username,password:saved.password});this.config=saved;}}
  catch{this.lastError='无法读取 WebDAV 连接设置，请重新保存地址和凭据';}
  try{
   const state=JSON.parse(await readFile(this.statePath,'utf8'));
   if(Number.isSafeInteger(state.revision)&&state.revision>=0)this.knownRevision=state.revision;
   if(state.revision===this.config.revision&&Array.isArray(state.ackIds)&&state.ackIds.every(x=>typeof x==='string')&&(state.lastSync===null||typeof state.lastSync==='string'))this.state=state;
  }catch(e){if(e.code!=='ENOENT'&&!this.lastError)this.lastError='WebDAV 同步状态无法读取，原事项仍保留，将重新确认远端内容';}
 }
 start(){if(this.closed||!this.automatic||this.interval)return;this.interval=setInterval(()=>{if(this.config.enabled)this.sync().catch(()=>{});},30000);this.interval.unref();if(this.config.enabled)this.notifyChanged();}
 notifyChanged(){if(this.closed||!this.automatic||!this.config.enabled)return;clearTimeout(this.timer);this.timer=setTimeout(()=>this.sync().catch(()=>{}),650);this.timer.unref();}
 async status(){
  const snapshot=await this.getSnapshot(),ack=new Set(this.state.revision===this.config.revision?this.state.ackIds:[]);
  return {syncing:Boolean(this.active),lastSync:this.state.revision===this.config.revision?this.state.lastSync:null,lastError:this.lastError,pending:snapshot.operations.filter(op=>!ack.has(op.id)).length};
 }
 async publicConfig(){const c=this.config;return {enabled:c.enabled,url:c.url,username:c.username,hasPassword:Boolean(c.password),configured:Boolean(c.url),revision:c.revision,status:await this.status()};}
 saveConfig(input){
  const save=this.settings.then(async()=>{
   if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['enabled','url','username','password'].includes(k))||typeof input.enabled!=='boolean'||typeof input.url!=='string'||typeof input.username!=='string'||('password'in input&&typeof input.password!=='string'))throw issue(400,'WebDAV 设置格式不正确');
   let url=input.url.trim(),username=input.username,password=input.password;
   if(!url){if(input.enabled)throw issue(400,'请填写完整的 WebDAV 同步文件地址');username='';password='';}
   else{
    try{
     url=normalizeWebDavConfig({url,username:'',password:''}).url;
     if(password===undefined)password=url===this.config.url&&username===this.config.username?this.config.password:'';
     ({url,username,password}=normalizeWebDavConfig({url,username,password}));
    }catch(e){throw issue(400,safeMessage(e,{password:password||'',username:'',url}));}
   }
   const next={enabled:input.enabled,url,username,password,revision:Math.max(this.knownRevision,this.config.revision)+1};
   try{await this.credentials.save(next);}catch{throw issue(500,'无法保存 WebDAV 凭据，请检查 Windows 账户与本地目录权限；原设置仍保留');}
   // A persisted revision fences every prior request. An old state file is
   // harmless after a crash because its revision no longer matches.
   this.config=next;this.knownRevision=next.revision;this.state={revision:next.revision,ackIds:[],lastSync:null};this.lastError=null;clearTimeout(this.timer);
   return this.publicConfig();
  });this.settings=save.catch(()=>{});return save;
 }
 async sync(){
  await this.settings;
  if(this.closed)throw issue(409,'同步服务已停止');
  if(!this.config.enabled||!this.config.url)throw issue(400,'请先启用并保存 WebDAV 连接设置');
  if(this.active){
   if(this.activeRevision===this.config.revision)return this.active;
   try{await this.active;}catch{}return this.sync();
  }
  const config={...this.config},revision=config.revision;
  const guard=()=>{if(this.config.revision!==revision||this.closed)throw issue(409,'同步设置已更新，请使用当前目的地重新同步');};
  this.activeRevision=revision;
  this.active=Promise.resolve().then(async()=>{
   try{
    const transport=this.transportFactory({url:config.url,username:config.username,password:config.password});
    const remote=await transport.exchange(await this.getSnapshot());guard();
    await this.mergeSnapshot(remote,guard);guard();
    const next={revision,ackIds:remote.operations.map(op=>op.id),lastSync:new Date().toISOString()};
    await atomicJson(this.statePath,next);guard();this.state=next;this.lastError=null;
    return {ok:true};
   }catch(e){if(this.config.revision===revision&&!this.closed)this.lastError=safeMessage(e,config);throw issue(e.status??502,safeMessage(e,config));}
   finally{this.active=null;}
  });
  return this.active;
 }
 async close(){this.closed=true;clearTimeout(this.timer);clearInterval(this.interval);await this.settings;if(this.active)try{await this.active;}catch{}}
}
