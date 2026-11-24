// Entity map: services (and databases) in a workflow and the calls between
// them, derived from parent/child spans. Pure functions.

const dbId = system => `db:${system}`;
const nameOf = s => s.service || s.system;

export function spanInNode(span, nodeId) {
  if (!nodeId) return true;
  if (nodeId.startsWith('db:')) return span.dbSystem === nodeId.slice(3);
  return nameOf(span) === nodeId;
}

// Returns { nodes, edges, width, height }. Nodes carry layout (x, y).
export function buildEntityMap(spans, opts = {}) {
  const { colW = 210, rowH = 100, padX = 70, padY = 55, dummyH = 30, cardW = 176 } = opts;
  const byId = new Map(spans.map(s => [s.id, s]));
  const nodes = new Map();
  const edges = new Map();

  const node = (id, name, kind, s) => {
    if (!nodes.has(id)) {
      nodes.set(id, {
        id,
        name,
        kind,
        guid: null,
        spans: 0,
        errors: 0,
        firstStart: s.start,
        system: s.system
      });
    }
    const n = nodes.get(id);
    n.firstStart = Math.min(n.firstStart, s.start);
    return n;
  };
  const edge = (from, to, s) => {
    const k = `${from}>${to}`;
    if (!edges.has(k)) edges.set(k, { from, to, calls: 0, errors: 0 });
    const e = edges.get(k);
    e.calls += 1;
    if (s.isError) e.errors += 1;
  };

  for (const s of spans) {
    const n = node(nameOf(s), nameOf(s), 'service', s);
    n.spans += 1;
    if (s.isError) n.errors += 1;
    if (!n.guid && s.entityGuid) n.guid = s.entityGuid;
    if (s.dbSystem) {
      const d = node(dbId(s.dbSystem), s.dbSystem, 'database', s);
      d.spans += 1;
      if (s.isError) d.errors += 1;
      edge(nameOf(s), d.id, s);
    }
    const p = s.parentId && byId.get(s.parentId);
    if (p && nameOf(p) !== nameOf(s)) edge(nameOf(p), nameOf(s), s);
  }

  // Calls that close a cycle (a worker calling back into the server that
  // started it) are found by DFS from the earliest entity and set aside, so
  // the remaining calls layer left to right; the back calls are routed after.
  const list = [...nodes.values()];
  const out = new Map(list.map(n => [n.id, []]));
  for (const e of edges.values()) out.get(e.from).push(e);
  const state = new Map();
  const back = new Set();
  const visit = id => {
    state.set(id, 1);
    for (const e of out.get(id)) {
      if (state.get(e.to) === 1) back.add(e);
      else if (!state.get(e.to)) visit(e.to);
    }
    state.set(id, 2);
  };
  [...list]
    .sort((a, b) => a.firstStart - b.firstStart || a.id.localeCompare(b.id))
    .forEach(n => {
      if (!state.get(n.id)) visit(n.id);
    });
  const fwd = [...edges.values()].filter(e => !back.has(e));

  // Layer = longest path from a source over the forward calls.
  const layer = new Map(list.map(n => [n.id, 0]));
  for (let pass = 0; pass < list.length; pass++) {
    let changed = false;
    for (const e of fwd) {
      if (layer.get(e.from) + 1 > layer.get(e.to)) {
        layer.set(e.to, layer.get(e.from) + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }

  // A node nothing calls (a trace root, e.g. a linked consumer) sits right
  // before its earliest caller target instead of at column 0, so its edges
  // stay short. Then shift so the first column is 0.
  const called = new Set(fwd.map(e => e.to));
  for (const n of list) {
    if (called.has(n.id)) continue;
    const targets = fwd.filter(e => e.from === n.id).map(e => layer.get(e.to));
    if (targets.length) layer.set(n.id, Math.max(0, Math.min(...targets) - 1));
  }
  const minLayer = Math.min(...layer.values());
  for (const [id, l] of layer) layer.set(id, l - minLayer);

  const cols = new Map();
  list
    .sort((a, b) => a.firstStart - b.firstStart || a.id.localeCompare(b.id))
    .forEach(n => {
      const l = layer.get(n.id);
      if (!cols.has(l)) cols.set(l, []);
      cols.get(l).push(n);
    });

  // A call that skips columns gets a waypoint in each column it crosses, so
  // it is routed between cards instead of through them.
  const links = [];
  const route = new Map();
  for (const [k, e] of edges) {
    // A back call is routed as the forward call it reverses, drawn in reverse.
    const isBack = back.has(e);
    const [u, v] = isBack ? [e.to, e.from] : [e.from, e.to];
    const via = [];
    let prev = u;
    for (let l = layer.get(u) + 1; l < layer.get(v); l++) {
      const d = { id: `~${k}~${l}`, dummy: true };
      layer.set(d.id, l);
      if (!cols.has(l)) cols.set(l, []);
      cols.get(l).push(d);
      via.push(d);
      links.push([prev, d.id]);
      prev = d.id;
    }
    links.push([prev, v]);
    e.back = isBack;
    route.set(k, isBack ? via.reverse() : via);
  }

  // Fewer crossings: sweep columns right/left ordering each node by the mean
  // position of its neighbours in the adjacent column (barycenter).
  const nbrs = new Map([...layer.keys()].map(id => [id, []]));
  for (const [u, v] of links) {
    nbrs.get(u).push(v);
    nbrs.get(v).push(u);
  }
  const keys = [...cols.keys()].sort((x, y) => x - y);
  const pos = new Map();
  const index = () => cols.forEach(col => col.forEach((n, i) => pos.set(n.id, i)));
  index();
  const reorder = (l, from) => {
    const col = cols.get(l);
    const score = n => {
      const p = nbrs
        .get(n.id)
        .filter(id => layer.get(id) === from)
        .map(id => pos.get(id));
      return p.length ? p.reduce((a, b) => a + b, 0) / p.length : pos.get(n.id);
    };
    const sc = new Map(col.map(n => [n.id, score(n)]));
    col.sort((a, b) => sc.get(a.id) - sc.get(b.id));
    index();
  };
  for (let sweep = 0; sweep < 4; sweep++) {
    for (let i = 1; i < keys.length; i++) reorder(keys[i], keys[i - 1]);
    for (let i = keys.length - 2; i >= 0; i--) reorder(keys[i], keys[i + 1]);
  }

  // Stack each column by card height (waypoints take a thin slot), centred.
  const hOf = n => (n.dummy ? dummyH : rowH);
  const offs = new Map();
  const ext = new Map();
  for (const [l, col] of cols) {
    let y = 0;
    col.forEach((n, i) => {
      if (i) y += (hOf(col[i - 1]) + hOf(n)) / 2;
      offs.set(n.id, y);
    });
    ext.set(l, y);
  }
  const span = Math.max(0, ...ext.values());
  const height = padY * 2 + span;
  for (const [l, col] of cols) {
    for (const n of col) {
      n.layer = l;
      n.x = padX + l * colW;
      n.y = padY + (span - ext.get(l)) / 2 + offs.get(n.id);
    }
  }
  for (const [k, e] of edges) e.via = route.get(k).map(d => ({ x: d.x, y: d.y }));

  // Every elbow gets its own vertical lane in the gap between two columns, so
  // lines from the same caller do not merge into one trunk. Order keeps lanes
  // from crossing: going down, the line that starts lower turns first (left).
  const gaps = new Map();
  for (const e of edges.values()) {
    const pts = [nodes.get(e.from), ...e.via, nodes.get(e.to)];
    e.turns = new Array(pts.length - 1).fill(null);
    for (let i = 0; i < e.turns.length; i++) {
      const [p, q] = [pts[i], pts[i + 1]];
      if (p.y === q.y) continue;
      const [l, r] = p.x < q.x ? [p, q] : [q, p];
      const gx = Math.min(p.x, q.x);
      if (!gaps.has(gx)) gaps.set(gx, []);
      gaps.get(gx).push({ e, i, L: l.y, R: r.y });
    }
  }
  for (const [gx, items] of gaps) {
    const down = items.filter(t => t.R > t.L).sort((a, b) => b.L - a.L || b.R - a.R);
    const up = items.filter(t => t.R < t.L).sort((a, b) => a.L - b.L || a.R - b.R);
    const ordered = down.concat(up);
    const gl = gx + cardW / 2;
    const gr = gx + colW - cardW / 2;
    const step = ordered.length > 1 ? Math.min(9, (gr - gl - 16) / (ordered.length - 1)) : 0;
    const start = (gl + gr) / 2 - (step * (ordered.length - 1)) / 2;
    ordered.forEach((t, n) => {
      t.e.turns[t.i] = start + n * step;
    });
  }
  const width = padX * 2 + Math.max(0, ...[...cols.keys()]) * colW;
  return { nodes: list, edges: [...edges.values()], width, height };
}
