import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { colorFor } from './colors';
import { activatable, clickable } from './a11y';
import { traceEntities } from '../data/stitch';
import { spanInNode } from '../data/entitymap';
import { buildRows } from '../data/tree';
import { inRange, isFiltering, spanMatches } from '../data/rowfilter';
import { hasCrossTraceLink } from '../data/links';
import { formatDuration } from '../data/state';
import { isErrorLevel } from '../data/logs';
import { scrollToRow, windowRange } from '../data/virtual';
import { openEntity } from './entityLink';

const ROW_H = 29; // a span row: 28px of bars and a 1px border
const VIEW_H = 640; // height of the scrolling list of a long trace
const VIRTUAL_FROM = 60; // shorter traces are drawn whole
// Standard New Relic entity permalink; opened in a new tab because the stacked
// entity panel failed to render some OpenTelemetry entities.
const TICKS = [0, 0.25, 0.5, 0.75, 1];
const fmtTime = ts => new Date(ts).toISOString().replace('T', ' ').slice(0, 19);

const NO_LOGS = [];

// One span row of the waterfall. Memoized so selecting a span, or filtering,
// only re-renders the rows whose own props changed.
const SpanRow = React.memo(function SpanRow({
  s,
  depth,
  hasKids,
  entry,
  orphan,
  isCollapsed,
  logs,
  spanLinks,
  selected,
  dimmed,
  traceStart,
  dur,
  onSelect,
  onToggle
}) {
  const left = ((s.start - traceStart) / dur) * 100;
  const width = Math.max((s.durMs / dur) * 100, 0.3);
  const cross = hasCrossTraceLink(spanLinks);
  const color = s.isError ? '#d5252b' : colorFor(s.system);
  return (
    <div
      className={`wte-wf-row${s.isError ? ' wte-wf-err' : ''}${cross ? ' wte-wf-link' : ''}${selected ? ' wte-wf-selected' : ''}${dimmed ? ' wte-wf-dim' : ''}`}
      {...activatable(() => onSelect(selected ? null : s.id))}
    >
      <div className="wte-wf-name" style={{ paddingLeft: 8 + depth * 14 }}>
        <span
          className="wte-caret"
          onClick={e => {
            e.stopPropagation();
            if (hasKids) onToggle(s.id);
          }}
        >
          {hasKids ? (isCollapsed ? '▸' : '▾') : ' '}
        </span>
        <span className="wte-dot" style={{ background: color }} />
        <span className="wte-svc">{s.system}</span>
        <span className="wte-op" title={s.name}>
          {s.name}
        </span>
        {entry && (
          <span
            className="wte-tag"
            title={
              s.parentId
                ? 'Start of the trace. Its caller sent no spans to New Relic.'
                : 'Start of the trace'
            }
          >
            start
          </span>
        )}
        {orphan && (
          <span className="wte-tag wte-tag-warn" title="Parent span missing">
            orphan
          </span>
        )}
        {spanLinks && (
          <span
            className={`wte-linkicon${cross ? ' wte-linkicon-cross' : ''}`}
            title={
              cross
                ? `${spanLinks.length} span link(s), to other traces. Open the span to see them.`
                : `${spanLinks.length} span link(s) within this trace`
            }
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
              <path
                d="M6.5 9.5a3 3 0 0 0 4.2 0l2.3-2.3a3 3 0 0 0-4.2-4.2L7.6 4.2M9.5 6.5a3 3 0 0 0-4.2 0L3 8.8A3 3 0 0 0 7.2 13l1.2-1.2"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
            {spanLinks.length}
          </span>
        )}
        {logs.length > 0 && <span className="wte-tag">{logs.length} logs</span>}
      </div>
      <div className="wte-wf-bars">
        <div
          className="wte-wf-bar"
          style={{ left: `${left}%`, width: `${width}%`, background: color }}
          title={`${s.name} | ${formatDuration(s.durMs)} | ${s.status || 'no status'}`}
        />
        <span
          className="wte-wf-dur"
          style={left > 70 ? { right: `${100 - left}%` } : { left: `${left + width}%` }}
        >
          {formatDuration(s.durMs)}
        </span>
        {logs.map((l, i) => (
          <span
            key={i}
            className={`wte-wf-log${isErrorLevel(l.level) ? ' wte-wf-log-err' : ''}`}
            style={{ left: `${Math.min(100, Math.max(0, ((l.ts - traceStart) / dur) * 100))}%` }}
            title={`${l.level}: ${l.message}`}
          />
        ))}
      </div>
    </div>
  );
});

SpanRow.propTypes = {
  s: PropTypes.object.isRequired,
  depth: PropTypes.number.isRequired,
  hasKids: PropTypes.bool.isRequired,
  entry: PropTypes.bool,
  orphan: PropTypes.bool,
  isCollapsed: PropTypes.bool.isRequired,
  logs: PropTypes.array.isRequired,
  spanLinks: PropTypes.array,
  selected: PropTypes.bool.isRequired,
  dimmed: PropTypes.bool.isRequired,
  traceStart: PropTypes.number.isRequired,
  dur: PropTypes.number.isRequired,
  onSelect: PropTypes.func.isRequired,
  onToggle: PropTypes.func.isRequired
};

function TraceSection({
  trace,
  index,
  total,
  bySpan,
  links,
  extra,
  selectedId,
  onSelect,
  focus,
  filter,
  signal
}) {
  const [open, setOpen] = useState(true);
  const [collapsed, setCollapsed] = useState(() => new Set());
  // Expand all / Collapse all from the toolbar (n === 0 is the initial state).
  useEffect(() => {
    if (!signal.n) return;
    setOpen(true);
    if (signal.mode === 'expand') {
      setCollapsed(new Set());
    } else {
      const parents = new Set(trace.spans.map(s => s.parentId).filter(Boolean));
      setCollapsed(new Set(trace.spans.filter(s => parents.has(s.id)).map(s => s.id)));
    }
  }, [signal, trace]);
  const allRows = useMemo(() => buildRows(trace.spans, collapsed), [trace, collapsed]);
  const filtering = isFiltering(filter);
  const rows = useMemo(
    () => (filtering ? allRows.filter(r => spanMatches(r.span, filter)) : allRows),
    [allRows, filter, filtering]
  );
  // Long traces scroll inside the trace and draw only the rows in view.
  const virtual = rows.length > VIRTUAL_FROM;
  const box = useRef(null);
  const [scrollTop, setScrollTop] = useState(0);
  useEffect(() => {
    if (!virtual || !selectedId || !box.current) return;
    const i = rows.findIndex(r => r.span.id === selectedId);
    if (i < 0) return;
    const to = scrollToRow(i, box.current.scrollTop, VIEW_H, ROW_H);
    if (to !== null) box.current.scrollTop = to;
  }, [selectedId, virtual, rows]);
  const range = virtual
    ? windowRange(rows.length, scrollTop, VIEW_H, ROW_H)
    : { start: 0, end: rows.length };
  const shown = virtual ? rows.slice(range.start, range.end) : rows;
  const dur = Math.max(trace.end - trace.start, 0.001);
  const errors = trace.spans.filter(s => s.isError).length;
  const entities = useMemo(() => traceEntities(trace.spans), [trace]);
  const toggle = useCallback(
    id =>
      setCollapsed(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    []
  );

  const renderRow = ({ span: s, depth, hasKids, entry, orphan }) => (
    <SpanRow
      key={`${s.traceId}/${s.id}`}
      s={s}
      depth={depth}
      hasKids={hasKids}
      entry={entry}
      orphan={orphan}
      isCollapsed={collapsed.has(s.id)}
      logs={bySpan.get(s.id) || NO_LOGS}
      spanLinks={links.get(`${s.traceId}/${s.id}`)}
      selected={selectedId === s.id}
      dimmed={Boolean(focus) && !spanInNode(s, focus)}
      traceStart={trace.start}
      dur={dur}
      onSelect={onSelect}
      onToggle={toggle}
    />
  );

  return (
    <div className="wte-wf-trace" id={`wte-trace-${trace.traceId}`}>
      <div className="wte-wf-thead" {...activatable(() => setOpen(!open))} aria-expanded={open}>
        <span className="wte-caret">{open ? '▾' : '▸'}</span>
        <strong>
          Trace {index + 1} of {total}
        </strong>
        <span className="wte-muted">{trace.traceId}</span>
        {extra.has(trace.traceId) && (
          <span className="wte-tag wte-tag-link" title="Loaded through a span link">
            linked trace
          </span>
        )}
        <span>{fmtTime(trace.start)} UTC</span>
        <span>{formatDuration(trace.end - trace.start)}</span>
        <span>{trace.spans.length} spans</span>
        {errors > 0 && <span className="wte-bad">{errors} errors</span>}
        {filtering && (
          <span className="wte-muted">
            {rows.length} of {allRows.length} rows match
          </span>
        )}
      </div>
      <div className="wte-entities">
        <span className="wte-muted">Entities ({entities.length})</span>
        {entities.map(e => (
          <span
            key={e.name}
            className={`wte-chip${e.guid ? ' wte-chip-link' : ''}${e.errors ? ' wte-chip-err' : ''}`}
            title={e.guid ? 'Open entity' : e.name}
            {...(e.guid ? clickable(() => openEntity(e.guid)) : {})}
          >
            <span className="wte-dot" style={{ background: colorFor(e.system) }} />
            {e.name}
            <span className="wte-muted">{e.spans}</span>
            {e.errors > 0 && <span className="wte-bad">{e.errors} err</span>}
          </span>
        ))}
      </div>
      {open && (
        <div className="wte-wf">
          <div className="wte-wf-row wte-wf-axis">
            <div className="wte-wf-name wte-muted">Span</div>
            <div className="wte-wf-bars">
              {TICKS.map(t => (
                <span key={t} className="wte-tick" style={{ left: `${t * 100}%` }}>
                  {formatDuration(dur * t)}
                </span>
              ))}
            </div>
          </div>
          {virtual ? (
            <div
              className="wte-wf-scroll"
              ref={box}
              style={{ height: VIEW_H }}
              onScroll={e => setScrollTop(e.currentTarget.scrollTop)}
            >
              <div
                className="wte-wf-fixed"
                style={{ height: rows.length * ROW_H, position: 'relative' }}
              >
                <div style={{ transform: `translateY(${range.start * ROW_H}px)` }}>
                  {shown.map(renderRow)}
                </div>
              </div>
            </div>
          ) : (
            shown.map(renderRow)
          )}
        </div>
      )}
    </div>
  );
}

TraceSection.propTypes = {
  trace: PropTypes.object.isRequired,
  index: PropTypes.number.isRequired,
  total: PropTypes.number.isRequired,
  bySpan: PropTypes.instanceOf(Map).isRequired,
  links: PropTypes.instanceOf(Map).isRequired,
  extra: PropTypes.instanceOf(Set).isRequired,
  selectedId: PropTypes.string,
  onSelect: PropTypes.func.isRequired,
  focus: PropTypes.string,
  filter: PropTypes.object,
  signal: PropTypes.shape({ n: PropTypes.number, mode: PropTypes.string }).isRequired
};

// One waterfall per trace, with the idle gap between consecutive traces.
export default function Waterfall({
  traces,
  bySpan,
  links,
  extra,
  gapMs,
  selectedId,
  onSelect,
  focus,
  filter
}) {
  const [signal, setSignal] = useState({ n: 0, mode: 'expand' });
  if (!traces.length) return <div className="wte-empty">No spans in this range.</div>;
  // A time window hides the traces it does not touch.
  const visible =
    filter && filter.range
      ? traces.filter(t => t.spans.some(s => inRange(s, filter.range)))
      : traces;
  if (!visible.length) return <div className="wte-empty">No spans in the selected window.</div>;
  return (
    <div>
      <div className="wte-wf-actions">
        <button
          type="button"
          className="wte-btn"
          onClick={() => setSignal(p => ({ n: p.n + 1, mode: 'expand' }))}
        >
          Expand all
        </button>
        <button
          type="button"
          className="wte-btn"
          onClick={() => setSignal(p => ({ n: p.n + 1, mode: 'collapse' }))}
        >
          Collapse all
        </button>
      </div>
      {visible.map((t, i) => {
        const prev = visible[i - 1];
        const gap = prev ? t.start - prev.end : 0;
        return (
          <React.Fragment key={t.traceId}>
            {prev && gap > 0 && (
              <div className={`wte-wf-gap${gap > gapMs ? ' wte-wf-gap-long' : ''}`}>
                {gap > gapMs ? 'Waiting' : 'Gap'} {formatDuration(gap)}
              </div>
            )}
            <TraceSection
              trace={t}
              index={i}
              total={visible.length}
              bySpan={bySpan}
              links={links}
              extra={extra}
              selectedId={selectedId}
              onSelect={onSelect}
              focus={focus}
              filter={filter}
              signal={signal}
            />
          </React.Fragment>
        );
      })}
    </div>
  );
}

Waterfall.propTypes = {
  traces: PropTypes.array.isRequired,
  bySpan: PropTypes.instanceOf(Map).isRequired,
  links: PropTypes.instanceOf(Map).isRequired,
  extra: PropTypes.instanceOf(Set).isRequired,
  gapMs: PropTypes.number.isRequired,
  selectedId: PropTypes.string,
  onSelect: PropTypes.func.isRequired,
  focus: PropTypes.string,
  filter: PropTypes.shape({
    query: PropTypes.string,
    errorsOnly: PropTypes.bool,
    range: PropTypes.shape({ from: PropTypes.number, to: PropTypes.number })
  })
};
