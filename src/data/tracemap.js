// Layout for the small per-trace span map in the workflow overview. Pure.

import { entrySpanId } from './tree.js';

export const MAP_ROWS = 10; // depth rows drawn; deeper spans share the last row
export const MAP_MAX_SPANS = 600; // spans drawn per trace

// Depth of every span from its root (parent chain inside the trace), with
// cycles and missing parents ending the chain. Returns Map(spanId -> depth).
export function spanDepths(spans) {
  const byId = new Map(spans.map(s => [s.id, s]));
  const depth = new Map();
  const walk = s => {
    const path = [];
    let cur = s;
    let base = 0;
    while (cur) {
      if (depth.has(cur.id)) {
        base = depth.get(cur.id) + 1;
        break;
      }
      if (path.includes(cur)) break; // parent cycle
      path.push(cur);
      cur = cur.parentId && cur.parentId !== cur.id ? byId.get(cur.parentId) : null;
    }
    for (let i = path.length - 1; i >= 0; i--) depth.set(path[i].id, base + (path.length - 1 - i));
  };
  spans.forEach(s => {
    if (!depth.has(s.id)) walk(s);
  });
  return depth;
}

// [{ span, row }] for the spans to draw: every error span, then the longest
// others, up to `limit`, each on the row of its depth (capped at rows - 1).
export function traceMapBars(spans, rows = MAP_ROWS, limit = MAP_MAX_SPANS) {
  const depth = spanDepths(spans);
  let pick = spans;
  if (spans.length > limit) {
    const errors = spans.filter(s => s.isError);
    const rest = spans
      .filter(s => !s.isError)
      .sort((a, b) => b.durMs - a.durMs)
      .slice(0, Math.max(0, limit - errors.length));
    pick = errors.concat(rest);
  }
  return pick.map(span => ({ span, row: Math.min(rows - 1, depth.get(span.id) || 0) }));
}

// Puts boxes ({ x0, x1 } in pixels) on rows so that none overlap: each box goes
// on the first row that ends at least `gap` px before it starts. Returns the
// row of every box (in the order given) and the number of rows.
export function packLanes(boxes, gap = 6) {
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[a].x0 - boxes[b].x0 || a - b);
  const ends = [];
  const lane = Array(boxes.length).fill(0);
  for (const i of order) {
    let l = ends.findIndex(end => end + gap <= boxes[i].x0);
    if (l === -1) {
      l = ends.length;
      ends.push(-Infinity);
    }
    ends[l] = boxes[i].x1;
    lane[i] = l;
  }
  return { lane, count: Math.max(1, ends.length) };
}

// What a trace is about: its entry span's name and service, e.g. for the
// overview labels. { name, service, title } where title joins both.
export function traceHeading(spans) {
  const id = entrySpanId(spans);
  const s = spans.find(x => x.id === id);
  if (!s) return { name: '', service: '', title: '' };
  const service = s.service || s.system || '';
  return { name: s.name, service, title: service ? `${service} \u00b7 ${s.name}` : s.name };
}

// Which other traces each trace is linked to through span links, as trace
// indexes: [{ from: [i...], to: [i...] }] (from = this trace's spans link to
// it, to = it links to). `links` is the Map from buildLinks.
export function traceLinkMap(traces, links) {
  const index = new Map(traces.map((t, i) => [t.traceId, i]));
  return traces.map((t, i) => {
    const out = new Set();
    const inn = new Set();
    for (const s of t.spans) {
      for (const l of links.get(`${s.traceId}/${s.id}`) || []) {
        if (!l.crossTrace || !index.has(l.traceId) || index.get(l.traceId) === i) continue;
        // Backward = this span points at the other trace; Forward = the other trace points here.
        (l.direction === 'Backward' ? out : inn).add(index.get(l.traceId));
      }
    }
    return { to: [...out].sort((a, b) => a - b), from: [...inn].sort((a, b) => a - b) };
  });
}
