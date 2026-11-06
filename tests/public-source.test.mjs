import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isPublicPath, inspectPublicFile, exportPublicSource } from '../scripts/public-source.mjs';

test('public source includes the reviewed multi-period fixture without accepting arbitrary calendar JSON',()=>{
 assert.equal(isPublicPath('android/tests/fixtures/multiple-periods.json'),true);
 for(const path of ['android/tests/fixtures/private-calendar.json','android/tests/fixtures/snapshot.json','tests/calendar.json'])assert.equal(isPublicPath(path),false);
});

test('public source selection excludes runtime data, history, credentials and internal reports', () => {
 for (const name of ['README.md','LICENSE','web/app.mjs','server/server.mjs','android/tools/Resolve-JavaHome.ps1','android/app/src/main/AndroidManifest.xml','android/gradle/wrapper/gradle-wrapper.jar','docs/images/desktop.png','docs/images/android-app.png','docs/images/android-widget-settings.png','docs/images/android-widget.png']) assert.equal(isPublicPath(name), true, name);
 for (const name of ['.git/config','.local/snapshot.json','.qa/report.json','artifacts/debug.apk','.env','web/.env','server/credentials.json','web/snapshot.json','android/local.properties','android/debug.jks','android/app/build/output.apk','docs/verification.md','docs/plans/private.md','../token','web/../../token']) assert.equal(isPublicPath(name), false, name);
});

test('public source excludes local assistant instructions and editor state inside code directories', () => {
 for (const path of ['scripts/AGENTS.md','web/CLAUDE.md','android/tools/CODEX.md','server/.codex/notes.md','web/.vscode/settings.js','android/app/src/.idea/workspace.xml']) assert.equal(isPublicPath(path),false,path);
 assert.equal(isPublicPath('android/tools/Resolve-JavaHome.ps1'),true);
});

test('privacy findings report positions and categories without copying matching text', () => {
 const address=['someone','private.invalid-domain.net'].join('@');
 const path=['C:','Users','Example','notes.txt'].join('\\');
 const issues=inspectPublicFile('README.md',Buffer.from(`${address}\n${path}\n`));
 assert.deepEqual(issues.map(issue=>issue.rule),['personal-email','personal-windows-path']);
 assert.ok(issues.every(issue=>issue.path==='README.md'&&Number.isInteger(issue.line)));
 assert.ok(!JSON.stringify(issues).includes(address));
 assert.ok(!JSON.stringify(issues).includes(path));
 assert.deepEqual(inspectPublicFile('README.md',Buffer.from('test@example.com https://dav.example.com/calendar.json')),[]);
});

test('source export uses an explicit selection and does not carry local data or Git metadata', async t => {
 const root=await mkdtemp(join(tmpdir(),'suili-public-test-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const source=join(root,'source'),output=join(root,'public');
 await mkdir(join(source,'web'),{recursive:true});await mkdir(join(source,'.local'));
 await writeFile(join(source,'README.md'),'# Example project\n');await writeFile(join(source,'LICENSE'),'Apache-2.0\n');
 await writeFile(join(source,'web','app.mjs'),'export const example=true;\n');
 await writeFile(join(source,'.local','snapshot.json'),'private fixture');
 const result=await exportPublicSource({root:source,output});
 assert.equal(result.files,3);
 const manifest=JSON.parse(await readFile(join(output,'PUBLIC_SOURCE_MANIFEST.json'),'utf8'));
 assert.deepEqual(manifest.files.map(file=>file.path),['LICENSE','README.md','web/app.mjs']);
 assert.ok(!JSON.stringify(manifest).includes(source));
 await assert.rejects(readFile(join(output,'.local','snapshot.json')),/ENOENT/);
 await assert.rejects(readFile(join(output,'.git','config')),/ENOENT/);
 await assert.rejects(exportPublicSource({root:source,output}),/already exists/);
});

test('source export stops on a privacy finding before creating a destination', async t => {
 const root=await mkdtemp(join(tmpdir(),'suili-public-test-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const source=join(root,'source'),output=join(root,'public');await mkdir(source);
 await writeFile(join(source,'README.md'),['person','private.invalid-domain.net'].join('@'));
 await assert.rejects(exportPublicSource({root:source,output}),/Privacy check failed/);
 await assert.rejects(readFile(join(output,'README.md')),/ENOENT/);
});

test('source export rejects symlinks instead of following them outside the source', {skip:process.platform==='win32'}, async t => {
 const root=await mkdtemp(join(tmpdir(),'suili-public-test-'));
 t.after(()=>rm(root,{recursive:true,force:true}));
 const source=join(root,'source'),output=join(root,'public');await mkdir(source);
 await writeFile(join(root,'private.txt'),'private fixture');await symlink(join(root,'private.txt'),join(source,'README.md'));
 await assert.rejects(exportPublicSource({root:source,output}),/Symlinks are not exported/);
});
