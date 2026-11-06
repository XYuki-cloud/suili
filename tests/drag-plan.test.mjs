import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyTask } from '../shared/core.mjs';
import { daysBetween, planBetween, resizeTask, moveTask, weekTaskAt, unplanTask, deadlineAt } from '../web/drag-plan.mjs';
import * as drag from '../web/drag-plan.mjs';

const task = (plan = { kind: 'none', start: null, end: null }) => ({
 ...emptyTask('准备报告', '11111111-1111-4111-8111-111111111111'),
 notes: '保留正文', color: '#345678', deadline: '2026-12-20', plan,
});
const day = date => ({ kind: 'day', start: date, end: date });
const range = (start, end) => ({ kind: 'range', start, end });
const frozen = value => Object.freeze({ ...value, plan: Object.freeze({ ...value.plan }) });

test('日期差使用有符号 UTC 日数，跨年和闰日仍精确', () => {
 assert.equal(daysBetween('2026-12-31', '2027-01-02'), 2);
 assert.equal(daysBetween('2024-02-28', '2024-03-01'), 2);
 assert.equal(daysBetween('2024-03-01', '2024-02-28'), -2);
 assert.equal(daysBetween('0001-01-01', '0001-01-02'), 1);
 assert.equal(daysBetween('9999-12-31', '9999-12-31'), 0);
});

test('日期差拒绝格式错误、无效闰日和协议年份之外的日期', () => {
 for (const invalid of ['2026-02-29', '2026-13-01', '2026-04-31', '0000-01-01', '10000-01-01', '2026-1-01', null]) {
  assert.throws(() => daysBetween(invalid, '2026-01-01'));
  assert.throws(() => daysBetween('2026-01-01', invalid));
 }
});

test('反向划选跨年自动形成正序范围，同日划选形成单日', () => {
 assert.deepEqual(planBetween('2027-01-02', '2026-12-30'), range('2026-12-30', '2027-01-02'));
 assert.deepEqual(planBetween('2024-02-29', '2024-02-29'), day('2024-02-29'));
 assert.throws(() => planBetween('2026-02-30', '2026-03-01'));
});

test('单日事项的任一端可以拉成多日，硬截止和其他字段不动', () => {
 const source = frozen(task(day('2026-10-23')));
 const earlier = resizeTask(source, 'start', '2026-10-20');
 const later = resizeTask(source, 'end', '2026-10-28');
 assert.deepEqual(earlier, { ...source, plan: range('2026-10-20', '2026-10-23') });
 assert.deepEqual(later, { ...source, plan: range('2026-10-23', '2026-10-28') });
 assert.notEqual(earlier, source);
 assert.deepEqual(source.plan, day('2026-10-23'));
});

test('拉伸范围只移动选中端，穿越另一端时夹紧成单日', () => {
 const source = frozen(task(range('2026-10-23', '2026-11-03')));
 assert.deepEqual(resizeTask(source, 'start', '2026-10-25').plan, range('2026-10-25', '2026-11-03'));
 assert.deepEqual(resizeTask(source, 'end', '2026-10-30').plan, range('2026-10-23', '2026-10-30'));
 assert.deepEqual(resizeTask(source, 'start', '2026-11-10').plan, day('2026-11-03'));
 assert.deepEqual(resizeTask(source, 'end', '2026-10-01').plan, day('2026-10-23'));
});

test('跨周抓取范围中段移动时保留抓取偏移、原持续日数和硬截止', () => {
 const source = frozen(task(range('2026-10-23', '2026-11-03')));
 const moved = moveTask(source, '2027-01-02', 5);
 assert.deepEqual(moved, { ...source, plan: range('2026-12-28', '2027-01-08') });
 assert.equal(daysBetween(moved.plan.start, moved.plan.end), 11);
 assert.notEqual(moved, source);
 assert.deepEqual(source.plan, range('2026-10-23', '2026-11-03'));
});

test('单日移动和待安排拖入日期都产生单日，闰日可以作为目标', () => {
 assert.deepEqual(moveTask(task(day('2026-10-23')), '2024-02-29').plan, day('2024-02-29'));
 assert.deepEqual(moveTask(task(), '2026-11-01').plan, day('2026-11-01'));
});

test('周事项移动直接归入目标所在周，不减去旧周抓取偏移', () => {
 const source = frozen(task({ kind: 'week', start: '2026-10-19', end: '2026-10-25' }));
 const moved = moveTask(source, '2026-11-02', 6);
 assert.deepEqual(moved, { ...source, plan: { kind: 'week', start: '2026-11-02', end: '2026-11-08' } });
});

test('转换到周计划支持周日和跨年，保留硬截止', () => {
 const source = frozen(task(day('2026-10-23')));
 assert.deepEqual(weekTaskAt(source, '2027-01-03'), {
  ...source, plan: { kind: 'week', start: '2026-12-28', end: '2027-01-03' },
 });
});

test('移回待安排只清除计划，拖动截止只修改截止且返回独立对象', () => {
 const source = frozen(task(range('2026-10-23', '2026-10-25')));
 const unscheduled = unplanTask(source);
 const changedDeadline = deadlineAt(source, '2026-10-24');
 assert.deepEqual(unscheduled, { ...source, plan: { kind: 'none', start: null, end: null } });
 assert.deepEqual(changedDeadline, { ...source, deadline: '2026-10-24' });
 assert.notEqual(unscheduled, source);
 assert.notEqual(changedDeadline, source);
 assert.notEqual(changedDeadline.plan, source.plan);
});

test('非法输入与日期溢出会拒绝，不改变原事项', () => {
 const source = frozen(task(range('2026-10-23', '2026-10-25')));
 const snapshot = JSON.stringify(source);
 for (const action of [
  () => resizeTask(source, 'middle', '2026-10-24'),
  () => resizeTask(source, 'end', '2026-02-30'),
  () => resizeTask(task(), 'end', '2026-10-24'),
  () => resizeTask(task({ kind: 'week', start: '2026-10-19', end: '2026-10-25' }), 'end', '2026-10-24'),
  () => moveTask(source, '9999-12-31'),
  () => moveTask(source, '0001-01-01', 1),
  () => moveTask(source, '2026-11-01', 1.5),
  () => weekTaskAt(source, '9999-12-31'),
  () => deadlineAt(source, '2026-02-30'),
 ]) assert.throws(action);
 assert.equal(JSON.stringify(source), snapshot);
});

test('所有任务变换拒绝非法源事项，不能通过改目标字段悄悄修复源数据', () => {
 const invalid = task(day('2026-10-23'));
 invalid.title = '';
 const snapshot = JSON.stringify(invalid);
 for (const action of [
  () => resizeTask(invalid, 'end', '2026-10-24'),
  () => moveTask(invalid, '2026-11-01'),
  () => weekTaskAt(invalid, '2026-11-01'),
  () => unplanTask(invalid),
  () => deadlineAt(invalid, '2026-11-01'),
 ]) assert.throws(action);
 assert.equal(JSON.stringify(invalid), snapshot);
});

const periods = (...segments) => ({ kind: 'segments', start: segments[0].start, end: segments.at(-1).end, segments });

test('给同一事项追加不连续计划保留原段与截止，重叠段由协议助手归并', () => {
 assert.equal(typeof drag.appendTaskPlan, 'function');
 const source = frozen(task(day('2026-11-02'))), snapshot = JSON.stringify(source);
 const appended = drag.appendTaskPlan(source, range('2026-11-04', '2026-11-06'));
 assert.deepEqual(appended, { ...source, plan: periods(day('2026-11-02'), range('2026-11-04', '2026-11-06')) });
 assert.deepEqual(drag.appendTaskPlan(appended, range('2026-11-02', '2026-11-04')).plan, range('2026-11-02', '2026-11-06'));
 assert.deepEqual(drag.appendTaskPlan(task(), day('2026-11-02')).plan, day('2026-11-02'));
 assert.equal(JSON.stringify(source), snapshot);
});

test('移除指定段后保留其余段，倒数第二段退为旧单段，最后一段退为待安排', () => {
 assert.equal(typeof drag.removeTaskSegment, 'function');
 const source = frozen(task(periods(day('2026-11-02'), range('2026-11-04', '2026-11-06'), day('2026-11-09'))));
 const snapshot = JSON.stringify(source);
 const first = drag.removeTaskSegment(source, 1);
 assert.deepEqual(first, { ...source, plan: periods(day('2026-11-02'), day('2026-11-09')) });
 const second = drag.removeTaskSegment(first, 0);
 assert.deepEqual(second, { ...source, plan: day('2026-11-09') });
 assert.deepEqual(drag.removeTaskSegment(second, 0), { ...source, plan: { kind: 'none', start: null, end: null } });
 assert.equal(JSON.stringify(source), snapshot);
});

test('指定索引移动一段保留其他段，跨越前段后按日期重排，抓取偏移只应用于该段', () => {
 const source = frozen(task(periods(day('2026-11-02'), range('2026-11-04', '2026-11-06'))));
 const snapshot = JSON.stringify(source);
 assert.deepEqual(moveTask(source, '2026-11-12', 1, 1), { ...source, plan: periods(day('2026-11-02'), range('2026-11-11', '2026-11-13')) });
 assert.deepEqual(moveTask(source, '2026-10-29', 1, 1).plan, periods(range('2026-10-28', '2026-10-30'), day('2026-11-02')));
 assert.deepEqual(moveTask(source, '2026-11-02', 0, 1).plan, range('2026-11-02', '2026-11-04'));
 assert.equal(JSON.stringify(source), snapshot);
});

test('无索引移动整项保留不连续间隔和抓取偏移，含周段时只能整体偏移整周', () => {
 const source = frozen(task(periods(day('2026-11-02'), range('2026-11-04', '2026-11-06'))));
 assert.deepEqual(moveTask(source, '2026-11-11', 2), { ...source, plan: periods(day('2026-11-09'), range('2026-11-11', '2026-11-13')) });
 const mixed = task(periods(day('2026-11-04'), { kind: 'week', start: '2026-11-09', end: '2026-11-15' }));
 assert.deepEqual(moveTask(mixed, '2026-11-20').plan, periods(day('2026-11-18'), { kind: 'week', start: '2026-11-23', end: '2026-11-29' }));
});

test('指定索引拉伸跨周只改该段，重叠时归并且不会跨间隙伪造额外安排', () => {
 const source = frozen(task(periods(day('2026-11-02'), range('2026-11-04', '2026-11-06'))));
 assert.deepEqual(resizeTask(source, 'end', '2026-11-10', 1), { ...source, plan: periods(day('2026-11-02'), range('2026-11-04', '2026-11-10')) });
 assert.deepEqual(resizeTask(source, 'end', '2026-11-03', 0).plan, periods(range('2026-11-02', '2026-11-03'), range('2026-11-04', '2026-11-06')));
 assert.deepEqual(resizeTask(source, 'end', '2026-11-04', 0).plan, range('2026-11-02', '2026-11-06'));
 assert.throws(() => resizeTask(source, 'end', '2026-11-10'), /segment|段/i);
});

test('指定索引转换成弹性周只改该段，无索引多段拖入周区则整体按周平移', () => {
 const source = frozen(task(periods(day('2026-11-04'), range('2026-11-09', '2026-11-11'))));
 assert.deepEqual(weekTaskAt(source, '2026-11-18', 1), { ...source, plan: periods(day('2026-11-04'), { kind: 'week', start: '2026-11-16', end: '2026-11-22' }) });
 assert.deepEqual(weekTaskAt(source, '2026-11-20'), { ...source, plan: periods(day('2026-11-18'), range('2026-11-23', '2026-11-25')) });
 const mixed = task(periods(day('2026-11-04'), { kind: 'week', start: '2026-11-09', end: '2026-11-15' }));
 assert.deepEqual(moveTask(mixed, '2026-11-20', 6, 1).plan, periods(day('2026-11-04'), { kind: 'week', start: '2026-11-16', end: '2026-11-22' }));
});

test('替换指定周段为具体日安排保留其他段，替换助手拒绝嵌套或空计划', () => {
 assert.equal(typeof drag.replaceTaskSegment, 'function');
 const source = frozen(task(periods(day('2026-11-04'), { kind: 'week', start: '2026-11-09', end: '2026-11-15' })));
 assert.deepEqual(drag.replaceTaskSegment(source, 1, day('2026-11-12')), { ...source, plan: periods(day('2026-11-04'), day('2026-11-12')) });
 assert.deepEqual(drag.replaceTaskSegment(task(day('2026-11-04')), 0, range('2026-11-09', '2026-11-11')).plan, range('2026-11-09', '2026-11-11'));
 assert.throws(() => drag.replaceTaskSegment(source, 0, source.plan));
 assert.throws(() => drag.replaceTaskSegment(source, 0, { kind: 'none', start: null, end: null }));
});

test('非法段索引明确拒绝，不能回退成整项覆盖或修复非法来源', () => {
 assert.equal(typeof drag.removeTaskSegment, 'function');
 assert.equal(typeof drag.replaceTaskSegment, 'function');
 const source = frozen(task(periods(day('2026-11-02'), range('2026-11-04', '2026-11-06'))));
 const snapshot = JSON.stringify(source);
 for (const index of [-1, 2, 0.5, '0', null]) {
  for (const action of [
   () => resizeTask(source, 'end', '2026-11-10', index),
   () => moveTask(source, '2026-11-10', 0, index),
   () => weekTaskAt(source, '2026-11-10', index),
   () => drag.removeTaskSegment(source, index),
   () => drag.replaceTaskSegment(source, index, day('2026-11-10')),
  ]) assert.throws(action, /segment|段/i);
 }
 assert.throws(() => moveTask(task(), '2026-11-10', 0, 0), /segment|段/i);
 assert.throws(() => drag.removeTaskSegment(source, undefined), /segment|段/i);
 const invalid = { ...source, title: '' };
 assert.throws(() => drag.appendTaskPlan(invalid, day('2026-11-10')));
 assert.throws(() => drag.removeTaskSegment(invalid, 0));
 assert.throws(() => drag.replaceTaskSegment(invalid, 0, day('2026-11-10')));
 assert.equal(JSON.stringify(source), snapshot);
});

test('多段改截止保持全部计划，取消安排清空全部段', () => {
 const source = frozen(task(periods(day('2026-11-02'), range('2026-11-04', '2026-11-06'))));
 assert.deepEqual(deadlineAt(source, '2026-12-01'), { ...source, deadline: '2026-12-01' });
 assert.deepEqual(unplanTask(source), { ...source, plan: { kind: 'none', start: null, end: null } });
});
