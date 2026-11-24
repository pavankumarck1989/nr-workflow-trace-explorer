// Time per entity (service or database) across a workflow. Pure functions.
import { entrySpanId } from './tree.js';
import { isErrorLevel } from './logs.js';
import { spanDepths } from './tracemap.js';

// Same ids as the entity map: db:<system> for database spans, else the service.
export const entityIdOf = s => (s.dbSystem ? `db:${s.dbSystem}` : s.service || s.system);

// Total length of the union of [start, end] intervals.
export function unionLength(intervals) {
  const iv = intervals.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  let total = 0;
  let curS = null;
  let curE = null;
  for (const [a, b] of iv) {
    if (curE === null || a > curE) {
      if (curE !== null) total += curE - curS;
      curS = a;
      curE = b;
    } else if (b > curE) {
      curE = b;
    }
  }
  return curE === null ? 0 : total + (curE - curS);
}

const serviceIdOf = s => s.service || s.system;

// Exclusive time per entity id, as the platform's trace view counts it: walk
// the trace's timeline and give every stretch of time to the entity of the
// deepest span running then, so parallel work is not counted twice. A client
// or internal span that is waiting on a call into another entity does not
// earn that waiting time (database calls always do). Returns Map(id -> ms).
function sweepExclusive(spans, kids) {
  const out = new Map();
  const byTrace = new Map();
  for (const s of spans) {
    if (!byTrace.has(s.traceId)) byTrace.set(s.traceId, []);
    byTrace.get(s.traceId).push(s);
  }
  const waiting = s => {
    const kind = s.attributes && s.attributes['span.kind'];
    if (s.dbSystem || (kind !== 'client' && kind !== 'internal')) return false;
    return (kids.get(`${s.traceId}/${s.id}`) || []).some(c => entityIdOf(c) !== entityIdOf(s));
  };
  for (const list of byTrace.values()) {
    const depth = spanDepths(list);
    const live = list.filter(s => s.end > s.start).sort((a, b) => a.start - b.start);
    const times = [...new Set(live.flatMap(s => [s.start, s.end]))].sort((a, b) => a - b);
    const active = new Set();
    let next = 0;
    for (let i = 0; i < times.length - 1; i++) {
      const t = times[i];
      while (next < live.length && live[next].start <= t) active.add(live[next++]);
      let top = null;
      for (const s of [...active]) {
        if (s.end <= t) active.delete(s);
        else if (
          !top ||
          depth.get(s.id) > depth.get(top.id) ||
          (depth.get(s.id) === depth.get(top.id) && s.start > top.start)
        ) {
          top = s;
        }
      }
      if (top && !waiting(top)) {
        const id = entityIdOf(top);
        out.set(id, (out.get(id) || 0) + times[i + 1] - t);
      }
    }
  }
  return out;
}

// Per entity: exclusive (self) time, total time (union of its spans, so nested
// calls inside one entity are not counted twice), span and error-span counts,
// and logs. Counts follow the entity map: a service counts every span it
// emitted, database calls included, and a database counts only its own calls.
// Exclusive time goes to the database for a database call, else to the service
// (see sweepExclusive). Also the slowest
// entity (most exclusive time) and the root entity (the one holding the
// workflow's first entry span). bySpan maps span id to its logs.
export function entityLatency(spans, traces = [], bySpan = new Map()) {
  const kids = new Map();
  for (const s of spans) {
    if (!s.parentId) continue;
    const k = `${s.traceId}/${s.parentId}`;
    if (!kids.has(k)) kids.set(k, []);
    kids.get(k).push(s);
  }
  const by = new Map();
  const slot = (id, name, kind, system) => {
    if (!by.has(id)) {
      by.set(id, {
        id,
        name,
        kind,
        system,
        guid: null,
        exclusive: 0,
        errors: 0,
        spans: 0,
        logs: 0,
        errorLogs: 0,
        iv: []
      });
    }
    return by.get(id);
  };
  for (const s of spans) {
    const logs = bySpan.get(s.id) || [];
    const errLogs = logs.filter(l => isErrorLevel(l.level)).length;
    const own = [slot(serviceIdOf(s), serviceIdOf(s), 'service', s.system)];
    if (s.dbSystem) own.push(slot(entityIdOf(s), s.dbSystem, 'database', s.system));
    for (const e of own) {
      e.spans += 1;
      if (e.kind === 'service' && !e.guid && s.entityGuid) e.guid = s.entityGuid;
      if (s.isError) e.errors += 1;
      e.logs += logs.length;
      e.errorLogs += errLogs;
      e.iv.push([s.start, s.end]);
    }
  }
  for (const [id, ms] of sweepExclusive(spans, kids)) {
    if (by.has(id)) by.get(id).exclusive += ms;
  }
  const entities = [...by.values()]
    .map(({ iv, ...e }) => ({ ...e, total: unionLength(iv) }))
    .sort((a, b) => b.exclusive - a.exclusive || a.name.localeCompare(b.name));

  const first = traces[0] ? traces[0].spans : spans;
  const entry = first.find(s => s.id === entrySpanId(first));
  const rootId = entry ? entityIdOf(entry) : null;
  return {
    entities,
    slowest: entities[0] || null,
    root: entities.find(e => e.id === rootId) || null,
    exclusiveTotal: entities.reduce((a, e) => a + e.exclusive, 0)
  };
}
