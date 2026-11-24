// Workflow state. The data has no state of its own, so it comes from an
// optional attribute chosen in Settings, else from whether any span failed.

export const STATES = ['Running', 'Waiting for human', 'Retrying', 'Completed', 'Failed'];

// Values (lower case) listed for each state, from the Settings text.
const valueList = csv =>
  String(csv || '')
    .split(',')
    .map(v => v.trim().toLowerCase())
    .filter(Boolean);

// The state a state-attribute value maps to, or null when the value is empty
// or not listed under any state.
export function stateFromValue(value, stateValues) {
  const v = String(value === null || value === undefined ? '' : value)
    .trim()
    .toLowerCase();
  if (!v) return null;
  return STATES.find(s => valueList((stateValues || {})[s]).includes(v)) || null;
}

// stateCfg = { attribute, values }. With an attribute set, the workflow's
// latest value of it decides the state, using the value lists in Settings.
// With no attribute, or no usable value (empty, or in no list), the state is
// Failed when any span has an error and Completed otherwise. idleMs is the
// time since the latest span started.
export function inferState({ now, lastTs, errors = 0, stateValue }, stateCfg) {
  const idleMs = Math.max(0, now - lastTs);
  const mapped =
    stateCfg && stateCfg.attribute ? stateFromValue(stateValue, stateCfg.values) : null;
  return { state: mapped || (errors > 0 ? 'Failed' : 'Completed'), idleMs };
}

// Value of `attr` on the latest-starting span that has a non-empty one, or
// undefined. Spans are normalized spans with their raw attributes.
export function latestAttributeValue(spans, attr) {
  if (!attr) return undefined;
  let best;
  for (const s of spans) {
    const v = s.attributes && s.attributes[attr];
    if (v === null || v === undefined || v === '') continue;
    if (!best || s.start >= best.start) best = { start: s.start, v };
  }
  return best ? best.v : undefined;
}

export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '-';
  if (ms < 1) return `${ms.toFixed(2)}ms`;
  if (ms < 10) return `${ms.toFixed(1)}ms`;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export function formatAgo(ms) {
  return `${formatDuration(ms)} ago`;
}
