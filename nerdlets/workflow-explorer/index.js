import React, { useCallback, useContext, useEffect, useRef, useMemo, useState } from 'react';
import {
  AccountPicker,
  BarChart,
  Button,
  Checkbox,
  LineChart,
  PlatformStateContext,
  Select,
  SelectItem,
  Spinner,
  TextField
} from 'nr1';
import Detail from '../workflow-detail/detail';
import { activatable, clickable } from '../../src/components/a11y';
import useTheme from '../../src/components/useTheme';
import useClock from '../../src/components/useClock';
import MultiSelect from '../../src/components/MultiSelect';
import { humanAttrs, humanReview, reviewRank } from '../../src/data/human';
import WorkflowRow from '../../src/components/WorkflowRow';
import SettingsPanel from '../../src/components/SettingsPanel';
import { mergeConfig } from '../../src/config/attributes';
import {
  fetchAppNames,
  fetchSummary,
  fetchRangeCounts,
  fetchTraceLinkCounts,
  fetchTraceSpanCounts,
  fetchWorkflowBounds
} from '../../src/data/fetch';
import { workflowEntities, workflowLinkCount, workflowSpanCount } from '../../src/data/counts';
import { loadConfig } from '../../src/data/settings';
import {
  errorSpansByAppNrql,
  logsBySeverityNrql,
  workflowsOverTimeNrql
} from '../../src/data/queries';
import { STATES, inferState } from '../../src/data/state';

const DAY = 24 * 3600000;
const TABLE_CAP = 5000;
const PAGE = 200; // rows drawn at a time
const FALLBACK_RANGE_MS = 30 * 60000; // used until the platform reports its time range
// Columns the query can sort by (largest first); the rest sort in the browser.
const SERVER_SORT = ['last', 'first', 'traces', 'spans', 'errors'];
const TEXT_SORT = ['workflowId', 'appName', 'entry', 'state'];

// Sort key -> comparable value for a table row.
function sortValue(r, key) {
  switch (key) {
    case 'state':
      return STATES.indexOf(r.state);
    case 'spans':
      return r.whole ? r.whole.count : r.spans;
    case 'duration':
      return r.lastEnd - r.first;
    case 'hil':
      return r.review.involved ? 1 : 0;
    case 'decision':
      return reviewRank(r.review.status);
    case 'links':
      return r.linkInfo ? r.linkInfo.count : -1;
    case 'entities':
      return r.ents ? r.ents.entities : r.entities;
    case 'databases':
      return r.ents ? r.ents.databases : r.databases;
    case 'workflowId':
    case 'appName':
    case 'entry':
      return String(r[key] || '').toLowerCase();
    default:
      return r[key];
  }
}

export default function WorkflowExplorer() {
  const pageRef = useRef(null);
  const theme = useTheme(pageRef);
  const [accountId, setAccountId] = useState(null);
  // The platform time picker drives the range: absolute (begin_time/end_time)
  // or relative (duration back from now).
  const { timeRange } = useContext(PlatformStateContext) || {};
  const rangeBegin = timeRange && timeRange.begin_time;
  const rangeEnd = timeRange && timeRange.end_time;
  const rangeDuration = timeRange && timeRange.duration;
  const [config, setConfig] = useState(mergeConfig(null));
  const [rows, setRows] = useState([]);
  const [win, setWin] = useState(null); // { begin, end } of the loaded rows
  const [asOf, setAsOf] = useState(Date.now()); // when the rows were loaded
  const clock = useClock(10000); // keeps ages and idle times counting between loads
  const [autoRefresh, setAutoRefresh] = useState(60); // seconds between reloads, 0 = off
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchText, setSearchText] = useState(''); // what is typed
  const [search, setSearch] = useState(''); // what the queries use
  const [apps, setApps] = useState([]);
  const [exact, setExact] = useState(null); // an exact workflow id match older than the range: null = unknown, false = none
  const [appOptions, setAppOptions] = useState([]);
  const [appsLoading, setAppsLoading] = useState(false);
  const [stateFilter, setStateFilter] = useState('All');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [sort, setSort] = useState({ key: 'last', dir: 'desc' });
  const [showSettings, setShowSettings] = useState(false);
  const [tick, setTick] = useState(0);
  const [selected, setSelected] = useState(null);
  const [all, setAll] = useState(null); // counts for the whole range
  const [traceCounts, setTraceCounts] = useState(null); // Map(traceId -> spans)
  const [countsLoading, setCountsLoading] = useState(false);
  const [linkCounts, setLinkCounts] = useState(null); // Map(traceId -> { out, in })
  const [linksLoading, setLinksLoading] = useState(false);
  const [linksOnly, setLinksOnly] = useState(false);
  const [limit, setLimit] = useState(PAGE);

  const { waitAttr, decisionAttr } = humanAttrs(config.attrs);
  const reviewConfigured = Boolean(waitAttr || decisionAttr);
  const NOT_SET = 'Set a state or decision attribute in Settings to fill this in';
  const wholeTrace = config.attrs.correlationId === config.attrs.traceId;
  // Spans limited to some apps (or a workflow id that is not the trace id) do
  // not add up to the whole workflow, so look the whole traces up.
  const appsKey = apps.join('\u0001');
  // Workflows per time bucket for the chart, with the same filters as the table.
  const chartQueries = useMemo(() => {
    const end = rangeEnd || Date.now();
    const begin = rangeBegin || end - (rangeDuration || FALLBACK_RANGE_MS);
    const links = linksOnly ? { since: begin, until: Math.max(end, Date.now()) } : null;
    const scope = { apps, search, links };
    return {
      overTime: workflowsOverTimeNrql(config.attrs, begin, end, scope),
      errorsByApp: errorSpansByAppNrql(config.attrs, begin, end, scope),
      logs: logsBySeverityNrql(config.attrs, begin, end, scope)
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.attrs, rangeBegin, rangeEnd, rangeDuration, appsKey, search, linksOnly, tick]);
  const lookup = !wholeTrace || apps.length > 0 || Boolean(search);
  // 'spans' only sorts in the database when it counts the whole trace.
  const serverSort =
    SERVER_SORT.includes(sort.key) && (sort.key !== 'spans' || !lookup) ? sort.key : 'last';

  useEffect(() => {
    if (accountId) loadConfig(accountId).then(setConfig);
    setApps([]);
  }, [accountId]);

  // Searching runs in the query, over every workflow in the range, so wait for
  // a pause in typing (Enter applies it at once).
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchText.trim()), 500);
    return () => clearTimeout(t);
  }, [searchText]);

  // Apps seen in the range, for the filter.
  useEffect(() => {
    if (!accountId) return undefined;
    let live = true;
    const end = rangeEnd || Date.now();
    const begin = rangeBegin || end - (rangeDuration || FALLBACK_RANGE_MS);
    setAppsLoading(true);
    fetchAppNames(accountId, config.attrs, begin, end)
      .then(a => live && setAppOptions(a))
      .catch(() => live && setAppOptions([]))
      .finally(() => live && setAppsLoading(false));
    return () => {
      live = false;
    };
  }, [accountId, rangeBegin, rangeEnd, rangeDuration, config.attrs, tick]);

  useEffect(() => {
    if (!accountId) return undefined;
    let live = true;
    const end = rangeEnd || Date.now();
    const begin = rangeBegin || end - (rangeDuration || FALLBACK_RANGE_MS);
    setLoading(true);
    setError(null);
    setTraceCounts(null);
    const links = linksOnly ? { since: begin, until: Math.max(end, Date.now()) } : null;
    fetchRangeCounts(accountId, config.attrs, begin, end, {
      apps,
      search,
      links
    })
      .then(c => live && setAll(c))
      .catch(() => live && setAll(null));
    fetchSummary(accountId, config.attrs, begin, end, {
      sort: serverSort,
      errorsOnly,
      apps,
      search,
      links,
      stateValues: config.stateValues
    })
      .then(r => {
        if (!live) return;
        setAsOf(Date.now());
        setWin({ begin, end });
        setRows(r);
      })
      .catch(e => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    accountId,
    rangeBegin,
    rangeEnd,
    rangeDuration,
    config,
    tick,
    serverSort,
    errorsOnly,
    linksOnly,
    appsKey,
    search
  ]);

  // Nothing matches the search in this range: is it the exact id of a workflow
  // from the last 7 days? Only then is opening it directly worth offering.
  const nothingFound = !loading && !rows.length && Boolean(search);
  useEffect(() => {
    setExact(null);
    if (!accountId || !nothingFound) return undefined;
    let live = true;
    fetchWorkflowBounds(accountId, config.attrs, search, 7 * DAY)
      .then(b => live && setExact(b || false))
      .catch(() => live && setExact(false));
    return () => {
      live = false;
    };
  }, [accountId, nothingFound, search, config.attrs]);

  // The summary only sees spans carrying the workflow id; look up the whole
  // traces so the Spans column matches the detail view.
  useEffect(() => {
    if (!accountId || !win || !lookup || !rows.length) return undefined;
    let live = true;
    setCountsLoading(true);
    fetchTraceSpanCounts(
      accountId,
      config.attrs,
      rows.flatMap(r => r.traceIds),
      win.begin,
      win.end,
      () => live,
      m => setTraceCounts(new Map(m))
    )
      .then(m => live && setTraceCounts(m))
      .catch(() => live && setTraceCounts(null))
      .finally(() => live && setCountsLoading(false));
    return () => {
      live = false;
    };
  }, [rows, win, lookup, accountId, config]);

  // Span links live in their own event, so count them per trace separately.
  useEffect(() => {
    if (!accountId || !win || !rows.length) return undefined;
    let live = true;
    setLinksLoading(true);
    fetchTraceLinkCounts(
      accountId,
      rows.flatMap(r => (r.traceIds && r.traceIds.length ? r.traceIds : [r.workflowId])),
      win.begin,
      () => live,
      m => setLinkCounts(new Map(m))
    )
      .then(m => live && setLinkCounts(m))
      .catch(() => live && setLinkCounts(null))
      .finally(() => live && setLinksLoading(false));
    return () => {
      live = false;
    };
  }, [rows, win, wholeTrace, accountId]);

  // Reload on a timer (not while the tab is hidden).
  useEffect(() => {
    if (!autoRefresh) return undefined;
    const id = setInterval(() => {
      if (!document.hidden) setTick(t => t + 1);
    }, autoRefresh * 1000);
    return () => clearInterval(id);
  }, [autoRefresh]);

  const now = Math.max(clock, asOf);
  const enriched = useMemo(
    () =>
      rows.map(r => {
        const { state, idleMs } = inferState(
          { now, lastTs: r.last, errors: r.errors, stateValue: r.stateValue },
          { attribute: config.attrs.stateAttribute, values: config.stateValues }
        );
        const whole = lookup ? workflowSpanCount(r, traceCounts) : null;
        const ents = lookup ? workflowEntities(r, traceCounts) : null;
        const linkInfo = workflowLinkCount(r, linkCounts, wholeTrace);
        const review = humanReview(r, config.stateValues);
        return { ...r, state, idleMs, whole, ents, linkInfo, review };
      }),
    [rows, config, now, traceCounts, linkCounts, wholeTrace, lookup]
  );

  // Start again at the first page when the list, a filter or the sort changes.
  useEffect(() => setLimit(PAGE), [rows, stateFilter, sort]);

  const counts = useMemo(() => {
    const c = {};
    STATES.forEach(s => (c[s] = 0));
    enriched.forEach(r => (c[r.state] += 1));
    return c;
  }, [enriched]);

  const shown = useMemo(() => {
    const dir = sort.dir === 'asc' ? 1 : -1;
    return enriched
      .filter(r => stateFilter === 'All' || r.state === stateFilter)
      .sort((a, b) => {
        const x = sortValue(a, sort.key);
        const y = sortValue(b, sort.key);
        const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
        return dir * c || b.last - a.last;
      });
  }, [enriched, stateFilter, sort]);

  const sortBy = key =>
    setSort(prev =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: TEXT_SORT.includes(key) ? 'asc' : 'desc' }
    );
  const th = (key, label, extra = {}) => (
    <th
      className={`wte-sortable${extra.num ? ' wte-num' : ''}`}
      title={extra.title}
      {...activatable(() => sortBy(key))}
      aria-sort={sort.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      {label}
      <span className="wte-sort">{sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
    </th>
  );

  // Detail renders in this nerdlet (not a stacked one) so it does not need a
  // second iframe, which some browsers block for local nerdpacks.
  const open = useCallback(
    r =>
      setSelected({
        accountId,
        workflowId: r.workflowId,
        first: r.first,
        last: r.last,
        windowId: r.windowId
      }),
    [accountId]
  );

  if (selected) {
    return <Detail urlState={selected} onBack={() => setSelected(null)} />;
  }

  const tiles = all && [
    { key: 'total', label: 'Workflows', value: all.total, tone: 'blue' },
    {
      key: 'withErrors',
      label: 'With errors (click to filter)',
      value: all.withErrors,
      tone: 'red'
    }
  ];

  return (
    <div className="wte-page" ref={pageRef} data-theme={theme}>
      <div className="wte-hero">
        <div>
          <h2>Workflow Trace Explorer</h2>
          <div className="wte-sub">
            Long-running workflows stitched across traces
            {accountId ? ` | grouped by ${config.attrs.correlationId}` : ''}
          </div>
        </div>
        <div className="wte-controls">
          <AccountPicker value={accountId} onChange={(e, v) => setAccountId(v)} />
          {accountId && (
            <MultiSelect
              label="App"
              loading={appsLoading}
              options={appOptions.map(a => ({
                value: a.name,
                hint: `${a.spans.toLocaleString()} spans`
              }))}
              value={apps}
              onChange={setApps}
            />
          )}
          <Select
            value={String(autoRefresh)}
            onChange={(e, v) => setAutoRefresh(Number(v))}
            title="Reload the table on a timer"
          >
            <SelectItem value="0">Auto refresh: off</SelectItem>
            <SelectItem value="30">Every 30s</SelectItem>
            <SelectItem value="60">Every 1m</SelectItem>
            <SelectItem value="300">Every 5m</SelectItem>
          </Select>
          <Button
            type={Button.TYPE.NORMAL}
            sizeType={Button.SIZE_TYPE.SMALL}
            onClick={() => setShowSettings(!showSettings)}
          >
            Settings
          </Button>
        </div>
      </div>

      {showSettings && accountId && (
        <div className="wte-card">
          <SettingsPanel accountId={accountId} config={config} onSaved={setConfig} />
        </div>
      )}
      {!accountId && <div className="wte-empty">Select an account to get started.</div>}
      {error && <div className="wte-diag wte-diag-error">{error}</div>}

      {accountId && (
        <>
          <div className="wte-kpis">
            {(tiles || [1, 2].map(i => ({ key: i, label: ' ', value: null, tone: 'grey' }))).map(
              k => (
                <div
                  className={`wte-kpi wte-kpi-${k.tone}${k.key === 'withErrors' ? ' wte-kpi-click' : ''}${k.key === 'withErrors' && errorsOnly ? ' wte-kpi-on' : ''}`}
                  key={k.key}
                  {...(k.key === 'withErrors' ? clickable(() => setErrorsOnly(!errorsOnly)) : {})}
                >
                  <b>{k.value === null ? '-' : k.value.toLocaleString()}</b>
                  <span>{k.label}</span>
                </div>
              )
            )}
          </div>
          <div className="wte-charts">
            <div className="wte-card">
              <div className="wte-card-title">Workflows with activity, and with an error span</div>
              <div className="wte-over-time">
                <LineChart
                  fullWidth
                  accountIds={[Number(accountId)]}
                  query={chartQueries.overTime}
                />
              </div>
            </div>
            <div className="wte-card">
              <div className="wte-card-title">Logs by severity (app filter applies)</div>
              <div className="wte-over-time">
                <LineChart fullWidth accountIds={[Number(accountId)]} query={chartQueries.logs} />
              </div>
            </div>
            <div className="wte-card">
              <div className="wte-card-title">Error spans by app</div>
              <div className="wte-over-time">
                <BarChart
                  fullWidth
                  accountIds={[Number(accountId)]}
                  query={chartQueries.errorsByApp}
                />
              </div>
            </div>
          </div>
          {(apps.length > 0 || search) && (
            <div className="wte-filterbar">
              <span className="wte-muted">Filters</span>
              {apps.map(a => (
                <span key={a} className="wte-chip">
                  App {a}
                  <button
                    type="button"
                    className="wte-chip-x"
                    aria-label={`Remove app ${a}`}
                    onClick={() => setApps(apps.filter(x => x !== a))}
                  >
                    ×
                  </button>
                </span>
              ))}
              {search && (
                <span className="wte-chip">
                  Workflow ID or app contains {search}
                  <button
                    type="button"
                    className="wte-chip-x"
                    aria-label="Clear search"
                    onClick={() => {
                      setSearchText('');
                      setSearch('');
                    }}
                  >
                    ×
                  </button>
                </span>
              )}
              <button
                type="button"
                className="wte-linkbtn"
                onClick={() => {
                  setApps([]);
                  setSearchText('');
                  setSearch('');
                }}
              >
                Clear all
              </button>
              {apps.length > 0 && (
                <span className="wte-muted">
                  Counts, times and states use only the spans of the selected apps.
                </span>
              )}
            </div>
          )}
          {all && enriched.length < (errorsOnly ? all.withErrors : all.total) && (
            <div className="wte-banner">
              The table lists {enriched.length.toLocaleString()} of about{' '}
              {(errorsOnly ? all.withErrors : all.total).toLocaleString()} workflows (limit{' '}
              {TABLE_CAP.toLocaleString()}). The tiles above cover all of them.
              {sort.dir === 'asc' &&
                SERVER_SORT.includes(sort.key) &&
                ' Ascending order only reorders the rows loaded here; click the column again for the true top rows.'}{' '}
              Search a workflow ID or pick apps above to narrow the list, or choose a shorter range.
            </div>
          )}

          <div className="wte-card wte-card-flush">
            <div className="wte-toolbar">
              <div
                className="wte-search"
                onKeyDown={e => e.key === 'Enter' && setSearch(searchText.trim())}
              >
                <TextField
                  type="search"
                  placeholder="Search workflow ID or app (all workflows in the range)"
                  value={searchText}
                  onChange={e => setSearchText(e.target.value)}
                />
              </div>
              <Select value={stateFilter} onChange={(e, v) => setStateFilter(v)}>
                <SelectItem value="All">{`All states (${enriched.length})`}</SelectItem>
                {STATES.filter(s => counts[s] > 0 || s === stateFilter).map(s => (
                  <SelectItem key={s} value={s}>
                    {`${s} (${counts[s]})`}
                  </SelectItem>
                ))}
              </Select>
              <span title="Applies to every workflow in the range, not only the rows loaded here">
                <Checkbox
                  label="Has errors"
                  checked={errorsOnly}
                  onChange={e => setErrorsOnly(e.target.checked)}
                />
              </span>
              <span title="Only workflows whose traces have span links, across every workflow in the range">
                <Checkbox
                  label="Has span links"
                  checked={linksOnly}
                  onChange={e => setLinksOnly(e.target.checked)}
                />
              </span>
              <span className="wte-muted wte-toolbar-end">
                {shown.length.toLocaleString()} shown
                {(loading || countsLoading || linksLoading) && <Spinner inline />}
              </span>
            </div>
            <div className="wte-table-wrap">
              <table className="wte-table wte-clickable">
                <thead>
                  <tr>
                    {th('workflowId', 'Workflow ID')}
                    {th('appName', 'App')}
                    {th('entry', 'Entry transaction')}
                    {th('state', 'State')}
                    {th('first', 'Started')}
                    {th('last', 'Last activity')}
                    {th('duration', 'Duration', {
                      num: true,
                      title:
                        'Time from the first to the last span of the workflow, including pauses'
                    })}
                    {th('hil', 'HIL', {
                      title: `Human in the loop: whether the workflow waited for a person to review or approve it${reviewConfigured ? '' : `. ${NOT_SET}.`}`
                    })}
                    {th('decision', 'HIL decision', {
                      title: `Current decision: Approved, Declined, or Pending while it waits for a person${reviewConfigured ? '' : `. ${NOT_SET}.`}`
                    })}
                    {th('traces', 'Traces', { num: true })}
                    {th('spans', 'Spans', {
                      num: true,
                      title: !lookup
                        ? 'Spans in the trace'
                        : `All spans in the workflow's traces (not only those carrying ${config.attrs.correlationId})`
                    })}
                    {th('entities', 'Entities', {
                      num: true,
                      title: `Services (${config.attrs.service}) plus databases seen on spans carrying ${config.attrs.correlationId}`
                    })}
                    {th('databases', 'Databases', {
                      num: true,
                      title: `Distinct database systems (${config.attrs.dbSystem}); included in Entities`
                    })}
                    {th('links', 'Span links', {
                      num: true,
                      title:
                        'Span links carried by the workflow traces plus links from other traces into them'
                    })}
                    {th('errors', 'Errors', { num: true })}
                  </tr>
                </thead>
                <tbody>
                  {shown.slice(0, limit).map(r => (
                    <WorkflowRow
                      key={r.workflowId}
                      r={r}
                      now={now}
                      lookup={lookup}
                      correlationId={config.attrs.correlationId}
                      stateAttribute={config.attrs.stateAttribute}
                      reviewConfigured={reviewConfigured}
                      reviewAttr={decisionAttr || waitAttr}
                      onOpen={open}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            {shown.length > limit && (
              <div className="wte-more">
                Showing {limit.toLocaleString()} of {shown.length.toLocaleString()} rows
                <button type="button" className="wte-btn" onClick={() => setLimit(limit + PAGE)}>
                  Show {Math.min(PAGE, shown.length - limit)} more
                </button>
                <button type="button" className="wte-btn" onClick={() => setLimit(shown.length)}>
                  Show all
                </button>
              </div>
            )}
            {!loading && !shown.length && (
              <div className="wte-empty">
                {search || apps.length
                  ? 'No workflows match these filters in this time range. Widen the time picker, or change the filters.'
                  : 'No workflows in this range. Try a longer range with the time picker at the top right.'}
                {search && exact === null && (
                  <div className="wte-muted">Checking the last 7 days…</div>
                )}
                {search && exact === false && (
                  <div className="wte-muted">
                    No workflow with the exact ID &ldquo;{search}&rdquo; in the last 7 days either,
                    and no app name contains it.
                  </div>
                )}
                {search && exact && (
                  <div>
                    <button
                      type="button"
                      className="wte-btn"
                      title="Opens the workflow and looks back 7 days, whatever the time picker says"
                      onClick={() =>
                        open({
                          workflowId: search,
                          first: exact.first,
                          last: exact.last,
                          windowId: '1w'
                        })
                      }
                    >
                      Open &ldquo;{search}&rdquo; (found in the last 7 days, outside this time
                      range)
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
