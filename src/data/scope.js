// Narrow loaded spans to one workflow id. Pure functions.

import { splitAttrs } from '../config/attributes.js';

// A span is tagged when any of the workflow id attributes equals the id.
const isTagged = (row, list, workflowId) => list.some(a => String(row[a]) === workflowId);

// Keeps the spans that carry the workflow id plus everything below them: a span
// without the id is kept when an ancestor in its own trace has it, so database
// and downstream calls stay while unrelated spans of a shared trace drop out.
// Traces in `keepTraces` (pulled in through span links) are kept whole.
// Returns { spans, logs }: the kept span rows, and the logs minus those of
// dropped spans.
export function scopeToWorkflow(rows, logs, attrs, workflowId, keepTraces = new Set()) {
  const list = splitAttrs(attrs.correlationId);
  const id = String(workflowId);
  const byKey = new Map();
  rows.forEach(r => byKey.set(`${r[attrs.traceId]}/${r[attrs.spanId]}`, r));
  const memo = new Map();
  const keep = row => {
    const trace = row[attrs.traceId];
    const k = `${trace}/${row[attrs.spanId]}`;
    if (memo.has(k)) return memo.get(k);
    memo.set(k, false); // a parent cycle ends as not kept
    let ok = keepTraces.has(trace) || isTagged(row, list, id);
    if (!ok && row[attrs.parentId]) {
      const parent = byKey.get(`${trace}/${row[attrs.parentId]}`);
      ok = Boolean(parent) && keep(parent);
    }
    memo.set(k, ok);
    return ok;
  };
  const kept = rows.filter(keep);
  const dropped = new Set(rows.filter(r => !memo.get(`${r[attrs.traceId]}/${r[attrs.spanId]}`)));
  const droppedIds = new Set([...dropped].map(r => r[attrs.spanId]));
  const keptIds = new Set(kept.map(r => r[attrs.spanId]));
  const keptLogs = logs.filter(l => {
    const sid = l[attrs.logSpanId];
    return !sid || keptIds.has(sid) || !droppedIds.has(sid);
  });
  return { spans: kept, logs: keptLogs };
}
