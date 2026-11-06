import { dateAdd } from '../shared/core.mjs';

// Cold starts and new native intents use the same widget navigation policy.
export function resolveLaunchTarget(current, target) {
 let date = null;
 for (const candidate of [target?.date, target?.week]) {
  try { date = dateAdd(candidate, 0); break; } catch { /* Ignore invalid native dates. */ }
 }
 const hasFilter = ['all', 'replan', 'unplanned'].includes(target?.filter);
 return {
  ...current,
  anchor: date ?? current.anchor,
  mode: date || hasFilter ? 'four' : current.mode,
  filter: hasFilter ? target.filter : current.filter,
  scrollTo: hasFilter ? 'unplanned' : date ? 'calendar' : null,
 };
}
