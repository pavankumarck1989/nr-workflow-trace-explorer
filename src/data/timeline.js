// Piecewise timeline: active periods keep a proportional width (with a
// minimum), idle gaps over gapMs collapse to a fixed-width marker.

export function buildSegments(spans, gapMs) {
  if (!spans.length) return [];
  const iv = spans.map(s => [s.start, Math.max(s.end, s.start)]).sort((a, b) => a[0] - b[0]);
  const segs = [];
  let cur = { type: 'active', start: iv[0][0], end: iv[0][1] };
  for (let i = 1; i < iv.length; i++) {
    const [s, e] = iv[i];
    if (s - cur.end > gapMs) {
      segs.push(cur);
      segs.push({ type: 'gap', start: cur.end, end: s });
      cur = { type: 'active', start: s, end: e };
    } else {
      cur.end = Math.max(cur.end, e);
    }
  }
  segs.push(cur);
  return segs;
}

export function makeScale(segments, opts = {}) {
  const { activePx = 600, minActivePx = 80, gapPx = 90 } = opts;
  const active = segments.filter(s => s.type === 'active');
  const total = active.reduce((a, s) => a + (s.end - s.start), 0) || 1;
  let x = 0;
  const laid = segments.map(s => {
    const w =
      s.type === 'gap' ? gapPx : Math.max(minActivePx, (activePx * (s.end - s.start)) / total);
    const out = { ...s, x0: x, x1: x + w };
    x += w;
    return out;
  });
  const xOf = t => {
    for (const s of laid) {
      if (t < s.start) return s.x0;
      if (t <= s.end) {
        if (s.type === 'gap') return t >= s.end ? s.x1 : s.x0;
        if (s.end === s.start) return s.x0;
        return s.x0 + ((t - s.start) / (s.end - s.start)) * (s.x1 - s.x0);
      }
    }
    return laid.length ? laid[laid.length - 1].x1 : 0;
  };
  // Inverse of xOf: the time at pixel x (gaps snap to their nearest edge).
  const tOf = px => {
    for (const s of laid) {
      if (px <= s.x1) {
        if (s.type === 'gap') return px - s.x0 < s.x1 - px ? s.start : s.end;
        return s.start + ((Math.max(px, s.x0) - s.x0) / (s.x1 - s.x0 || 1)) * (s.end - s.start);
      }
    }
    return laid.length ? laid[laid.length - 1].end : 0;
  };
  return { segments: laid, width: x, xOf, tOf };
}
