// Whole-workflow span and entity counts from per-trace counts. Pure.

// Returns { count, approx } or null when no trace counts are known yet.
// approx is true when the workflow has more traces than were listed.
export function workflowSpanCount(row, traceCounts) {
  if (!traceCounts || !row.traceIds || !row.traceIds.length) return null;
  let sum = 0;
  let known = 0;
  for (const id of row.traceIds) {
    if (traceCounts.has(id)) {
      sum += traceCounts.get(id).count;
      known += 1;
    }
  }
  if (!known) return null;
  return { count: sum, approx: known < row.traceIds.length || row.traces > row.traceIds.length };
}

// Distinct services plus databases across the workflow's traces, the same
// definition as the detail view's entity map. Returns { entities, databases }
// or null when no trace counts are known yet.
export function workflowEntities(row, traceCounts) {
  if (!traceCounts || !row.traceIds) return null;
  const services = new Set();
  const databases = new Set();
  let known = 0;
  for (const id of row.traceIds) {
    const t = traceCounts.get(id);
    if (!t) continue;
    known += 1;
    t.services.forEach(s => services.add(s));
    t.databases.forEach(d => databases.add(d));
  }
  if (!known) return null;
  return { entities: services.size + databases.size, databases: databases.size };
}

// Span links touching a workflow's traces, from per-trace link counts.
// Returns { count, approx } or null while the counts for its traces are unknown.
// approx is true when the workflow has more traces than were listed.
export function workflowLinkCount(row, linkCounts, wholeTrace) {
  if (!linkCounts) return null;
  const listed = row.traceIds || [];
  const ids = listed.length ? listed : wholeTrace ? [row.workflowId] : [];
  if (!ids.length) return null;
  let count = 0;
  let known = 0;
  for (const id of ids) {
    const c = linkCounts.get(id);
    if (!c) continue;
    known += 1;
    count += c.out + c.in;
  }
  if (!known) return null; // counts for these traces have not loaded yet
  return { count, approx: row.traces > ids.length };
}
