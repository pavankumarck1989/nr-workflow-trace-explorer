// NerdGraph access: NRQL with time-sliced paging, and workflow loading.
import { NerdGraphQuery } from 'nr1';
import {
  summaryNrql,
  rangeCountsNrql,
  appNamesNrql,
  workflowBoundsNrql,
  traceCountsNrql,
  spansByWorkflowNrql,
  spansByTraceNrql,
  spanLinksNrql,
  traceLinkCountsNrql,
  linkedSpansNrql,
  logsNrql,
  logsByTraceNrql
} from './queries';

const ROW_CAP = 2000; // NRQL returns at most 2000 raw rows per query
const MIN_SLICE_MS = 1000;
const IN_CHUNK = 100;

const GQL = `query($id: Int!, $nrql: Nrql!) {
  actor { account(id: $id) { nrql(query: $nrql, timeout: 120) { results } } }
}`;

export async function runNrql(accountId, nrql) {
  const { data, error } = await NerdGraphQuery.query({
    query: GQL,
    variables: { id: Number(accountId), nrql }
  });
  if (error) throw new Error(error.message || String(error));
  const result = data && data.actor && data.actor.account && data.actor.account.nrql;
  if (!result) {
    throw new Error(`No data returned for account ${accountId}. Check that you have access to it.`);
  }
  return result.results || [];
}

// Runs build(begin, end) and, when the row cap is hit, halves the window and
// recurses so no rows are silently truncated.
export async function runSliced(accountId, build, begin, end) {
  const rows = await runNrql(accountId, build(begin, end));
  if (rows.length < ROW_CAP || end - begin <= MIN_SLICE_MS) return rows;
  const mid = Math.floor((begin + end) / 2);
  const [a, b] = await Promise.all([
    runSliced(accountId, build, begin, mid),
    runSliced(accountId, build, mid, end)
  ]);
  return a.concat(b);
}

export async function fetchSummary(accountId, attrs, begin, end, opts) {
  const rows = await runNrql(accountId, summaryNrql(attrs, begin, end, opts));
  return rows.map(r => ({
    workflowId: Array.isArray(r.facet) ? r.facet[0] : r.facet,
    traces: r.traces,
    spans: r.spans,
    first: r.first,
    last: r.last,
    // when the latest span ended; falls back to its start without durations
    lastEnd: Number.isFinite(r.lastEnd) ? Math.max(r.lastEnd, r.last) : r.last,
    errors: r.errors,
    entities: (r.services || 0) + (r.databases || 0),
    databases: r.databases || 0,
    lastName: r.lastName,
    lastStatus: r.lastStatus,
    stateValue: r.stateValue,
    waitTs: r.waitTs,
    decisionTs: r.decisionTs,
    decisionValue: r.decisionValue,
    traceIds: [].concat(r.traceIds || []),
    appName: r.appName,
    entry: r.txnName || r.entryName
  }));
}

// Counts for every workflow in the range: total and with an error span.
export async function fetchRangeCounts(accountId, attrs, begin, end, scope = {}) {
  const rows = await runNrql(accountId, rangeCountsNrql(attrs, begin, end, scope));
  const r = rows[0] || {};
  return { total: r.total || 0, withErrors: r.withErrors || 0 };
}

const chunk = (arr, n) => {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
};

// Spans by workflow id, then any spans of the traces found, which picks up
// spans missing the correlation attribute.
export async function fetchWorkflow(accountId, attrs, workflowId, begin, end) {
  const byWf = await runSliced(
    accountId,
    (b, e) => spansByWorkflowNrql(attrs, workflowId, b, e),
    begin,
    end
  );
  const traceIds = new Set();
  byWf.forEach(s => {
    if (s[attrs.traceId]) traceIds.add(s[attrs.traceId]);
  });
  const known = new Set(byWf.map(s => `${s[attrs.traceId]}/${s[attrs.spanId]}`));
  // When the workflow id is the trace id, the first query already has every span.
  const extra =
    attrs.correlationId === attrs.traceId
      ? []
      : (
          await Promise.all(
            chunk([...traceIds], IN_CHUNK).map(ids =>
              runSliced(accountId, (b, e) => spansByTraceNrql(attrs, ids, b, e), begin, end)
            )
          )
        ).flat();
  const spans = byWf.concat(
    extra.filter(s => !known.has(`${s[attrs.traceId]}/${s[attrs.spanId]}`))
  );

  const allTraces = [...new Set(spans.map(s => s[attrs.traceId]).filter(Boolean))];
  const logChunks = allTraces.length ? chunk(allTraces, IN_CHUNK) : [[]];
  const logs = (
    await Promise.all(
      logChunks.map(ids =>
        runSliced(accountId, (b, e) => logsNrql(attrs, workflowId, ids, b, e), begin, end)
      )
    )
  ).flat();
  const seenLogs = new Set();
  const uniqLogs = logs.filter(l => {
    const k = `${l.timestamp}|${l[attrs.logSpanId]}|${l[attrs.logMessage]}`;
    if (seenLogs.has(k)) return false;
    seenLogs.add(k);
    return true;
  });
  const { links, linkedSpans } = await fetchSpanLinks(accountId, attrs, spans, begin);
  return { spans, logs: uniqLogs, links, linkedSpans };
}

const LINK_CAP = 600;

// Span links touching the loaded traces, plus the spans at their other ends.
// Links often arrive after the workflow's last span (a consumer picks the
// message up later), so the window runs to now. Missing SpanLink data or a
// failed query just means no links are shown.
export async function fetchSpanLinks(accountId, attrs, spans, begin) {
  const traceIds = [...new Set(spans.map(s => s[attrs.traceId]).filter(Boolean))];
  if (!traceIds.length) return { links: [], linkedSpans: [] };
  try {
    const end = Date.now();
    const links = (
      await Promise.all(
        chunk(traceIds, IN_CHUNK).map(ids => runNrql(accountId, spanLinksNrql(ids, begin, end)))
      )
    )
      .flat()
      .slice(0, LINK_CAP);
    const loaded = new Set(spans.map(s => s[attrs.spanId]));
    const wanted = new Set();
    links.forEach(l => {
      if (!loaded.has(l.id)) wanted.add(l.id);
      if (!loaded.has(l.linkedSpanId)) wanted.add(l.linkedSpanId);
    });
    const linkedSpans = (
      await Promise.all(
        chunk([...wanted].filter(Boolean), IN_CHUNK).map(ids =>
          runNrql(accountId, linkedSpansNrql(attrs, ids, begin, end))
        )
      )
    ).flat();
    return { links, linkedSpans };
  } catch (e) {
    return { links: [], linkedSpans: [] };
  }
}

// Whole-trace span, service and database counts for many traces (onBatch gets
// the map so far after each round of queries, so the first rows fill in early):
// Map(traceId -> { count, services, databases }). Runs a few
// chunked queries at a time; stops early when isLive() turns false.
export async function fetchTraceSpanCounts(
  accountId,
  attrs,
  traceIds,
  begin,
  end,
  isLive = () => true,
  onBatch = () => {}
) {
  const out = new Map();
  const chunks = chunk([...new Set(traceIds)], 150);
  const PARALLEL = 6;
  for (let i = 0; i < chunks.length && isLive(); i += PARALLEL) {
    await Promise.all(
      chunks.slice(i, i + PARALLEL).map(async ids => {
        const rows = await runNrql(accountId, traceCountsNrql(attrs, ids, begin, end));
        rows.forEach(r =>
          out.set(Array.isArray(r.facet) ? r.facet[0] : r.facet, {
            count: r.count,
            services: [].concat(r.services || []),
            databases: [].concat(r.databases || [])
          })
        );
      })
    );
    if (isLive()) onBatch(out);
  }
  return out;
}

// Spans (and their links) of extra traces, e.g. traces reached through span
// links. The window runs to now because linked traces often start later.
export async function fetchTraces(accountId, attrs, traceIds, begin) {
  const end = Date.now();
  const spans = (
    await Promise.all(
      chunk(traceIds, IN_CHUNK).map(ids =>
        runSliced(accountId, (b, e) => spansByTraceNrql(attrs, ids, b, e), begin, end)
      )
    )
  ).flat();
  const { links, linkedSpans } = await fetchSpanLinks(accountId, attrs, spans, begin);
  const logs = (
    await Promise.all(
      chunk(traceIds, IN_CHUNK).map(ids =>
        runSliced(accountId, (b, e) => logsByTraceNrql(attrs, ids, b, e), begin, end).catch(
          () => []
        )
      )
    )
  ).flat();
  return { spans, logs, links, linkedSpans };
}

// Span link counts for many traces: Map(traceId -> { out, in }); a trace is in
// the map once its chunk has been counted, even with no links. The window runs
// to now because consumers link back after the workflow's spans.
export async function fetchTraceLinkCounts(
  accountId,
  traceIds,
  begin,
  isLive = () => true,
  onBatch = () => {}
) {
  const out = new Map();
  const end = Date.now();
  const entry = id => {
    if (!out.has(id)) out.set(id, { out: 0, in: 0 });
    return out.get(id);
  };
  const chunks = chunk([...new Set(traceIds)], 150);
  const PARALLEL = 4;
  for (let i = 0; i < chunks.length && isLive(); i += PARALLEL) {
    await Promise.all(
      chunks.slice(i, i + PARALLEL).map(async ids => {
        await Promise.all(
          ['out', 'in'].map(async dir => {
            const rows = await runNrql(accountId, traceLinkCountsNrql(ids, begin, end, dir));
            rows.forEach(r => {
              const id = Array.isArray(r.facet) ? r.facet[0] : r.facet;
              entry(id)[dir] += r.count;
            });
          })
        );
        // Traces without links never appear in the results; once their chunk is
        // done they count as 0 rather than "not loaded yet".
        ids.forEach(entry);
      })
    );
    if (isLive()) onBatch(out);
  }
  return out;
}

// Application names seen in the range: [{ name, spans }], busiest first.
export async function fetchAppNames(accountId, attrs, begin, end) {
  const rows = await runNrql(accountId, appNamesNrql(attrs, begin, end));
  return rows
    .map(r => ({ name: Array.isArray(r.facet) ? r.facet[0] : r.facet, spans: r.count }))
    .filter(a => a.name)
    .sort((a, b) => b.spans - a.spans || a.name.localeCompare(b.name));
}

// { first, last } timestamps of a workflow over the lookback, or null when no
// span carries its id.
export async function fetchWorkflowBounds(accountId, attrs, workflowId, lookbackMs) {
  const end = Date.now();
  const rows = await runNrql(
    accountId,
    workflowBoundsNrql(attrs, workflowId, end - lookbackMs, end)
  );
  const r = rows[0];
  return r && Number.isFinite(r.first) && Number.isFinite(r.last)
    ? { first: r.first, last: r.last }
    : null;
}
