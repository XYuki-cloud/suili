import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink, lstat } from 'node:fs/promises';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { publicEntries, exportPublicSource, isPublicPath } from '../scripts/public-source.mjs';

async function fixture(t){
 const temporaryRoot=resolve(tmpdir()),directory=await mkdtemp(join(temporaryRoot,'suili-public-hardening-'));
 if(!resolve(directory).startsWith(temporaryRoot+sep))throw new Error('Refusing fixture cleanup outside the temporary root');
 t.after(()=>rm(directory,{recursive:true,force:true}));
 return directory;
}
function git(cwd,args){
 const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('GIT_'))delete env[key];
 const globalConfig=join(cwd,'.fixture-global.gitconfig');writeFileSync(globalConfig,'');
 env.GIT_CONFIG_GLOBAL=globalConfig;env.GIT_CONFIG_NOSYSTEM='1';
 try{return execFileSync('git',['-c','core.hooksPath=nonexistent-fixture-hooks','-c','commit.gpgsign=false',...args],{cwd,env,stdio:['ignore','pipe','pipe']});}
 catch{throw new Error('Synthetic Git fixture command failed');}
}
function commitReadme(directory){
 git(directory,['add','README.md']);
 git(directory,['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','commit','--quiet','-m','test: synthetic source fixture']);
}
async function exists(path){try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}

test('inherited Git routing cannot select a parent repository as the source',async t=>{
 const directory=await fixture(t),parent=join(directory,'parent'),source=join(parent,'source');
 await mkdir(source,{recursive:true});await writeFile(join(parent,'README.md'),'PARENT_SYNTHETIC_FIXTURE\n');await writeFile(join(source,'README.md'),'CHILD_SYNTHETIC_FIXTURE\n');
 git(parent,['init','--quiet']);commitReadme(parent);
 const saved=new Map(Object.keys(process.env).filter(key=>key.startsWith('GIT_')).map(key=>[key,process.env[key]]));
 try{
  for(const key of [...saved.keys()])delete process.env[key];
  assert.equal((await publicEntries(source)).some(entry=>entry.bytes.includes('CHILD_SYNTHETIC_FIXTURE')),true);
  process.env.GIT_DIR=join(parent,'.git');process.env.GIT_WORK_TREE=source;
  const selected=await publicEntries(source);
  assert.equal(selected.some(entry=>entry.bytes.includes('PARENT_SYNTHETIC_FIXTURE')),false,'An inherited environment must not read the parent HEAD');
  assert.equal(selected.some(entry=>entry.bytes.includes('CHILD_SYNTHETIC_FIXTURE')),true);
 }finally{
  for(const key of Object.keys(process.env))if(key.startsWith('GIT_'))delete process.env[key];
  for(const [key,value]of saved)process.env[key]=value;
 }
});

test('a broken own Git marker fails closed instead of exporting uncommitted files',async t=>{
 const directory=await fixture(t),source=join(directory,'source');await mkdir(source);
 await writeFile(join(source,'README.md'),'UNCOMMITTED_SYNTHETIC_FIXTURE\n');await writeFile(join(source,'.git'),'gitdir: ./missing-fixture-git\n');
 let rejected=false;try{await publicEntries(source);}catch{rejected=true;}
 assert.equal(rejected,true,'An invalid own repository must not silently fall back to filesystem mode');
});

test('Git errors expose no original absolute metadata path',async t=>{
 const directory=await fixture(t),source=join(directory,'source'),metadata=join(directory,'synthetic-private-metadata');await mkdir(source);
 git(source,['init','--quiet','--separate-git-dir='+metadata]);await writeFile(join(source,'README.md'),'# Synthetic fixture\n');commitReadme(source);
 await writeFile(join(metadata,'index'),'not a valid synthetic fixture index');
 const previousIndex=process.env.GIT_INDEX_FILE;let rejected=false,message='';
 try{process.env.GIT_INDEX_FILE=join(metadata,'index');try{await publicEntries(source,{staged:true});}catch(error){rejected=true;message=String(error.message);}}
 finally{if(previousIndex===undefined)delete process.env.GIT_INDEX_FILE;else process.env.GIT_INDEX_FILE=previousIndex;}
 assert.equal(rejected,true,'A malformed index must stop the export');
 // Boolean assertions deliberately keep the captured error and absolute paths out of test output.
 assert.equal(message.includes(metadata),false,'The original absolute metadata directory must be redacted');
 assert.equal(message.includes(directory),false,'The original absolute fixture directory must be redacted');
});

test('a destination claimed during inspection is never reused or followed through a link',async t=>{
 const directory=await fixture(t),source=join(directory,'source'),output=join(directory,'public'),outside=join(directory,'outside-fixture');
 await mkdir(join(source,'web'),{recursive:true});await mkdir(outside);await writeFile(join(source,'README.md'),'# Synthetic fixture\n');await writeFile(join(source,'LICENSE'),'Apache-2.0\n');
 await writeFile(join(source,'web','app.mjs'),'export const synthetic=true;\n');
 const fs=createRequire(import.meta.url)('node:fs/promises'),originalReadDir=fs.readdir;let injected=false,rejected=false;
 // Model a second process claiming output after lstat but before the exporter creates it.
 fs.readdir=async(...args)=>{
  if(args[0]===source&&!injected){
   injected=true;await mkdir(output);await writeFile(join(output,'preexisting-marker.txt'),'preserved synthetic fixture');
   await symlink(outside,join(output,'web'),process.platform==='win32'?'junction':'dir');
  }
  return originalReadDir(...args);
 };
 syncBuiltinESMExports();
 try{await exportPublicSource({root:source,output});}catch{rejected=true;}
 finally{fs.readdir=originalReadDir;syncBuiltinESMExports();}
 assert.equal(injected,true,'The concurrent-creation fixture must run after inspection starts');
 assert.equal(rejected,true,'A concurrently created destination must stop the export');
 assert.equal(await exists(join(outside,'app.mjs')),false,'No export file may escape through the destination link');
 assert.equal(await readFile(join(output,'preexisting-marker.txt'),'utf8'),'preserved synthetic fixture','Do not delete or overwrite the independently claimed destination');
});

test('runtime JSON files under code directories are excluded from the public selection',async t=>{
 const directory=await fixture(t),source=join(directory,'source');await mkdir(join(source,'web'),{recursive:true});
 await writeFile(join(source,'README.md'),'# Synthetic fixture\n');await writeFile(join(source,'web','runtime-state.json'),JSON.stringify({password:'synthetic fixture value',operations:[]}));
 assert.equal(isPublicPath('web/runtime-state.json'),false);
 assert.equal((await publicEntries(source)).some(entry=>entry.path==='web/runtime-state.json'),false);
 assert.equal(isPublicPath('package.json'),true,'The explicit project manifest remains public');
});
