import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyTask, validateTask, validateOperation, mergeOperations, materialize, makeOperation, dateAdd, startOfWeek, shiftPlan } from '../shared/core.mjs';
import * as core from '../shared/core.mjs';

const taskId = '12345678-1234-4234-8234-123456789abc';
const otherId = '22345678-1234-4234-8234-123456789abc';
const task = (changes = {}) => ({ ...emptyTask('整理资料', taskId), ...changes });
const op = (id, value = task(), parents = [], date = '2026-10-23T10:00:00.000Z') => ({ id, taskId: value.id, parents, deviceId: 'desktop', createdAt: date, task: value });

test('default task is unscheduled and validates its complete schema', () => {
  const value = task();
  assert.deepEqual(value, { id: taskId, title: '整理资料', notes: '', plan: { kind: 'none', start: null, end: null }, deadline: null, completed: false, deleted: false, color: '#477766' });
  assert.equal(validateTask(value), value);
  assert.match(emptyTask('new').id, /^[\da-f-]{36}$/i);
  for (const value of [task({ title: ' ' }), task({ title: 'x'.repeat(301) }), task({ id: 'wrong' }), task({ color: '#xyzxyz' }), task({ completed: 1 }), task({ notes: null }), task({ deadline: '2026-02-29' })]) assert.throws(() => validateTask(value));
});

test('protocol objects reject unknown fields instead of stripping them during cross-client exchange', () => {
  assert.throws(() => validateTask(task({ uiSelected: true })), /field|字段/i);
  assert.throws(() => validateTask(task({ plan: { kind: 'none', start: null, end: null, timeZone: 'Asia/Shanghai' } })), /field|字段/i);
  assert.throws(() => validateOperation({ ...op('a'), secret: 'must-not-roundtrip' }), /field|字段/i);
});

test('calendar arithmetic spans months, leap days, years and stays date-only', () => {
  assert.equal(dateAdd('2026-10-31', 1), '2026-11-01');
  assert.equal(dateAdd('2024-02-28', 1), '2024-02-29');
  assert.equal(dateAdd('2026-01-01', -1), '2025-12-31');
  assert.equal(dateAdd('0099-12-31', 1), '0100-01-01');
  assert.equal(startOfWeek('2026-11-01'), '2026-10-26');
  assert.equal(startOfWeek('2026-10-26'), '2026-10-26');
  assert.throws(() => dateAdd('2026-02-30', 1));
  assert.throws(() => dateAdd('2026-10-23', 0.5));
  assert.throws(() => dateAdd('9999-12-31', 1));
});

test('moving ranges preserves inclusive length and independent deadline', () => {
  const value = task({ plan: { kind: 'range', start: '2026-10-26', end: '2026-11-01' }, deadline: '2026-11-08' });
  const moved = shiftPlan(value, '2026-11-09');
  assert.deepEqual(moved.plan, { kind: 'range', start: '2026-11-09', end: '2026-11-15' });
  assert.equal(moved.deadline, '2026-11-08');
  assert.equal(value.plan.start, '2026-10-26');
  assert.deepEqual(shiftPlan(task(), '2026-11-01').plan, { kind: 'day', start: '2026-11-01', end: '2026-11-01' });
});

test('week plans normalize target dates to Monday through Sunday', () => {
  const value = task({ plan: { kind: 'week', start: '2026-10-26', end: '2026-11-01' } });
  assert.deepEqual(shiftPlan(value, '2026-11-08').plan, { kind: 'week', start: '2026-11-02', end: '2026-11-08' });
  for (const plan of [{ kind: 'week', start: '2026-10-27', end: '2026-11-02' }, { kind: 'day', start: '2026-10-26', end: '2026-10-27' }, { kind: 'range', start: '2026-11-01', end: '2026-10-26' }, { kind: 'none', start: '2026-10-23', end: null }]) assert.throws(() => validateTask(task({ plan })));
});

test('duplicate delivery is idempotent and object property order is irrelevant', () => {
  const a = op('a');
  const reordered = { task: a.task, createdAt: a.createdAt, deviceId: a.deviceId, parents: [], taskId: taskId, id: 'a' };
  assert.equal(mergeOperations([a], [reordered, a]).length, 1);
  assert.throws(() => mergeOperations([a], [op('a', task({ title: 'changed' }))]), /same|different|内容|ID/i);
});

test('concurrent edits remain conflicts regardless of device clock', () => {
  const a = op('a');
  const b = op('b', task({ completed: true }), ['a'], '2026-10-23T11:00:00.000Z');
  const c = op('c', task({ title: 'phone title' }), ['a'], '2026-10-23T09:00:00.000Z');
  const merged = mergeOperations([a, b], [c, a]);
  const state = materialize(merged);
  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0].completed, true);
  assert.deepEqual(new Set(state.heads[taskId]), new Set(['b', 'c']));
  assert.equal(state.conflicts.length, 1);
  assert.equal(state.conflicts[0].heads.length, 2);
  const resolved = makeOperation(task({ title: 'phone title', completed: true }), merged, 'phone', { id: 'resolved', createdAt: '2026-10-23T12:00:00.000Z' });
  assert.deepEqual(new Set(resolved.parents), new Set(['b', 'c']));
  assert.equal(materialize(mergeOperations(merged, [resolved])).conflicts.length, 0);
});

test('deleted task remains a tombstone and retrying old operations cannot resurrect it', () => {
  const a = op('a');
  const deleted = makeOperation(task({ deleted: true }), [a], 'desktop', { id: 'd' });
  const state = materialize(mergeOperations([a, deleted], [a]));
  assert.equal(state.tasks[0].deleted, true);
  assert.deepEqual(state.heads[taskId], ['d']);
});

test('unordered batches validate the full causal graph; tasks merge independently', () => {
  const a = op('a');
  const b = op('b', task({ completed: true }), ['a']);
  const c = op('c', task({ id: otherId }));
  assert.equal(materialize(mergeOperations([], [b, c, a])).tasks.length, 2);
  assert.throws(() => mergeOperations([], [op('bad', task(), ['missing'])]), /parent|父/i);
  assert.throws(() => mergeOperations([], [a, op('cross', task({ id: otherId }), ['a'])]), /task|事项/i);
  assert.throws(() => mergeOperations([], [op('a', task(), ['b']), op('b', task(), ['a'])]), /cycle|循环/i);
  assert.throws(() => mergeOperations([], [op('self', task(), ['self'])]));
  assert.throws(() => validateOperation({ ...a, taskId: otherId }));
  assert.throws(() => validateOperation({ ...a, createdAt: 'tomorrow' }));
  assert.throws(() => validateOperation({ ...a, parents: ['b', 'b'] }));
});

test('causality wins over timestamps and equal clock previews have deterministic ID ordering', () => {
  const a = op('a', task(), [], '2026-10-23T12:00:00.000Z');
  const b = op('b', task({ title: 'clock behind' }), ['a'], '2026-10-23T09:00:00.000Z');
  assert.equal(materialize([a, b]).tasks[0].title, 'clock behind');
  const c = op('c', task({ title: 'tie' }), ['a'], b.createdAt);
  assert.equal(materialize([c, a, b]).tasks[0].title, 'tie');
  assert.deepEqual(materialize([c, a, b]), materialize([b, c, a]));
});

const dayPart = date => ({ kind: 'day', start: date, end: date });
const rangePart = (start, end) => ({ kind: 'range', start, end });
const multiPlan = (...segments) => ({ kind: 'segments', start: segments[0].start, end: segments.at(-1).end, segments });

test('multiple periods validate without changing legacy records or inserting default fields', () => {
  const plans = [
    { kind: 'none', start: null, end: null }, dayPart('2026-11-02'),
    rangePart('2026-11-04', '2026-11-06'),
    { kind: 'week', start: '2026-11-09', end: '2026-11-15' },
    multiPlan(dayPart('2026-11-02'), rangePart('2026-11-04', '2026-11-06')),
  ];
  for (const plan of plans) {
    const value = task({ plan });
    const before = JSON.stringify(value);
    assert.equal(validateTask(value), value);
    assert.equal(JSON.stringify(value), before);
    assert.equal(Object.hasOwn(plan, 'segments'), plan.kind === 'segments');
  }
});

test('multiple periods require exact envelopes and sorted nonoverlapping valid simple segments', () => {
  const first = dayPart('2026-11-02'), second = rangePart('2026-11-04', '2026-11-06');
  const valid = multiPlan(first, second);
  const invalid = [
    { ...valid, segments: [] }, { ...valid, segments: [first] }, { ...valid, segments: null },
    { ...valid, segments: [second, first] }, { ...valid, start: '2026-11-01' },
    { ...valid, end: '2026-11-07' }, { ...valid, color: '#ffffff' },
    multiPlan(rangePart('2026-11-02', '2026-11-04'), second),
    { ...valid, segments: [first, valid] },
    { ...valid, segments: [first, { ...second, extra: true }] },
    { ...valid, segments: [first, { kind: 'none', start: null, end: null }] },
    { ...valid, segments: [first, { kind: 'week', start: '2026-11-04', end: '2026-11-10' }] },
    { ...valid, segments: [first, rangePart('2026-11-04', '2026-02-30')] },
  ];
  for (const plan of invalid) assert.throws(() => validateTask(task({ plan })), JSON.stringify(plan));
  assert.equal(validateTask(task({ plan: multiPlan(first, dayPart('2026-11-03')) })).plan.kind, 'segments');
});

test('plan helpers unpack all kinds and pack sorted parts without merging adjacent days', () => {
  assert.equal(typeof core.planParts, 'function');
  assert.equal(typeof core.packPlan, 'function');
  const first = dayPart('2026-11-02'), second = rangePart('2026-11-04', '2026-11-06');
  const parts = Object.freeze([Object.freeze(second), Object.freeze(first)]);
  assert.deepEqual(core.planParts(task().plan), []);
  assert.deepEqual(core.planParts(first), [first]);
  assert.deepEqual(core.planParts(multiPlan(first, second)), [first, second]);
  assert.deepEqual(core.packPlan(parts), multiPlan(first, second));
  assert.deepEqual(core.packPlan([]), task().plan);
  assert.deepEqual(core.packPlan([first]), first);
  assert.deepEqual(core.packPlan([dayPart('2026-11-03'), first]), multiPlan(first, dayPart('2026-11-03')));
  for (const invalid of [null, [task().plan], [multiPlan(first, second)], [{ ...first, extra: 1 }]]) assert.throws(() => core.packPlan(invalid));
});

test('packing unions overlapping parts while preserving an exact repeated week', () => {
  assert.equal(typeof core.packPlan, 'function');
  const week = { kind: 'week', start: '2026-11-02', end: '2026-11-08' };
  assert.deepEqual(core.packPlan([week, { ...week }]), week);
  assert.deepEqual(core.packPlan([dayPart('2026-11-04'), week]), rangePart('2026-11-02', '2026-11-08'));
  assert.deepEqual(core.packPlan([rangePart('2026-11-04', '2026-11-06'), rangePart('2026-11-02', '2026-11-04'), dayPart('2026-11-02')]), rangePart('2026-11-02', '2026-11-06'));
});

test('moving all periods preserves each duration, gaps and independent deadline', () => {
  const plan = multiPlan(dayPart('2026-11-02'), rangePart('2026-11-04', '2026-11-06'));
  const source = task({ plan, deadline: '2026-11-20' });
  const snapshot = JSON.stringify(source);
  assert.deepEqual(shiftPlan(source, '2026-11-09'), { ...source, plan: multiPlan(dayPart('2026-11-09'), rangePart('2026-11-11', '2026-11-13')) });
  assert.throws(() => shiftPlan(source, '9999-12-30'));
  assert.equal(JSON.stringify(source), snapshot);
});

test('moving a mixed plan shifts by complete weeks so flexible week periods stay valid', () => {
  const source = task({ plan: multiPlan(dayPart('2026-11-04'), { kind: 'week', start: '2026-11-09', end: '2026-11-15' }) });
  assert.deepEqual(shiftPlan(source, '2026-11-20').plan, multiPlan(dayPart('2026-11-18'), { kind: 'week', start: '2026-11-23', end: '2026-11-29' }));
});

test('mixed historical and multiple-period operation snapshots roundtrip without migration', () => {
  const old = op('a', task({ plan: dayPart('2026-11-02') }));
  const before = JSON.stringify(old);
  const next = makeOperation(task({ plan: multiPlan(dayPart('2026-11-02'), rangePart('2026-11-04', '2026-11-06')) }), [old], 'phone', { id: 'b', createdAt: '2026-10-30T12:00:00.000Z' });
  const snapshot = { schemaVersion: 1, operations: [old, next] };
  const parsed = JSON.parse(JSON.stringify(snapshot));
  const merged = mergeOperations(parsed.operations, [old]);
  assert.equal(JSON.stringify(merged[0]), before);
  assert.equal(JSON.stringify(old), before);
  assert.deepEqual(merged, snapshot.operations);
  assert.equal(validateOperation(next), next);
  assert.deepEqual(materialize(merged).tasks, [next.task]);
});
