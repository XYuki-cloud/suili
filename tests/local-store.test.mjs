import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalStore } from '../web/local-store.mjs';
import { emptyTask, makeOperation } from '../shared/core.mjs';
const memory=()=>{const m=new Map();return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v)};};
test('本地保存重载、整批撤销和待同步数',()=>{
 const storage=memory(), s=new LocalStore(storage), t=emptyTask('作业');
 s.commit([t]); assert.equal(s.pending,1); assert.equal(new LocalStore(storage).view.tasks[0].title,'作业');
 s.undo(); assert.equal(s.view.tasks[0].deleted,true); assert.equal(s.pending,2);
});
test('同步期间的新操作保留且仍显示待同步',()=>{
 const s=new LocalStore(memory());const t=emptyTask('A');s.commit([t]);const outgoing=s.snapshot;
 s.commit([{...t,title:'B'}]); s.acceptRemote(outgoing);
 assert.equal(s.view.tasks[0].title,'B');assert.equal(s.pending,1);
});
test('并发编辑不被普通编辑或撤销静默解决',()=>{
 const s=new LocalStore(memory());const t=emptyTask('A');s.commit([t]);const base=s.snapshot.operations;
 s.commit([{...t,title:'本地'}]);s.acceptRemote({schemaVersion:1,operations:[...base,makeOperation({...t,title:'远程'},base,'other')]});
 assert.equal(s.view.conflicts.length,1);assert.throws(()=>s.commit([{...t,title:'覆盖'}]),/冲突/);assert.throws(()=>s.undo(),/更新/);
 s.commit([{...t,title:'选择本地'}],{resolve:true});assert.equal(s.view.conflicts.length,0);
});
test('存储写入失败不能假保存，损坏数据不能静默清空',()=>{
 const storage=memory(),s=new LocalStore(storage);storage.setItem=()=>{throw new Error('quota')};
 assert.throws(()=>s.commit([emptyTask('A')]),/quota/);assert.equal(s.view.tasks.length,0);
 assert.throws(()=>new LocalStore({getItem:()=>'{broken',setItem(){}}));
});
test('编辑窗口打开后别处更新，旧草稿不能覆盖新版本',()=>{
 const s=new LocalStore(memory());const t=emptyTask('A');s.commit([t]);const expectedHeads=structuredClone(s.view.heads);
 s.commit([{...t,notes:'较新修改'}]);
 assert.throws(()=>s.commit([{...t,title:'旧窗口'}],{expectedHeads}),/更新/);
 assert.equal(s.view.tasks[0].notes,'较新修改');
});
test('同一事项的连续本地修改可以逐步撤销',()=>{
 const s=new LocalStore(memory()),t=emptyTask('A');s.commit([t]);s.commit([{...t,title:'B'}]);
 s.undo();assert.equal(s.view.tasks[0].title,'A');s.undo();assert.equal(s.view.tasks[0].deleted,true);assert.equal(s.canUndo,false);
});
test('标签页失去编辑锁后，普通编辑、撤销和迟到的同步响应均不能写盘',()=>{
 let active=true;
 const storage=memory(),s=new LocalStore(storage,()=>active),t=emptyTask('已保存');
 s.commit([t]);const before=s.snapshot;
 active=false;
 assert.throws(()=>s.commit([{...t,title:'旧页编辑'}]),/标签页/);
 assert.throws(()=>s.undo(),/标签页/);
 assert.throws(()=>s.acceptRemote({schemaVersion:1,operations:[...before.operations,makeOperation({...t,title:'迟到同步'},before.operations,'remote')]}),/标签页/);
 assert.deepEqual(new LocalStore(storage).snapshot,before);
});
