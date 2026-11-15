/*
 * Checks the route planner against Perseverance's real drive.
 *
 * The rover's traverse (NASA/JPL "Where is Perseverance?") is cut into stretches of about
 * 1 km. For each stretch the planner routes from its start to its end on the same CTX DEM,
 * and the two paths are compared: how much of the planned route lies within 100 m of the
 * path JPL's rover drivers actually chose, the length of each, and the steepest ground each
 * one crosses. Writes data/validation.js.   Run: node tools/validate_routes.js
 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const LIMIT = Number(process.env.LIMIT || 25);   // slope limit for the validation runs (degrees)
const ctx = { window: {}, console, performance, DecompressionStream, Blob, Response, Uint8Array, atob, setTimeout };
ctx.window = ctx; vm.createContext(ctx);
for (const f of ['data/dem.js', 'data/rover.js', 'js/terrain.js', 'js/eva.js', 'js/router.js']) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });

(async () => {
  const MM = ctx.MM, T = MM.terrain;
  await T.load();
  const tr = ctx.MM_ROVER.traverse.map(([lon, lat]) => [lat, lon]).filter((p) => T.inside(p[0], p[1]));
  const D = (a, b) => T.dist(a[0], a[1], b[0], b[1]);
  const len = (l) => l.reduce((s, p, i) => (i ? s + D(l[i - 1], p) : 0), 0);
  // densify the rover path to 10 m so "distance to the rover path" is accurate
  const dense = (l, step) => { const o = [l[0]]; for (let i = 1; i < l.length; i++) { const d = D(l[i - 1], l[i]), n = Math.max(1, Math.ceil(d / step)); for (let k = 1; k <= n; k++) o.push([l[i - 1][0] + (l[i][0] - l[i - 1][0]) * k / n, l[i - 1][1] + (l[i][1] - l[i - 1][1]) * k / n]); } return o; };
  const maxSlope = (l) => Math.max(...dense(l, 10).map((p) => T.slopeAt(p[0], p[1])));
  const steepShare = (l, lim) => { const d = dense(l, 10); return d.filter((p) => T.slopeAt(p[0], p[1]) > lim).length / d.length; };

  // stretches of ~1 km of driving, end to end
  const STRETCH = 1000, segs = [];
  let start = 0, acc = 0;
  for (let i = 1; i < tr.length; i++) {
    const d = D(tr[i - 1], tr[i]);
    if (d > 300) { start = i; acc = 0; continue; }          // a gap in the record: start over
    acc += d;
    if (acc >= STRETCH) { segs.push(tr.slice(start, i + 1)); start = i; acc = 0; }
  }
  const out = [];
  for (const rov of segs) {
    const a = rov[0], b = rov[rov.length - 1];
    if (D(a, b) < 300) continue;                              // loops and turnarounds say little about route choice
    const r = MM.router.route(a, b, { maxSlope: LIMIT, pace: 'nominal', hazardK: 2.5 });
    if (!r.ok) { out.push({ ok: false, reason: r.reason }); continue; }
    const rd = dense(rov, 10), pd = dense(r.line, 10);
    const near = pd.filter((p) => { for (const q of rd) if (D(p, q) <= 100) return true; return false; }).length / pd.length;
    const meanOff = pd.reduce((s, p) => { let m = Infinity; for (const q of rd) m = Math.min(m, D(p, q)); return s + m; }, 0) / pd.length;
    out.push({ ok: true, from: a.map((v) => +v.toFixed(5)), to: b.map((v) => +v.toFixed(5)), straight: Math.round(D(a, b)),
      rover_m: Math.round(len(rov)), plan_m: Math.round(len(r.line)), within100: +near.toFixed(3), mean_offset_m: Math.round(meanOff),
      rover_max_slope: +maxSlope(rov).toFixed(1), plan_max_slope: +maxSlope(r.line).toFixed(1),
      rover_steep15: +steepShare(rov, 15).toFixed(3), plan_steep15: +steepShare(r.line, 15).toFixed(3),
      straight_over25_m: Math.round(steepShare([a, b], 25) * D(a, b)), straight_over15_m: Math.round(steepShare([a, b], 15) * D(a, b)),
      plan_over25_m: Math.round(steepShare(r.line, 25) * len(r.line)),
      line: r.line.filter((p, i, l) => i % 3 === 0 || i === l.length - 1).map((p) => [+p[0].toFixed(5), +p[1].toFixed(5)]) });
  }
  const ok = out.filter((s) => s.ok);
  const med = (k) => { const v = ok.map((s) => s[k]).sort((x, y) => x - y); return v[Math.floor(v.length / 2)]; };
  const sum = (k) => ok.reduce((s, x) => s + x[k], 0);
  const summary = {
    stretches: ok.length, failed: out.length - ok.length,
    rover_km: +(sum('rover_m') / 1000).toFixed(1), plan_km: +(sum('plan_m') / 1000).toFixed(1),
    within100_median: med('within100'), mean_offset_median_m: med('mean_offset_m'),
    within100_overall: +(ok.reduce((s, x) => s + x.within100 * x.plan_m, 0) / sum('plan_m')).toFixed(3),
    length_ratio: +(sum('plan_m') / sum('rover_m')).toFixed(3),
    rover_steep15: +(ok.reduce((s, x) => s + x.rover_steep15 * x.rover_m, 0) / sum('rover_m')).toFixed(3),
    plan_steep15: +(ok.reduce((s, x) => s + x.plan_steep15 * x.plan_m, 0) / sum('plan_m')).toFixed(3),
    straight_km: +(sum('straight') / 1000).toFixed(1), straight_over25_m: sum('straight_over25_m'), straight_over15_m: sum('straight_over15_m'),
    straight_blocked: ok.filter((x) => x.straight_over25_m > 0).length, plan_over25_m: sum('plan_over25_m'),
  };
  const doc = { generated: new Date().toISOString().slice(0, 10), method: 'Perseverance traverse cut into ~1 km stretches (gaps over 300 m and stretches that end within 300 m of their start skipped). Planner run start to end on the CTX 20 m DEM, slope limit ' + LIMIT + '°, safest weighting. "Within 100 m" is the share of the planned route lying within 100 m of the rover\'s actual path.', summary, stretches: out };
  fs.writeFileSync(path.join(root, 'data/validation.js'), '/* Generated by tools/validate_routes.js - do not edit by hand. */\nwindow.MM_VALIDATION = ' + JSON.stringify(doc) + ';\n');
  console.log(JSON.stringify(summary, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
