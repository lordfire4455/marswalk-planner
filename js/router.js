/*
 * Safe-route finder: A* over the 20 m DEM grid.
 *
 * Edge cost = walking time (Apollo-derived speed for the grade actually walked)
 *             x a hazard factor that grows with the terrain slope of the cells.
 * Cells steeper than the chosen limit are impassable.
 * 16-direction moves keep paths close to the true shortest line.
 */
(function () {
  'use strict';
  const MM = (window.MM = window.MM || {});
  const D2R = Math.PI / 180;

  let g = null, from = null, stamp = null, closed = null, queryId = 0;
  let heapIdx = null, heapKey = null, heapN = 0;

  function ensure(n) {
    if (g && g.length === n) return;
    g = new Float32Array(n); from = new Int32Array(n);
    stamp = new Uint32Array(n); closed = new Uint32Array(n);
    heapIdx = new Int32Array(1 << 16); heapKey = new Float32Array(1 << 16);
  }
  function hpush(i, k) {
    if (heapN >= heapIdx.length) {
      const ni = new Int32Array(heapIdx.length * 2); ni.set(heapIdx); heapIdx = ni;
      const nk = new Float32Array(heapKey.length * 2); nk.set(heapKey); heapKey = nk;
    }
    let p = heapN++;
    while (p > 0) {
      const q = (p - 1) >> 1;
      if (heapKey[q] <= k) break;
      heapIdx[p] = heapIdx[q]; heapKey[p] = heapKey[q]; p = q;
    }
    heapIdx[p] = i; heapKey[p] = k;
  }
  function hpop() {
    const top = heapIdx[0];
    const li = heapIdx[--heapN], lk = heapKey[heapN];
    let p = 0;
    for (;;) {
      let c = 2 * p + 1;
      if (c >= heapN) break;
      if (c + 1 < heapN && heapKey[c + 1] < heapKey[c]) c++;
      if (heapKey[c] >= lk) break;
      heapIdx[p] = heapIdx[c]; heapKey[p] = heapKey[c]; p = c;
    }
    heapIdx[p] = li; heapKey[p] = lk;
    return top;
  }

  // 16-neighbourhood: [dc, dr, [cells that must also be passable]]
  const MOVES = [
    [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
    [2, 1, [[1, 0], [1, 1]]], [2, -1, [[1, 0], [1, -1]]], [-2, 1, [[-1, 0], [-1, 1]]], [-2, -1, [[-1, 0], [-1, -1]]],
    [1, 2, [[0, 1], [1, 1]]], [-1, 2, [[0, 1], [-1, 1]]], [1, -2, [[0, -1], [1, -1]]], [-1, -2, [[0, -1], [-1, -1]]],
  ];

  /** Nearest passable cell to (lat, lon) within ~radius cells, or -1. */
  function snap(lat, lon, maxSlope, radius) {
    const T = MM.terrain;
    const c0 = Math.round(T.colOf(lon)), r0 = Math.round(T.rowOf(lat));
    let best = -1, bd = Infinity;
    const R = radius || 8;
    for (let dr = -R; dr <= R; dr++) {
      for (let dc = -R; dc <= R; dc++) {
        const c = c0 + dc, r = r0 + dr;
        if (c < 1 || r < 1 || c >= T.w - 1 || r >= T.h - 1) continue;
        const i = r * T.w + c;
        if (T.slope[i] > maxSlope) continue;
        const d = dc * dc + dr * dr;
        if (d < bd) { bd = d; best = i; }
      }
    }
    return best;
  }

  /**
   * @returns {{ok:boolean, line?:Array<[lat,lon]>, reason?:string, expanded?:number, ms?:number}}
   */
  function route(a, b, opts) {
    const T = MM.terrain, E = MM.eva;
    const t0 = performance.now();
    const maxSlope = opts.maxSlope || 20;
    const pf = E.PACES[opts.pace || 'nominal'].factor;
    const { w, h, z, slope, dx, dy } = T;
    ensure(w * h);
    if (!T.inside(a[0], a[1]) || !T.inside(b[0], b[1])) return { ok: false, reason: 'outside' };
    const start = snap(a[0], a[1], maxSlope), goal = snap(b[0], b[1], maxSlope);
    if (start < 0) return { ok: false, reason: 'start-steep' };
    if (goal < 0) return { ok: false, reason: 'goal-steep' };

    const moves = MOVES.map(([dc, dr, mid]) => ({
      dc, dr, off: dr * w + dc, len: Math.sqrt(dc * dx * dc * dx + dr * dy * dr * dy),
      mid: mid ? mid.map(([mc, mr]) => mr * w + mc) : null,
    }));
    const gc = goal % w, gr = (goal - gc) / w;
    const vmax = E.MAX_SPEED * pf;
    const heur = (i) => {
      const c = i % w, r = (i - c) / w;
      const ex = (c - gc) * dx, ey = (r - gr) * dy;
      return Math.sqrt(ex * ex + ey * ey) / vmax;
    };
    const hazard = (s) => { const q = s / maxSlope; return 1 + 2.5 * q * q; };

    queryId++; heapN = 0;
    g[start] = 0; from[start] = -1; stamp[start] = queryId;
    hpush(start, heur(start));
    let expanded = 0, found = false;
    while (heapN > 0) {
      const cur = hpop();
      if (closed[cur] === queryId) continue;
      closed[cur] = queryId; expanded++;
      if (cur === goal) { found = true; break; }
      const cc = cur % w, cr = (cur - cc) / w;
      const gcur = g[cur], zc = z[cur], hc = hazard(slope[cur]);
      for (let m = 0; m < 16; m++) {
        const mv = moves[m];
        const nc = cc + mv.dc, nr = cr + mv.dr;
        if (nc < 1 || nr < 1 || nc >= w - 1 || nr >= h - 1) continue;
        const ni = cur + mv.off;
        if (closed[ni] === queryId) continue;
        const sn = slope[ni];
        if (sn > maxSlope) continue;
        if (mv.mid && (slope[cur + mv.mid[0]] > maxSlope || slope[cur + mv.mid[1]] > maxSlope)) continue;
        const dz = z[ni] - zc;
        const grade = Math.atan2(dz, mv.len) / D2R;
        const v = E.speed(grade, pf);
        const cost = Math.sqrt(mv.len * mv.len + dz * dz) / v * 0.5 * (hc + hazard(sn));
        const ng = gcur + cost;
        if (stamp[ni] !== queryId || ng < g[ni]) {
          g[ni] = ng; from[ni] = cur; stamp[ni] = queryId;
          hpush(ni, ng + heur(ni));
        }
      }
    }
    if (!found) return { ok: false, reason: 'no-path', expanded, ms: performance.now() - t0 };

    const cells = [];
    for (let i = goal; i !== -1; i = from[i]) cells.push(i);
    cells.reverse();
    const line = cells.map((i) => { const c = i % w, r = (i - c) / w; return [T.latOf(r), T.lonOf(c)]; });
    // Use the exact clicked points when they were not snapped away from a steep cell.
    if (T.cellOf(a[0], a[1]) === start) line[0] = [a[0], a[1]];
    if (T.cellOf(b[0], b[1]) === goal) line[line.length - 1] = [b[0], b[1]];
    return { ok: true, line, expanded, ms: performance.now() - t0, snappedStart: T.cellOf(a[0], a[1]) !== start, snappedGoal: T.cellOf(b[0], b[1]) !== goal };
  }

  MM.router = { route, snap };
})();
