// Attach logs to spans. Pure functions.
import { levelName, logLevelAttrs } from '../config/attributes.js';

export function normalizeLog(raw, attrs) {
  return {
    attributes: raw, // full payload, for the log side panel
    service: raw[attrs.service] || '',
    ts: Number(raw.timestamp),
    traceId: raw[attrs.logTraceId] || null,
    spanId: raw[attrs.logSpanId] || null,
    message: raw[attrs.logMessage] || '',
    level: levelName(
      logLevelAttrs(attrs)
        .map(a => raw[a])
        .find(v => v !== undefined && v !== null && v !== '')
    )
  };
}

export const isErrorLevel = l => l === 'ERROR' || l === 'FATAL' || l === 'SEVERE';

// Returns { bySpan: Map(spanId -> logs), unattached: logs }.
// Match by span id, else the nearest span (in time) in the same trace.
// Logs with neither are left unattached and shown as standalone entries.
export function attachLogs(spans, rawLogs, attrs) {
  const logs = rawLogs
    .map(l => normalizeLog(l, attrs))
    .filter(l => Number.isFinite(l.ts))
    .sort((a, b) => a.ts - b.ts);
  const bySpan = new Map();
  const unattached = [];
  const ids = new Set(spans.map(s => s.id));
  const add = (id, l) => {
    if (!bySpan.has(id)) bySpan.set(id, []);
    bySpan.get(id).push(l);
  };
  const nearest = (pool, ts) => {
    let best = null;
    let bestD = Infinity;
    for (const s of pool) {
      const d = ts < s.start ? s.start - ts : ts > s.end ? ts - s.end : 0;
      if (d < bestD) {
        best = s;
        bestD = d;
      }
    }
    return best;
  };
  for (const l of logs) {
    if (l.spanId && ids.has(l.spanId)) {
      add(l.spanId, l);
      continue;
    }
    const inTrace = l.traceId ? spans.filter(s => s.traceId === l.traceId) : [];
    const target = nearest(inTrace, l.ts);
    if (target) add(target.id, l);
    else unattached.push(l);
  }
  return { logs, bySpan, unattached };
}

// Pretty-prints a message that is JSON; returns { text, json } for display.
export function prettyMessage(message) {
  const m = String(message || '');
  const t = m.trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    try {
      return { text: JSON.stringify(JSON.parse(t), null, 2), json: true };
    } catch (e) {
      // not JSON; fall through
    }
  }
  return { text: m, json: false };
}
