// NRQL builders. Pure functions so they can be unit-tested.

import { logLevelAttrs, splitAttrs } from '../config/attributes.js';
import { humanAttrs, valuePattern } from './human.js';

// Attribute names are quoted with backticks; strip any backtick so a name can
// never break out of the quoting.
const q = a => `\`${String(a).replace(/`/g, '')}\``;
// NRQL expression for a workflow id spec: one attribute, or the first
// non-empty of several (empty strings are ignored, none found gives null).
export function idExpr(spec) {
  const list = splitAttrs(spec);
  if (list.length <= 1) return q(list[0] || spec);
  // `!= ''` alone is true for a missing attribute, so test for null as well.
  return list.reduceRight(
    (rest, a) => `if(${q(a)} IS NOT NULL AND ${q(a)} != '', ${q(a)}, ${rest})`,
    'null'
  );
}
export const esc = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const sec = ms => Math.floor(ms / 1000);
const window_ = (b, e) => `SINCE ${sec(b)} UNTIL ${sec(e)}`;

// Columns the database can sort by. FACET ... ORDER BY only supports largest
// first, so ascending order is applied to the loaded rows in the UI.
export function sortExpr(attrs, key) {
  switch (key) {
    case 'first':
      return 'min(timestamp)';
    case 'traces':
      return `uniqueCount(${q(attrs.traceId)})`;
    case 'spans':
      return 'count(*)';
    case 'errors':
      return `filter(count(*), WHERE ${q(attrs.status)} = 'ERROR')`;
    default:
      return 'max(timestamp)';
  }
}

// Extra WHERE terms (each ends with a space) for the summary filters:
// apps = only spans of these applications, search = workflow ids or app names
// containing the text, links = { since, until } only workflows that have span links.
// Empty filters add nothing.
export function scopeClause(attrs, scope = {}) {
  const { apps = [], search = '', links = null } = scope;
  const term = String(search).trim();
  let out = '';
  if (apps.length) {
    out += `AND ${q(attrs.appName)} IN (${apps.map(a => `'${esc(a)}'`).join(',')}) `;
  }
  if (term) {
    const like = `LIKE '%${esc(term)}%'`;
    out += `AND (${idExpr(attrs.correlationId)} ${like} OR ${q(attrs.appName)} ${like}) `;
  }
  if (links) {
    // Workflows with a span link in either direction. Links often arrive after
    // the range ends, so the lookup runs to `until` (now).
    const w = window_(links.since, links.until);
    const t = q(attrs.traceId);
    out +=
      `AND (${t} IN (FROM SpanLink SELECT uniques(\`trace.id\`, 5000) ${w}) ` +
      `OR ${t} IN (FROM SpanLink SELECT uniques(linkedTraceId, 5000) ${w})) `;
  }
  return out;
}

// Human review fields: when a "waiting for human" value and a decision value
// were last seen, and the latest decision value.
const humanSelect = (attrs, values) => {
  const { waitAttr, decisionAttr } = humanAttrs(attrs);
  const waitPat = waitAttr && valuePattern((values || {})['Waiting for human']);
  const decPat =
    decisionAttr && valuePattern([(values || {}).Approved, (values || {}).Declined].join(','));
  let out = '';
  if (waitPat) {
    out += `filter(max(timestamp), WHERE ${q(waitAttr)} RLIKE '${esc(waitPat)}') AS waitTs, `;
  }
  if (decPat) {
    out += `filter(max(timestamp), WHERE ${q(decisionAttr)} RLIKE '${esc(decPat)}') AS decisionTs, `;
    out += `filter(latest(${q(decisionAttr)}), WHERE ${q(decisionAttr)} RLIKE '${esc(decPat)}') AS decisionValue, `;
  }
  return out;
};

// Latest non-empty value of the state attribute, when one is configured.
const stateSelect = attrs =>
  attrs.stateAttribute
    ? `filter(latest(${q(attrs.stateAttribute)}), WHERE ${q(attrs.stateAttribute)} != '') AS stateValue, `
    : '';

// One row per workflow in the selected range. With errorsOnly, only workflows
// whose traces contain an error span are returned. apps and search narrow the
// spans considered (see scopeClause).
export function summaryNrql(attrs, beginMs, endMs, opts = {}) {
  const {
    sort = 'last',
    errorsOnly = false,
    apps = [],
    search = '',
    links = null,
    stateValues
  } = opts;
  // With a workflow id other than the trace id (or spans limited to some apps),
  // also fetch the workflow's trace ids so whole-trace counts can be looked up.
  const ids =
    attrs.correlationId === attrs.traceId && !apps.length && !String(search).trim()
      ? ''
      : `uniques(${q(attrs.traceId)}, 20) AS traceIds, `;
  const errClause = errorsOnly
    ? `AND ${q(attrs.traceId)} IN (FROM Span SELECT uniques(${q(attrs.traceId)}, 5000) ` +
      `WHERE ${q(attrs.status)} = 'ERROR' ${window_(beginMs, endMs)}) `
    : '';
  return (
    `FROM Span SELECT ${ids}uniqueCount(${q(attrs.traceId)}) AS traces, ` +
    `count(*) AS spans, min(timestamp) AS first, max(timestamp) AS last, ` +
    `max(timestamp + ${q(attrs.duration)}) AS lastEnd, ` +
    `uniqueCount(${q(attrs.service)}) AS services, uniqueCount(${q(attrs.dbSystem)}) AS databases, ` +
    `filter(count(*), WHERE ${q(attrs.status)} = 'ERROR') AS errors, ` +
    `latest(${q(attrs.name)}) AS lastName, ` +
    `latest(${q(attrs.status)}) AS lastStatus, ` +
    stateSelect(attrs) +
    humanSelect(attrs, stateValues) +
    `earliest(${q(attrs.appName)}) AS appName, ` +
    `earliest(${q(attrs.transactionName)}) AS txnName, ` +
    `earliest(${q(attrs.name)}) AS entryName ` +
    `WHERE ${idExpr(attrs.correlationId)} IS NOT NULL ${scopeClause(attrs, { apps, search, links })}${errClause}` +
    `FACET ${idExpr(attrs.correlationId)} ORDER BY ${sortExpr(attrs, sort)} LIMIT MAX ${window_(beginMs, endMs)}`
  );
}

// Exact counts for the whole range (not capped like the table): workflows, and
// those with an error span.
export function rangeCountsNrql(attrs, beginMs, endMs, scope = {}) {
  const c = idExpr(attrs.correlationId);
  return (
    `FROM Span SELECT uniqueCount(${c}) AS total, ` +
    `filter(uniqueCount(${c}), WHERE ${q(attrs.status)} = 'ERROR') AS withErrors ` +
    `WHERE ${c} IS NOT NULL ${scopeClause(attrs, scope)}${window_(beginMs, endMs)}`
  );
}

// Workflows with spans in each time bucket, and how many of those had an error
// span, for the chart on the summary page. Same filters as the table.
export function workflowsOverTimeNrql(attrs, beginMs, endMs, scope = {}) {
  const c = idExpr(attrs.correlationId);
  return (
    `FROM Span SELECT uniqueCount(${c}) AS 'Workflows', ` +
    `filter(uniqueCount(${c}), WHERE ${q(attrs.status)} = 'ERROR') AS 'With errors' ` +
    `WHERE ${c} IS NOT NULL ${scopeClause(attrs, scope)}TIMESERIES AUTO ${window_(beginMs, endMs)}`
  );
}

// Error spans per application, for the bar chart on the summary page.
export function errorSpansByAppNrql(attrs, beginMs, endMs, scope = {}) {
  const c = idExpr(attrs.correlationId);
  return (
    `FROM Span SELECT count(*) AS 'Error spans' ` +
    `WHERE ${c} IS NOT NULL AND ${q(attrs.status)} = 'ERROR' ${scopeClause(attrs, scope)}` +
    `FACET ${q(attrs.appName)} LIMIT 10 ${window_(beginMs, endMs)}`
  );
}

// Log lines per severity over time, for the chart on the summary page. Level
// text differs between sources (INFO, info, Information, WARN, warning, error,
// SEVERE) and some write a numeric `level` (30 = info, 50 = error), so every
// spelling is grouped into Error, Warn, Info, Debug, else No level (no level at
// all). Only the app filter applies: logs are not tied to workflow ids here.
export function logsBySeverityNrql(attrs, beginMs, endMs, scope = {}) {
  const cols = logLevelAttrs(attrs).map(q);
  const text = re => cols.map(c => `${c} RLIKE '(?i)${re}.*'`).join(' OR ');
  const num = list => cols.map(c => `${c} IN (${list.map(n => `'${n}'`).join(',')})`).join(' OR ');
  const apps = scope.apps || [];
  const where = apps.length
    ? `WHERE ${q(attrs.service)} IN (${apps.map(a => `'${esc(a)}'`).join(',')}) `
    : '';
  const level =
    `if(${text('(err|fatal|crit|severe)')} OR ${num([50, 60])}, 'Error', ` +
    `if(${text('warn')} OR ${num([40])}, 'Warn', ` +
    `if(${text('(info|notice)')} OR ${num([30])}, 'Info', ` +
    `if(${text('(debug|trace)')} OR ${num([10, 20])}, 'Debug', 'No level'))))`;
  return (
    `FROM Log SELECT count(*) ${where}FACET ${level} AS 'Level' ` +
    `TIMESERIES AUTO ${window_(beginMs, endMs)}`
  );
}

// Span count and the services and databases seen, per trace, for the given
// trace ids.
export function traceCountsNrql(attrs, traceIds, beginMs, endMs) {
  const list = traceIds.map(t => `'${esc(t)}'`).join(',');
  return (
    `FROM Span SELECT count(*) AS count, uniques(${q(attrs.service)}, 200) AS services, ` +
    `uniques(${q(attrs.dbSystem)}, 50) AS databases ` +
    `WHERE ${q(attrs.traceId)} IN (${list}) ` +
    `FACET ${q(attrs.traceId)} LIMIT MAX ${window_(beginMs, endMs)}`
  );
}

export function spansByWorkflowNrql(attrs, workflowId, beginMs, endMs) {
  return (
    `FROM Span SELECT * WHERE ${idExpr(attrs.correlationId)} = '${esc(workflowId)}' ` +
    `LIMIT MAX ${window_(beginMs, endMs)}`
  );
}

export function spansByTraceNrql(attrs, traceIds, beginMs, endMs) {
  const list = traceIds.map(t => `'${esc(t)}'`).join(',');
  return (
    `FROM Span SELECT * WHERE ${q(attrs.traceId)} IN (${list}) ` +
    `LIMIT MAX ${window_(beginMs, endMs)}`
  );
}

export function logsNrql(attrs, workflowId, traceIds, beginMs, endMs) {
  const parts = [`${idExpr(attrs.logCorrelationId)} = '${esc(workflowId)}'`];
  if (traceIds.length) {
    const list = traceIds.map(t => `'${esc(t)}'`).join(',');
    parts.push(`${q(attrs.logTraceId)} IN (${list})`);
  }
  return `FROM Log SELECT * WHERE ${parts.join(' OR ')} ` + `LIMIT MAX ${window_(beginMs, endMs)}`;
}

// Logs of whole traces, by trace id.
export function logsByTraceNrql(attrs, traceIds, beginMs, endMs) {
  const list = traceIds.map(t => `'${esc(t)}'`).join(',');
  return `FROM Log SELECT * WHERE ${q(attrs.logTraceId)} IN (${list}) LIMIT MAX ${window_(beginMs, endMs)}`;
}

// Span links live in their own SpanLink event: `id` and `trace.id` are the
// span that carries the link, linkedSpanId / linkedTraceId the span it points
// at. Fetch links in both directions for the given traces.
export function spanLinksNrql(traceIds, beginMs, endMs) {
  const list = traceIds.map(t => `'${esc(t)}'`).join(',');
  return (
    `FROM SpanLink SELECT id, \`trace.id\`, linkedSpanId, linkedTraceId, timestamp ` +
    `WHERE \`trace.id\` IN (${list}) OR linkedTraceId IN (${list}) ` +
    `LIMIT MAX ${window_(beginMs, endMs)}`
  );
}

// The span at the other end of each link, for its name, service, time and status.
export function linkedSpansNrql(attrs, spanIds, beginMs, endMs) {
  const list = spanIds.map(t => `'${esc(t)}'`).join(',');
  return (
    `FROM Span SELECT ${q(attrs.spanId)}, ${q(attrs.traceId)}, ${q(attrs.name)}, ` +
    `${q(attrs.service)}, ${q(attrs.duration)}, ${q(attrs.status)}, timestamp ` +
    `WHERE ${q(attrs.spanId)} IN (${list}) LIMIT MAX ${window_(beginMs, endMs)}`
  );
}

// Span link counts per trace: 'out' counts links carried by the trace's spans,
// 'in' counts links from other spans that point into the trace.
export function traceLinkCountsNrql(traceIds, beginMs, endMs, dir = 'out') {
  const list = traceIds.map(t => `'${esc(t)}'`).join(',');
  const col = dir === 'in' ? 'linkedTraceId' : '`trace.id`';
  return (
    `FROM SpanLink SELECT count(*) WHERE ${col} IN (${list}) ` +
    `FACET ${col} LIMIT MAX ${window_(beginMs, endMs)}`
  );
}

// Application names in the range, busiest first, for the app filter.
export function appNamesNrql(attrs, beginMs, endMs) {
  return (
    `FROM Span SELECT count(*) WHERE ${q(attrs.appName)} IS NOT NULL ` +
    `FACET ${q(attrs.appName)} LIMIT 500 ${window_(beginMs, endMs)}`
  );
}

// First and last span of a workflow, to find its real extent.
export function workflowBoundsNrql(attrs, workflowId, beginMs, endMs) {
  return (
    `FROM Span SELECT min(timestamp) AS first, max(timestamp) AS last ` +
    `WHERE ${idExpr(attrs.correlationId)} = '${esc(workflowId)}' ${window_(beginMs, endMs)}`
  );
}

// Performance of one kind of span (same service and name as `span`) around the
// time it ran: kind is 'duration' (average over time), 'throughput' (calls per
// minute over time), 'histogram' (duration spread) or 'summary' (average,
// 95th percentile, calls).
export function spanPerformanceNrql(attrs, span, kind, beginMs, endMs) {
  const dur = q(attrs.duration);
  const where =
    `WHERE ${q(attrs.name)} = '${esc(span.name)}'` +
    (span.service ? ` AND ${q(attrs.service)} = '${esc(span.service)}'` : '');
  const w = window_(beginMs, endMs);
  switch (kind) {
    case 'throughput':
      return `FROM Span SELECT rate(count(*), 1 minute) AS 'Throughput' ${where} TIMESERIES AUTO ${w}`;
    case 'histogram': {
      const ceiling = Math.max(10, Math.ceil((Number(span.durMs) || 0) * 3));
      return `FROM Span SELECT histogram(${dur}, ${ceiling}, 30) ${where} ${w}`;
    }
    case 'summary':
      return (
        `FROM Span SELECT average(${dur}) AS 'Average (ms)', percentile(${dur}, 95) AS 'p95 (ms)', ` +
        `count(*) AS 'Calls' ${where} ${w}`
      );
    default:
      return `FROM Span SELECT average(${dur}) AS 'Average duration (ms)' ${where} TIMESERIES AUTO ${w}`;
  }
}
