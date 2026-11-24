import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { buildSegments, makeScale } from '../data/timeline';
import { formatDuration } from '../data/state';

const H = 40;
const AXIS_H = 14;
const PAD = 8;
const BAD = '#d5252b';
const MAX_BARS = 3000;

// Compact time axis for the map: every span as a thin tick, idle gaps
// collapsed like the Timeline view. Drag across it to pick a window; the map
// dims the entities that were idle in it.
export default function TimeStrip({ spans, gapMs, range, onRange }) {
  const box = useRef(null);
  const [w, setW] = useState(0);
  const [drag, setDrag] = useState(null); // { a, b } in plot pixels
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const measure = () => setW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const plotW = Math.max(200, w - PAD * 2);
  const segments = useMemo(() => buildSegments(spans, gapMs), [spans, gapMs]);
  const scale = useMemo(
    () => makeScale(segments, { activePx: plotW, minActivePx: 40, gapPx: 70 }),
    [segments, plotW]
  );
  const t0 = useMemo(() => spans.reduce((m, s) => Math.min(m, s.start), Infinity), [spans]);
  const ticks = useMemo(
    () =>
      (spans.length > MAX_BARS ? spans.slice(0, MAX_BARS) : spans).map(s => {
        const x = scale.xOf(s.start);
        return (
          <rect
            key={`${s.traceId}/${s.id}`}
            x={x}
            y={AXIS_H + 4}
            width={Math.max(1.5, scale.xOf(s.end) - x)}
            height={H - AXIS_H - 8}
            fill={s.isError ? BAD : '#4a90c2'}
            opacity={0.55}
          />
        );
      }),
    [spans, scale]
  );
  if (!spans.length) return null;

  const px = e => e.clientX - e.currentTarget.getBoundingClientRect().left - PAD;
  const clamp = x => Math.max(0, Math.min(scale.width, x));
  const finish = () => {
    if (drag && Math.abs(drag.b - drag.a) > 4) {
      const [lo, hi] = [Math.min(drag.a, drag.b), Math.max(drag.a, drag.b)];
      onRange({ from: scale.tOf(lo), to: scale.tOf(hi) });
    }
    setDrag(null);
  };
  const sel = drag
    ? { x0: Math.min(drag.a, drag.b), x1: Math.max(drag.a, drag.b) }
    : range
      ? { x0: scale.xOf(range.from), x1: scale.xOf(range.to) }
      : null;

  return (
    <div className="wte-timebar" ref={box}>
      <svg
        className="wte-tl"
        width={scale.width + PAD * 2}
        height={H}
        onMouseDown={e => {
          const x = clamp(px(e));
          setDrag({ a: x, b: x });
        }}
        onMouseMove={e => drag && setDrag({ ...drag, b: clamp(px(e)) })}
        onMouseUp={finish}
        onMouseLeave={finish}
        style={{ cursor: 'crosshair' }}
      >
        <g transform={`translate(${PAD},0)`}>
          {scale.segments.map((s, i) =>
            s.type === 'gap' ? (
              <g key={i}>
                <rect
                  x={s.x0}
                  y={AXIS_H}
                  width={s.x1 - s.x0}
                  height={H - AXIS_H}
                  className="wte-tl-gap"
                />
                <text
                  x={(s.x0 + s.x1) / 2}
                  y={AXIS_H - 3}
                  textAnchor="middle"
                  className="wte-tl-tick"
                >
                  waiting {formatDuration(s.end - s.start)}
                </text>
              </g>
            ) : (
              <text key={i} x={s.x0 + 2} y={AXIS_H - 3} className="wte-tl-tick">
                +{formatDuration(s.start - t0)}
              </text>
            )
          )}
          {ticks}
          {sel && (
            <rect
              x={sel.x0}
              y={AXIS_H}
              width={Math.max(1, sel.x1 - sel.x0)}
              height={H - AXIS_H}
              className="wte-tl-sel"
              pointerEvents="none"
            />
          )}
        </g>
      </svg>
    </div>
  );
}

TimeStrip.propTypes = {
  spans: PropTypes.array.isRequired,
  gapMs: PropTypes.number.isRequired,
  range: PropTypes.shape({ from: PropTypes.number, to: PropTypes.number }),
  onRange: PropTypes.func.isRequired
};
