// Span tree for the waterfall. Pure functions.

// Id of the span where a trace starts: the earliest span with no parent, else
// the earliest span whose parent is not in the data (its caller sent no spans,
// e.g. a browser or load generator). Null for an empty trace.
export function entrySpanId(spans) {
  const ids = new Set(spans.map(s => s.id));
  const roots = spans.filter(s => !s.parentId || !ids.has(s.parentId) || s.parentId === s.id);
  const pick = list => list.reduce((a, s) => (!a || s.start < a.start ? s : a), null);
  const top = pick(roots.filter(s => !s.parentId)) || pick(roots);
  return top ? top.id : null;
}

// Returns ordered rows [{ span, depth, hasKids, entry, orphan }] for one trace.
// Roots are spans with no parent or whose parent is not in the trace. The
// trace's entry span is flagged entry; any other root with a missing parent is
// flagged orphan. Children of ids in `collapsed` are skipped.
export function buildRows(spans, collapsed = new Set()) {
  const ids = new Set(spans.map(s => s.id));
  const entryId = entrySpanId(spans);
  const kids = new Map();
  const roots = [];
  for (const s of spans) {
    if (s.parentId && ids.has(s.parentId) && s.parentId !== s.id) {
      if (!kids.has(s.parentId)) kids.set(s.parentId, []);
      kids.get(s.parentId).push(s);
    } else {
      roots.push(s);
    }
  }
  const byStart = (a, b) => a.start - b.start;
  roots.sort(byStart);
  kids.forEach(list => list.sort(byStart));

  const rows = [];
  const seen = new Set();
  const stack = roots
    .slice()
    .reverse()
    .map(s => ({ s, depth: 0 }));
  while (stack.length) {
    const { s, depth } = stack.pop();
    if (seen.has(s.id)) continue; // guards against parent cycles
    seen.add(s.id);
    const children = kids.get(s.id) || [];
    rows.push({
      span: s,
      depth,
      hasKids: children.length > 0,
      entry: s.id === entryId,
      orphan: s.id !== entryId && Boolean(s.parentId) && !ids.has(s.parentId)
    });
    if (!collapsed.has(s.id)) {
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push({ s: children[i], depth: depth + 1 });
      }
    }
  }
  return rows;
}
