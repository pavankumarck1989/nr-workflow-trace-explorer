import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import { entityLatency } from '../data/latency';
import { formatDuration } from '../data/state';
import { colorFor } from './colors';
import { activatable } from './a11y';
import { openEntity } from './entityLink';

const DB = '#8e5bd1';
const R = 80;
const colorOf = e => (e.kind === 'database' ? DB : colorFor(e.system));

// SVG donut slice from fraction a to b (0..1) of the circle.
function arc(a, b, r0 = 46, r1 = R) {
  const pt = (f, r) => [R + r * Math.sin(2 * Math.PI * f), R - r * Math.cos(2 * Math.PI * f)];
  const big = b - a > 0.5 ? 1 : 0;
  const [x0, y0] = pt(a, r1);
  const [x1, y1] = pt(b, r1);
  const [x2, y2] = pt(b, r0);
  const [x3, y3] = pt(a, r0);
  return `M${x0},${y0} A${r1},${r1} 0 ${big} 1 ${x1},${y1} L${x2},${y2} A${r0},${r0} 0 ${big} 0 ${x3},${y3} Z`;
}

// Where the time goes per entity (exclusive and total time, spans, errors,
// logs).
export default function LatencyView({ spans, traces, bySpan, selected, onSelect }) {
  const lat = useMemo(() => entityLatency(spans, traces, bySpan), [spans, traces, bySpan]);
  if (!lat.entities.length) return null;
  const sum = lat.exclusiveTotal || 1;
  let acc = 0;
  const slices = lat.entities
    .filter(e => e.exclusive > 0)
    .map(e => {
      const a = acc / sum;
      acc += e.exclusive;
      return { e, a, b: Math.min(acc / sum, a + 0.99999) };
    });

  return (
    <div>
      <div className="wte-lat">
        <div className="wte-lat-stats">
          <div>
            <span className="wte-muted">Slowest entity</span>
            <b>{lat.slowest.name}</b>
            <span>{formatDuration(lat.slowest.exclusive)} exclusive</span>
          </div>
          {lat.root && (
            <div>
              <span className="wte-muted">Root entity</span>
              <b>{lat.root.name}</b>
              <span>{formatDuration(lat.root.total)} total</span>
            </div>
          )}
          <div>
            <span className="wte-muted">Time in entities</span>
            <b>{formatDuration(lat.exclusiveTotal)}</b>
            <span>sum of exclusive time</span>
          </div>
        </div>
        <svg
          className="wte-lat-donut"
          width={R * 2}
          height={R * 2}
          role="img"
          aria-label="Exclusive time by entity"
        >
          {slices.map(({ e, a, b }) => (
            <path
              key={e.id}
              d={arc(a, b)}
              fill={colorOf(e)}
              opacity={selected && selected !== e.id ? 0.3 : 1}
            >
              <title>{`${e.name}: ${formatDuration(e.exclusive)} (${Math.round((e.exclusive / sum) * 100)}%)`}</title>
            </path>
          ))}
          <text x={R} y={R - 2} textAnchor="middle" className="wte-lat-total">
            {formatDuration(lat.exclusiveTotal)}
          </text>
          <text x={R} y={R + 13} textAnchor="middle" className="wte-lat-total-sub">
            exclusive
          </text>
        </svg>
        <table className="wte-table wte-clickable wte-lat-table">
          <thead>
            <tr>
              <th>Entity</th>
              <th title="System lane from the Settings classification rules">System</th>
              <th
                className="wte-num"
                title="Time in the entity itself, excluding its calls to other spans"
              >
                Exclusive
              </th>
              <th className="wte-num">Share</th>
              <th className="wte-num" title="Time the entity was busy, nested spans counted once">
                Total
              </th>
              <th
                className="wte-num"
                title="A service counts all its spans, including its database calls"
              >
                Spans
              </th>
              <th className="wte-num">Error spans</th>
              <th className="wte-num">Logs</th>
              <th className="wte-num">Error logs</th>
            </tr>
          </thead>
          <tbody>
            {lat.entities.map(e => (
              <tr
                key={e.id}
                className={selected === e.id ? 'wte-lat-on' : ''}
                {...activatable(() => onSelect(e.id))}
              >
                <td>
                  <span className="wte-dot" style={{ background: colorOf(e) }} /> {e.name}
                  {e.kind === 'database' && <span className="wte-tag">db</span>}
                  {e.guid && (
                    <button
                      type="button"
                      className="wte-linkbtn wte-open-entity"
                      title="Open entity"
                      aria-label={`Open ${e.name}`}
                      onClick={ev => {
                        ev.stopPropagation();
                        openEntity(e.guid);
                      }}
                      onKeyDown={ev => ev.stopPropagation()}
                    >
                      &#8599;
                    </button>
                  )}
                </td>
                <td className="wte-muted">{e.system !== e.name ? e.system : ''}</td>
                <td className="wte-num">{formatDuration(e.exclusive)}</td>
                <td className="wte-num">
                  <span className="wte-lat-bar">
                    <span
                      style={{ width: `${(e.exclusive / sum) * 100}%`, background: colorOf(e) }}
                    />
                  </span>
                  {Math.round((e.exclusive / sum) * 100)}%
                </td>
                <td className="wte-num">{formatDuration(e.total)}</td>
                <td className="wte-num">{e.spans}</td>
                <td className={`wte-num${e.errors ? ' wte-bad' : ''}`}>{e.errors}</td>
                <td className="wte-num">{e.logs}</td>
                <td className={`wte-num${e.errorLogs ? ' wte-bad' : ''}`}>{e.errorLogs}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

LatencyView.propTypes = {
  spans: PropTypes.array.isRequired,
  traces: PropTypes.array.isRequired,
  bySpan: PropTypes.instanceOf(Map).isRequired,
  selected: PropTypes.string,
  onSelect: PropTypes.func.isRequired
};
