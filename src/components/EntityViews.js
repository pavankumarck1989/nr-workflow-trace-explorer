import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import EntityMap from './EntityMap';
import TimeStrip from './TimeStrip';
import TimelineView from './TimelineView';
import LatencyView from './LatencyView';
import { formatDuration } from '../data/state';

const VIEWS = [
  {
    id: 'Map',
    hint: 'Services and databases in this workflow, with the calls between them. Drag across the time bar to dim what was idle in that window.'
  },
  {
    id: 'Timeline',
    hint: 'When each entity was busy, idle gaps collapsed. Drag across the lanes to focus the waterfall on a window; click a bar to open the span.'
  },
  {
    id: 'Latency',
    hint: 'Compare the exclusive and total time of each entity to find where the time goes.'
  }
];

// The entity card: map, timeline and latency views of the same spans, in a
// fixed-height body that scrolls. Maximize fills the window.
export default function EntityViews({
  spans,
  traces,
  bySpan,
  gapMs,
  focus,
  onFocus,
  selectedId,
  onSelectSpan,
  range,
  onRange
}) {
  const [view, setView] = useState('Map');
  const [max, setMax] = useState(false);
  const [zoom, setZoom] = useState(1);
  // localStorage can throw (blocked storage, strict privacy settings in Firefox), so guard it.
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem('wte.entityViews') !== 'closed';
    } catch (e) {
      return true;
    }
  });
  const toggle = () =>
    setOpen(o => {
      try {
        localStorage.setItem('wte.entityViews', o ? 'closed' : 'open');
      } catch (e) {
        // storage unavailable: the choice just is not remembered
      }
      return !o;
    });
  useEffect(() => {
    if (!max) return undefined;
    const onKey = e => e.key === 'Escape' && setMax(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [max]);
  const v = VIEWS.find(x => x.id === view);
  const shown = open || max;
  return (
    <div className={`wte-card wte-views${max ? ' wte-max' : ''}`}>
      <div className="wte-views-head">
        <div className="wte-card-title">
          <b>Entity {view.toLowerCase()}</b> {shown && v.hint}
          {shown &&
            view !== 'Timeline' &&
            (focus
              ? ' Click the highlighted entity again to clear.'
              : ' Click an entity to highlight its spans in the waterfall.')}
        </div>
        {shown && view === 'Map' && (
          <div className="wte-zoom" role="group" aria-label="Map zoom">
            <button
              type="button"
              className="wte-btn"
              title="Zoom out"
              onClick={() => setZoom(z => Math.max(0.3, z / 1.25))}
            >
              −
            </button>
            <button
              type="button"
              className="wte-btn"
              title="Fit to the box"
              onClick={() => setZoom(1)}
            >
              Fit
            </button>
            <button
              type="button"
              className="wte-btn"
              title="Zoom in"
              onClick={() => setZoom(z => Math.min(4, z * 1.25))}
            >
              +
            </button>
          </div>
        )}
        {shown && (
          <div className="wte-seg" role="tablist" aria-label="Entity view">
            {VIEWS.map(x => (
              <button
                type="button"
                key={x.id}
                role="tab"
                aria-selected={x.id === view}
                className={x.id === view ? 'wte-seg-on' : ''}
                onClick={() => setView(x.id)}
              >
                {x.id}
              </button>
            ))}
          </div>
        )}
        {shown && (
          <button
            type="button"
            className="wte-btn wte-views-toggle"
            title={max ? 'Restore (Esc)' : 'Fill the window'}
            onClick={() => setMax(m => !m)}
          >
            {max ? 'Restore' : 'Maximize'}
          </button>
        )}
        {!max && (
          <button
            type="button"
            className="wte-btn wte-views-toggle"
            aria-expanded={open}
            onClick={toggle}
          >
            {open ? 'Hide' : 'Show'}
          </button>
        )}
      </div>
      {shown && range && (
        <div className="wte-range">
          Focused on {formatDuration(range.to - range.from)} window
          <button type="button" className="wte-btn" onClick={() => onRange(null)}>
            Reset
          </button>
        </div>
      )}
      {shown && (
        <div className="wte-views-body">
          {view === 'Map' && (
            <div className="wte-map-view">
              <TimeStrip spans={spans} gapMs={gapMs} range={range} onRange={onRange} />
              <EntityMap
                spans={spans}
                selected={focus}
                onSelect={onFocus}
                zoom={zoom}
                range={range}
              />
            </div>
          )}
          {view === 'Timeline' && (
            <TimelineView
              spans={spans}
              gapMs={gapMs}
              selectedId={selectedId}
              focus={focus}
              range={range}
              onRange={onRange}
              onSelectSpan={onSelectSpan}
            />
          )}
          {view === 'Latency' && (
            <LatencyView
              spans={spans}
              traces={traces}
              bySpan={bySpan}
              selected={focus}
              onSelect={f => onFocus(f === focus ? null : f)}
            />
          )}
        </div>
      )}
    </div>
  );
}

EntityViews.propTypes = {
  spans: PropTypes.array.isRequired,
  traces: PropTypes.array.isRequired,
  bySpan: PropTypes.instanceOf(Map).isRequired,
  gapMs: PropTypes.number.isRequired,
  focus: PropTypes.string,
  onFocus: PropTypes.func.isRequired,
  selectedId: PropTypes.string,
  onSelectSpan: PropTypes.func.isRequired,
  range: PropTypes.shape({ from: PropTypes.number, to: PropTypes.number }),
  onRange: PropTypes.func.isRequired
};
