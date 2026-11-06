import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CredentialStore, WindowsSecretProtector } from '../server/credential-store.mjs';

const fake={protect:async s=>Buffer.from(s).toString('base64'),unprotect:async s=>Buffer.from(s,'base64').toString()};
async function fixture(t,protector=fake){const dir=await mkdtemp(join(tmpdir(),'suili-secret-'));t.after(()=>rm(dir,{recursive:true,force:true}));return {path:join(dir,'webdav-config.json'),store:new CredentialStore(dir,protector)};}

test('credential settings persist without plaintext password and restore exact Unicode credentials',async t=>{
 const {path,store}=await fixture(t);assert.equal(await store.load(),null);
 const config={enabled:true,url:'https://example.test/dav/calendar.json',username:'用户',password:'口令-秘密',revision:2};
 await store.save(config);const raw=await readFile(path,'utf8');assert.ok(!raw.includes(config.password));assert.ok(!raw.includes('"password":'));assert.deepEqual(await store.load(),config);
});
test('malformed or undecryptable credential settings are never treated as empty',async t=>{
 const {path,store}=await fixture(t);await writeFile(path,'{broken');await assert.rejects(store.load());assert.equal(await readFile(path,'utf8'),'{broken');
 await store.save({enabled:true,url:'https://x.test/c.json',username:'u',password:'p',revision:1});
 const broken=new CredentialStore(join(path,'..'),{...fake,unprotect:async()=>{throw Error('private provider details');}});await assert.rejects(broken.load(),/无法读取|凭据/);
});
test('encryption failure does not overwrite saved credentials',async t=>{
 const {path,store}=await fixture(t);await store.save({enabled:true,url:'https://x.test/c.json',username:'u',password:'p',revision:1});const before=await readFile(path,'utf8');
 const broken=new CredentialStore(join(path,'..'),{...fake,protect:async()=>{throw Error('secret in provider error');}});await assert.rejects(broken.save({password:'new secret'}),/无法保存|凭据/);assert.equal(await readFile(path,'utf8'),before);
});
test('Windows DPAPI round trip protects Unicode and rejects a damaged envelope',{skip:process.platform!=='win32'},async()=>{
 const protector=new WindowsSecretProtector();const cipher=await protector.protect('随历 密码 \u{1f512}');assert.ok(!cipher.includes('密码'));assert.equal(await protector.unprotect(cipher),'随历 密码 \u{1f512}');await assert.rejects(protector.unprotect('invalid'));
});
