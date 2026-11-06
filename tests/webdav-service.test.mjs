import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebDavService } from '../server/webdav-service.mjs';
import { CredentialStore } from '../server/credential-store.mjs';
import { emptyTask, makeOperation, mergeOperations } from '../shared/core.mjs';
import { startWebDavFixture } from './helpers/webdav-fixture.mjs';

const snap=operations=>({schemaVersion:1,operations});
const protector={protect:async s=>Buffer.from(s).toString('base64'),unprotect:async s=>Buffer.from(s,'base64').toString()};
async function fixture(t,opts={}){
 const dir=await mkdtemp(join(tmpdir(),'suili-dav-service-'));let operations=[];
 const options={dataDir:dir,credentialStore:new CredentialStore(dir,protector),automatic:false,getSnapshot:async()=>snap(operations),mergeSnapshot:async(s,guard)=>{guard?.();operations=mergeOperations(operations,s.operations);return snap(operations);},...opts};
 const service=await WebDavService.create(options);t.after(async()=>{await service.close();await rm(dir,{recursive:true,force:true});});
 return {dir,service,options,add(op){operations=mergeOperations(operations,[op]);},get operations(){return operations;}};
}
test('cloud settings redact password, retain it only for same destination, and reset cloud acknowledgment',async t=>{
 const f=await fixture(t);const dav=await startWebDavFixture({username:'用户',password:'秘密'});t.after(()=>dav.close());
 const op=makeOperation(emptyTask('本地事项'),[],'desktop');f.add(op);
 await f.service.saveConfig({enabled:true,url:dav.url,username:'用户',password:'秘密'});
 const saved=await f.service.publicConfig();assert.equal(saved.hasPassword,true);assert.ok(!JSON.stringify(saved).includes('秘密'));assert.equal(saved.status.pending,1);
 await f.service.sync();assert.equal((await f.service.status()).pending,0);
 await f.service.saveConfig({enabled:true,url:dav.url,username:'用户'});await f.service.sync();assert.equal((await f.service.status()).pending,0);
 await assert.rejects(f.service.saveConfig({enabled:true,url:dav.url+'x',username:'用户'}));assert.equal((await f.service.publicConfig()).url,dav.url);
 await f.service.saveConfig({enabled:false,url:'',username:'',password:''});assert.equal((await f.service.status()).pending,1);assert.equal((await f.service.publicConfig()).hasPassword,false);
});
test('cloud sync merges latest local writes without acknowledging edits created during exchange',async t=>{
 const f=await fixture(t);const dav=await startWebDavFixture();t.after(()=>dav.close());
 const a=makeOperation(emptyTask('先发送'),[],'desktop'),b=makeOperation(emptyTask('同步期间新增'),[],'desktop');f.add(a);
 await f.service.saveConfig({enabled:true,url:dav.url,username:'',password:''});
 dav.inject({method:'PUT',before(){f.add(b);}});await f.service.sync();
 assert.equal(f.operations.length,2);assert.equal((await f.service.status()).pending,1);assert.equal(dav.snapshot.operations.length,1);
 await f.service.sync();assert.equal(dav.snapshot.operations.length,2);assert.equal((await f.service.status()).pending,0);
});
test('settings generation fences old cloud results and restart restores acknowledgments only for current target',async t=>{
 let release,started;const reached=new Promise(r=>started=r),wait=new Promise(r=>release=r);
 const f=await fixture(t,{transportFactory:()=>({exchange:async s=>{started();await wait;return s;}})});f.add(makeOperation(emptyTask('不要旧设置确认'),[],'desktop'));
 await f.service.saveConfig({enabled:true,url:'https://dav.test/a.json',username:'',password:''});const running=f.service.sync();await reached;
 await f.service.saveConfig({enabled:true,url:'https://dav.test/b.json',username:'',password:''});release();await assert.rejects(running,/设置.*更新|目的地/);assert.equal((await f.service.status()).pending,1);
 const restarted=await WebDavService.create(f.options);t.after(()=>restarted.close());assert.equal((await restarted.publicConfig()).url,'https://dav.test/b.json');assert.equal((await restarted.status()).pending,1);
});
test('authentication failure never confirms pending operations or changes local history',async t=>{
 const f=await fixture(t);const dav=await startWebDavFixture({username:'u',password:'right'});t.after(()=>dav.close());f.add(makeOperation(emptyTask('保留'),[],'desktop'));
 await f.service.saveConfig({enabled:true,url:dav.url,username:'u',password:'wrong'});await assert.rejects(f.service.sync());let status=await f.service.status();assert.equal(status.pending,1);assert.ok(!JSON.stringify(status).includes('wrong'));
 assert.equal(dav.snapshot,null);assert.equal(f.operations.length,1);
});
test('unreadable credentials cannot reuse an old target acknowledgment after reconfiguration and restart',async t=>{
 let saved=null,failRead=false;
 const credentials={load:async()=>{if(failRead)throw Error('cannot decrypt');return saved;},save:async c=>{saved={...c};}};
 const f=await fixture(t,{credentialStore:credentials,transportFactory:()=>({exchange:async s=>s})});f.add(makeOperation(emptyTask('目标切换'),[],'desktop'));
 await f.service.saveConfig({enabled:true,url:'https://dav.test/a.json',username:'',password:''});await f.service.sync();await f.service.close();
 failRead=true;const recovery=await WebDavService.create(f.options);t.after(()=>recovery.close());await recovery.saveConfig({enabled:true,url:'https://dav.test/b.json',username:'',password:''});assert.equal((await recovery.status()).pending,1);await recovery.close();
 failRead=false;const restarted=await WebDavService.create(f.options);t.after(()=>restarted.close());assert.equal((await restarted.status()).pending,1);assert.equal((await restarted.status()).lastSync,null);
});
test('local persistence failure after a remote write never publishes cloud acknowledgment',async t=>{
 const f=await fixture(t,{mergeSnapshot:async()=>{throw Error('local disk unavailable');},transportFactory:()=>({exchange:async s=>s})});f.add(makeOperation(emptyTask('保存失败'),[],'desktop'));
 await f.service.saveConfig({enabled:true,url:'https://dav.test/c.json',username:'',password:''});await assert.rejects(f.service.sync());assert.equal((await f.service.status()).pending,1);assert.equal((await f.service.status()).lastSync,null);
});
test('persisted cloud acknowledgment survives service restart without leaking credentials into metadata',async t=>{
 const f=await fixture(t);const dav=await startWebDavFixture({username:'u',password:'secret'});t.after(()=>dav.close());f.add(makeOperation(emptyTask('持久化'),[],'desktop'));
 await f.service.saveConfig({enabled:true,url:dav.url,username:'u',password:'secret'});await f.service.sync();
 const raw=await readFile(join(f.dir,'webdav-state.json'),'utf8');assert.ok(!raw.includes('secret'));const restarted=await WebDavService.create(f.options);t.after(()=>restarted.close());assert.equal((await restarted.status()).pending,0);assert.ok((await restarted.status()).lastSync);
});
