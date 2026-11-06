import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dateAdd, emptyTask, makeOperation, mergeOperations, packPlan, shiftPlan, startOfWeek } from '../../shared/core.mjs';
import { weekTaskAt } from '../../web/drag-plan.mjs';

const java = process.argv[2], classpath = process.argv[3];
const output = fileURLToPath(new URL('../build/multiple-period-tests/interop/', import.meta.url));
mkdirSync(output, { recursive: true });
const fixture = JSON.parse(readFileSync(new URL('./fixtures/multiple-periods.json', import.meta.url), 'utf8'));
assert.deepEqual(mergeOperations([], fixture.operations), fixture.operations);

const legacy = emptyTask('  Node旧记录保持空格  ', '33333333-3333-4333-8333-333333333333');
legacy.plan = { kind: 'day', start: '2026-12-01', end: '2026-12-01' };
legacy.deadline = '2026-12-31';
const a = makeOperation(legacy, [], 'node-host', { id: 'd-node-legacy', createdAt: '2026-10-30T12:03:00.000Z' });
const multi = structuredClone(legacy);
multi.plan = packPlan([
  { kind: 'range', start: '2026-12-10', end: '2026-12-12' },
  { kind: 'day', start: '2026-12-01', end: '2026-12-01' },
  { kind: 'week', start: '2026-12-14', end: '2026-12-20' },
]);
const b = makeOperation(multi, [a], 'node-host', { id: 'e-node-multi', createdAt: '2026-10-30T12:04:00.000Z' });
const shifted = shiftPlan(multi, '2026-12-09');
const c = makeOperation(shifted, [a, b], 'node-host', { id: 'f-node-shift', createdAt: '2026-10-30T12:05:00.000Z' });
const midweek = emptyTask('周三与周五保持星期位置', '44444444-4444-4444-8444-444444444444');
midweek.deadline = '2026-11-20';
midweek.plan = packPlan([
  { kind: 'day', start: '2026-11-04', end: '2026-11-04' },
  { kind: 'day', start: '2026-11-06', end: '2026-11-06' },
]);
const d = makeOperation(midweek, [], 'node-host', { id: 'g-node-midweek', createdAt: '2026-10-30T12:06:00.000Z' });
const expected = { schemaVersion: 1, operations: mergeOperations(fixture.operations, [a, b, c, d]) };
const inputPath = `${output}/node-input.json`, outputPath = `${output}/java-output.json`, movedPath = `${output}/java-next-week.json`;
writeFileSync(inputPath, JSON.stringify(expected), 'utf8');
const result = spawnSync(java, ['-Dfile.encoding=UTF-8', '-cp', classpath, 'app.flexible.calendar.ProtocolRoundtrip', inputPath, outputPath, movedPath, d.id, '2026-11-04'], { encoding: 'utf8', timeout: 30_000, env: process.env });
if (result.error) throw result.error;
assert.equal(result.status, 0, result.stderr || result.stdout);
const actual = JSON.parse(readFileSync(outputPath, 'utf8'));
assert.deepEqual(actual, expected, 'Java must preserve every legacy operation and every segment exactly');
assert.deepEqual(mergeOperations([], actual.operations), expected.operations);
assert.deepEqual(actual.operations.find(op => op.id === a.id), a);
assert.equal(actual.operations.find(op => op.id === b.id).task.plan.segments.length, 3);
assert.equal(actual.operations.find(op => op.id === c.id).task.deadline, legacy.deadline);
const javaNextWeek = JSON.parse(readFileSync(movedPath, 'utf8'));
const webNextWeek = weekTaskAt(midweek, dateAdd(startOfWeek('2026-11-04'), 7));
assert.deepEqual(javaNextWeek, webNextWeek, 'Native and web next-week shortcuts must preserve the same weekdays');
assert.equal(javaNextWeek.plan.start, '2026-11-11');
assert.equal(javaNextWeek.plan.end, '2026-11-13');
console.log(result.stdout.trim());
console.log('PASS Node -> Java -> Node: generated mixed day/range/week periods, shifted periods, and original legacy history');
console.log('PASS Java next-week move equals web weekTaskAt for a Wednesday-first two-period plan');
