import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { buildEntityMap } from '../data/entitymap';
import { entityLatency } from '../data/latency';
import { formatDuration } from '../data/state';
import { colorFor } from './colors';
import { clickable } from './a11y';
import { openEntity } from './entityLink';

const CARD_W = 176;
const CARD_H = 58;
const BAD = '#d5252b';
const DB = '#8e5bd1';
const LAYOUT = { colW: 270, rowH: 68, padX: 100, padY: 44, dummyH: 30, cardW: CARD_W };
const MAX_FIT = 1.5;
const MIN_FIT = 0.8;
const trunc = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// Small cylinder glyph for databases.
function Cylinder({ x, y, color }) {
  return (
    <g transform={`translate(${x},${y})`} fill="none" stroke={color} strokeWidth="1.6">
      <ellipse cx="9" cy="4" rx="8" ry="3" />
      <path d="M1 4v12c0 1.7 3.6 3 8 3s8-1.3 8-3V4" />
      <path d="M1 10c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </g>
  );
}
Cylinder.propTypes = { x: PropTypes.number, y: PropTypes.number, color: PropTypes.string };

// Services and databases in the workflow, with the calls between them. Each
// card shows the entity's spans, errors and share of the workflow's time.
// `zoom` multiplies the size that fits the available box.
export default function EntityMap({ spans, selected, onSelect, zoom, range }) {
  const box = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState(null);
  const map = useMemo(() => buildEntityMap(spans, LAYOUT), [spans]);
  const byId = useMemo(() => new Map(map.nodes.map(n => [n.id, n])), [map]);
  const lat = useMemo(() => entityLatency(spans), [spans]);
  const latOf = useMemo(() => new Map(lat.entities.map(e => [e.id, e])), [lat]);

  // Entities and calls with a span in the picked time window; the rest dim.
  const live = useMemo(() => {
    if (!range) return null;
    const m = buildEntityMap(spans.filter(s => s.end >= range.from && s.start <= range.to));
    return {
      nodes: new Set(m.nodes.map(n => n.id)),
      edges: new Set(m.edges.map(e => `${e.from}>${e.to}`))
    };
  }, [spans, range]);

  useEffect(() => {
    const el = box.current;
    if (!el) return undefined;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!map.nodes.length) return null;
  const W = Math.max(map.width, 320);
  const H = map.height + CARD_H;
  // Height may not shrink cards below MIN_FIT; the box scrolls instead.
  const fit =
    size.w && size.h
      ? Math.min((size.w - 12) / W, Math.max((size.h - 12) / H, MIN_FIT), MAX_FIT)
      : 1;
  const k = Math.max(0.25, fit * zoom);
  const arrowColors = [
    ...new Set(
      map.edges.map(e => {
        const a = byId.get(e.from);
        return e.errors > 0 ? BAD : a.kind === 'database' ? DB : colorFor(a.system);
      })
    )
  ];
  const maxMs = Math.max(1, ...lat.entities.map(e => e.exclusive));
  const root = lat.root && lat.root.id;
  const slowest = lat.slowest && lat.slowest.id;

  return (
    <div className="wte-map-box" ref={box}>
      <svg className="wte-map" width={W * k} height={H * k} viewBox={`0 0 ${W} ${H}`}>
        <defs>
          {arrowColors.map(c => (
            <marker
              key={c}
              id={`wte-arrow-${c.slice(1)}`}
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M0 0 L10 5 L0 10 z" fill={c} />
            </marker>
          ))}
        </defs>
        {map.edges.map(e => {
          const a = byId.get(e.from);
          const b = byId.get(e.to);
          // A call back to an earlier column leaves a's left side and enters
          // b's right side, a little lower so it does not overlap the way in.
          const off = e.back ? 9 : 0;
          const x1 = e.back ? a.x - CARD_W / 2 - 2 : a.x + CARD_W / 2 + 2;
          const x2 = e.back ? b.x + CARD_W / 2 + 7 : b.x - CARD_W / 2 - 7;
          const pts = [
            { x: x1, y: a.y + off, cx: a.x },
            ...e.via.map(v => ({ x: v.x, y: v.y + off, cx: v.x })),
            { x: x2, y: b.y + off, cx: b.x }
          ];
          // Elbow route like the platform map: run along a row, turn only in
          // the gap between two columns (so never across a card), run on.
          let d = `M${pts[0].x},${pts[0].y}`;
          let lastTurn = x2;
          for (let i = 1; i < pts.length; i++) {
            const p = pts[i - 1];
            const q = pts[i];
            const mx = e.turns[i - 1] == null ? (p.cx + q.cx) / 2 : e.turns[i - 1];
            const dir = Math.sign(q.x - p.x) || 1;
            const dy = q.y - p.y;
            const r = Math.min(8, Math.abs(dy) / 2, Math.abs(mx - p.x), Math.abs(q.x - mx));
            if (Math.abs(dy) < 1 || r < 1) {
              d += ` L${q.x},${q.y}`;
            } else {
              const sy = Math.sign(dy);
              d +=
                ` L${mx - dir * r},${p.y} Q${mx},${p.y} ${mx},${p.y + sy * r}` +
                ` L${mx},${q.y - sy * r} Q${mx},${q.y} ${mx + dir * r},${q.y} L${q.x},${q.y}`;
            }
            lastTurn = mx;
          }
          const focus = hover || selected;
          const dim =
            (focus && focus !== e.from && focus !== e.to) ||
            (live && !live.edges.has(`${e.from}>${e.to}`));
          const bad = e.errors > 0;
          const label = `${e.calls}x${bad ? ` · ${e.errors} err` : ''}`;
          // Call counts only where they matter: errors, or the selected entity.
          const showLabel = bad || (focus && (focus === e.from || focus === e.to));
          const color = bad ? BAD : a.kind === 'database' ? DB : colorFor(a.system);
          const lw = label.length * 6 + 12;
          const mx = (lastTurn + x2) / 2;
          const ly = pts[pts.length - 1].y;
          return (
            <g key={`${e.from}>${e.to}`} opacity={dim ? 0.15 : 1}>
              <path
                d={d}
                fill="none"
                stroke={color}
                strokeOpacity={0.8}
                strokeWidth={1.2 + Math.min(1.8, Math.log2(e.calls + 1) * 0.35)}
                markerEnd={`url(#wte-arrow-${color.slice(1)})`}
              />
              <title>{label}</title>
              {showLabel && (
                <>
                  <rect
                    x={mx - lw / 2}
                    y={ly - 9}
                    width={lw}
                    height={17}
                    rx={8.5}
                    className="wte-map-pill"
                    stroke={bad ? BAD : undefined}
                  />
                  <text
                    x={mx}
                    y={ly + 3.5}
                    textAnchor="middle"
                    className="wte-map-edge"
                    fill={bad ? BAD : undefined}
                  >
                    {label}
                  </text>
                </>
              )}
            </g>
          );
        })}
        {map.nodes.map(n => {
          const on = selected === n.id;
          const dim = (selected && !on) || (live && !live.nodes.has(n.id));
          const db = n.kind === 'database';
          const color = db ? DB : colorFor(n.system);
          const l = latOf.get(n.id);
          const share = l ? l.exclusive / maxMs : 0;
          const x0 = n.x - CARD_W / 2;
          const y0 = n.y - CARD_H / 2;
          return (
            <g
              key={n.id}
              className="wte-map-node"
              opacity={dim ? 0.35 : 1}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover(null)}
              {...clickable(() => onSelect(on ? null : n.id))}
              aria-label={`${n.name}: ${n.spans} spans, ${n.errors} errors`}
            >
              <title>
                {`${n.name}\n${n.spans} spans, ${n.errors} errors${l ? `\n${formatDuration(l.exclusive)} exclusive, ${formatDuration(l.total)} total` : ''}`}
              </title>
              <rect
                x={x0}
                y={y0}
                width={CARD_W}
                height={CARD_H}
                rx={9}
                className="wte-map-card"
                stroke={on ? '#0078bf' : color}
                strokeWidth={on ? 3 : 1.5}
                strokeDasharray={db ? '5 3' : undefined}
              />
              <rect x={x0} y={y0 + 8} width={5} height={CARD_H - 16} rx={2.5} fill={color} />
              {db ? (
                <Cylinder x={x0 + 14} y={y0 + 10} color={color} />
              ) : (
                <circle cx={x0 + 23} cy={y0 + 20} r={9} fill={color} fillOpacity={0.9} />
              )}
              {!db && (
                <text
                  x={x0 + 23}
                  y={y0 + 24}
                  textAnchor="middle"
                  className="wte-map-glyph"
                  fill="#fff"
                >
                  {n.name.slice(0, 2).toUpperCase()}
                </text>
              )}
              {n.guid && (
                <g
                  className="wte-map-open"
                  role="button"
                  tabIndex={0}
                  aria-label={`Open ${n.name}`}
                  onClick={ev => {
                    ev.stopPropagation();
                    openEntity(n.guid);
                  }}
                  onKeyDown={ev => {
                    ev.stopPropagation();
                    if (ev.key === 'Enter' || ev.key === ' ') {
                      ev.preventDefault();
                      openEntity(n.guid);
                    }
                  }}
                >
                  <title>Open entity</title>
                  <rect
                    x={x0 + CARD_W - 22}
                    y={y0 + 4}
                    width={18}
                    height={16}
                    rx={3}
                    fill="transparent"
                  />
                  <text x={x0 + CARD_W - 13} y={y0 + 16} textAnchor="middle" fill={color}>
                    &#8599;
                  </text>
                </g>
              )}
              <text x={x0 + 40} y={y0 + 19} className="wte-map-label">
                {trunc(n.name, 17)}
              </text>
              <text x={x0 + 40} y={y0 + 33} className="wte-map-sub">
                {db ? 'database · ' : ''}
                {n.spans} {db ? 'calls' : 'spans'}
                {l ? ` · ${formatDuration(l.exclusive)}` : ''}
              </text>
              <rect
                x={x0 + 12}
                y={y0 + CARD_H - 11}
                width={CARD_W - 24}
                height={4}
                rx={2}
                className="wte-map-track"
              />
              <rect
                x={x0 + 12}
                y={y0 + CARD_H - 11}
                width={Math.max(2, (CARD_W - 24) * share)}
                height={4}
                rx={2}
                fill={color}
              />
              {n.errors > 0 && (
                <g>
                  <rect x={x0 + CARD_W - 46} y={y0 - 8} width={40} height={16} rx={8} fill={BAD} />
                  <text
                    x={x0 + CARD_W - 26}
                    y={y0 + 3.5}
                    textAnchor="middle"
                    className="wte-map-badge"
                  >
                    {n.errors} err
                  </text>
                </g>
              )}
              {(n.id === root || n.id === slowest) && (
                <g>
                  {n.id === root && (
                    <text x={x0 + 8} y={y0 - 6} className="wte-map-flag">
                      ▶ entry
                    </text>
                  )}
                  {n.id === slowest && (
                    <text
                      x={x0 + (n.id === root ? 62 : 8)}
                      y={y0 - 6}
                      className="wte-map-flag wte-map-flag-slow"
                    >
                      ◷ slowest
                    </text>
                  )}
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

EntityMap.propTypes = {
  spans: PropTypes.array.isRequired,
  selected: PropTypes.string,
  onSelect: PropTypes.func.isRequired,
  zoom: PropTypes.number,
  range: PropTypes.shape({ from: PropTypes.number, to: PropTypes.number })
};
EntityMap.defaultProps = { zoom: 1 };
