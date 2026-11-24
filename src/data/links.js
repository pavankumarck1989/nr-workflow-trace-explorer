// Span links between traces. Pure functions.

const key = (traceId, spanId) => `${traceId}/${spanId}`;

// Map(`${traceId}/${spanId}` -> links[]) for the loaded spans.
// A link row says span (trace.id, id) points at (linkedTraceId, linkedSpanId).
// For the span that carries the row the link is 'Backward' (it points back at
// the span that led to it); for the span it points at, the link is 'Forward'
// (the work continues in another span or trace), as in New Relic's trace view.
// crossTrace is true when the other end is in a different trace.
export function buildLinks(spans, linkRows, otherSpans, attrs) {
  const loaded = new Map(spans.map(s => [key(s.traceId, s.id), s]));
  const other = new Map(otherSpans.map(r => [key(r[attrs.traceId], r[attrs.spanId]), r]));
  const out = new Map();
  const add = (k, link) => {
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(link);
  };
  const detail = (traceId, spanId, fallbackTs) => {
    const k = key(traceId, spanId);
    const s = loaded.get(k);
    if (s) {
      return {
        name: s.name,
        service: s.service,
        durMs: s.durMs,
        isError: s.isError,
        timestamp: s.start
      };
    }
    const r = other.get(k);
    if (r) {
      return {
        name: r[attrs.name],
        service: r[attrs.service] || '',
        durMs: Number(r[attrs.duration]) || 0,
        isError: String(r[attrs.status] || '').toUpperCase() === 'ERROR',
        timestamp: Number(r.timestamp) || fallbackTs
      };
    }
    return { name: '', service: '', durMs: null, isError: false, timestamp: fallbackTs };
  };
  const seen = new Set();
  for (const l of linkRows) {
    const from = key(l['trace.id'], l.id);
    const to = key(l.linkedTraceId, l.linkedSpanId);
    const dedupe = `${from}>${to}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    const crossTrace = l['trace.id'] !== l.linkedTraceId;
    if (loaded.has(from)) {
      add(from, {
        direction: 'Backward',
        traceId: l.linkedTraceId,
        spanId: l.linkedSpanId,
        crossTrace,
        ...detail(l.linkedTraceId, l.linkedSpanId, Number(l.timestamp))
      });
    }
    if (loaded.has(to)) {
      add(to, {
        direction: 'Forward',
        traceId: l['trace.id'],
        spanId: l.id,
        crossTrace,
        ...detail(l['trace.id'], l.id, Number(l.timestamp))
      });
    }
  }
  return out;
}

// True when any link of the span reaches a different trace.
export const hasCrossTraceLink = list => Boolean(list && list.some(l => l.crossTrace));
