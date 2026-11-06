import { dateAdd, startOfWeek, validateTask, planParts, packPlan, shiftPlan } from '../shared/core.mjs';

const DAY = 86_400_000;

// Reuse protocol validation before UTC arithmetic, including years 0001–0099.
export function daysBetween(from, to) {
 const start = dateAdd(from, 0), end = dateAdd(to, 0);
 return (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY;
}

export function planBetween(a, b) {
 const first = dateAdd(a, 0), second = dateAdd(b, 0);
 const [start, end] = first <= second ? [first, second] : [second, first];
 return { kind: start === end ? 'day' : 'range', start, end };
}

function requireSegment(parts, segmentIndex) {
 if (!Number.isSafeInteger(segmentIndex) || segmentIndex < 0 || segmentIndex >= parts.length) throw new Error('Segment index is outside the plan');
 return parts[segmentIndex];
}

export function appendTaskPlan(task, plan) {
 validateTask(task);
 return validateTask({ ...task, plan: packPlan([...planParts(task.plan), ...planParts(plan)]) });
}

export function replaceTaskSegment(task, segmentIndex, plan) {
 validateTask(task);
 const parts = planParts(task.plan);
 requireSegment(parts, segmentIndex);
 parts[segmentIndex] = plan;
 return validateTask({ ...task, plan: packPlan(parts) });
}

export function removeTaskSegment(task, segmentIndex) {
 validateTask(task);
 const parts = planParts(task.plan);
 requireSegment(parts, segmentIndex);
 parts.splice(segmentIndex, 1);
 return validateTask({ ...task, plan: packPlan(parts) });
}

export function resizeTask(task, edge, date, segmentIndex) {
 validateTask(task);
 if (edge !== 'start' && edge !== 'end') throw new Error('Resize edge must be start or end');
 if (segmentIndex === undefined && task.plan.kind === 'segments') throw new Error('Choose a segment to resize');
 const selected = segmentIndex === undefined ? task.plan : requireSegment(planParts(task.plan), segmentIndex);
 if (selected.kind !== 'day' && selected.kind !== 'range') throw new Error('Only day and range plans can be resized');
 const target = dateAdd(date, 0);
 const { start, end } = selected;
 const plan = edge === 'start'
  ? planBetween(target > end ? end : target, end)
  : planBetween(start, target < start ? start : target);
 return segmentIndex === undefined ? validateTask({ ...task, plan }) : replaceTaskSegment(task, segmentIndex, plan);
}

export function moveTask(task, targetDate, grabOffset = 0, segmentIndex) {
 validateTask(task);
 if (!Number.isSafeInteger(grabOffset)) throw new Error('Grab offset must be an integer');
 const selected = segmentIndex === undefined ? task.plan : requireSegment(planParts(task.plan), segmentIndex);
 // A week card refers to its destination week regardless of where it was held.
 if (selected.kind === 'week') return weekTaskAt(task, targetDate, segmentIndex);
 const start = dateAdd(targetDate, selected.kind === 'none' ? 0 : -grabOffset);
 if (selected.kind === 'segments') return shiftPlan(task, start);
 const duration = selected.kind === 'range' ? daysBetween(selected.start, selected.end) : 0;
 const plan = planBetween(start, dateAdd(start, duration));
 return segmentIndex === undefined ? validateTask({ ...task, plan }) : replaceTaskSegment(task, segmentIndex, plan);
}

export function weekTaskAt(task, date, segmentIndex) {
 validateTask(task);
 if (segmentIndex !== undefined) requireSegment(planParts(task.plan), segmentIndex);
 if (segmentIndex === undefined && task.plan.kind === 'segments') {
  const offset = daysBetween(startOfWeek(task.plan.start), startOfWeek(date));
  return shiftPlan(task, dateAdd(task.plan.start, offset));
 }
 const start = startOfWeek(date), end = dateAdd(start, 6);
 const plan = { kind: 'week', start, end };
 return segmentIndex === undefined ? validateTask({ ...task, plan }) : replaceTaskSegment(task, segmentIndex, plan);
}

export function unplanTask(task) {
 validateTask(task);
 return validateTask({ ...task, plan: { kind: 'none', start: null, end: null } });
}

export function deadlineAt(task, date) {
 validateTask(task);
 return validateTask({ ...task, plan: { ...task.plan }, deadline: dateAdd(date, 0) });
}
