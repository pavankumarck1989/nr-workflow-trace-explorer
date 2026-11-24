// How far back the detail page looks for a workflow's spans. Pure functions.

const MIN = 60000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export const SUMMARY_WINDOW = 'summary';
export const WHOLE_WINDOW = 'whole';
// How far back the whole-workflow lookup searches for the first span.
export const WHOLE_LOOKBACK_MS = 90 * DAY;
export const CUSTOM_WINDOW = 'custom';
// Longest custom window; spans are not kept longer than this.
export const MAX_CUSTOM_MS = 365 * DAY;

export const CUSTOM_UNITS = [
  { id: 'hours', label: 'hours', ms: HOUR },
  { id: 'days', label: 'days', ms: DAY },
  { id: 'weeks', label: 'weeks', ms: 7 * DAY }
];

// Dropdown content, grouped. Relative windows end now.
export const WINDOW_GROUPS = [
  {
    label: 'Based on the workflow',
    options: [
      { id: SUMMARY_WINDOW, label: 'Range seen in summary, up to now' },
      { id: WHOLE_WINDOW, label: 'Whole workflow (looks up its first span)' }
    ]
  },
  {
    label: 'Last',
    options: [
      { id: '60m', label: '60 minutes', ms: HOUR },
      { id: '6h', label: '6 hours', ms: 6 * HOUR },
      { id: '24h', label: '24 hours', ms: DAY },
      { id: '2d', label: '2 days', ms: 2 * DAY },
      { id: '1w', label: '1 week', ms: 7 * DAY },
      { id: '2w', label: '2 weeks', ms: 14 * DAY },
      { id: '1mo', label: '1 month', ms: 30 * DAY },
      { id: '2mo', label: '2 months', ms: 60 * DAY }
    ]
  },
  { label: 'Other', options: [{ id: CUSTOM_WINDOW, label: 'Custom…' }] }
];

const ALL = WINDOW_GROUPS.flatMap(g => g.options);

// Milliseconds for a custom { n, unit }, or null when it is not usable.
export function customMs(custom) {
  const unit = CUSTOM_UNITS.find(u => u.id === custom.unit);
  const n = Number(custom.n);
  if (!unit || !Number.isFinite(n) || n <= 0) return null;
  return Math.min(n * unit.ms, MAX_CUSTOM_MS);
}

// { begin, end } for the chosen window. The summary window starts a minute
// before the first span the summary saw and runs to now, so spans that arrived
// since are included; the others look back from now. The whole-workflow window
// needs a lookup of the real first span (see fetchWorkflowBounds); until that
// is known it is the summary window.
export function resolveWindow(id, custom, now, first, last) {
  if (id === SUMMARY_WINDOW || id === WHOLE_WINDOW) {
    return { begin: first - MIN, end: Math.max(last + MIN, now) };
  }
  const ms = id === CUSTOM_WINDOW ? customMs(custom) : (ALL.find(o => o.id === id) || {}).ms;
  return { begin: now - (ms || HOUR), end: now };
}

// Open on the range the summary saw, up to now: it matches the row that was
// clicked and never opens empty.
export const defaultWindowId = () => SUMMARY_WINDOW;
