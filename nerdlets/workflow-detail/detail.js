import React, { useEffect, useRef, useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { Button, Checkbox, Select, SelectItem, Spinner, TextField } from 'nr1';
import Waterfall from '../../src/components/Waterfall';
import TraceStrip from '../../src/components/TraceStrip';
import EntityViews from '../../src/components/EntityViews';
import SpanPanel from '../../src/components/SpanPanel';
import LogDetailPanel from '../../src/components/LogDetailPanel';
import DatabasesPanel from '../../src/components/DatabasesPanel';
import LogPanel from '../../src/components/LogPanel';
import useTheme from '../../src/components/useTheme';
import StateBadge from '../../src/components/StateBadge';
import { mergeConfig } from '../../src/config/attributes';
import { fetchTraces, fetchWorkflow, fetchWorkflowBounds } from '../../src/data/fetch';
import { loadConfig } from '../../src/data/settings';
import { stitch } from '../../src/data/stitch';
import { setColorOrder } from '../../src/components/colors';
import useClock from '../../src/components/useClock';
import { scopeToWorkflow } from '../../src/data/scope';
import { attachLogs } from '../../src/data/logs';
import { humanReviewFromSpans, REVIEW } from '../../src/data/human';
import { buildLinks } from '../../src/data/links';
import { formatDuration, inferState, latestAttributeValue } from '../../src/data/state';
import { buildEntityMap } from '../../src/data/entitymap';
import { unionLength } from '../../src/data/latency';
import {
  CUSTOM_UNITS,
  CUSTOM_WINDOW,
  WHOLE_LOOKBACK_MS,
  WHOLE_WINDOW,
  WINDOW_GROUPS,
  defaultWindowId,
  resolveWindow
} from '../../src/data/window';

const TABS = ['Waterfall', 'Databases', 'Logs'];

export default function Detail({ urlState, onBack }) {
  const { accountId, workflowId, first, last, windowId } = urlState;
  const pageRef = useRef(null);
  const clock = useClock(10000); // keeps the waiting time counting
  const theme = useTheme(pageRef);
  const [config, setConfig] = useState(mergeConfig(null));
  const [widen, setWiden] = useState(() => windowId || defaultWindowId());
  const [custom, setCustom] = useState({ n: 3, unit: 'days' }); // applied custom window
  const [customDraft, setCustomDraft] = useState('3');
  const [tab, setTab] = useState('Waterfall');
  const [raw, setRaw] = useState({ spans: [], logs: [], links: [], linkedSpans: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedLog, setSelectedLog] = useState(null);
  const [focus, setFocus] = useState(null); // entity highlighted in the waterfall
  const [range, setRange] = useState(null); // { from, to } window picked on the timeline
  const [query, setQuery] = useState('');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [linksOnly, setLinksOnly] = useState(false);
  const [loadingLinked, setLoadingLinked] = useState(false);
  const [extra, setExtra] = useState([]); // trace ids pulled in through span links
  const [onlyThisId, setOnlyThisId] = useState(false); // narrow every view to the workflow id
  const beginRef = useRef(0); // start of the loaded window, reused for linked traces

  useEffect(() => {
    if (accountId) loadConfig(accountId).then(setConfig);
  }, [accountId]);

  useEffect(() => {
    if (!accountId || !workflowId) return undefined;
    let live = true;
    const win = resolveWindow(widen, custom, Date.now(), first, last);
    setExtra([]);
    setLoading(true);
    setError(null);
    // The whole-workflow window starts at the workflow's real first span.
    const bounds =
      widen === WHOLE_WINDOW
        ? fetchWorkflowBounds(accountId, config.attrs, workflowId, WHOLE_LOOKBACK_MS).catch(
            () => null
          )
        : Promise.resolve(null);
    bounds
      .then(b => {
        const begin = b ? Math.min(win.begin, b.first - 60000) : win.begin;
        beginRef.current = begin;
        return fetchWorkflow(accountId, config.attrs, workflowId, begin, win.end);
      })
      .then(r => live && setRaw(r))
      .catch(e => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [accountId, workflowId, first, last, widen, custom, config]);

  // Load the spans of traces reached through span links, then show the span.
  const loadLinked = async (traceIds, spanId) => {
    const have = new Set(raw.spans.map(x => x[config.attrs.traceId]));
    const need = [...new Set(traceIds)].filter(t => !have.has(t));
    if (need.length) {
      setLoadingLinked(true);
      try {
        const r = await fetchTraces(accountId, config.attrs, need, beginRef.current);
        setRaw(prev => ({
          spans: prev.spans.concat(r.spans),
          logs: prev.logs.concat(r.logs),
          links: (prev.links || []).concat(r.links),
          linkedSpans: (prev.linkedSpans || []).concat(r.linkedSpans)
        }));
        setExtra(prev => [...new Set([...prev, ...need])]);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoadingLinked(false);
      }
    }
    if (spanId) {
      setTab('Waterfall');
      setSelectedId(spanId);
      setTimeout(() => {
        const el = document.getElementById(`wte-trace-${traceIds[0]}`);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    }
  };

  const model = useMemo(() => {
    const scoped = onlyThisId
      ? scopeToWorkflow(raw.spans, raw.logs, config.attrs, workflowId, new Set(extra))
      : { spans: raw.spans, logs: raw.logs };
    const st = stitch(scoped.spans, config.attrs, config.systemRules);
    // One color per service of this workflow, busiest first, so none share one.
    const bySystem = new Map();
    st.spans.forEach(s => bySystem.set(s.system, (bySystem.get(s.system) || 0) + 1));
    setColorOrder(
      [...bySystem].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(e => e[0])
    );
    const lg = attachLogs(st.spans, scoped.logs, config.attrs);
    const links = buildLinks(st.spans, raw.links || [], raw.linkedSpans || [], config.attrs);
    const lastSpan = st.spans.reduce((a, s) => (!a || s.end > a.end ? s : a), null);
    const state = lastSpan
      ? inferState(
          {
            now: Date.now(),
            lastTs: lastSpan.end,
            errors: st.spans.filter(x => x.isError).length,
            stateValue: latestAttributeValue(st.spans, config.attrs.stateAttribute)
          },
          { attribute: config.attrs.stateAttribute, values: config.stateValues }
        )
      : null;
    const entities = buildEntityMap(st.spans).nodes.length;
    const startTs = st.spans.reduce((m, x) => Math.min(m, x.start), Infinity);
    const duration = lastSpan ? lastSpan.end - startTs : 0;
    // Traces other loaded spans link to (either direction) that are not loaded.
    const loaded = new Set(raw.spans.map(x => x[config.attrs.traceId]));
    const missing = new Set();
    links.forEach(list =>
      list.forEach(l => {
        if (l.crossTrace && !loaded.has(l.traceId)) missing.add(l.traceId);
      })
    );
    const review = humanReviewFromSpans(st.spans, config.attrs, config.stateValues);
    // Time with at least one span running, and the idle time between spans.
    const activeMs = unionLength(st.spans.map(s => [s.start, s.end]));
    const waitMs = Math.max(0, duration - activeMs);
    const dbCalls = st.spans.filter(s => s.dbSystem).length;
    return {
      st,
      lg,
      links,
      state,
      stateAsOf: Date.now(),
      review,
      dbCalls,
      entities,
      duration,
      activeMs,
      waitMs,
      missingLinked: [...missing]
    };
  }, [raw, config, onlyThisId, workflowId, extra]);

  // Header toggle: pull every linked trace into the view, or drop them again.
  const linkedOn = extra.length > 0;
  const extraSet = useMemo(() => new Set(extra), [extra]);
  const toggleLinked = on => {
    if (on) {
      loadLinked(model.missingLinked, null);
    } else {
      const drop = new Set(extra);
      setRaw(prev => ({
        ...prev,
        spans: prev.spans.filter(x => !drop.has(x[config.attrs.traceId])),
        logs: prev.logs.filter(l => !drop.has(l[config.attrs.logTraceId]))
      }));
      setExtra([]);
      setSelectedId(null);
    }
  };

  const tabCounts = { Databases: model.dbCalls, Logs: model.lg.logs.length };

  if (!workflowId) return <div className="wte-empty">No workflow selected.</div>;

  const selectedSpan = selectedId ? model.st.spans.find(s => s.id === selectedId) : null;
  const goTrace = traceId => {
    setTab('Waterfall');
    setTimeout(() => {
      const el = document.getElementById(`wte-trace-${traceId}`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 0);
  };

  // Open a span from the overview map and scroll its trace into view.
  const goSpan = (traceId, spanId) => {
    setSelectedId(spanId);
    goTrace(traceId);
  };

  return (
    <div className="wte-page" ref={pageRef} data-theme={theme}>
      <div className="wte-header">
        {onBack && (
          <button type="button" className="wte-linkbtn wte-back" onClick={onBack}>
            &larr; All workflows
          </button>
        )}
        <div className="wte-header-id">
          <span className="wte-muted">Workflow</span>
          <h2>{workflowId}</h2>
        </div>
        {model.state && (
          <StateBadge state={model.state.state}>
            {model.state.state}
            {model.state.state === 'Waiting for human'
              ? ` ${formatDuration(model.state.idleMs + Math.max(0, clock - model.stateAsOf))}`
              : ''}
          </StateBadge>
        )}
        {model.review && model.review.involved && (
          <StateBadge
            state={
              model.review.status === REVIEW.approved
                ? 'Completed'
                : model.review.status === REVIEW.declined
                  ? 'Failed'
                  : 'Waiting for human'
            }
          >
            Human review: {model.review.status}
          </StateBadge>
        )}
        <div className="wte-controls">
          <span
            title={
              linkedOn || model.missingLinked.length
                ? 'Show the traces this workflow is linked to through span links'
                : 'No span links to other traces were found'
            }
          >
            <Checkbox
              checked={linkedOn}
              disabled={loadingLinked || (!linkedOn && !model.missingLinked.length)}
              onChange={e => toggleLinked(e.target.checked)}
              label={
                loadingLinked
                  ? 'Loading linked traces…'
                  : linkedOn
                    ? `Linked traces shown (${extra.length})`
                    : `Show linked traces (${model.missingLinked.length})`
              }
            />
          </span>
          <span
            title={`Show only spans that carry this workflow id (${config.attrs.correlationId}) and the spans below them. Other spans of the same traces are hidden from every view.`}
          >
            <Checkbox
              checked={onlyThisId}
              onChange={e => setOnlyThisId(e.target.checked)}
              label="Only this workflow ID"
            />
          </span>
          <select
            className="wte-input"
            value={widen}
            aria-label="How far back to look for this workflow's spans"
            title="How far back to look for this workflow's spans"
            onChange={e => setWiden(e.target.value)}
          >
            {WINDOW_GROUPS.map(g => (
              <optgroup key={g.label} label={g.label}>
                {g.options.map(o => (
                  <option key={o.id} value={o.id}>
                    {g.label === 'Last' ? `Last ${o.label}` : o.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {widen === CUSTOM_WINDOW && (
            <span className="wte-custom-window">
              Last
              <div
                className="wte-custom-n"
                onBlur={() => setCustom({ ...custom, n: customDraft })}
                onKeyDown={e => e.key === 'Enter' && setCustom({ ...custom, n: customDraft })}
              >
                <TextField
                  type="number"
                  min="1"
                  value={customDraft}
                  onChange={e => setCustomDraft(e.target.value)}
                />
              </div>
              <Select value={custom.unit} onChange={(e, v) => setCustom({ ...custom, unit: v })}>
                {CUSTOM_UNITS.map(u => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.label}
                  </SelectItem>
                ))}
              </Select>
            </span>
          )}
        </div>
      </div>

      <div className="wte-kpis">
        <div className="wte-kpi wte-kpi-blue">
          <b>{formatDuration(Math.max(0, model.duration))}</b>
          <span>Duration</span>
        </div>
        <div
          className="wte-kpi wte-kpi-amber"
          title="Time with no span running, between the workflow's first and last span (idle gaps, human waits, queues)"
        >
          <b>{formatDuration(model.waitMs)}</b>
          <span>
            Waiting
            {model.duration > 0 && ` (${Math.round((model.waitMs / model.duration) * 100)}%)`}
          </span>
        </div>
        <div className="wte-kpi wte-kpi-blue" title="Time with at least one span running">
          <b>{formatDuration(model.activeMs)}</b>
          <span>Active</span>
        </div>
        <div className="wte-kpi wte-kpi-blue">
          <b>{model.entities}</b>
          <span>Entities</span>
        </div>
        <div className="wte-kpi wte-kpi-blue">
          <b>{model.st.traces.length}</b>
          <span>Traces</span>
        </div>
        <div className="wte-kpi wte-kpi-blue">
          <b>{model.st.spans.length}</b>
          <span>
            Spans
            {config.attrs.correlationId !== config.attrs.traceId &&
              ` (${model.st.spans.filter(s => s.correlationId).length} tagged)`}
          </span>
        </div>
        <div className="wte-kpi wte-kpi-grey">
          <b>{model.lg.logs.length}</b>
          <span>Logs</span>
        </div>
        <div className="wte-kpi wte-kpi-red">
          <b>{model.st.spans.filter(s => s.isError).length}</b>
          <span>Error spans</span>
        </div>
      </div>

      {error && <div className="wte-diag wte-diag-error">{error}</div>}
      {!loading && !error && !raw.spans.length && (
        <div className="wte-banner">
          No spans found for workflow ID &ldquo;{workflowId}&rdquo; ({config.attrs.correlationId})
          in this window. Check the ID, pick a longer window above, or go back and search by ID or
          app name.
        </div>
      )}
      {loading && <Spinner />}

      {model.st.traces.length > 0 && (
        <div className="wte-card">
          <div className="wte-card-title">
            Workflow overview. Each trace is a map of its spans (idle gaps collapsed): click a trace
            to jump to it, a span to open it.
          </div>
          <TraceStrip
            traces={model.st.traces}
            links={model.links}
            extra={extraSet}
            gapMs={config.thresholds.gapMs}
            selectedId={selectedId}
            onSelect={goTrace}
            onSelectSpan={goSpan}
          />
        </div>
      )}

      {model.st.spans.length > 0 && (
        <EntityViews
          spans={model.st.spans}
          traces={model.st.traces}
          bySpan={model.lg.bySpan}
          gapMs={config.thresholds.gapMs}
          focus={focus}
          onFocus={f => {
            setFocus(f);
            setTab('Waterfall');
          }}
          selectedId={selectedId}
          onSelectSpan={setSelectedId}
          range={range}
          onRange={r => {
            setRange(r);
            if (r) setTab('Waterfall');
          }}
        />
      )}

      <div className="wte-tabs">
        {TABS.map(t => (
          <button
            type="button"
            key={t}
            role="tab"
            aria-selected={t === tab}
            className={t === tab ? 'wte-tab-active' : ''}
            onClick={() => setTab(t)}
          >
            {t}
            {t in tabCounts ? ` (${tabCounts[t].toLocaleString()})` : ''}
          </button>
        ))}
      </div>

      {tab === 'Waterfall' && (
        <div className="wte-wf-toolbar">
          <div className="wte-search">
            <TextField
              placeholder="Find spans by name, service or ID"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
          <Checkbox
            checked={errorsOnly}
            onChange={e => setErrorsOnly(e.target.checked)}
            label={`Errors only (${model.st.spans.filter(s => s.isError).length})`}
          />
          <Checkbox
            checked={linksOnly}
            onChange={e => setLinksOnly(e.target.checked)}
            label={`Span links only (${model.links.size})`}
          />
          {range && (
            <span className="wte-chip">
              Timeline window {formatDuration(range.to - range.from)}
              <Button
                type={Button.TYPE.NORMAL}
                sizeType={Button.SIZE_TYPE.SMALL}
                onClick={() => setRange(null)}
              >
                Clear
              </Button>
            </span>
          )}
          {focus && (
            <span className="wte-chip">
              Entity {focus.replace(/^db:/, '')}
              <Button
                type={Button.TYPE.NORMAL}
                sizeType={Button.SIZE_TYPE.SMALL}
                onClick={() => setFocus(null)}
              >
                Clear
              </Button>
            </span>
          )}
        </div>
      )}
      {tab === 'Waterfall' && (
        <Waterfall
          filter={{ query, errorsOnly, linksOnly, links: model.links, range }}
          links={model.links}
          extra={extraSet}
          traces={model.st.traces}
          bySpan={model.lg.bySpan}
          gapMs={config.thresholds.gapMs}
          selectedId={selectedId}
          onSelect={setSelectedId}
          focus={focus}
        />
      )}
      {tab === 'Databases' && (
        <DatabasesPanel
          spans={model.st.spans}
          onSelect={id => {
            setSelectedId(id);
            setTab('Waterfall');
          }}
        />
      )}
      {tab === 'Logs' && (
        <LogPanel
          logs={model.lg.logs}
          title="Workflow logs"
          onSelect={setSelectedLog}
          selected={selectedLog}
        />
      )}
      {selectedSpan && (
        <SpanPanel
          key={`${selectedSpan.traceId}/${selectedSpan.id}`}
          accountId={accountId}
          attrs={config.attrs}
          span={selectedSpan}
          parent={model.st.spans.find(s => s.id === selectedSpan.parentId)}
          logs={model.lg.bySpan.get(selectedSpan.id) || []}
          links={model.links.get(`${selectedSpan.traceId}/${selectedSpan.id}`) || []}
          loadedTraces={new Set(model.st.traces.map(t => t.traceId))}
          loadingLinked={loadingLinked}
          onLoadLinked={loadLinked}
          onClose={() => setSelectedId(null)}
          onSelect={setSelectedId}
          onSelectLog={setSelectedLog}
        />
      )}
      {selectedLog && (
        <LogDetailPanel
          log={selectedLog}
          span={model.st.spans.find(s => s.id === selectedLog.spanId)}
          onClose={() => setSelectedLog(null)}
          onGoToSpan={id => {
            setSelectedLog(null);
            setSelectedId(id);
            setTab('Waterfall');
          }}
        />
      )}
    </div>
  );
}

Detail.propTypes = {
  urlState: PropTypes.object.isRequired,
  onBack: PropTypes.func
};
