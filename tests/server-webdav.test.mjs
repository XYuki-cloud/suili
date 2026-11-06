import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { createServer } from '../server/server.mjs';
import { CredentialStore } from '../server/credential-store.mjs';
import { startWebDavFixture } from './helpers/webdav-fixture.mjs';
import { emptyTask, makeOperation } from '../shared/core.mjs';
const headers={authorization:'Bearer integration-secret','content-type':'application/json'};
const snapshot=operations=>({schemaVersion:1,operations});
const protector={protect:async s=>Buffer.from(s).toString('base64'),unprotect:async s=>Buffer.from(s,'base64').toString()};
async function fixture(t){const dir=await mkdtemp(join(tmpdir(),'suili-dav-api-'));const app=await createServer({dataDir:dir,token:'integration-secret',webdavAutomatic:false,credentialStore:new CredentialStore(dir,protector)});const {url,port}=await app.listen(0);t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});return {app,url,dir,port};}

test('WebDAV settings require bearer plus local same-origin caller and never disclose saved passwords',async t=>{
 const {url,port,dir}=await fixture(t);
 assert.equal((await fetch(url+'/api/webdav/config')).status,401);
 for(const extra of [{origin:'https://evil.test'},{'sec-fetch-site':'cross-site'}])assert.equal((await fetch(url+'/api/webdav/config',{headers:{...headers,...extra}})).status,403,JSON.stringify(extra));
 const hostStatus=await new Promise((resolve,reject)=>{const r=http.get({hostname:'127.0.0.1',port,path:'/api/webdav/config',headers:{...headers,host:`remote.test:${port}`}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});r.on('error',reject);});assert.equal(hostStatus,403);
 const response=await fetch(url+'/api/webdav/config',{method:'POST',headers,body:JSON.stringify({enabled:true,url:'https://example.test/dav/calendar.json',username:'u',password:'private-pass'})});assert.equal(response.status,200);const config=await response.json();assert.equal(config.hasPassword,true);assert.equal(config.enabled,true);assert.ok(!JSON.stringify(config).includes('private-pass'));
 const raw=await readFile(join(dir,'webdav-config.json'),'utf8');assert.ok(!raw.includes('private-pass'));
 const got=await (await fetch(url+'/api/webdav/config',{headers})).json();assert.equal(got.hasPassword,true);assert.ok(!JSON.stringify(got).includes('private-pass'));
});
test('two desktop servers exchange through DAV, merge rather than replace, and keep cloud failures separate from local saves',async t=>{
 const first=await fixture(t),second=await fixture(t),dav=await startWebDavFixture();t.after(()=>dav.close());
 const a=makeOperation(emptyTask('电脑甲'),[],'desktop-a'),b=makeOperation(emptyTask('电脑乙'),[],'desktop-b');
 for(const [f,op] of [[first,a],[second,b]]){
  assert.equal((await fetch(f.url+'/api/sync',{method:'POST',headers,body:JSON.stringify(snapshot([op]))})).status,200);
  assert.equal((await fetch(f.url+'/api/webdav/config',{method:'POST',headers,body:JSON.stringify({enabled:true,url:dav.url,username:'',password:''})})).status,200);
  assert.equal((await fetch(f.url+'/api/webdav/sync',{method:'POST',headers,body:'{}'})).status,200);
 }
 await fetch(first.url+'/api/webdav/sync',{method:'POST',headers,body:'{}'});
 const merged=await (await fetch(first.url+'/api/sync',{headers})).json();assert.deepEqual(new Set(merged.operations.map(o=>o.id)),new Set([a.id,b.id]));
 dav.inject({method:'GET',status:503});const failed=await fetch(first.url+'/api/webdav/sync',{method:'POST',headers,body:'{}'});assert.equal(failed.status,502);assert.ok((await failed.json()).status.lastError);
 const fresh=makeOperation(emptyTask('断网仍保存'),merged.operations,'desktop-a');const local=await fetch(first.url+'/api/sync',{method:'POST',headers,body:JSON.stringify(snapshot([fresh]))});assert.equal(local.status,200);assert.equal((await local.json()).operations.length,3);
 const status=await (await fetch(first.url+'/api/webdav/status',{headers})).json();assert.equal(status.pending,1);assert.ok(status.lastError);
});
