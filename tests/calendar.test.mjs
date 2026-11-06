import test from 'node:test';
import assert from 'node:assert/strict';
import { getWeeks, layoutWeek, classifyTask, localToday, planLabel } from '../web/calendar.mjs';

test('连续四周从周一开始并跨月，不产生 UTC 日期漂移',()=>{
 const weeks=getWeeks('2026-10-23','four');
 assert.equal(weeks.length,4); assert.equal(weeks[0][0],'2026-10-19'); assert.equal(weeks[3][6],'2026-11-15');
 assert.equal(localToday(new Date(2026,9,23,0,1)),'2026-10-23');
});
test('月历包含月份完整日期，周一开始',()=>{
 const weeks=getWeeks('2026-11-15','month');
 assert.equal(weeks.length,6); assert.equal(weeks[0][0],'2026-10-26'); assert.equal(weeks[5][6],'2026-12-06');
});
test('单周模式仅显示锚点所在周，跨年仍为周一到周日',()=>{
 const weeks=getWeeks('2027-01-03','week');
 assert.equal(weeks.length,1);
 assert.deepEqual(weeks[0],['2026-12-28','2026-12-29','2026-12-30','2026-12-31','2027-01-01','2027-01-02','2027-01-03']);
});
test('跨周范围切成连续横条，重叠横条分行，周任务不伪装为每天事件',()=>{
 const task=(id,start,end,kind='range')=>({id,title:id,plan:{kind,start,end},completed:false,deleted:false});
 const result=layoutWeek([task('a','2026-10-23','2026-11-03'),task('b','2026-10-27','2026-10-29'),task('w','2026-10-26','2026-11-01','week')],'2026-10-26');
 assert.deepEqual(result.segments.map(s=>[s.task.id,s.startColumn,s.span,s.lane]),[['a',0,7,0],['b',1,3,1]]);
 assert.equal(result.segments[0].continuesBefore,true); assert.equal(result.segments[0].continuesAfter,true); assert.equal(result.weekTasks[0].task.id,'w');
});
test('软计划过期只待重排，硬截止过期才逾期，完成事项不告警',()=>{
 const task={plan:{kind:'day',start:'2026-10-20',end:'2026-10-20'},completed:false,deadline:null};
 assert.equal(classifyTask(task,'2026-10-23'),'replan');
 assert.equal(classifyTask({...task,deadline:'2026-10-22'},'2026-10-23'),'overdue');
 assert.equal(classifyTask({...task,deadline:'2026-10-23'},'2026-10-23'),'due');
 assert.equal(classifyTask({...task,completed:true},'2026-10-23'),'completed');
});

const day = date => ({ kind: 'day', start: date, end: date });
const range = (start, end) => ({ kind: 'range', start, end });
const periods = (...segments) => ({ kind: 'segments', start: segments[0].start, end: segments.at(-1).end, segments });
const calendarTask = (id, plan, deadline = null) => ({ id, title: id, plan, deadline, completed: false, deleted: false });

test('多段逐段布局，间隙留空，所有条带携带原事项和真实段索引', () => {
 const value = calendarTask('multi', periods(day('2026-11-02'), range('2026-11-04', '2026-11-06'), range('2026-11-08', '2026-11-10')));
 const result = layoutWeek([value], '2026-11-02');
 assert.deepEqual(result.segments.map(s => [s.segmentIndex, s.startColumn, s.span, s.lane]), [[0, 0, 1, 0], [1, 2, 3, 0], [2, 6, 1, 0]]);
 for (const s of result.segments) { assert.equal(s.task, value); assert.equal(s.plan, value.plan.segments[s.segmentIndex]); }
 assert.equal(result.segments[2].continuesAfter, true);
 const next = layoutWeek([value], '2026-11-09');
 assert.deepEqual(next.segments.map(s => [s.segmentIndex, s.startColumn, s.span, s.continuesBefore]), [[2, 0, 2, true]]);
});

test('多段中的弹性周安排独立进入周区且保持原段索引', () => {
 const value = calendarTask('multi', periods(day('2026-11-04'), { kind: 'week', start: '2026-11-09', end: '2026-11-15' }));
 const result = layoutWeek([value], '2026-11-09');
 assert.deepEqual(result.segments, []);
 assert.deepEqual(result.weekTasks, [{ task: value, plan: value.plan.segments[1], segmentIndex: 1 }]);
 assert.equal(result.laneCount, 0);
});

test('截止占当前日期最早空行，不被其他日期的普通安排整体压低', () => {
 const ordinary = calendarTask('ordinary', range('2026-11-02', '2026-11-04'));
 const due = calendarTask('due', { kind: 'none', start: null, end: null }, '2026-11-06');
 const result = layoutWeek([ordinary, due], '2026-11-02');
 assert.deepEqual(result.deadlines, [{ task: due, startColumn: 4, span: 1, lane: 0 }]);
 assert.equal(result.laneCount, 1);
});

test('截止只避开本日占用，同日多个截止分行，删除安排后自动回填空位', () => {
 const occupied = calendarTask('occupied', day('2026-11-06'));
 const a = calendarTask('a', { kind: 'none', start: null, end: null }, '2026-11-06');
 const b = calendarTask('b', { kind: 'none', start: null, end: null }, '2026-11-06');
 const otherDay = calendarTask('c', { kind: 'none', start: null, end: null }, '2026-11-07');
 const result = layoutWeek([b, occupied, otherDay, a], '2026-11-02');
 assert.deepEqual(result.deadlines.map(s => [s.task.id, s.startColumn, s.lane]), [['a', 4, 1], ['b', 4, 2], ['c', 5, 0]]);
 assert.equal(result.laneCount, 3);
 const removed = layoutWeek([{ ...occupied, deleted: true }, a, b], '2026-11-02');
 assert.deepEqual(removed.deadlines.map(s => s.lane), [0, 1]);
 assert.equal(removed.laneCount, 2);
});

test('截止可放入多段间隙且周区事项不占具体日格，已删和周外截止不显示', () => {
 const value = calendarTask('multi', periods(day('2026-11-02'), range('2026-11-04', '2026-11-06')), '2026-11-03');
 const week = calendarTask('week', { kind: 'week', start: '2026-11-02', end: '2026-11-08' }, '2026-11-08');
 const hidden = calendarTask('hidden', { kind: 'none', start: null, end: null }, '2026-11-03');
 const outside = { ...hidden, id: 'outside', deadline: '2026-11-09' };
 const result = layoutWeek([value, week, { ...hidden, deleted: true }, outside], '2026-11-02');
 assert.deepEqual(result.deadlines.map(s => [s.task.id, s.startColumn, s.lane]), [['multi', 1, 0], ['week', 6, 0]]);
 assert.equal(result.laneCount, 1);
});

test('多段摘要逐段显示，不伪造连续区间', () => {
 const value = calendarTask('multi', periods(day('2026-11-02'), range('2026-11-04', '2026-11-06')));
 assert.equal(planLabel(value), '11/2；11/4 – 11/6');
 assert.equal(planLabel(calendarTask('week', { kind: 'week', start: '2026-11-09', end: '2026-11-15' })), '11/9 – 11/15 · 这周找时间');
 assert.equal(classifyTask(value, '2026-11-03'), 'planned');
 assert.equal(classifyTask(value, '2026-11-07'), 'replan');
});
