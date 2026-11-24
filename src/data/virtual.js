// Windowing for long lists of fixed-height rows. Pure functions.

// Rows [start, end) to render for a scroll position, with `overscan` rows of
// margin either side.
export function windowRange(total, scrollTop, viewportH, rowH, overscan = 8) {
  const first = Math.floor(Math.max(0, scrollTop) / rowH);
  const count = Math.ceil(viewportH / rowH);
  return {
    start: Math.min(total, Math.max(0, first - overscan)),
    end: Math.min(total, first + count + overscan)
  };
}

// Scroll position that brings row `index` into view, or null when it already is.
export function scrollToRow(index, scrollTop, viewportH, rowH) {
  const top = index * rowH;
  if (top >= scrollTop && top + rowH <= scrollTop + viewportH) return null;
  return Math.max(0, top - Math.floor(viewportH / 2));
}
