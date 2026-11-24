// Database activity in a workflow, from spans that carry a db system. Pure functions.

const STATEMENT_KEYS = ['db.query.text', 'db.statement', 'db.query'];
export const statementOf = s => {
  const k = STATEMENT_KEYS.find(key => s.attributes && s.attributes[key]);
  return k ? String(s.attributes[k]) : '';
};

// One row per database system (calls, errors, time, calling services) and the
// slowest database spans.
export function summarizeDatabases(spans, slowest = 20) {
  const dbSpans = spans.filter(s => s.dbSystem);
  const bySystem = new Map();
  for (const s of dbSpans) {
    if (!bySystem.has(s.dbSystem)) {
      bySystem.set(s.dbSystem, {
        system: s.dbSystem,
        calls: 0,
        errors: 0,
        totalMs: 0,
        maxMs: 0,
        services: new Set()
      });
    }
    const d = bySystem.get(s.dbSystem);
    d.calls += 1;
    if (s.isError) d.errors += 1;
    d.totalMs += s.durMs;
    d.maxMs = Math.max(d.maxMs, s.durMs);
    if (s.service) d.services.add(s.service);
  }
  const databases = [...bySystem.values()]
    .map(d => ({ ...d, avgMs: d.totalMs / d.calls, services: [...d.services].sort() }))
    .sort((a, b) => b.totalMs - a.totalMs || a.system.localeCompare(b.system));
  const slow = [...dbSpans].sort((a, b) => b.durMs - a.durMs).slice(0, slowest);
  return { databases, slow };
}
