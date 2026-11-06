import test from 'node:test';
import assert from 'node:assert/strict';
import * as form from '../web/task-form.mjs';

test('multi-period metadata editing preserves all periods until allocation is disabled',()=>{
 const segments=[{kind:'day',start:'2026-11-02',end:'2026-11-02'},{kind:'range',start:'2026-11-04',end:'2026-11-06'}];
 const fields={hasDeadline:true,deadline:'2026-11-11',allocateTime:true,kind:'segments',segments};
 assert.deepEqual(form.taskTiming(fields),{deadline:'2026-11-11',plan:{kind:'segments',start:'2026-11-02',end:'2026-11-06',segments}});
 assert.deepEqual(form.taskTiming({...fields,hasDeadline:false}).plan.segments,segments);
 assert.deepEqual(form.taskTiming({...fields,allocateTime:false}).plan,{kind:'none',start:null,end:null});
});
import { emptyTask, shiftPlan, validateTask } from '../shared/core.mjs';

const none={kind:'none',start:null,end:null};
const day={kind:'day',start:'2026-11-11',end:'2026-11-11'};
const deadline={hasDeadline:true,deadline:'2026-11-11',allocateTime:false,...day};

test('choosing deadline on a selected day does not also allocate that day',()=>{
 assert.deepEqual(form.taskTiming(deadline),{deadline:'2026-11-11',plan:none});
});
test('ordinary plans ignore a hidden deadline and retain their selected range',()=>{
 const plan={kind:'range',start:'2026-11-02',end:'2026-11-05'};
 assert.deepEqual(form.taskTiming({...plan,hasDeadline:false,deadline:'bad',allocateTime:false}),{deadline:null,plan});
 assert.deepEqual(form.taskTiming({kind:'none'}),{deadline:null,plan:none});
});
test('deadline tasks can independently allocate a day, a range or a week',()=>{
 assert.deepEqual(form.taskTiming({...deadline,allocateTime:true,...day}),{deadline:'2026-11-11',plan:day});
 const range={kind:'range',start:'2026-11-02',end:'2026-11-06'};
 assert.deepEqual(form.taskTiming({...deadline,allocateTime:true,...range}),{deadline:'2026-11-11',plan:range});
 assert.deepEqual(form.taskTiming({...deadline,allocateTime:true,kind:'week',start:'2026-11-04'}),{deadline:'2026-11-11',plan:{kind:'week',start:'2026-11-02',end:'2026-11-08'}});
});
test('disabled allocation ignores unfinished hidden dates',()=>{
 assert.deepEqual(form.taskTiming({...deadline,kind:'range',start:'',end:'bad'}),{deadline:'2026-11-11',plan:none});
});
test('enabled deadline and allocation require valid dates and ordered ranges',()=>{
 assert.throws(()=>form.taskTiming({...deadline,deadline:''}),/截止/);
 assert.throws(()=>form.taskTiming({...deadline,deadline:'2026-02-30'}),/截止/);
 assert.throws(()=>form.taskTiming({...deadline,allocateTime:true,kind:'day',start:''}),/处理|计划|开始/);
 assert.throws(()=>form.taskTiming({kind:'range',start:'2026-11-05',end:'2026-11-02'}),/结束/);
 assert.throws(()=>form.taskTiming({kind:'range',start:'2026-11-05',end:''}),/结束/);
 assert.throws(()=>form.taskTiming({kind:'day',start:'2026-02-30'}),/开始/);
 assert.throws(()=>form.taskTiming({kind:'unknown'}),/安排/);
});
test('allocation changes preserve independent deadline and the v1 task shape',()=>{
 const task=validateTask({...emptyTask('整理公开笔记'),...form.taskTiming(deadline)});
 const moved=shiftPlan(task,'2026-11-03');
 assert.equal(moved.deadline,'2026-11-11');
 assert.deepEqual(moved.plan,{kind:'day',start:'2026-11-03',end:'2026-11-03'});
 assert.deepEqual({...moved,...form.taskTiming({...deadline,allocateTime:false})},task);
});
test('plans after a deadline remain available to the existing confirmation flow',()=>{
 const plan={kind:'range',start:'2026-11-10',end:'2026-11-13'};
 assert.deepEqual(form.taskTiming({...deadline,allocateTime:true,...plan}),{deadline:'2026-11-11',plan});
});
