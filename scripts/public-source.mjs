import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync } from 'node:fs';
import { lstat, mkdir, readFile, readdir, writeFile, chmod } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_FILES=new Set(['README.md','LICENSE','NOTICE','THIRD_PARTY_NOTICES.md','CONTRIBUTING.md','PRIVACY.md','SECURITY.md','CHANGELOG.md','.gitignore','.gitattributes','.editorconfig','package.json','Start-Calendar.ps1','Install-Shortcut.ps1']);
const PUBLIC_DOCS=new Set(['docs/getting-started.md','docs/development.md','docs/publishing.md','docs/sync-contract.md','docs/hyperos.md','docs/images/desktop.png','docs/images/mobile.png','docs/images/android-app.png','docs/images/android-widget-settings.png','docs/images/android-widget.png']);
const ANDROID_ROOTS=new Set(['android/README.md','android/.gitignore','android/build.gradle','android/settings.gradle','android/gradle.properties','android/gradlew','android/gradlew.bat','android/build.ps1','android/test-core.ps1','android/test-widget.ps1','android/test-webdav.ps1','android/app/build.gradle','android/gradle/wrapper/gradle-wrapper.jar','android/gradle/wrapper/gradle-wrapper.properties']);
const FORBIDDEN=/(^|\/)(?:\.git|\.local|\.qa|\.private|\.codex|\.vscode|\.idea|artifacts|node_modules|build|\.gradle|%SystemDrive%)(\/|$)|(^|\/)(?:AGENTS\.md|CLAUDE\.md|CODEX\.md|local\.properties|\.env(?:\..*)?|id_rsa|id_ed25519|token|credentials\.json|secrets\.json|snapshot\.json|operations\.json|sync-state\.json|webdav-config\.json|webdav-state\.json)$|\.(?:apk|aab|jks|keystore|p12|pfx|pem|key|lnk|log|zip)$/i;
const CODE_EXT=/\.(?:mjs|js|html|css|svg|webmanifest|java|xml|ps1|gradle|properties|md)$/i;
class PublicSourceError extends Error {}

/** Deliberately enumerated: adding a new top-level area requires a release review. */
export function isPublicPath(path){
 if(typeof path!=='string'||path.includes('\\')||path.startsWith('/')||path.split('/').some(part=>part==='..'||part==='.'||!part)||FORBIDDEN.test(path))return false;
 if(ROOT_FILES.has(path)||PUBLIC_DOCS.has(path)||ANDROID_ROOTS.has(path))return true;
 if(path==='android/tests/fixtures/multiple-periods.json')return true;
 if(path==='third_party/gradle-wrapper/LICENSE')return true;
 if(/^(?:server|shared|web|tests|scripts)\//.test(path))return CODE_EXT.test(path);
 if(/^android\/(?:app\/src|tests|tools)\//.test(path))return CODE_EXT.test(path)||path==='android/app/src/main/res/drawable-nodpi/widget_preview_image.png';
 return false;
}

const exampleEmail=value=>/@(?:[^@.]+\.)*(?:example\.(?:com|org|net)|invalid|test|localhost)$/i.test(value);
export function inspectPublicFile(path,bytes){
 if(/\.(?:png|jar)$/i.test(path))return [];
 const findings=[],lines=bytes.toString('utf8').split(/\r?\n/);
 const rules=[
  ['personal-email',/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,exampleEmail],
  ['personal-windows-path',/\b[A-Z]:[\\/]Users[\\/][^\s\\/"'<>]+/gi],
  ['machine-project-path',/\b[A-Z]:[\\/](?:projects|anddev|android-sdk|桌面|下载)[\\/][^\s"'<>]+/gi],
  ['provider-token',/\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|glpat-[A-Za-z0-9_-]{20,}|AKIA[A-Z0-9]{16})\b/g],
 ];
 for(let index=0;index<lines.length;index++)for(const [rule,pattern,allowed] of rules){
  pattern.lastIndex=0;const matches=[...lines[index].matchAll(pattern)];
  if(matches.some(match=>!allowed?.(match[0])))findings.push({path,line:index+1,rule});
 }
 // Require actual multiline key material, not a test describing a rejected header.
 if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]{40,}/.test(bytes.toString('utf8')))findings.push({path,line:1,rule:'private-key-material'});
 return findings;
}

function git(root,args){
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!/^GIT_/i.test(key)));
 try{return execFileSync('git',args,{cwd:root,env,encoding:'buffer',stdio:['ignore','pipe','pipe'],maxBuffer:32*1024*1024});}
 catch{throw new PublicSourceError('Git source selection failed; verify the repository and index state');}
}
function ownGitRoot(root){
 let marker;
 try{marker=lstatSync(resolve(root,'.git'));}catch(error){if(error.code==='ENOENT')return false;throw new PublicSourceError('Cannot inspect the source repository');}
 if(marker.isSymbolicLink())throw new PublicSourceError('Git metadata symlinks are not accepted');
 if(resolve(git(root,['rev-parse','--show-toplevel']).toString().trim())!==resolve(root))throw new PublicSourceError('The Git repository does not match the source directory');
 return true;
}
async function entriesFromDisk(root){
 const result=[];
 async function visit(directory,prefix=''){
  for(const item of await readdir(directory,{withFileTypes:true})){
   const path=prefix+item.name;
   if(FORBIDDEN.test(path))continue;
   if(item.isSymbolicLink()){
    if(isPublicPath(path)||/^(?:android|server|shared|web|tests|scripts|docs|third_party)(?:\/|$)/.test(path))throw new PublicSourceError('Symlinks are not exported');
    continue;
   }
   if(item.isDirectory()){
    if(/^(?:android|server|shared|web|tests|scripts|docs|third_party)(?:\/|$)/.test(path))await visit(resolve(directory,item.name),path+'/');
   }else if(isPublicPath(path))result.push({path,mode:0o644,bytes:await readFile(resolve(directory,item.name))});
  }
 }
 await visit(root);return result;
}
export async function publicEntries(root,{staged=false}={}){
 try{
 root=resolve(root);
 if(!ownGitRoot(root))return await entriesFromDisk(root);
 const rows=git(root,staged?['ls-files','--stage','-z']:['ls-tree','-r','-z','HEAD']).toString('utf8').split('\0').filter(Boolean);
 const entries=[];
 for(const row of rows){
  const split=row.indexOf('\t'),path=row.slice(split+1),meta=row.slice(0,split).split(' ');
  if(!isPublicPath(path))continue;
  const [mode,second,third]=meta,oid=staged?second:third;
  if(mode==='120000')throw new PublicSourceError('Symlinks are not exported');
  if(staged&&third!=='0')throw new PublicSourceError('Resolve index conflicts before exporting');
  entries.push({path,mode:mode==='100755'?0o755:0o644,bytes:git(root,['cat-file','blob',oid])});
 }
 return entries;
 }catch(error){throw error instanceof PublicSourceError?error:new PublicSourceError('Cannot read the selected public source files');}
}
export async function checkPublicSource({root,staged=false}){
 const entries=await publicEntries(root,{staged});
 const findings=entries.flatMap(entry=>inspectPublicFile(entry.path,entry.bytes));
 return {entries,findings};
}
export async function exportPublicSource({root,output,staged=false}){
 try{
 root=resolve(root);output=resolve(output);
 const within=relative(root,output);
 if(output===root||(!within.startsWith('..'+sep)&&!isAbsolute(within)&&!within.startsWith('artifacts'+sep)))throw new PublicSourceError('Use a new sibling directory or a directory under artifacts');
 try{await lstat(output);throw new PublicSourceError('Destination already exists; choose a new directory');}catch(error){if(error.code!=='ENOENT')throw error;}
 const {entries,findings}=await checkPublicSource({root,staged});
 if(findings.length)throw new PublicSourceError(`Privacy check failed: ${JSON.stringify(findings)}`);
 for(const required of ['README.md','LICENSE'])if(!entries.some(entry=>entry.path===required))throw new PublicSourceError(`${required} is required`);
 entries.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 await mkdir(dirname(output),{recursive:true});
 await mkdir(output); // Atomically claim a new directory after the source checks.
 const ownedDirectories=new Set([output]);
 async function createDirectory(directory){
  if(ownedDirectories.has(directory))return;
  await createDirectory(dirname(directory));await mkdir(directory);ownedDirectories.add(directory);
 }
 for(const entry of entries){const destination=resolve(output,entry.path);await createDirectory(dirname(destination));await writeFile(destination,entry.bytes,{flag:'wx'});if(process.platform!=='win32')await chmod(destination,entry.mode);}
 const manifest={schemaVersion:1,license:'Apache-2.0',files:entries.map(entry=>({path:entry.path,mode:entry.mode===0o755?'100755':'100644',sha256:createHash('sha256').update(entry.bytes).digest('hex'),bytes:entry.bytes.length}))};
 await writeFile(resolve(output,'PUBLIC_SOURCE_MANIFEST.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
 return {files:entries.length,output};
 }catch(error){
  if(error instanceof PublicSourceError)throw error;
  if(error.code==='EEXIST')throw new PublicSourceError('Destination already exists; choose a new directory');
  throw new PublicSourceError('Source export failed; check the destination permissions and source state');
 }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2),command=args[0]??'check',staged=args.includes('--staged');
 try{
  if(command==='check'){
   const {entries,findings}=await checkPublicSource({root,staged});console.log(JSON.stringify({files:entries.length,findings},null,2));if(findings.length)process.exitCode=1;
  }else if(command==='export'){
   const index=args.indexOf('--output');if(index<0||!args[index+1])throw new PublicSourceError('Usage: node scripts/public-source.mjs export --output NEW_DIRECTORY [--staged]');
   console.log(JSON.stringify(await exportPublicSource({root,output:resolve(root,args[index+1]),staged}),null,2));
  }else throw new PublicSourceError('Use check or export');
 }catch(error){console.error(error instanceof PublicSourceError?error.message:'Public source operation failed; check the command and source state');process.exitCode=1;}
}
