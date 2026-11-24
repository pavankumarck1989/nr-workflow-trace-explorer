// Attribute names and thresholds, overridable per account in Settings
// (NerdStorage). Defaults follow OpenTelemetry semantic conventions.
// The workflow id defaults to the trace id (one trace = one workflow). Point
// correlationId/logCorrelationId at another attribute (e.g. 'workflow.id' for
// Temporal) to stitch several traces into one workflow. Several names can be
// listed, comma separated; the first non-empty one on a span is used.

export const DEFAULT_ATTRS = {
  // spans
  correlationId: 'trace.id',
  traceId: 'trace.id',
  spanId: 'id',
  parentId: 'parent.id',
  name: 'name',
  service: 'entity.name',
  appName: 'entity.name', // app shown in the summary (entry span)
  transactionName: 'transaction.name', // entry transaction (falls back to span name)
  entityGuid: 'entity.guid',
  dbSystem: 'db.system.name', // adds a database node to the entity map (db.system is also read)
  status: 'otel.status_code',
  decisionAttribute: '', // optional: attribute holding the human decision (defaults to stateAttribute)
  stateAttribute: '', // optional: attribute whose latest value sets the workflow state (see stateValues)
  duration: 'duration.ms',
  // logs
  logTraceId: 'trace.id',
  logSpanId: 'span.id',
  logCorrelationId: 'trace.id',
  logMessage: 'message',
  logLevel: 'severity.text'
};

// First matching rule wins; matched against "<service> <span name>".
// Spans matching no rule get a lane named after their service.
export const DEFAULT_SYSTEM_RULES = [
  { system: 'MuleSoft', pattern: 'mule' },
  { system: 'Solace', pattern: 'solace' },
  { system: 'Temporal', pattern: 'temporal' }
];
export const DEFAULT_SYSTEM = 'Java worker'; // used when a span has no service name

export const DEFAULT_THRESHOLDS = {
  gapMs: 90 * 1000 // idle gap collapsed in the overview and timeline (head-sampling window)
};

// Values of the state attribute that mean each state (comma separated, case
// insensitive). Used only when a state attribute is set in Settings.
export const DEFAULT_STATE_VALUES = {
  Running: 'running,started,in_progress,active,approved',
  'Waiting for human': 'waiting,pending,paused,awaiting_approval',
  Retrying: 'retrying',
  Completed: 'completed,complete,done,success,closed',
  Failed: 'failed,error,timed_out,terminated,canceled,cancelled,declined,rejected,denied',
  // Decision values, for the HIL decision column (not states)
  Approved: 'approved,accepted',
  Declined: 'declined,rejected,denied'
};

const ATTR_NAME = /^[A-Za-z0-9_.@:-]+$/;

// correlationId / logCorrelationId may list several attribute names, comma
// separated, for systems that write the workflow id under different names
// (e.g. 'temporal.workflow.id,workflowId,temporalWorkflowID'). The first
// non-empty value on a span wins.
export const splitAttrs = spec =>
  String(spec || '')
    .split(',')
    .map(a => a.trim())
    .filter(Boolean);
export const isAttrList = spec => {
  const list = splitAttrs(spec);
  return list.length > 0 && list.every(a => ATTR_NAME.test(a));
};
export const firstValue = (raw, spec) => {
  for (const a of splitAttrs(spec)) {
    const v = raw[a];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
};
// Attributes holding a log's level: the configured one first, then 'level',
// which libraries such as pino and bunyan write (numeric: 30 = info, 50 = error).
export const logLevelAttrs = attrs => [...new Set([...splitAttrs(attrs.logLevel), 'level'])];
// Level name for a raw value: numeric levels map to names, text is upper-cased.
const NUMERIC_LEVELS = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARN',
  50: 'ERROR',
  60: 'FATAL'
};
export const levelName = v => {
  const s = String(v === undefined || v === null || v === '' ? 'INFO' : v).trim();
  return NUMERIC_LEVELS[s] || s.toUpperCase();
};
const LIST_ATTRS = ['correlationId', 'logCorrelationId'];

// Merges saved settings over the defaults. Anything invalid (wrong type, bad
// attribute name) falls back to its default, so a typo in
// Settings can never break queries or crash the page.
export function mergeConfig(saved) {
  const s = saved && typeof saved === 'object' ? saved : {};

  const attrs = { ...DEFAULT_ATTRS };
  Object.entries(s.attrs || {}).forEach(([k, v]) => {
    if (!(k in DEFAULT_ATTRS) || typeof v !== 'string') return;
    if (LIST_ATTRS.includes(k) ? isAttrList(v) : ATTR_NAME.test(v)) {
      attrs[k] = LIST_ATTRS.includes(k) ? splitAttrs(v).join(',') : v;
    }
  });
  // The state attribute is optional: an empty value switches it off.
  if (s.attrs && s.attrs.stateAttribute === '') attrs.stateAttribute = '';
  if (s.attrs && s.attrs.decisionAttribute === '') attrs.decisionAttribute = '';

  const thresholds = { ...DEFAULT_THRESHOLDS };
  Object.entries(s.thresholds || {}).forEach(([k, v]) => {
    if (!(k in DEFAULT_THRESHOLDS)) return;
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) thresholds[k] = v;
  });

  const rules = Array.isArray(s.systemRules)
    ? s.systemRules.filter(
        r =>
          r &&
          typeof r.system === 'string' &&
          r.system &&
          typeof r.pattern === 'string' &&
          r.pattern
      )
    : [];

  const stateValues = { ...DEFAULT_STATE_VALUES };
  Object.keys(DEFAULT_STATE_VALUES).forEach(k => {
    const v = s.stateValues && s.stateValues[k];
    if (typeof v === 'string') stateValues[k] = v;
  });

  return {
    attrs,
    systemRules: rules.length ? rules : DEFAULT_SYSTEM_RULES,
    thresholds,
    stateValues
  };
}

// Workflow id choices for the Settings dropdown. Anything else is entered with
// the "Custom attribute" option, so a saved custom value still loads.
export const WORKFLOW_ID_PRESETS = [
  { id: 'trace.id', label: 'Trace ID (one trace = one workflow)' },
  {
    id: 'temporal.workflow.id,workflowId,workflow.id,temporalWorkflowID',
    label: 'Temporal (any of temporal.workflow.id, workflowId, workflow.id, temporalWorkflowID)'
  }
];
