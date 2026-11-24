// Normalize span rows and group them by trace. Pure functions.

import { DEFAULT_SYSTEM, firstValue } from '../config/attributes.js';

export function classifySystem(service, name, rules) {
  const hay = `${service || ''} ${name || ''}`.toLowerCase();
  for (const r of rules) {
    if (hay.includes(String(r.pattern).toLowerCase())) return r.system;
  }
  return service || DEFAULT_SYSTEM;
}

export function normalizeSpan(raw, attrs, rules) {
  const start = Number(raw.timestamp);
  const durMs = Number(raw[attrs.duration]) || 0;
  const status = raw[attrs.status] || '';
  return {
    attributes: raw, // every attribute, for the span side panel
    id: raw[attrs.spanId],
    traceId: raw[attrs.traceId],
    parentId: raw[attrs.parentId] || null,
    name: raw[attrs.name] || '(unnamed)',
    service: raw[attrs.service] || '',
    entityGuid: raw[attrs.entityGuid] || null,
    dbSystem: raw[attrs.dbSystem] || raw['db.system.name'] || raw['db.system'] || null,
    system: classifySystem(raw[attrs.service], raw[attrs.name], rules),
    start,
    durMs,
    end: start + durMs,
    status,
    isError: String(status).toUpperCase() === 'ERROR',
    correlationId: firstValue(raw, attrs.correlationId)
  };
}

// Returns { spans, traces }: spans are normalized, de-duplicated and sorted by
// start; `traces` has one entry per trace id (its spans, start and end), sorted
// by start.
export function stitch(rawSpans, attrs, rules) {
  const seen = new Set();
  const spans = [];
  for (const raw of rawSpans) {
    const s = normalizeSpan(raw, attrs, rules);
    if (!s.id || !s.traceId || !Number.isFinite(s.start)) continue;
    const key = `${s.traceId}/${s.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    spans.push(s);
  }
  spans.sort((a, b) => a.start - b.start);

  const traceMap = new Map();
  for (const s of spans) {
    if (!traceMap.has(s.traceId)) {
      traceMap.set(s.traceId, { traceId: s.traceId, spans: [], start: s.start, end: s.end });
    }
    const t = traceMap.get(s.traceId);
    t.spans.push(s);
    t.start = Math.min(t.start, s.start);
    t.end = Math.max(t.end, s.end);
  }
  const traces = [...traceMap.values()].sort((a, b) => a.start - b.start);
  return { spans, traces };
}

// Entities (services) taking part in a trace, busiest first.
export function traceEntities(spans) {
  const m = new Map();
  for (const s of spans) {
    const name = s.service || s.system;
    if (!m.has(name)) m.set(name, { name, guid: null, system: s.system, spans: 0, errors: 0 });
    const e = m.get(name);
    e.spans += 1;
    if (s.isError) e.errors += 1;
    if (!e.guid && s.entityGuid) e.guid = s.entityGuid;
  }
  return [...m.values()].sort((a, b) => b.spans - a.spans || a.name.localeCompare(b.name));
}
