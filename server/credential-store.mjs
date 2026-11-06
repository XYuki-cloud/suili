import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile, open, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';

// Passwords cross the PowerShell boundary through stdin only. The subprocess
// receives no credentials in arguments/environment and never emits clear text.
export class WindowsSecretProtector {
 async transform(value,protect){
  if(process.platform!=='win32')throw new Error('当前系统尚未提供 WebDAV 凭据保护器');
  const windows=process.env.SystemRoot||'C:\\Windows';
  const script="Add-Type -AssemblyName System.Security; $bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $result=[Security.Cryptography.ProtectedData]::"+(protect?'Protect':'Unprotect')+"($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result))";
  const input=protect?Buffer.from(value,'utf8').toString('base64'):value;
  return new Promise((resolve,reject)=>{
   const child=spawn(join(windows,'System32','WindowsPowerShell','v1.0','powershell.exe'),['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,SystemRoot:windows,WINDIR:windows}});
   const chunks=[];let size=0,finished=false;
   const finish=(error,result)=>{if(finished)return;finished=true;clearTimeout(timer);error?reject(error):resolve(result);};
   const timer=setTimeout(()=>{child.kill();finish(new Error('系统凭据保护超时'));},10000);
   child.stdout.on('data',c=>{size+=c.length;if(size>65536){child.kill();finish(new Error('系统凭据保护返回异常'));}else chunks.push(c);});
   child.stderr.resume();child.on('error',()=>finish(new Error('无法使用 Windows 凭据保护')));child.stdin.on('error',()=>{});
   child.on('close',code=>{if(code!==0)return finish(new Error('Windows 凭据无法解密，请重新输入密码'));const raw=Buffer.concat(chunks).toString('ascii').trim();if(!/^[A-Za-z0-9+/]*={0,2}$/.test(raw))return finish(new Error('系统凭据保护返回异常'));finish(null,protect?raw:Buffer.from(raw,'base64').toString('utf8'));});
   child.stdin.end(input);
  });
 }
 protect(value){return this.transform(value,true);}
 unprotect(value){return this.transform(value,false);}
}

export async function atomicJson(path,value){
 const temp=`${path}.${randomUUID()}.tmp`;let file;
 try{file=await open(temp,'wx',0o600);await file.writeFile(JSON.stringify(value)+'\n','utf8');await file.sync();await file.close();file=null;await rename(temp,path);}
 finally{if(file)await file.close();await rm(temp,{force:true}).catch(()=>{});}
}

export class CredentialStore {
 constructor(dataDir,protector=new WindowsSecretProtector()){this.path=join(dataDir,'webdav-config.json');this.protector=protector;}
 async load(){
  let raw;try{raw=await readFile(this.path,'utf8');}catch(e){if(e.code==='ENOENT')return null;throw new Error('无法读取 WebDAV 凭据设置');}
  try{
   const saved=JSON.parse(raw);
   if(saved.schemaVersion!==1||typeof saved.enabled!=='boolean'||typeof saved.url!=='string'||typeof saved.username!=='string'||typeof saved.passwordProtected!=='string'||!Number.isSafeInteger(saved.revision)||saved.revision<1)throw new Error();
   const password=saved.passwordProtected?await this.protector.unprotect(saved.passwordProtected):'';
   return {enabled:saved.enabled,url:saved.url,username:saved.username,password,revision:saved.revision};
  }catch{throw new Error('无法读取或解密 WebDAV 凭据，请重新保存连接设置');}
 }
 async save(config){
  try{
   const passwordProtected=config.password?await this.protector.protect(config.password):'';
   await atomicJson(this.path,{schemaVersion:1,enabled:config.enabled,url:config.url,username:config.username,passwordProtected,revision:config.revision});
  }catch{throw new Error('无法保存 WebDAV 凭据，原设置已保留');}
 }
}
