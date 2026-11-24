import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ATTRS,
  DEFAULT_SYSTEM_RULES as R,
  DEFAULT_THRESHOLDS as T,
  mergeConfig
} from '../src/config/attributes.js';

// Tests stitch on a shared attribute; the default workflow id is trace.id.
const A = { ...DEFAULT_ATTRS, correlationId: 'demo.order.id', logCorrelationId: 'demo.order.id' };
import { stitch, traceEntities } from '../src/data/stitch.js';
import { inferState } from '../src/data/state.js';
import { buildSegments, makeScale } from '../src/data/timeline.js';
import { workflowEntities, workflowLinkCount, workflowSpanCount } from '../src/data/counts.js';
import { attributeRows, spanError } from '../src/data/spanattrs.js';
import { buildEntityMap, spanInNode } from '../src/data/entitymap.js';
import { buildRows } from '../src/data/tree.js';
import { formatDuration } from '../src/data/state.js';
import { attachLogs, prettyMessage, normalizeLog } from '../src/data/logs.js';
import {
  summaryNrql,
  sortExpr,
  rangeCountsNrql,
  appNamesNrql,
  scopeClause,
  traceCountsNrql,
  traceLinkCountsNrql,
  spansByTraceNrql,
  esc
} from '../src/data/queries.js';

const span = o => ({
  timestamp: 0,
  'duration.ms': 100,
  'otel.status_code': 'OK',
  'entity.name': 'temporal-worker',
  name: 'op',
  ...o
});
const H = 3600 * 1000;

test('stitch gives one entry per trace, sorted by start, and drops duplicate spans', () => {
  const raw = [
    span({ id: 'b', 'trace.id': 't2', timestamp: 500000 }),
    span({ id: 'a', 'trace.id': 't1', timestamp: 1000 }),
    span({ id: 'a2', 'trace.id': 't1', timestamp: 2000 }),
    span({ id: 'a2', 'trace.id': 't1', timestamp: 2000 })
  ];
  const r = stitch(raw, A, R);
  assert.equal(r.spans.length, 3);
  assert.deepEqual(
    r.traces.map(t => [t.traceId, t.spans.length]),
    [
      ['t1', 2],
      ['t2', 1]
    ]
  );
  assert.equal(r.traces[0].start, 1000);
  assert.equal(r.traces[0].end, 2100); // latest span end
});

test('system classification', () => {
  const r = stitch(
    [
      span({ id: 'a', 'trace.id': 't', 'entity.name': 'mulesoft-api' }),
      span({ id: 'b', 'trace.id': 't', 'entity.name': 'solace-bridge' }),
      span({ id: 'c', 'trace.id': 't', 'entity.name': 'java-worker-svc' })
    ],
    A,
    R
  );
  assert.deepEqual(
    r.spans.map(s => s.system),
    ['MuleSoft', 'Solace', 'java-worker-svc']
  );
});

test('inferState: no attribute means failed when any span errored, else completed', () => {
  const now = 10 * H;
  const f = (idle, errors) => inferState({ now, lastTs: now - idle, errors }).state;
  assert.equal(f(1000, 0), 'Completed'); // recent activity is not 'Running' any more
  assert.equal(f(H, 0), 'Completed');
  assert.equal(f(1000, 1), 'Failed');
  assert.equal(f(H, 3), 'Failed');
  assert.equal(inferState({ now, lastTs: now - 5000, errors: 0 }).idleMs, 5000);
  assert.equal(inferState({ now, lastTs: now + 5000, errors: 0 }).idleMs, 0);
});

test('timeline collapses long gaps', () => {
  const spans = [
    { start: 0, end: 1000 },
    { start: 500, end: 2000 },
    { start: 2 * 24 * H, end: 2 * 24 * H + 1000 }
  ];
  const segs = buildSegments(spans, 90000);
  assert.deepEqual(
    segs.map(s => s.type),
    ['active', 'gap', 'active']
  );
  const sc = makeScale(segs);
  assert.ok(sc.width < 2000);
  assert.ok(sc.xOf(2 * 24 * H) > sc.xOf(2000));
});

test('logs attach by span id, then trace; others unattached', () => {
  const spans = stitch(
    [
      span({ id: 'a', 'trace.id': 't1', timestamp: 1000 }),
      span({ id: 'b', 'trace.id': 't1', timestamp: 9000 })
    ],
    A,
    R
  ).spans;
  const logs = [
    { timestamp: 1100, 'span.id': 'a', 'trace.id': 't1', 'severity.text': 'info' },
    { timestamp: 8900, 'trace.id': 't1', 'severity.text': 'error' },
    { timestamp: 5000, 'severity.text': 'info' }
  ];
  const r = attachLogs(spans, logs, A);
  assert.equal(r.bySpan.get('a').length, 1);
  assert.equal(r.bySpan.get('b').length, 1);
  assert.equal(r.unattached.length, 1);
});

test('queries escape and window', () => {
  assert.equal(esc("a'b"), "a\\'b");
  const n = summaryNrql(A, 1000000, 2000000);
  assert.match(n, /FACET `demo.order.id` ORDER BY/);
  assert.match(n, /SINCE 1000 UNTIL 2000/);
  assert.match(spansByTraceNrql(A, ['x', "y'z"], 0, 1000), /IN \('x','y\\'z'\)/);
});

test('buildRows orders a span tree, flags orphans, honours collapse', () => {
  const sp = stitch(
    [
      span({ id: 'r', 'trace.id': 't', timestamp: 0 }),
      span({ id: 'c2', 'trace.id': 't', timestamp: 20, 'parent.id': 'r' }),
      span({ id: 'c1', 'trace.id': 't', timestamp: 10, 'parent.id': 'r' }),
      span({ id: 'g', 'trace.id': 't', timestamp: 12, 'parent.id': 'c1' }),
      span({ id: 'o', 'trace.id': 't', timestamp: 30, 'parent.id': 'missing' })
    ],
    A,
    R
  ).spans;
  const rows = buildRows(sp);
  assert.deepEqual(
    rows.map(r => [r.span.id, r.depth]),
    [
      ['r', 0],
      ['c1', 1],
      ['g', 2],
      ['c2', 1],
      ['o', 0]
    ]
  );
  assert.equal(rows.find(r => r.span.id === 'o').orphan, true);
  assert.equal(rows.find(r => r.span.id === 'r').entry, true);
  assert.equal(rows.find(r => r.span.id === 'o').entry, false);
  assert.equal(rows.find(r => r.span.id === 'r').hasKids, true);
  assert.deepEqual(
    buildRows(sp, new Set(['c1'])).map(r => r.span.id),
    ['r', 'c1', 'c2', 'o']
  );
});

test('buildRows survives a parent cycle', () => {
  const sp = stitch(
    [
      span({ id: 'a', 'trace.id': 't', timestamp: 0, 'parent.id': 'b' }),
      span({ id: 'b', 'trace.id': 't', timestamp: 1, 'parent.id': 'a' })
    ],
    A,
    R
  ).spans;
  assert.ok(buildRows(sp).length <= 2);
});

test('formatDuration handles sub-millisecond and long values', () => {
  assert.equal(formatDuration(0.5), '0.50ms');
  assert.equal(formatDuration(7.25), '7.3ms');
  assert.equal(formatDuration(250), '250ms');
  assert.equal(formatDuration(2 * 24 * 3600000 + 3 * 3600000), '2d 3h');
});

test('default workflow id is the trace id and summary orders by recency', () => {
  assert.equal(DEFAULT_ATTRS.correlationId, 'trace.id');
  assert.equal(DEFAULT_ATTRS.logCorrelationId, 'trace.id');
  assert.match(
    summaryNrql(DEFAULT_ATTRS, 0, 1000),
    /FACET `trace.id` ORDER BY max\(timestamp\) LIMIT MAX/
  );
});

test('traceEntities groups spans by service, busiest first, keeps guid', () => {
  const sp = stitch(
    [
      span({ id: 'a', 'trace.id': 't', 'entity.name': 'cart', 'entity.guid': 'G1' }),
      span({ id: 'b', 'trace.id': 't', 'entity.name': 'frontend' }),
      span({ id: 'c', 'trace.id': 't', 'entity.name': 'frontend', 'otel.status_code': 'ERROR' })
    ],
    A,
    R
  ).spans;
  const e = traceEntities(sp);
  assert.deepEqual(
    e.map(x => [x.name, x.spans, x.errors]),
    [
      ['frontend', 2, 1],
      ['cart', 1, 0]
    ]
  );
  assert.equal(e.find(x => x.name === 'cart').guid, 'G1');
});

test('summary query selects entry app and transaction', () => {
  const n = summaryNrql(A, 0, 1000);
  assert.match(n, /earliest\(`entity.name`\) AS appName/);
  assert.match(n, /earliest\(`transaction.name`\) AS txnName/);
  assert.match(n, /earliest\(`name`\) AS entryName/);
});

test('rangeCountsNrql counts unique workflows in range and those with errors', () => {
  const n = rangeCountsNrql(DEFAULT_ATTRS, 0, 1000000);
  assert.match(n, /uniqueCount\(`trace.id`\) AS total/);
  assert.match(n, /WHERE `otel.status_code` = 'ERROR'\) AS withErrors/);
  assert.match(n, /SINCE 0 UNTIL 1000$/);
});

test('summary asks for trace ids only when workflow id differs from trace id', () => {
  assert.match(summaryNrql(A, 0, 1000), /uniques\(`trace.id`, 20\) AS traceIds/);
  assert.doesNotMatch(summaryNrql(DEFAULT_ATTRS, 0, 1000), /traceIds/);
  assert.match(traceCountsNrql(A, ['a', 'b'], 0, 1000), /IN \('a','b'\) FACET `trace.id`/);
});

test('workflowSpanCount sums whole-trace counts and flags approximations', () => {
  const counts = new Map([
    ['t1', { count: 97, services: [], databases: [] }],
    ['t2', { count: 3, services: [], databases: [] }]
  ]);
  assert.deepEqual(workflowSpanCount({ traceIds: ['t1'], traces: 1 }, counts), {
    count: 97,
    approx: false
  });
  assert.deepEqual(workflowSpanCount({ traceIds: ['t1', 't2'], traces: 2 }, counts), {
    count: 100,
    approx: false
  });
  assert.equal(workflowSpanCount({ traceIds: ['t1', 'x'], traces: 2 }, counts).approx, true);
  assert.equal(workflowSpanCount({ traceIds: ['t1'], traces: 40 }, counts).approx, true);
  assert.equal(workflowSpanCount({ traceIds: ['x'], traces: 1 }, counts), null);
  assert.equal(workflowSpanCount({ traceIds: [], traces: 1 }, counts), null);
});

test('summary sort and errors-only are applied in the query', () => {
  assert.match(summaryNrql(DEFAULT_ATTRS, 0, 1000), /ORDER BY max\(timestamp\) LIMIT MAX/);
  assert.match(
    summaryNrql(DEFAULT_ATTRS, 0, 1000, { sort: 'errors' }),
    /ORDER BY filter\(count\(\*\), WHERE `otel.status_code` = 'ERROR'\) LIMIT MAX/
  );
  assert.equal(sortExpr(DEFAULT_ATTRS, 'spans'), 'count(*)');
  assert.equal(sortExpr(DEFAULT_ATTRS, 'first'), 'min(timestamp)');
  const e = summaryNrql(DEFAULT_ATTRS, 5000, 9000, { errorsOnly: true });
  assert.match(
    e,
    /AND `trace.id` IN \(FROM Span SELECT uniques\(`trace.id`, 5000\) WHERE `otel.status_code` = 'ERROR' SINCE 5 UNTIL 9\) FACET/
  );
  assert.doesNotMatch(summaryNrql(DEFAULT_ATTRS, 0, 1000), / IN \(FROM/);
});

test('entity map: services, db node, caller->callee edges, left-to-right layers', () => {
  const sp = stitch(
    [
      span({ id: 'a', 'trace.id': 't', 'entity.name': 'proxy', timestamp: 0 }),
      span({ id: 'b', 'trace.id': 't', 'entity.name': 'frontend', timestamp: 1, 'parent.id': 'a' }),
      span({ id: 'c', 'trace.id': 't', 'entity.name': 'frontend', timestamp: 2, 'parent.id': 'b' }),
      span({ id: 'd', 'trace.id': 't', 'entity.name': 'catalog', timestamp: 3, 'parent.id': 'c' }),
      span({
        id: 'e',
        'trace.id': 't',
        'entity.name': 'catalog',
        timestamp: 4,
        'parent.id': 'd',
        'db.system': 'postgresql'
      }),
      span({
        id: 'f',
        'trace.id': 't',
        'entity.name': 'checkout',
        timestamp: 5,
        'parent.id': 'c',
        'otel.status_code': 'ERROR'
      })
    ],
    A,
    R
  ).spans;
  const m = buildEntityMap(sp);
  assert.deepEqual(m.nodes.map(n => n.id).sort(), [
    'catalog',
    'checkout',
    'db:postgresql',
    'frontend',
    'proxy'
  ]);
  assert.deepEqual(m.edges.map(e => `${e.from}>${e.to}`).sort(), [
    'catalog>db:postgresql',
    'frontend>catalog',
    'frontend>checkout',
    'proxy>frontend'
  ]);
  const x = id => m.nodes.find(n => n.id === id).x;
  assert.ok(
    x('proxy') < x('frontend') && x('frontend') < x('catalog') && x('catalog') < x('db:postgresql')
  );
  assert.equal(m.nodes.find(n => n.id === 'checkout').errors, 1);
  assert.equal(m.edges.find(e => e.to === 'checkout').errors, 1);
  assert.equal(m.nodes.find(n => n.id === 'db:postgresql').kind, 'database');
  // newer semconv attribute name is read too
  const nd = stitch(
    [span({ id: 'z', 'trace.id': 't', 'entity.name': 'svc', 'db.system.name': 'redis' })],
    A,
    R
  ).spans;
  assert.equal(buildEntityMap(nd).nodes.find(n => n.kind === 'database').id, 'db:redis');
  assert.ok(
    spanInNode(
      sp.find(s => s.id === 'e'),
      'db:postgresql'
    )
  );
  assert.ok(
    !spanInNode(
      sp.find(s => s.id === 'a'),
      'db:postgresql'
    )
  );
  assert.ok(spanInNode(sp[0], null));
});

test('entity map survives call cycles', () => {
  const sp = stitch(
    [
      span({ id: 'a', 'trace.id': 't', 'entity.name': 'x', timestamp: 0 }),
      span({ id: 'b', 'trace.id': 't', 'entity.name': 'y', timestamp: 1, 'parent.id': 'a' }),
      span({ id: 'c', 'trace.id': 't', 'entity.name': 'x', timestamp: 2, 'parent.id': 'b' })
    ],
    A,
    R
  ).spans;
  const m = buildEntityMap(sp);
  assert.equal(m.nodes.length, 2);
  assert.equal(m.edges.length, 2);
  assert.ok(Number.isFinite(m.width) && Number.isFinite(m.height));
});

test('spans keep every raw attribute; attributeRows sorts, drops empties and filters', () => {
  const sp = stitch(
    [
      span({
        id: 'a',
        'trace.id': 't',
        'zeta.attr': 'Z',
        'db.query.text': 'select 1',
        empty: '',
        nothing: null,
        'list.attr': ['a', 'b']
      })
    ],
    A,
    R
  ).spans[0];
  assert.equal(sp.attributes['zeta.attr'], 'Z');
  const rows = attributeRows(sp.attributes);
  const keys = rows.map(r => r.key);
  assert.deepEqual(
    keys,
    [...keys].sort((a, b) => a.localeCompare(b))
  );
  assert.ok(!keys.includes('empty') && !keys.includes('nothing'));
  assert.equal(rows.find(r => r.key === 'list.attr').value, '["a","b"]');
  assert.deepEqual(
    attributeRows(sp.attributes, 'SELECT').map(r => r.key),
    ['db.query.text']
  );
  assert.deepEqual(
    attributeRows(sp.attributes, 'zeta').map(r => r.key),
    ['zeta.attr']
  );
  assert.deepEqual(attributeRows(null), []);
});

test('logs keep their full payload and service; JSON messages are pretty-printed', () => {
  const raw = {
    timestamp: 5,
    message: '{"a":1,"b":[2]}',
    'severity.text': 'info',
    'entity.name': 'cart',
    'trace.id': 't',
    'span.id': 's',
    extra: 'x'
  };
  const l = normalizeLog(raw, DEFAULT_ATTRS);
  assert.equal(l.attributes.extra, 'x');
  assert.equal(l.service, 'cart');
  assert.equal(l.level, 'INFO');
  const p = prettyMessage(l.message);
  assert.equal(p.json, true);
  assert.match(p.text, /\n {2}"a": 1/);
  assert.deepEqual(prettyMessage('plain text'), { text: 'plain text', json: false });
  assert.equal(prettyMessage('{not json').json, false);
});

test('mergeConfig ignores invalid settings instead of breaking', () => {
  const c = mergeConfig({
    attrs: { correlationId: 'workflow.id', spanId: 'bad`name', unknownKey: 'x', name: 42 },
    thresholds: {
      gapMs: 'abc',
      noSuchThreshold: 120000
    },
    systemRules: [{ system: '', pattern: 'x' }, null]
  });
  assert.equal(c.attrs.correlationId, 'workflow.id');
  assert.equal(c.attrs.spanId, DEFAULT_ATTRS.spanId);
  assert.equal(c.attrs.name, DEFAULT_ATTRS.name);
  assert.ok(!('unknownKey' in c.attrs));
  assert.equal(c.thresholds.gapMs, T.gapMs);
  assert.ok(!('noSuchThreshold' in c.thresholds));
  assert.deepEqual(c.systemRules, R);
  assert.deepEqual(mergeConfig(null).attrs, DEFAULT_ATTRS);
  assert.deepEqual(mergeConfig('junk').thresholds, T);
});

test('queries strip backticks from attribute names', () => {
  assert.match(summaryNrql({ ...DEFAULT_ATTRS, name: 'na`me' }, 0, 1000), /latest\(`name`\)/);
});

test('summarizeDatabases groups db spans by system and ranks the slowest', async () => {
  const { summarizeDatabases } = await import('../src/data/databases.js');
  const sp = (id, dbSystem, durMs, service, isError = false) => ({
    id,
    name: `q${id}`,
    dbSystem,
    durMs,
    service,
    isError,
    attributes: {}
  });
  const r = summarizeDatabases([
    sp('1', 'postgresql', 30, 'a'),
    sp('2', 'postgresql', 10, 'b', true),
    sp('3', 'redis', 5, 'a'),
    sp('4', null, 99, 'a')
  ]);
  assert.deepEqual(
    r.databases.map(d => d.system),
    ['postgresql', 'redis']
  );
  assert.equal(r.databases[0].calls, 2);
  assert.equal(r.databases[0].errors, 1);
  assert.equal(r.databases[0].avgMs, 20);
  assert.deepEqual(r.databases[0].services, ['a', 'b']);
  assert.deepEqual(
    r.slow.map(s => s.id),
    ['1', '2', '3']
  );
});

test('workflowEntities unions services and databases across the traces', () => {
  const counts = new Map([
    ['t1', { count: 5, services: ['a', 'b'], databases: ['pg'] }],
    ['t2', { count: 4, services: ['b', 'c'], databases: ['pg', 'redis'] }]
  ]);
  assert.deepEqual(workflowEntities({ traceIds: ['t1', 't2'] }, counts), {
    entities: 5,
    databases: 2
  });
  assert.equal(workflowEntities({ traceIds: ['x'] }, counts), null);
  assert.equal(workflowEntities({ traceIds: ['t1'] }, null), null);
});

test('a trace whose only root names a parent outside the data starts there, not orphaned', () => {
  const st = stitch(
    [
      span({ id: 'i', 'trace.id': 't', timestamp: 0, 'parent.id': 'caller' }),
      span({ id: 'c', 'trace.id': 't', timestamp: 5, 'parent.id': 'i' })
    ],
    A,
    R
  );
  const rows = buildRows(st.spans);
  assert.equal(rows[0].entry, true);
  assert.equal(rows[0].orphan, false);
});

test('entityLatency splits exclusive vs total time and finds slowest and root', async () => {
  const { entityLatency } = await import('../src/data/latency.js');
  const sp = (id, parentId, service, start, durMs, extra = {}) => ({
    id,
    parentId,
    traceId: 't',
    service,
    system: service,
    start,
    durMs,
    end: start + durMs,
    isError: false,
    dbSystem: null,
    ...extra
  });
  const spans = [
    sp('a', null, 'proxy', 0, 100),
    sp('b', 'a', 'app', 10, 60),
    sp('c', 'b', 'app', 20, 20, { dbSystem: 'pg' }),
    sp('d', 'b', 'app', 50, 10, { isError: true })
  ];
  const r = entityLatency(spans, [{ spans }]);
  const get = id => r.entities.find(e => e.id === id);
  assert.equal(get('proxy').exclusive, 40);
  assert.equal(get('app').exclusive, 30 + 10);
  assert.equal(get('app').total, 60);
  assert.equal(get('app').errors, 1);
  // counts match the entity map: the service keeps its database call, the db counts its own
  assert.equal(get('app').spans, 3);
  assert.equal(get('db:pg').spans, 1);
  assert.equal(get('db:pg').errors, 0);
  assert.equal(get('db:pg').exclusive, 20);
  assert.equal(r.root.id, 'proxy');
  assert.equal(r.slowest.exclusive, 40);
});

test('spanMatches combines search, errors only and window', async () => {
  const { spanMatches, isFiltering } = await import('../src/data/rowfilter.js');
  const s = {
    id: 'ab12',
    name: 'GET /cart',
    service: 'frontend',
    start: 10,
    end: 20,
    isError: false
  };
  assert.equal(spanMatches(s, null), true);
  assert.equal(spanMatches(s, { query: 'CART' }), true);
  assert.equal(spanMatches(s, { query: 'ab1' }), true);
  assert.equal(spanMatches(s, { query: 'nope' }), false);
  assert.equal(spanMatches(s, { errorsOnly: true }), false);
  assert.equal(spanMatches(s, { range: { from: 21, to: 30 } }), false);
  assert.equal(spanMatches(s, { range: { from: 15, to: 30 } }), true);
  assert.equal(isFiltering({ query: '', errorsOnly: false, range: null }), false);
  const links = new Map([['undefined/ab12', [1]]]);
  assert.equal(spanMatches(s, { linksOnly: true, links }), true);
  assert.equal(spanMatches(s, { linksOnly: true, links: new Map() }), false);
});

test('makeScale.tOf inverts xOf', () => {
  const sc = makeScale(
    buildSegments(
      [
        { start: 0, end: 1000 },
        { start: 100000, end: 101000 }
      ],
      5000
    ),
    {
      activePx: 400,
      minActivePx: 50,
      gapPx: 100
    }
  );
  assert.equal(Math.round(sc.tOf(sc.xOf(500))), 500);
  assert.equal(Math.round(sc.tOf(sc.xOf(100500))), 100500);
});

test('buildLinks marks forward and backward links and flags cross-trace ones', async () => {
  const { buildLinks, hasCrossTraceLink } = await import('../src/data/links.js');
  const spans = [
    {
      id: 'p',
      traceId: 'T1',
      name: 'orders publish',
      service: 'checkout',
      durMs: 0.19,
      isError: false,
      start: 100
    }
  ];
  const rows = [
    { id: 'c1', 'trace.id': 'T2', linkedSpanId: 'p', linkedTraceId: 'T1', timestamp: 500 },
    { id: 'c1', 'trace.id': 'T2', linkedSpanId: 'p', linkedTraceId: 'T1', timestamp: 500 },
    { id: 'x', 'trace.id': 'T1', linkedSpanId: 'p', linkedTraceId: 'T1', timestamp: 120 }
  ];
  const other = [
    {
      id: 'c1',
      'trace.id': 'T2',
      name: 'orders process',
      'entity.name': 'fraud',
      'duration.ms': 6,
      'otel.status_code': 'ERROR',
      timestamp: 500
    }
  ];
  const m = buildLinks(spans, rows, other, A);
  const l = m.get('T1/p');
  assert.equal(l.length, 2); // duplicate row dropped
  assert.equal(l[0].direction, 'Forward');
  assert.equal(l[0].traceId, 'T2');
  assert.equal(l[0].crossTrace, true);
  assert.equal(l[0].durMs, 6);
  assert.equal(l[0].isError, true);
  assert.equal(l[0].service, 'fraud');
  assert.equal(l[1].crossTrace, false);
  assert.equal(hasCrossTraceLink(l), true);
  assert.equal(hasCrossTraceLink([l[1]]), false);
  assert.equal(hasCrossTraceLink(undefined), false);
});

test('trace link counts are queried per direction and summed per workflow', () => {
  assert.match(
    traceLinkCountsNrql(['a', 'b'], 0, 1000),
    /FROM SpanLink SELECT count\(\*\) WHERE `trace.id` IN \('a','b'\) FACET `trace.id`/
  );
  assert.match(
    traceLinkCountsNrql(['a'], 0, 1000, 'in'),
    /WHERE linkedTraceId IN \('a'\) FACET linkedTraceId/
  );
  const counts = new Map([
    ['t1', { out: 1, in: 2 }],
    ['t2', { out: 0, in: 1 }]
  ]);
  assert.deepEqual(workflowLinkCount({ traceIds: ['t1', 't2'], traces: 2 }, counts, false), {
    count: 4,
    approx: false
  });
  assert.deepEqual(workflowLinkCount({ traceIds: ['t1'], traces: 30 }, counts, false), {
    count: 3,
    approx: true
  });
  assert.deepEqual(workflowLinkCount({ workflowId: 't2' }, counts, true), {
    count: 1,
    approx: false
  });
  assert.equal(workflowLinkCount({ workflowId: 'zz' }, counts, true), null); // not counted yet
  assert.deepEqual(
    workflowLinkCount({ workflowId: 't3' }, new Map([['t3', { out: 0, in: 0 }]]), true),
    { count: 0, approx: false }
  );
  assert.equal(workflowLinkCount({ traceIds: [], traces: 1 }, counts, false), null);
  assert.equal(workflowLinkCount({ workflowId: 't1' }, null, true), null);
});

test('entityLatency counts logs per entity', async () => {
  const { entityLatency } = await import('../src/data/latency.js');
  const sp = (id, parentId, service, system, start, durMs) => ({
    id,
    parentId,
    traceId: 't',
    service,
    system,
    start,
    durMs,
    end: start + durMs,
    isError: false,
    dbSystem: null
  });
  const spans = [sp('a', null, 'mule', 'MuleSoft', 0, 10), sp('b', 'a', 'solace', 'Solace', 50, 5)];
  const bySpan = new Map([['b', [{ level: 'ERROR' }, { level: 'INFO' }]]]);
  const r = entityLatency(spans, [{ spans }], bySpan);
  const solace = r.entities.find(e => e.id === 'solace');
  assert.equal(solace.logs, 2);
  assert.equal(solace.errorLogs, 1);
  assert.equal(solace.system, 'Solace');
});

test('app and search filters narrow the summary, the range counts and the app list', () => {
  const scope = { apps: ['cart', "o'neil"], search: 'abc' };
  const w = scopeClause(DEFAULT_ATTRS, scope);
  assert.match(w, /AND `entity.name` IN \('cart','o\\'neil'\) /);
  assert.match(w, /AND \(`trace.id` LIKE '%abc%' OR `entity.name` LIKE '%abc%'\) $/);
  assert.equal(scopeClause(DEFAULT_ATTRS, {}), '');
  assert.equal(scopeClause(DEFAULT_ATTRS, { apps: [], search: '  ' }), '');
  const n = summaryNrql(DEFAULT_ATTRS, 0, 1000, scope);
  assert.match(n, /IS NOT NULL AND `entity.name` IN \('cart'/);
  assert.match(n, /uniques\(`trace.id`, 20\) AS traceIds/); // whole-trace lookup needed when spans are limited to apps
  assert.match(summaryNrql(DEFAULT_ATTRS, 0, 1000, { search: 'x' }), /traceIds/); // search can match app names, which limits spans
  const r = rangeCountsNrql(DEFAULT_ATTRS, 0, 1000000, scope);
  assert.match(r, /IS NOT NULL AND `entity.name` IN \('cart'.*LIKE '%abc%'\) SINCE 0 UNTIL 1000$/);
  assert.match(
    appNamesNrql(DEFAULT_ATTRS, 0, 1000),
    /FACET `entity.name` LIMIT 500 SINCE 0 UNTIL 1$/
  );
});

test('detail windows: summary range, relative ranges, custom and the default', async () => {
  const { resolveWindow, customMs, defaultWindowId, WINDOW_GROUPS } =
    await import('../src/data/window.js');
  const now = 10_000_000_000;
  const HOUR = 3600000;
  // summary range starts a minute before the first span and runs to now
  assert.deepEqual(resolveWindow('summary', {}, now, 5000, 9000), { begin: -55000, end: now });
  assert.deepEqual(resolveWindow('whole', {}, now, 5000, 9000), { begin: -55000, end: now });
  assert.equal(resolveWindow('summary', {}, 100, 5000, 9000).end, 69000); // never ends before the last span
  assert.deepEqual(resolveWindow('60m', {}, now, 0, 0), { begin: now - HOUR, end: now });
  assert.deepEqual(resolveWindow('2mo', {}, now, 0, 0), { begin: now - 60 * 24 * HOUR, end: now });
  assert.deepEqual(resolveWindow('custom', { n: 3, unit: 'weeks' }, now, 0, 0), {
    begin: now - 21 * 24 * HOUR,
    end: now
  });
  assert.equal(customMs({ n: 2, unit: 'hours' }), 2 * HOUR);
  assert.equal(customMs({ n: 9999, unit: 'weeks' }), 365 * 24 * HOUR); // capped
  assert.equal(customMs({ n: 0, unit: 'days' }), null);
  assert.equal(customMs({ n: 'x', unit: 'days' }), null);
  assert.equal(resolveWindow('custom', { n: 0, unit: 'days' }, now, 0, 0).begin, now - HOUR); // unusable falls back to 60m
  assert.equal(defaultWindowId(), 'summary');
  const ids = WINDOW_GROUPS.flatMap(g => g.options.map(o => o.id));
  assert.equal(new Set(ids).size, ids.length);
});

test('workflow bounds query is scoped to the workflow id', async () => {
  const { workflowBoundsNrql } = await import('../src/data/queries.js');
  const n = workflowBoundsNrql(A, "w'1", 0, 1000000);
  assert.match(n, /min\(timestamp\) AS first, max\(timestamp\) AS last/);
  assert.match(n, /WHERE `demo.order.id` = 'w\\'1' SINCE 0 UNTIL 1000$/);
});

test('state attribute decides the state; no usable value means failed or completed', async () => {
  const { inferState, stateFromValue, latestAttributeValue } = await import('../src/data/state.js');
  const { DEFAULT_STATE_VALUES, mergeConfig } = await import('../src/config/attributes.js');
  const cfg = { attribute: 'workflow.status', values: DEFAULT_STATE_VALUES };
  const base = { now: 1e9, lastTs: 1e9 - 10, errors: 0 };
  const st = (extra, c = cfg) => inferState({ ...base, ...extra }, c).state;
  assert.equal(st({ stateValue: 'RUNNING' }), 'Running');
  assert.equal(st({ stateValue: ' Waiting ' }), 'Waiting for human');
  assert.equal(st({ stateValue: 'completed', errors: 3 }), 'Completed'); // the value wins over errors
  assert.equal(st({ stateValue: 'timed_out' }), 'Failed');
  // human-in-the-loop outcomes: approved means work continues, declined ends it
  assert.equal(st({ stateValue: 'APPROVED' }), 'Running');
  assert.equal(st({ stateValue: 'Declined' }), 'Failed');
  assert.equal(st({ stateValue: 'rejected' }), 'Failed');
  // no value, or a value no list contains: errors mean Failed, else Completed
  assert.equal(st({ stateValue: undefined, errors: 2 }), 'Failed');
  assert.equal(st({ stateValue: '', errors: 0 }), 'Completed');
  assert.equal(st({ stateValue: 'SOMETHING_ELSE', errors: 0 }), 'Completed');
  assert.equal(st({ stateValue: 'SOMETHING_ELSE', errors: 1 }), 'Failed');
  // no attribute configured: a stray value is ignored; errors decide
  const off = { attribute: '', values: DEFAULT_STATE_VALUES };
  assert.equal(st({ stateValue: 'running' }, off), 'Completed');
  assert.equal(st({ stateValue: 'running', errors: 1 }, off), 'Failed');
  assert.equal(stateFromValue(null, DEFAULT_STATE_VALUES), null);
  // latest non-empty value by span start
  const spans = [
    { start: 1, attributes: { s: 'RUNNING' } },
    { start: 5, attributes: { s: '' } },
    { start: 3, attributes: { s: 'WAITING' } }
  ];
  assert.equal(latestAttributeValue(spans, 's'), 'WAITING');
  assert.equal(latestAttributeValue(spans, 'missing'), undefined);
  // config: the attribute can be set, cleared, and values are kept
  const on = mergeConfig({
    attrs: { stateAttribute: 'workflow.status' },
    stateValues: { Running: 'go' }
  });
  assert.equal(on.attrs.stateAttribute, 'workflow.status');
  assert.equal(on.stateValues.Running, 'go');
  assert.equal(on.stateValues.Failed, DEFAULT_STATE_VALUES.Failed);
  assert.equal(mergeConfig({ attrs: { stateAttribute: '' } }).attrs.stateAttribute, '');
  assert.equal(mergeConfig({ attrs: { stateAttribute: 'bad name!' } }).attrs.stateAttribute, '');
  assert.match(
    summaryNrql({ ...DEFAULT_ATTRS, stateAttribute: 'workflow.status' }, 0, 1000),
    /filter\(latest\(`workflow.status`\), WHERE `workflow.status` != ''\) AS stateValue/
  );
  assert.doesNotMatch(summaryNrql(DEFAULT_ATTRS, 0, 1000), /stateValue/);
});

test('human review: in the loop, pending, approved or declined, and a new wait clears a decision', async () => {
  const { humanReview, humanReviewFromSpans, valuePattern, humanAttrs } =
    await import('../src/data/human.js');
  const { DEFAULT_STATE_VALUES: V } = await import('../src/config/attributes.js');
  assert.equal(humanReview({}, V).status, 'None');
  assert.equal(humanReview({}, V).involved, false);
  assert.equal(humanReview({ waitTs: 5 }, V).status, 'Pending');
  assert.equal(
    humanReview({ waitTs: 5, decisionTs: 9, decisionValue: 'APPROVED' }, V).status,
    'Approved'
  );
  assert.equal(
    humanReview({ waitTs: 5, decisionTs: 9, decisionValue: 'declined' }, V).status,
    'Declined'
  );
  assert.equal(
    humanReview({ waitTs: 12, decisionTs: 9, decisionValue: 'approved' }, V).status,
    'Pending'
  ); // waiting again
  assert.equal(humanReview({ decisionTs: 9, decisionValue: 'approved' }, V).involved, true);
  assert.equal(humanReview({ decisionTs: 9, decisionValue: 'weird' }, V).status, 'Pending');
  // from spans, using the state attribute for both
  const sp = (start, v) => ({ start, attributes: { 'wf.status': v } });
  const attrs = { stateAttribute: 'wf.status', decisionAttribute: '' };
  assert.equal(
    humanReviewFromSpans([sp(1, 'RUNNING'), sp(2, 'WAITING'), sp(3, 'Approved')], attrs, V).status,
    'Approved'
  );
  assert.equal(
    humanReviewFromSpans([sp(1, 'WAITING'), sp(2, 'approved'), sp(3, 'waiting')], attrs, V).status,
    'Pending'
  );
  assert.equal(
    humanReviewFromSpans([sp(1, 'RUNNING'), sp(2, 'COMPLETED')], attrs, V).status,
    'None'
  );
  assert.equal(
    humanReviewFromSpans([sp(1, 'x')], { stateAttribute: '', decisionAttribute: '' }, V),
    null
  );
  assert.deepEqual(humanAttrs({ stateAttribute: 's', decisionAttribute: 'd' }), {
    waitAttr: 's',
    decisionAttr: 'd'
  });
  assert.deepEqual(humanAttrs({ stateAttribute: 's', decisionAttribute: '' }), {
    waitAttr: 's',
    decisionAttr: 's'
  });
  // NRQL pattern: case-insensitive, whole value, regex characters escaped
  assert.equal(valuePattern('Approved, a.b'), '(?i)^(approved|a\\.b)$');
  assert.equal(valuePattern(''), null);
  const n = summaryNrql({ ...DEFAULT_ATTRS, stateAttribute: 'wf.status' }, 0, 1000, {
    stateValues: V
  });
  assert.match(
    n,
    /filter\(max\(timestamp\), WHERE `wf.status` RLIKE '\(\?i\)\^\(waiting\|pending\|paused\|awaiting_approval\)\$'\) AS waitTs/
  );
  assert.match(
    n,
    /AS decisionTs, filter\(latest\(`wf.status`\), WHERE `wf.status` RLIKE .*\) AS decisionValue/
  );
  assert.doesNotMatch(summaryNrql(DEFAULT_ATTRS, 0, 1000, { stateValues: V }), /waitTs|decisionTs/);
});

test('summary measures duration to the end of the latest span', () => {
  const n = summaryNrql(DEFAULT_ATTRS, 0, 1000);
  assert.match(
    n,
    /min\(timestamp\) AS first, max\(timestamp\) AS last, max\(timestamp \+ `duration.ms`\) AS lastEnd/
  );
  assert.match(
    summaryNrql({ ...DEFAULT_ATTRS, duration: 'dur' }, 0, 1000),
    /max\(timestamp \+ `dur`\) AS lastEnd/
  );
});

test('span link filter queries SpanLink in both directions, over the given window', () => {
  const links = { since: 1000000, until: 9000000 };
  const w = scopeClause(DEFAULT_ATTRS, { links });
  assert.match(
    w,
    /^AND \(`trace.id` IN \(FROM SpanLink SELECT uniques\(`trace.id`, 5000\) SINCE 1000 UNTIL 9000\) OR `trace.id` IN \(FROM SpanLink SELECT uniques\(linkedTraceId, 5000\) SINCE 1000 UNTIL 9000\)\) $/
  );
  assert.match(
    summaryNrql(DEFAULT_ATTRS, 1000000, 2000000, { links }),
    /IS NOT NULL AND \(`trace.id` IN \(FROM SpanLink/
  );
  assert.match(rangeCountsNrql(DEFAULT_ATTRS, 1000000, 2000000, { links }), /FROM SpanLink/);
  assert.doesNotMatch(summaryNrql(DEFAULT_ATTRS, 0, 1000), /SpanLink/);
});

test('trace map puts spans on rows by depth and keeps errors when it has to sample', async () => {
  const { spanDepths, traceMapBars } = await import('../src/data/tracemap.js');
  const sp = (id, parentId, durMs = 1, isError = false) => ({ id, parentId, durMs, isError });
  const spans = [
    sp('a', null),
    sp('b', 'a'),
    sp('c', 'b'),
    sp('d', 'gone'),
    sp('x', 'x'),
    sp('p', 'q'),
    sp('q', 'p')
  ];
  const d = spanDepths(spans);
  assert.equal(d.get('a'), 0);
  assert.equal(d.get('b'), 1);
  assert.equal(d.get('c'), 2);
  assert.equal(d.get('d'), 0); // missing parent: a root
  assert.equal(d.get('x'), 0); // its own parent: a root
  assert.ok(Number.isFinite(d.get('p')) && Number.isFinite(d.get('q'))); // cycle ends
  const rows = traceMapBars(spans, 2).find(b => b.span.id === 'c');
  assert.equal(rows.row, 1); // depth 2 is clamped to the last of 2 rows
  const many = Array.from({ length: 50 }, (_, i) => sp(`s${i}`, null, i, i === 3));
  const picked = traceMapBars(many, 10, 5).map(b => b.span.id);
  assert.equal(picked.length, 5);
  assert.ok(picked.includes('s3')); // the error span is kept
  assert.ok(picked.includes('s49')); // longest others fill the rest
});

test('packLanes puts overlapping traces on separate rows and reuses free ones', async () => {
  const { packLanes } = await import('../src/data/tracemap.js');
  // trace 0 spans everything; 1 and 2 overlap each other; 3 starts after 1 ended
  const boxes = [
    { x0: 0, x1: 500 },
    { x0: 250, x1: 400 },
    { x0: 300, x1: 450 },
    { x0: 420, x1: 480 }
  ];
  const r = packLanes(boxes, 6);
  assert.equal(r.count, 3);
  assert.equal(r.lane[0], 0);
  assert.equal(r.lane[1], 1);
  assert.equal(r.lane[2], 2);
  assert.equal(r.lane[3], 1); // reuses the row trace 1 left
  boxes.forEach((a, i) =>
    boxes.forEach((b, j) => {
      if (i < j && r.lane[i] === r.lane[j]) assert.ok(a.x1 + 6 <= b.x0 || b.x1 + 6 <= a.x0);
    })
  );
  assert.equal(
    packLanes([
      { x0: 0, x1: 10 },
      { x0: 30, x1: 40 }
    ]).count,
    1
  );
  assert.equal(packLanes([]).count, 1);
});

test('workflow id can list several attributes; first non-empty wins', async () => {
  const { idExpr, summaryNrql, spansByWorkflowNrql } = await import('../src/data/queries.js');
  const spec = 'temporal.workflow.id, workflowId ,temporalWorkflowID';
  const c = mergeConfig({ attrs: { correlationId: spec, logCorrelationId: spec } });
  assert.equal(c.attrs.correlationId, 'temporal.workflow.id,workflowId,temporalWorkflowID');
  // a bad name anywhere in the list rejects the whole value
  assert.equal(
    mergeConfig({ attrs: { correlationId: 'a.b,bad`c' } }).attrs.correlationId,
    DEFAULT_ATTRS.correlationId
  );
  // single attribute: unchanged query text
  assert.equal(idExpr('workflow.id'), '`workflow.id`');
  assert.equal(
    idExpr(c.attrs.correlationId),
    "if(`temporal.workflow.id` IS NOT NULL AND `temporal.workflow.id` != '', `temporal.workflow.id`, " +
      "if(`workflowId` IS NOT NULL AND `workflowId` != '', `workflowId`, " +
      "if(`temporalWorkflowID` IS NOT NULL AND `temporalWorkflowID` != '', `temporalWorkflowID`, null)))"
  );
  const nrql = summaryNrql(c.attrs, 0, 1000);
  assert.match(nrql, /FACET if\(`temporal\.workflow\.id` IS NOT NULL/);
  assert.match(spansByWorkflowNrql(c.attrs, 'wf-1', 0, 1000), /WHERE if\(.*\) = 'wf-1'/);
  // stitching reads the first non-empty value
  const raw = {
    timestamp: 1,
    id: 's1',
    'trace.id': 't1',
    'duration.ms': 1,
    'temporal.workflow.id': '',
    workflowId: 'wf-1'
  };
  assert.equal(stitch([raw], c.attrs, R).spans[0].correlationId, 'wf-1');
});

import { scopeToWorkflow } from '../src/data/scope.js';

test('scopeToWorkflow keeps tagged spans and their descendants only', () => {
  const a = { ...DEFAULT_ATTRS, correlationId: 'wf.a,wf.b' };
  const row = (id, parent, extra = {}) => ({
    [a.traceId]: 't1',
    [a.spanId]: id,
    [a.parentId]: parent,
    ...extra
  });
  const rows = [
    row('root', null), // untagged entry, dropped
    row('tagged', 'root', { 'wf.b': 'W1' }),
    row('db', 'tagged'), // inherits from its parent
    row('deep', 'db'),
    row('other', 'root', { 'wf.a': 'W2' }), // another workflow in the same trace
    row('orphan', 'gone'),
    { ...row('x', null), [a.traceId]: 't2' }
  ];
  const logs = [
    { [a.logSpanId]: 'db' },
    { [a.logSpanId]: 'other' },
    { [a.logSpanId]: 'unknown' },
    {}
  ];
  const r = scopeToWorkflow(rows, logs, a, 'W1');
  assert.deepEqual(
    r.spans.map(s => s[a.spanId]),
    ['tagged', 'db', 'deep']
  );
  assert.equal(r.logs.length, 3);
  const kept = scopeToWorkflow(rows, logs, a, 'W1', new Set(['t2']));
  assert.ok(kept.spans.some(s => s[a.spanId] === 'x'));
});

import { traceHeading, traceLinkMap } from '../src/data/tracemap.js';

test('trace heading names the entry span; link map says which traces link to which', () => {
  const sp = (traceId, id, parentId, name, service, start) => ({
    traceId,
    id,
    parentId,
    name,
    service,
    system: service,
    start
  });
  const t1 = {
    traceId: 'a',
    spans: [sp('a', '1', null, 'orders publish', 'orders', 0), sp('a', '2', '1', 'db', 'orders', 1)]
  };
  const t2 = { traceId: 'b', spans: [sp('b', '9', null, 'order-consumed', 'accounting', 5)] };
  assert.equal(traceHeading(t1.spans).title, 'orders · orders publish');
  assert.equal(traceHeading([]).title, '');
  // span b/9 links to a/1 (Backward on b/9, Forward on a/1)
  const links = new Map([
    ['b/9', [{ direction: 'Backward', traceId: 'a', crossTrace: true }]],
    ['a/1', [{ direction: 'Forward', traceId: 'b', crossTrace: true }]]
  ]);
  const m = traceLinkMap([t1, t2], links);
  assert.deepEqual(m[0], { to: [], from: [1] });
  assert.deepEqual(m[1], { to: [0], from: [] });
});

import { spanPerformanceNrql } from '../src/data/queries.js';

test('span performance queries cover the same service and span name', () => {
  const span = { name: "orders 'publish'", service: 'checkout', durMs: 4 };
  const d = spanPerformanceNrql(DEFAULT_ATTRS, span, 'duration', 0, 60000);
  assert.match(d, /average\(`duration.ms`\)/);
  assert.match(
    d,
    /`name` = 'orders \\'publish\\'' AND `entity.name` = 'checkout' TIMESERIES AUTO SINCE 0 UNTIL 60/
  );
  assert.match(
    spanPerformanceNrql(DEFAULT_ATTRS, span, 'throughput', 0, 60000),
    /rate\(count\(\*\), 1 minute\)/
  );
  assert.match(
    spanPerformanceNrql(DEFAULT_ATTRS, span, 'histogram', 0, 60000),
    /histogram\(`duration.ms`, 12, 30\)/
  );
  assert.match(
    spanPerformanceNrql(DEFAULT_ATTRS, span, 'summary', 0, 60000),
    /percentile\(`duration.ms`, 95\)/
  );
  assert.doesNotMatch(
    spanPerformanceNrql(DEFAULT_ATTRS, { name: 'x', durMs: 1 }, 'duration', 0, 1000),
    /entity.name/
  );
});

import { scrollToRow, windowRange } from '../src/data/virtual.js';

test('windowRange picks the rows in view plus overscan; scrollToRow only moves when needed', () => {
  assert.deepEqual(windowRange(1000, 0, 290, 29, 5), { start: 0, end: 15 });
  assert.deepEqual(windowRange(1000, 2900, 290, 29, 5), { start: 95, end: 115 });
  assert.deepEqual(windowRange(20, 5000, 290, 29, 5), { start: 20, end: 20 });
  assert.equal(scrollToRow(3, 0, 290, 29), null); // already visible
  assert.equal(scrollToRow(100, 0, 290, 29), 2900 - 145); // centred
  assert.equal(scrollToRow(0, 600, 290, 29), 0);
});

import { workflowsOverTimeNrql } from '../src/data/queries.js';

test('workflows over time counts workflow ids per bucket with the table filters', () => {
  const n = workflowsOverTimeNrql(DEFAULT_ATTRS, 0, 60000, { apps: ['cart'], search: 'ab' });
  assert.match(n, /uniqueCount\(`trace.id`\) AS 'Workflows'/);
  assert.match(
    n,
    /filter\(uniqueCount\(`trace.id`\), WHERE `otel.status_code` = 'ERROR'\) AS 'With errors'/
  );
  assert.match(n, /`entity.name` IN \('cart'\)/);
  assert.match(n, /LIKE '%ab%'/);
  assert.match(n, /TIMESERIES AUTO SINCE 0 UNTIL 60$/);
});

import { unionLength } from '../src/data/latency.js';

test('unionLength counts overlapping time once, so waiting = duration - active', () => {
  assert.equal(
    unionLength([
      [0, 10],
      [5, 20],
      [30, 40]
    ]),
    30
  );
  assert.equal(unionLength([]), 0);
  // a workflow spanning 0..100 with spans over 0-20 and 80-100 is waiting 60
  assert.equal(
    100 -
      unionLength([
        [0, 20],
        [80, 100]
      ]),
    60
  );
});

import { errorSpansByAppNrql } from '../src/data/queries.js';

test('error spans by app facets on the app name', () => {
  const e = errorSpansByAppNrql(DEFAULT_ATTRS, 0, 60000, { search: 'x' });
  assert.match(e, /`otel.status_code` = 'ERROR' .*LIKE '%x%'.*FACET `entity.name` LIMIT 10/);
});

import { logsBySeverityNrql } from '../src/data/queries.js';
import { levelName, logLevelAttrs } from '../src/config/attributes.js';

test('logs by severity groups every spelling, numeric levels too, and honours the app filter', () => {
  const n = logsBySeverityNrql(DEFAULT_ATTRS, 0, 60000, { apps: ['cart'] });
  assert.match(n, /^FROM Log SELECT count\(\*\) WHERE `entity.name` IN \('cart'\) FACET if\(/);
  assert.match(n, /`level` IN \('50','60'\)/); // pino / bunyan numeric levels
  assert.match(n, /`severity.text` RLIKE '\(\?i\)warn\.\*'/);
  assert.match(n, /'Debug', 'No level'\)\)\)\) AS 'Level' TIMESERIES AUTO SINCE 0 UNTIL 60$/);
  assert.doesNotMatch(logsBySeverityNrql(DEFAULT_ATTRS, 0, 60000), /WHERE `entity/);
  assert.deepEqual(logLevelAttrs({ logLevel: 'severity.text' }), ['severity.text', 'level']);
  assert.deepEqual(['30', '50', 'warn', undefined].map(levelName), [
    'INFO',
    'ERROR',
    'WARN',
    'INFO'
  ]);
});

test('setColorOrder gives each listed name its own color and leaves others on the hash color', async () => {
  const { colorFor, hashColor, setColorOrder } = await import('../src/components/colors.js');
  const names = ['checkout', 'shipping', 'quote', 'payment', 'postgresql', 'cart'];
  setColorOrder(names);
  assert.equal(new Set(names.map(colorFor)).size, names.length);
  assert.equal(colorFor('unlisted'), hashColor('unlisted'));
  setColorOrder([]);
  assert.equal(colorFor('checkout'), hashColor('checkout'));
});

test('entity map routes a column-skipping call between cards, not through them', () => {
  const sp = (id, service, parentId) => ({
    id,
    service,
    parentId,
    start: Number(id.slice(1)),
    end: 99
  });
  // a>b>c>d chain plus a direct a>d call that skips b and c
  const m = buildEntityMap(
    [
      sp('s1', 'a'),
      sp('s2', 'b', 's1'),
      sp('s3', 'c', 's2'),
      sp('s4', 'd', 's3'),
      sp('s5', 'd', 's1')
    ],
    { colW: 240, rowH: 68, padX: 100, padY: 44, dummyH: 30 }
  );
  const skip = m.edges.find(e => e.from === 'a' && e.to === 'd');
  assert.equal(skip.via.length, 2);
  for (const v of skip.via) {
    for (const n of m.nodes) if (n.x === v.x) assert.ok(Math.abs(n.y - v.y) >= 37);
  }
  assert.equal(m.nodes.length, 4);
});

test('entity map routes a call that closes a cycle as a back edge between cards', () => {
  const sp = (id, service, parentId) => ({
    id,
    service,
    parentId,
    start: Number(id.slice(1)),
    end: 99
  });
  // a>b>c, then c calls back into a (cycle) and b calls c twice over
  const m = buildEntityMap([
    sp('s1', 'a'),
    sp('s2', 'b', 's1'),
    sp('s3', 'c', 's2'),
    sp('s4', 'a', 's3')
  ]);
  const back = m.edges.find(e => e.from === 'c' && e.to === 'a');
  assert.equal(back.back, true);
  assert.equal(back.via.length, 1);
  const x = m.nodes.find(n => n.id === 'b');
  assert.ok(Math.abs(back.via[0].y - x.y) >= 37);
  const layers = Object.fromEntries(m.nodes.map(n => [n.id, n.layer]));
  assert.deepEqual(layers, { a: 0, b: 1, c: 2 });
});

test('entity map gives each elbow its own lane inside the gap between columns', () => {
  const sp = (id, service, parentId) => ({
    id,
    service,
    parentId,
    start: Number(id.slice(1)),
    end: 99
  });
  const m = buildEntityMap(
    [
      sp('s1', 'a'),
      sp('s2', 'b', 's1'),
      sp('s3', 'c', 's1'),
      sp('s4', 'd', 's1'),
      sp('s5', 'e', 's2')
    ],
    { colW: 270, rowH: 68, padX: 100, padY: 44, dummyH: 30, cardW: 176 }
  );
  const xs = m.edges.flatMap(e => e.turns).filter(x => x != null);
  assert.ok(xs.length >= 3);
  assert.equal(new Set(xs.filter(x => x < 100 + 270)).size, xs.filter(x => x < 100 + 270).length);
  for (const x of xs) assert.ok(x > 88 && x < 100 + 270 * 2);
});

test('spanError reads the error text from New Relic or OpenTelemetry attributes', () => {
  assert.equal(spanError({ isError: false, attributes: { 'error.message': 'x' } }), null);
  assert.deepEqual(
    spanError({ isError: true, attributes: { 'error.message': 'boom', 'error.class': 'IOError' } }),
    { message: 'boom', errorClass: 'IOError', stack: '' }
  );
  const otel = spanError({
    isError: true,
    attributes: { 'otel.status_description': 'timeout', 'exception.stacktrace': 'at a' }
  });
  assert.equal(otel.message, 'timeout');
  assert.equal(otel.stack, 'at a');
  assert.deepEqual(spanError({ isError: true, attributes: { 'error.message': '  ' } }), {
    message: '',
    errorClass: '',
    stack: ''
  });
});
