import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLaunchTarget } from '../web/launch-target.mjs';

const state = (mode = 'week') => Object.freeze({ anchor: '2026-10-30', mode, filter: 'unplanned' });

test('小部件日期入口在冷启动和已打开单周时均切换四周并保留目标日期', () => {
 for (const mode of ['four', 'week']) {
  const current = state(mode), target = Object.freeze({ date: '2026-11-12' });
  assert.deepEqual(resolveLaunchTarget(current, target), {
   anchor: '2026-11-12', mode: 'four', filter: 'unplanned', scrollTo: 'calendar',
  });
  assert.deepEqual(current, { anchor: '2026-10-30', mode, filter: 'unplanned' });
  assert.deepEqual(target, { date: '2026-11-12' });
 }
});

test('小部件周条入口切换四周并保留周锚点和已有筛选', () => {
 const current = Object.freeze({ ...state(), filter: 'replan' });
 assert.deepEqual(resolveLaunchTarget(current, { week: '2026-12-28' }), {
  anchor: '2026-12-28', mode: 'four', filter: 'replan', scrollTo: 'calendar',
 });
});

test('查看全部等有效筛选入口从任意视图切换四周并保留已有日期', () => {
 for (const mode of ['week', 'month', 'four']) {
  for (const filter of ['all', 'replan', 'unplanned']) {
   assert.deepEqual(resolveLaunchTarget(state(mode), { filter }), {
    anchor: '2026-10-30', mode: 'four', filter, scrollTo: 'unplanned',
   });
  }
 }
});

test('同时包含日期、周和筛选时优先日期并保留筛选的滚动目标', () => {
 assert.deepEqual(resolveLaunchTarget(state(), { date: '2024-02-29', week: '2024-02-26', filter: 'all' }), {
  anchor: '2024-02-29', mode: 'four', filter: 'all', scrollTo: 'unplanned',
 });
});

test('空目标和未知筛选不覆盖用户手动单周或月视图', () => {
 for (const mode of ['week', 'month']) {
  const current = state(mode);
  for (const target of [undefined, null, {}, { date: null, week: null, filter: null }, { filter: 'unknown' }]) {
   assert.deepEqual(resolveLaunchTarget(current, target), { ...current, scrollTo: null });
  }
 }
});

test('非法日期或周值不污染日期锚点也不触发导航', () => {
 const current = state();
 for (const invalid of ['2026-02-29', '2026-04-31', '2026-13-01', '0000-01-01', '10000-01-01', '2026-1-01', '', 20261030, {}, null]) {
  for (const key of ['date', 'week']) {
   assert.deepEqual(resolveLaunchTarget(current, { [key]: invalid }), { ...current, scrollTo: null });
  }
 }
});

test('无效日期可以回退合法周目标', () => {
 assert.deepEqual(resolveLaunchTarget(state(), { date: '2026-02-29', week: '2026-11-02' }), {
  anchor: '2026-11-02', mode: 'four', filter: 'unplanned', scrollTo: 'calendar',
 });
});

test('非法日期不会影响合法筛选入口且保留当前日期', () => {
 assert.deepEqual(resolveLaunchTarget(state(), { date: '2026-02-29', filter: 'all' }), {
  anchor: '2026-10-30', mode: 'four', filter: 'all', scrollTo: 'unplanned',
 });
});
