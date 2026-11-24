import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { buildSegments, makeScale } from '../data/timeline';
import { traceMapBars, packLanes, traceHeading, traceLinkMap, MAP_ROWS } from '../data/tracemap';
import { formatDuration } from '../data/state';
import { colorFor } from './colors';
import { clickable } from './a11y';
import { hasCrossTraceLink } from '../data/links';

const GAP_PX = 110;
const LABEL_H = 18;
const LANE_GAP = 4;
const BAD = '#d5252b';
const LINK = '#00a3a3';
const HEADING_PX = 260; // wide enough blocks also show the trace's entry span
const clock = ts => new Date(ts).toISOString().slice(11, 19);
const nums = list => list.map(n => n + 1).join(', ');
const MIN_LABEL_PX = 70; // narrower blocks show only the number
const MIN_READABLE_PX = 110; // a trace narrower than this switches to full-width rows

// Workflow overview: each trace is a small span map (every span a bar at its
// time and depth), idle gaps between traces are collapsed markers. Click a
// trace to jump to it, or a span's bar to open that span.
export default function TraceStrip({
  traces,
  links,
  extra,
  gapMs,
  selectedId,
  onSelect,
  onSelectSpan
}) {
  const box = useRef(null);
  const [width, setWidth] = useState(0);
  const [mode, setMode] = useState(null); // null = automatic, 'time' or 'full'
  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Active periods share whatever width is left after the fixed-width gaps.
  const scale = useMemo(() => {
    const segs = buildSegments(traces, gapMs);
    const gaps = segs.filter(s => s.type === 'gap').length;
    const activePx = Math.max(240, (width || 800) - 16 - gaps * GAP_PX);
    return makeScale(segs, { activePx, minActivePx: 60, gapPx: GAP_PX });
  }, [traces, gapMs, width]);
  // Bars per trace only change with the data, not with the window width.
  const bars = useMemo(() => traces.map(t => traceMapBars(t.spans)), [traces]);
  const heads = useMemo(() => traces.map(t => traceHeading(t.spans)), [traces]);
  const linkMap = useMemo(() => traceLinkMap(traces, links), [traces, links]);

  // Traces that overlap in time go on separate rows so each can be clicked.
  // When some trace would be too narrow to read on the shared time axis, every
  // trace gets its own full-width row instead (each drawn to its own length).
  const layout = useMemo(() => {
    const timeBoxes = traces.map(t => {
      const x0 = scale.xOf(t.start);
      return { x0, x1: x0 + Math.max(18, scale.xOf(t.end) - x0) };
    });
    const narrow = traces.length > 1 && timeBoxes.some(b => b.x1 - b.x0 < MIN_READABLE_PX);
    const full = mode ? mode === 'full' && traces.length > 1 : narrow;
    let boxes = timeBoxes;
    let lane;
    let count;
    if (full) {
      const W = Math.max(240, (width || 800) - 16);
      boxes = traces.map(() => ({ x0: 0, x1: W }));
      lane = traces.map((_, i) => i);
      count = traces.length;
    } else {
      ({ lane, count } = packLanes(boxes));
    }
    const rowH = count > 6 ? 3.4 : full || count <= 2 ? 4.8 : 3.4; // denser bars when there are many rows
    const mapH = Math.round(MAP_ROWS * rowH) + 4;
    return { boxes, lane, count, rowH, mapH, full, narrow, laneH: LABEL_H + mapH + LANE_GAP };
  }, [traces, scale, mode, width]);
  const { rowH: ROW_H, mapH: MAP_H, laneH } = layout;

  // One chip per trace, for picking a trace without aiming at its map.
  const chips = useMemo(
    () =>
      traces.map((t, i) => {
        const errors = t.spans.filter(s => s.isError).length;
        const nLinks = t.spans.reduce((a, s) => {
          const l = links.get(`${s.traceId}/${s.id}`);
          return a + (hasCrossTraceLink(l) ? l.length : 0);
        }, 0);
        return { t, i, errors, nLinks };
      }),
    [traces, links]
  );
  const selectedTrace = useMemo(
    () =>
      selectedId ? (traces.find(t => t.spans.some(s => s.id === selectedId)) || {}).traceId : null,
    [traces, selectedId]
  );
  const [hover, setHover] = useState(-1); // chip under the pointer, outlined on the map

  const blocks = useMemo(
    () =>
      traces.map((t, i) => {
        const x0 = layout.boxes[i].x0;
        const w = layout.boxes[i].x1 - x0;
        const dur = Math.max(t.end - t.start, 0.001);
        const errors = t.spans.filter(s => s.isError).length;
        const nLinks = t.spans.reduce((a, s) => {
          const l = links.get(`${s.traceId}/${s.id}`);
          return a + (hasCrossTraceLink(l) ? l.length : 0);
        }, 0);
        const isExtra = extra.has(t.traceId);
        const tip =
          `Trace ${i + 1}: ${heads[i].title || t.traceId}\n${t.traceId}\nstarted ${clock(t.start)} UTC, ${t.spans.length} spans, ${formatDuration(t.end - t.start)}` +
          (linkMap[i].to.length ? `\nlinks to trace ${nums(linkMap[i].to)}` : '') +
          (linkMap[i].from.length ? `\nlinked by trace ${nums(linkMap[i].from)}` : '') +
          (errors ? `, ${errors} error span(s)` : '') +
          (nLinks ? `\n${nLinks} span link(s) to other traces` : '') +
          (isExtra ? '\nLoaded through a span link' : '');
        return (
          <div
            key={t.traceId}
            className={`wte-strip-trace${errors ? ' wte-strip-err' : ''}${isExtra ? ' wte-strip-extra' : ''}`}
            style={{ left: x0, width: w, top: layout.lane[i] * laneH }}
          >
            <div
              className="wte-strip-label wte-strip-jump"
              title={tip}
              {...clickable(() => onSelect(t.traceId))}
            >
              <b>{i + 1}</b>
              {layout.full && i > 0 && (
                <span className="wte-muted">+{formatDuration(t.start - traces[0].start)}</span>
              )}
              {w >= HEADING_PX && heads[i].title && (
                <span className="wte-strip-title" title={heads[i].title}>
                  {heads[i].title}
                </span>
              )}
              {w >= MIN_LABEL_PX && (
                <span className="wte-muted">
                  {formatDuration(t.end - t.start)} · {t.spans.length} spans
                  {w >= HEADING_PX && ` · ${clock(t.start)} UTC`}
                </span>
              )}
              {w >= HEADING_PX && linkMap[i].to.length > 0 && (
                <span className="wte-muted">links to {nums(linkMap[i].to)}</span>
              )}
              {w >= HEADING_PX && linkMap[i].from.length > 0 && (
                <span className="wte-muted">linked by {nums(linkMap[i].from)}</span>
              )}
              {errors > 0 && w >= MIN_LABEL_PX + 40 && (
                <span className="wte-bad">{errors} err</span>
              )}
              {nLinks > 0 && (
                <span
                  className="wte-strip-linkbadge"
                  title={`${nLinks} span link(s) to other traces`}
                >
                  {nLinks}
                </span>
              )}
            </div>
            <svg
              className="wte-strip-map"
              width={w}
              height={MAP_H}
              role="button"
              tabIndex={0}
              aria-label={`Go to trace ${i + 1}, ${t.spans.length} spans`}
              {...clickable(() => onSelect(t.traceId))}
            >
              <title>{tip}</title>
              {bars[i].map(({ span: s, row }) => {
                const x = ((s.start - t.start) / dur) * (w - 2) + 1;
                const bw = Math.max(1.5, (s.durMs / dur) * (w - 2));
                const cross = hasCrossTraceLink(links.get(`${s.traceId}/${s.id}`));
                return (
                  <rect
                    key={s.id}
                    x={x}
                    y={row * ROW_H + 2}
                    width={Math.min(bw, w - 1 - x + 1)}
                    height={ROW_H - 1}
                    rx={1}
                    fill={s.isError ? BAD : colorFor(s.system)}
                    stroke={selectedId === s.id ? 'currentColor' : cross ? LINK : 'none'}
                    strokeWidth={selectedId === s.id ? 1.5 : 1}
                    className="wte-strip-bar"
                    onClick={e => {
                      e.stopPropagation();
                      onSelectSpan(s.traceId, s.id);
                    }}
                  >
                    <title>{`${s.name} | ${s.service || s.system} | ${formatDuration(s.durMs)}${s.isError ? ' | ERROR' : ''}`}</title>
                  </rect>
                );
              })}
            </svg>
          </div>
        );
      }),
    [
      traces,
      bars,
      heads,
      linkMap,
      layout,
      ROW_H,
      MAP_H,
      laneH,
      links,
      extra,
      selectedId,
      onSelect,
      onSelectSpan
    ]
  );

  if (!traces.length) return null;
  return (
    <div>
      {traces.length > 1 && (
        <div className="wte-tchips" role="group" aria-label="Traces in this workflow">
          <button
            type="button"
            className="wte-tchip wte-tchip-mode"
            title={
              layout.full
                ? 'Back to one shared time axis (idle gaps collapsed)'
                : 'One full-width row per trace, each drawn to its own length'
            }
            onClick={() => setMode(layout.full ? 'time' : 'full')}
          >
            {layout.full ? 'Time aligned' : 'Full width rows'}
          </button>
          {chips.map(({ t, i, errors, nLinks }) => (
            <button
              type="button"
              key={t.traceId}
              className={`wte-tchip${t.traceId === selectedTrace ? ' wte-tchip-on' : ''}${errors ? ' wte-tchip-err' : ''}${extra.has(t.traceId) ? ' wte-tchip-extra' : ''}`}
              title={`${heads[i].title}\n${t.traceId}\n${t.spans.length} spans, ${formatDuration(t.end - t.start)}${errors ? `, ${errors} error span(s)` : ''}${nLinks ? `, ${nLinks} span link(s) to other traces` : ''}`}
              onClick={() => onSelect(t.traceId)}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(-1)}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(-1)}
            >
              <b>{i + 1}</b>
              {heads[i].title && <span className="wte-tchip-title">{heads[i].title}</span>}
              <span>{formatDuration(t.end - t.start)}</span>
              <span className="wte-muted">{t.spans.length} spans</span>
              {errors > 0 && <span className="wte-bad">{errors} err</span>}
              {nLinks > 0 && <span className="wte-strip-linkbadge">{nLinks}</span>}
            </button>
          ))}
        </div>
      )}
      <div className="wte-strip" ref={box}>
        <div
          className="wte-strip-inner"
          style={{
            width: (layout.full ? layout.boxes[0].x1 : scale.width) + 8,
            height: layout.count * laneH
          }}
        >
          {(layout.full ? [] : scale.segments)
            .filter(s => s.type === 'gap')
            .map((s, i) => (
              <div
                key={i}
                className="wte-strip-gap"
                style={{
                  left: s.x0,
                  width: s.x1 - s.x0,
                  top: 0,
                  height: layout.count * laneH - LANE_GAP
                }}
              >
                waiting {formatDuration(s.end - s.start)}
              </div>
            ))}
          {blocks}
          {hover >= 0 && layout.boxes[hover] && (
            <div
              className="wte-strip-hot"
              style={{
                left: layout.boxes[hover].x0 - 3,
                top: layout.lane[hover] * laneH - 2,
                width: layout.boxes[hover].x1 - layout.boxes[hover].x0 + 6,
                height: laneH - LANE_GAP + 2
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

TraceStrip.propTypes = {
  traces: PropTypes.array.isRequired,
  links: PropTypes.instanceOf(Map).isRequired,
  extra: PropTypes.instanceOf(Set).isRequired,
  gapMs: PropTypes.number.isRequired,
  selectedId: PropTypes.string,
  onSelect: PropTypes.func.isRequired,
  onSelectSpan: PropTypes.func.isRequired
};
