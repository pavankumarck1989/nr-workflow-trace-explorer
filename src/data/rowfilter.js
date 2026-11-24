// Waterfall row filters: text search, errors only, and a time window. Pure.

export function isFiltering(f) {
  return Boolean(f && (f.query || f.errorsOnly || f.linksOnly || f.range));
}

// True when the span overlaps the [from, to] window (or there is no window).
export const inRange = (s, range) => !range || (s.end >= range.from && s.start <= range.to);

export function spanMatches(s, f) {
  if (!f) return true;
  if (f.errorsOnly && !s.isError) return false;
  if (f.linksOnly && !(f.links && f.links.has(`${s.traceId}/${s.id}`))) return false;
  if (!inRange(s, f.range)) return false;
  const q = (f.query || '').trim().toLowerCase();
  if (!q) return true;
  return [s.name, s.id, s.service, s.system, s.dbSystem].some(v =>
    String(v || '')
      .toLowerCase()
      .includes(q)
  );
}
