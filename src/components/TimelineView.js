import React, { useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { buildSegments, makeScale } from '../data/timeline';
import { entityIdOf } from '../data/latency';
import { formatDuration } from '../data/state';
import { colorFor } from './colors';
import { clickable } from './a11y';

const LABEL_W = 150;
const LANE_H = 24;
const AXIS_H = 26;
const PLOT_W = 900;
const MAX_BARS = 6000;
const BAD = '#d5252b';
const DB = '#8e5bd1';

// One lane per entity over time, idle gaps collapsed. Drag across the lanes to
// focus the waterfall on that window; click a bar to open the span.
export default function TimelineView({
  spans,
  gapMs,
  selectedId,
  focus,
  range,
  onRange,
  onSelectSpan
}) {
  const svgRef = useRef(null);
  const [drag, setDrag] = useState(null); // { a, b } in plot pixels
  const scale = useMemo(
    () => makeScale(buildSegments(spans, gapMs), { activePx: PLOT_W, minActivePx: 70, gapPx: 90 }),
    [spans, gapMs]
  );
  const lanes = useMemo(() => {
    const by = new Map();
    for (const s of spans) {
      const id = entityIdOf(s);
      if (!by.has(id)) {
        by.set(id, {
          id,
          name: s.dbSystem || s.service || s.system,
          db: !!s.dbSystem,
          system: s.system,
          first: s.start
        });
      }
      const l = by.get(id);
      l.first = Math.min(l.first, s.start);
    }
    return [...by.values()].sort((a, b) => a.first - b.first || a.name.localeCompare(b.name));
  }, [spans]);
  // The bars are the expensive part (up to MAX_BARS rects). They do not depend
  // on the drag, so a drag only re-renders the selection rectangle.
  const bars = useMemo(() => {
    const laneOf = new Map(lanes.map((l, i) => [l.id, i]));
    return (spans.length > MAX_BARS ? spans.slice(0, MAX_BARS) : spans).map(s => {
      const lane = laneOf.get(entityIdOf(s));
      const x = LABEL_W + scale.xOf(s.start);
      const w = Math.max(2, scale.xOf(s.end) - scale.xOf(s.start));
      const color = s.isError ? BAD : s.dbSystem ? DB : colorFor(s.system);
      const dim =
        (focus && focus !== entityIdOf(s)) || (range && (s.end < range.from || s.start > range.to));
      return (
        <rect
          key={`${s.traceId}/${s.id}`}
          x={x}
          y={AXIS_H + lane * LANE_H + 5}
          width={w}
          height={LANE_H - 10}
          rx={2}
          fill={color}
          opacity={dim ? 0.25 : 1}
          stroke={selectedId === s.id ? 'currentColor' : 'none'}
          strokeWidth={2}
          className="wte-tl-bar"
          aria-label={`${s.name}, ${formatDuration(s.durMs)}`}
          {...clickable(() => onSelectSpan(s.id))}
        >
          <title>{`${s.name} | ${s.service || s.system} | ${formatDuration(s.durMs)}${s.isError ? ' | ERROR' : ''}`}</title>
        </rect>
      );
    });
  }, [spans, lanes, scale, focus, range, selectedId, onSelectSpan]);
  const t0 = useMemo(() => spans.reduce((m, s) => Math.min(m, s.start), Infinity), [spans]);
  if (!spans.length) return null;

  const H = AXIS_H + lanes.length * LANE_H + 6;
  const W = LABEL_W + scale.width + 12;
  const px = e => e.clientX - svgRef.current.getBoundingClientRect().left - LABEL_W;
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
    <div className="wte-tl-wrap">
      <svg
        ref={svgRef}
        className="wte-tl"
        width={W}
        height={H}
        onMouseMove={e => drag && setDrag({ ...drag, b: clamp(px(e)) })}
        onMouseUp={finish}
        onMouseLeave={finish}
      >
        {scale.segments.map((s, i) =>
          s.type === 'gap' ? (
            <g key={i}>
              <rect
                x={LABEL_W + s.x0}
                y={AXIS_H - 4}
                width={s.x1 - s.x0}
                height={H - AXIS_H}
                className="wte-tl-gap"
              />
              <text
                x={LABEL_W + (s.x0 + s.x1) / 2}
                y={AXIS_H - 10}
                textAnchor="middle"
                className="wte-tl-tick"
              >
                waiting {formatDuration(s.end - s.start)}
              </text>
            </g>
          ) : (
            <text key={i} x={LABEL_W + s.x0 + 2} y={AXIS_H - 10} className="wte-tl-tick">
              +{formatDuration(s.start - t0)}
            </text>
          )
        )}
        {lanes.map((l, i) => (
          <g key={l.id} opacity={focus && focus !== l.id ? 0.35 : 1}>
            <rect
              x={0}
              y={AXIS_H + i * LANE_H}
              width={W}
              height={LANE_H}
              className={i % 2 ? 'wte-tl-lane' : 'wte-tl-lane wte-tl-lane-alt'}
            />
            <circle
              cx={10}
              cy={AXIS_H + i * LANE_H + LANE_H / 2}
              r={4}
              fill={l.db ? DB : colorFor(l.system)}
            />
            <text x={20} y={AXIS_H + i * LANE_H + LANE_H / 2 + 4} className="wte-tl-label">
              {l.name.length > 20 ? `${l.name.slice(0, 19)}…` : l.name}
              <title>{l.name}</title>
            </text>
          </g>
        ))}
        <rect
          x={LABEL_W}
          y={AXIS_H}
          width={scale.width}
          height={lanes.length * LANE_H}
          fill="transparent"
          style={{ cursor: 'crosshair' }}
          onMouseDown={e => {
            const x = clamp(px(e));
            setDrag({ a: x, b: x });
          }}
        />
        {bars}
        {sel && (
          <rect
            x={LABEL_W + sel.x0}
            y={AXIS_H}
            width={Math.max(1, sel.x1 - sel.x0)}
            height={lanes.length * LANE_H}
            className="wte-tl-sel"
            pointerEvents="none"
          />
        )}
      </svg>
      {spans.length > MAX_BARS && (
        <div className="wte-muted wte-pad">
          Showing the first {MAX_BARS.toLocaleString()} of {spans.length.toLocaleString()} spans.
        </div>
      )}
    </div>
  );
}

TimelineView.propTypes = {
  spans: PropTypes.array.isRequired,
  gapMs: PropTypes.number.isRequired,
  selectedId: PropTypes.string,
  focus: PropTypes.string,
  range: PropTypes.shape({ from: PropTypes.number, to: PropTypes.number }),
  onRange: PropTypes.func.isRequired,
  onSelectSpan: PropTypes.func.isRequired
};
