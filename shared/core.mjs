// Protocol v1. Calendar dates are UTC arithmetic containers, never instants in a
// user's time zone. Device timestamps only choose a conflict preview.
const DAY = 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const compareId = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const clone = value => JSON.parse(JSON.stringify(value));
function requireValue(condition, message) { if (!condition) throw new Error(message); }
function object(value, name) { requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), `${name} must be an object`); }
function nonempty(value, name) { requireValue(typeof value === 'string' && value.trim().length > 0, `${name} must be a nonempty string`); }
function fields(value, expected, name) {
  object(value, name);
  requireValue(Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key)), `${name} contains missing or unknown fields`);
}

function dateValue(value) {
  requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), 'Date must use YYYY-MM-DD');
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  requireValue(year >= 1 && date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day, `Invalid calendar date: ${value}`);
  return date;
}

export function dateAdd(isoDate, days) {
  requireValue(Number.isSafeInteger(days), 'Days must be an integer');
  const date = dateValue(isoDate);
  date.setTime(date.getTime() + days * DAY);
  requireValue(Number.isFinite(date.getTime()) && date.getUTCFullYear() >= 1 && date.getUTCFullYear() <= 9999, 'Date outside supported years 0001–9999');
  return date.toISOString().slice(0, 10);
}

export function startOfWeek(isoDate) {
  const date = dateValue(isoDate);
  return dateAdd(isoDate, -((date.getUTCDay() + 6) % 7));
}

export function emptyTask(title, id = crypto.randomUUID()) {
  return validateTask({ id, title, notes: '', plan: { kind: 'none', start: null, end: null }, deadline: null, completed: false, deleted: false, color: '#477766' });
}

export function validateTask(task) {
  fields(task, ['id', 'title', 'notes', 'plan', 'deadline', 'completed', 'deleted', 'color'], 'Task');
  requireValue(typeof task.id === 'string' && UUID.test(task.id), 'Task id must be a UUID');
  nonempty(task.title, 'Title');
  requireValue(task.title.length <= 300, 'Title exceeds 300 characters');
  requireValue(typeof task.notes === 'string', 'Notes must be a string');
  requireValue(typeof task.completed === 'boolean' && typeof task.deleted === 'boolean', 'completed/deleted must be boolean');
  requireValue(typeof task.color === 'string' && /^#[\da-f]{6}$/i.test(task.color), 'Color must be #RRGGBB');
  if (task.deadline !== null) dateValue(task.deadline);
  validatePlan(task.plan);
  return task;
}

function validatePlan(plan, simpleOnly = false) {
  object(plan, 'Plan');
  const { kind, start, end } = plan;
  requireValue((simpleOnly ? ['day', 'week', 'range'] : ['none', 'day', 'week', 'range', 'segments']).includes(kind), 'Unknown plan kind');
  fields(plan, kind === 'segments' ? ['kind', 'start', 'end', 'segments'] : ['kind', 'start', 'end'], 'Plan');
  if (kind === 'none') {
    requireValue(start === null && end === null, 'Unscheduled plans require null dates');
  } else {
    dateValue(start); dateValue(end);
    requireValue(end >= start, 'Plan end must not precede start');
    if (kind === 'day') requireValue(start === end, 'Day plans require identical dates');
    if (kind === 'week') requireValue(startOfWeek(start) === start && dateAdd(start, 6) === end, 'Week plans must run Monday through Sunday');
    if (kind === 'segments') {
      requireValue(Array.isArray(plan.segments) && plan.segments.length >= 2, 'Multiple-period plans require at least two segments');
      let previous;
      for (const segment of plan.segments) {
        validatePlan(segment, true);
        requireValue(!previous || previous.end < segment.start, 'Plan segments must be sorted and must not overlap');
        previous = segment;
      }
      requireValue(start === plan.segments[0].start && end === plan.segments.at(-1).end, 'Plan dates must match the segment envelope');
    }
  }
  return plan;
}

export function planParts(plan) {
  validatePlan(plan);
  return plan.kind === 'none' ? [] : plan.kind === 'segments' ? plan.segments.slice() : [plan];
}

export function packPlan(parts) {
  requireValue(Array.isArray(parts), 'Plan parts must be an array');
  const sorted = Array.from(parts, part => ({ ...validatePlan(part, true) }))
    .sort((a, b) => compareId(a.start, b.start) || compareId(b.end, a.end) || compareId(a.kind, b.kind));
  const segments = [];
  for (const part of sorted) {
    const previous = segments.at(-1);
    if (!previous || previous.end < part.start) { segments.push(part); continue; }
    const sameWeek = previous.kind === 'week' && part.kind === 'week' && previous.start === part.start && previous.end === part.end;
    previous.end = previous.end > part.end ? previous.end : part.end;
    previous.kind = sameWeek ? 'week' : previous.start === previous.end ? 'day' : 'range';
  }
  if (!segments.length) return { kind: 'none', start: null, end: null };
  if (segments.length === 1) return segments[0];
  return { kind: 'segments', start: segments[0].start, end: segments.at(-1).end, segments };
}

export function shiftPlan(task, targetStart) {
  validateTask(task); dateValue(targetStart);
  if (task.plan.kind === 'segments') {
    const parts = planParts(task.plan);
    const hasWeek = parts.some(part => part.kind === 'week');
    const offset = hasWeek
      ? (dateValue(startOfWeek(targetStart)) - dateValue(startOfWeek(task.plan.start))) / DAY
      : (dateValue(targetStart) - dateValue(task.plan.start)) / DAY;
    const plan = packPlan(parts.map(part => ({ ...part, start: dateAdd(part.start, offset), end: dateAdd(part.end, offset) })));
    return validateTask({ ...clone(task), plan });
  }
  let kind = task.plan.kind;
  let start = targetStart;
  let end = targetStart;
  if (kind === 'none') kind = 'day';
  if (kind === 'week') { start = startOfWeek(targetStart); end = dateAdd(start, 6); }
  if (kind === 'range') end = dateAdd(start, (dateValue(task.plan.end) - dateValue(task.plan.start)) / DAY);
  return validateTask({ ...clone(task), plan: { kind, start, end } });
}

export function validateOperation(operation) {
  fields(operation, ['id', 'taskId', 'parents', 'deviceId', 'createdAt', 'task'], 'Operation');
  nonempty(operation.id, 'Operation id');
  nonempty(operation.deviceId, 'Device id');
  validateTask(operation.task);
  requireValue(operation.taskId === operation.task.id, 'Operation taskId must match its task');
  requireValue(Array.isArray(operation.parents), 'Operation parents must be an array');
  for (const parent of operation.parents) nonempty(parent, 'Parent id');
  requireValue(new Set(operation.parents).size === operation.parents.length, 'Duplicate parent id');
  requireValue(!operation.parents.includes(operation.id), 'Operation cannot be its own parent');
  const stamp = operation.createdAt;
  requireValue(typeof stamp === 'string' && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(stamp) && Number.isFinite(Date.parse(stamp)), 'createdAt must be an ISO 8601 timestamp');
  dateValue(stamp.slice(0, 10));
  return operation;
}

// Property insertion order is not wire content. Array order remains significant.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function mergeOperations(local, remote) {
  requireValue(Array.isArray(local) && Array.isArray(remote), 'Operations must be arrays');
  const byId = new Map();
  const contents = new Map();
  for (const operation of [...local, ...remote]) {
    validateOperation(operation);
    const content = canonical(operation);
    requireValue(!contents.has(operation.id) || contents.get(operation.id) === content, `Same operation ID has different content: ${operation.id}`);
    if (!byId.has(operation.id)) { byId.set(operation.id, operation); contents.set(operation.id, content); }
  }
  const degree = new Map();
  const children = new Map();
  for (const operation of byId.values()) {
    degree.set(operation.id, operation.parents.length);
    for (const parentId of operation.parents) {
      const parent = byId.get(parentId);
      requireValue(parent, `Missing parent: ${parentId}`);
      requireValue(parent.taskId === operation.taskId, 'Parent must belong to the same task');
      if (!children.has(parentId)) children.set(parentId, []);
      children.get(parentId).push(operation.id);
    }
  }
  const queue = [...degree].filter(([, count]) => count === 0).map(([id]) => id);
  for (let i = 0; i < queue.length; i++) {
    for (const child of children.get(queue[i]) ?? []) {
      degree.set(child, degree.get(child) - 1);
      if (degree.get(child) === 0) queue.push(child);
    }
  }
  requireValue(queue.length === byId.size, 'Operation graph contains a cycle');
  return [...byId.values()].sort((a, b) => compareId(a.id, b.id)).map(clone);
}

export function materialize(operations) {
  const validated = mergeOperations([], operations);
  const parentIds = new Set(validated.flatMap(operation => operation.parents));
  const grouped = new Map();
  for (const operation of validated) {
    if (parentIds.has(operation.id)) continue;
    if (!grouped.has(operation.taskId)) grouped.set(operation.taskId, []);
    grouped.get(operation.taskId).push(operation);
  }
  const tasks = [], conflicts = [], heads = {};
  for (const taskId of [...grouped.keys()].sort(compareId)) {
    const values = grouped.get(taskId).sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || compareId(a.id, b.id));
    heads[taskId] = values.map(operation => operation.id).sort(compareId);
    tasks.push(clone(values.at(-1).task));
    if (values.length > 1) conflicts.push({ taskId, heads: values });
  }
  return { tasks, conflicts, heads };
}

export function makeOperation(task, operations, deviceId, options = {}) {
  validateTask(task);
  const { heads } = materialize(operations);
  return validateOperation({ id: options.id ?? crypto.randomUUID(), taskId: task.id, parents: heads[task.id] ?? [], deviceId, createdAt: options.createdAt ?? new Date().toISOString(), task: clone(task) });
}
