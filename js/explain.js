/*
 * "Why this route?": explains, leg by leg, why the planner picked the path it did.
 *
 * Each leg of the plan is compared with two other paths between the same two points:
 *  - the straight line, which shows what lies in the way (ground steeper than the limit,
 *    steep slopes, a rise to climb), and
 *  - the quickest path the slope limit allows, found by the same A* search with the slope
 *    penalty switched off. It shows what the planner gave up (minutes) and what it bought
 *    (less steep ground).
 * Every sentence is chosen by the numbers: a reason is only given when the numbers show it.
 * All walking times come from the same Apollo model (eva.analyze on 10 m samples).
 */
(function () {
  'use strict';
  const MM = (window.MM = window.MM || {});
  const D2R = Math.PI / 180;
  const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
  const NOTICE = 45;        // seconds: smaller time differences are not worth a sentence
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  let plan = null, result = null, token = 0, showMap = false, layer = null;
  const cache = new Map();   // per-leg numbers, keyed by the leg's frozen end points, its route, limit and pace

  const km = (m) => MM.planner.km(m);
  const mins = (sec) => (Number.isFinite(sec) ? Math.max(1, Math.round(sec / 60)) + ' min' : '–');
  const deg = (v) => (v == null || !Number.isFinite(v) ? '–' : Math.round(v) + '°');
  /** A slope that is over the limit, shown so it never reads as equal to the limit (15.3°, not 15°). */
  const over = (v, lim) => (Math.round(v) <= lim ? v.toFixed(1) : Math.round(v)) + '°';
  const pctOf = (extra, base) => (base > 0 ? Math.max(0, extra) / base * 100 : 0);

  // ------------------------------------------------------------------ numbers
  /**
   * Which samples of a walked line count. Around a stop the router had to move off steep
   * ground, the last metres of the straight line are left out: nobody can walk them anyway,
   * and the leg text explains the move separately.
   */
  function zoneOf(an, skip0, skip1) {
    const s = an.samples, end = an.distance - skip1;
    return (k) => s.d[k] >= skip0 && s.d[k] <= end;
  }

  /** Stretches steeper than `limit`, in order along the line: [{d0, d1, len, max, k0, k1}]. */
  function stretches(an, limit, zone) {
    const s = an.samples, out = [];
    let cur = null;
    for (let k = 1; k < s.d.length; k++) {
      if (zone(k) && s.slope[k] > limit) {
        if (!cur) cur = { d0: s.d[k - 1], d1: s.d[k], len: 0, max: 0, k0: k - 1, k1: k };
        cur.d1 = s.d[k]; cur.k1 = k; cur.len += s.d[k] - s.d[k - 1]; cur.max = Math.max(cur.max, s.slope[k]);
      } else if (cur) { out.push(cur); cur = null; }
    }
    if (cur) out.push(cur);
    return out;
  }

  /** Distance, time, climb, slopes and the split of walking time into climbing and descending. */
  function stats(an, zone) {
    const s = an.samples;
    let max = null, steep10 = 0, steep15 = 0, up = 0, down = 0, slopeT = 0, penT = 0, tT = 0;
    for (let k = 1; k < s.d.length; k++) {
      const dt = s.t[k] - s.t[k - 1];
      if (s.grade[k] > 0.5) up += dt; else if (s.grade[k] < -0.5) down += dt;
      if (Number.isFinite(dt) && dt > 0) { slopeT += s.slope[k] * dt; penT += MM.router.hazardFactor(s.slope[k]) * dt; tT += dt; }
      if (!zone(k)) continue;
      const seg = s.d[k] - s.d[k - 1];
      if (s.slope[k] > 10) steep10 += seg;
      if (s.slope[k] > 15) steep15 += seg;
      if (max == null || s.slope[k] > max) max = s.slope[k];
    }
    return {
      dist: an.distance, walk: an.walkSeconds, ascent: an.ascent, max, steep10, steep15, up, down,
      meanSlope: tT ? slopeT / tT : 0, meanPenalty: tT ? penT / tT : 1,
    };
  }

  /** Sideways offsets of the route from the straight line a-b, with their position along it. */
  function sideways(line, a, b) {
    const T = MM.terrain;
    const bx = (b[1] - a[1]) * T.mPerDegLon, by = (b[0] - a[0]) * T.mPerDegLat, L2 = bx * bx + by * by, L = Math.sqrt(L2);
    return line.map((p) => {
      const px = (p[1] - a[1]) * T.mPerDegLon, py = (p[0] - a[0]) * T.mPerDegLat;
      const t = L2 > 0 ? Math.max(0, Math.min(1, (px * bx + py * by) / L2)) : 0;
      const dx = px - t * bx, dy = py - t * by;
      return { s: t * L, dx, dy, d: Math.sqrt(dx * dx + dy * dy) };
    });
  }
  function widest(pts) {
    const q = pts.reduce((m, p) => (p.d > m.d ? p : m), { d: 0, dx: 0, dy: 1 });
    return { d: q.d, dir: DIRS[Math.round(((Math.atan2(q.dx, q.dy) / D2R) + 360) % 360 / 45) % 8] };
  }

  /** Keep a point inside the area where the elevation model can be sampled (half a cell in from its edge). */
  function clampIn(p) {
    const T = MM.terrain;
    return [Math.max(T.latOf(T.h - 1), Math.min(T.latOf(0), p[0])), Math.max(T.lonOf(0), Math.min(T.lonOf(T.w - 1), p[1]))];
  }

  const legEnds = (leg) => [leg.a || [leg.from.lat, leg.from.lon], leg.b || [leg.to.lat, leg.to.lon]];
  function keyOf(leg, lim, pace) {
    const [a, b] = legEnds(leg);
    return [a[0], a[1], b[0], b[1]].map((v) => v.toFixed(6)).join('|') + '|' + lim + '|' + pace + '|' + leg.line.length + '|' + leg.an.distance.toFixed(1);
  }

  /** Everything we need to explain one leg (numbers only, no names, so it can be cached). */
  function legNumbers(leg, lim, pace) {
    const key = keyOf(leg, lim, pace);
    if (cache.has(key)) return cache.get(key);
    const T = MM.terrain, E = MM.eva, [a, b] = legEnds(leg), line = leg.line;
    // How far the router moved a stop, and whether it moved it because of steep ground or the map edge.
    const moved0 = leg.snappedStart ? T.dist(a[0], a[1], line[0][0], line[0][1]) : 0;
    const moved1 = leg.snapped ? T.dist(b[0], b[1], line[line.length - 1][0], line[line.length - 1][1]) : 0;
    const steepAt = (p) => { const s = T.slopeAt(p[0], p[1]); return Number.isFinite(s) && s > lim; };

    const straightAn = E.analyze([clampIn(a), clampIn(b)], { pace });
    const zone = zoneOf(straightAn, moved0 ? moved0 + 20 : 0, moved1 ? moved1 + 20 : 0);
    const straight = stats(straightAn, zone);
    const blocked = stretches(straightAn, lim, zone);
    straight.blocked = blocked.reduce((t, r) => t + r.len, 0);
    straight.blockedMax = blocked.reduce((m, r) => Math.max(m, r.max), 0);
    const steepRuns = stretches(straightAn, Math.min(15, lim), zone);

    const route = stats(leg.an, () => true);
    const fr = MM.router.route(a, b, { maxSlope: lim, pace, hazardWeight: 0 });
    let fast = null;
    if (fr.ok) { fast = stats(E.analyze(fr.line, { pace }), () => true); fast.line = fr.line; }

    const side = sideways(line, a, b);
    const main = blocked.length ? blocked.reduce((m, r) => (r.len > m.len ? r : m)) : null;   // longest closed stretch
    const n = {
      straight, route, fast, straightAn, blocked, steepRuns, main,
      first: blocked[0] || null,
      widest: widest(side),
      // How far the route passes the longest closed stretch, measured where that stretch is.
      pass: main ? widest(side.filter((p) => p.s >= main.d0 - 60 && p.s <= main.d1 + 60)) : null,
      mainLatLon: main ? [straightAn.samples.lat[(main.k0 + main.k1) >> 1], straightAn.samples.lon[(main.k0 + main.k1) >> 1]] : null,
      moved0, moved1, steep0: moved0 > 0 && steepAt(a), steep1: moved1 > 0 && steepAt(b),
    };
    if (cache.size > 300) cache.clear();
    cache.set(key, n);
    return n;
  }

  // ------------------------------------------------------------------ words
  const nameOf = (stop) => (stop.isReturn ? 'base' : stop.name);

  /** Plain-language reasons for one leg, most important first; also says what it concluded about time. */
  function reasons(n, leg, lim, i) {
    const out = [], st = n.straight, rt = n.route, f = n.fast;
    const extra = rt.dist - st.dist, pct = pctOf(extra, st.dist);
    const lenTxt = pct < 1 ? 'about as long as the straight line' : `${km(extra)} longer than the straight line (+${Math.round(pct)}%)`;
    const dt = st.walk - rt.walk;                                  // > 0: the straight line is slower
    const cause = (st.up - rt.up) >= (st.down - rt.down) ? 'climbs' : 'descents';
    const d10 = st.steep10 - rt.steep10, d15 = st.steep15 - rt.steep15;
    const open = !(st.blocked > 0);
    let timeSaid = !open || !Number.isFinite(dt);

    // 1. What lies on the straight line, and what the route does about it.
    if (!open) {
      const many = n.blocked.length > 1;
      out.push(`The straight line (${km(st.dist)}) crosses ${km(st.blocked)} of ground steeper than your ${lim}° limit (up to ${over(st.blockedMax, lim)}), ` +
        (many ? `in ${n.blocked.length} stretches, the first ${km(n.first.d0)} from ${nameOf(leg.from)}.` : `${km(n.first.d0)} from ${nameOf(leg.from)}.`) + ' The route may not step there.');
      out.push(n.pass.d >= 30
        ? `So the route passes ${many ? 'the longest stretch' : 'it'} up to ${km(n.pass.d)} to the ${n.pass.dir}, and is ${lenTxt}.`
        : `The route threads past ${many ? 'the longest stretch' : 'it'} close to the straight line, through a gap in the steep ground, and is ${lenTxt}.`);
    } else if ((n.widest.d < 20 || st.dist < 60) && Math.abs(dt) < 60 && d10 < 20) {
      out.push('The route follows the straight line to within one 20 m square: there is nothing on it worth avoiding.');
      timeSaid = true;
    } else if (pct < 3 && d10 < 20 && d15 < 20 && Math.abs(dt) < 60) {
      out.push(`The route stays close to the straight line (${pct < 1 ? 'about the same length' : '+' + Math.round(pct) + '%'}). The straight line itself is ${st.max < 10 ? 'gentle' : 'walkable'} (steepest ${deg(st.max)}), so there was little to avoid.`);
      timeSaid = true;
    } else if (d15 >= 20 || d10 >= 20) {
      const t = d15 >= 20 ? 15 : 10, sx = t === 15 ? st.steep15 : st.steep10, rx = t === 15 ? rt.steep15 : rt.steep10;
      let s = `The straight line (${km(st.dist)}) is walkable, but ${km(sx)} of it is on slopes over ${t}° (up to ${over(st.max, t)}). The route is ${lenTxt} and cuts that to ${km(rx)}`;
      if (t === 15 && rt.steep10 > st.steep10 + 20) s += `, at the cost of more moderate slope (${km(rt.steep10)} over 10° against ${km(st.steep10)})`;
      out.push(s + '.');
    } else if (dt >= 60) {
      out.push(`The straight line is walkable but slow: its steep ${cause} take a long time in a suit. The route bends up to ${km(n.widest.d)} to the ${n.widest.dir} onto easier grades, is ${lenTxt}, and saves about ${mins(dt)}.`);
      timeSaid = true;
    } else if (st.ascent - rt.ascent >= 10) {
      out.push(`The straight line climbs ${Math.round(st.ascent)} m over rising ground. The route goes round and climbs ${Math.round(rt.ascent)} m, and is ${lenTxt}.`);
    } else if (dt > -60) {
      const gentler = rt.steep10 <= st.steep10 && rt.max <= st.max && rt.meanSlope < st.meanSlope;
      out.push(`The route bends up to ${km(n.widest.d)} to the ${n.widest.dir} and is ${lenTxt}. ${gentler ? 'It finds slightly gentler ground there, but the' : 'The'} difference from the straight line is small: similar slopes and about the same walking time.`);
      timeSaid = true;
    } else {
      const ms = (v) => (Math.abs(rt.meanSlope - st.meanSlope) < 1 ? v.toFixed(1) : Math.round(v)) + '°';
      out.push(rt.meanPenalty < st.meanPenalty - 0.01
        ? `The route bends up to ${km(n.widest.d)} to the ${n.widest.dir} and is ${lenTxt}. It walks about ${mins(-dt)} longer than the straight line would, but on gentler ground on average (mean slope ${ms(rt.meanSlope)} against ${ms(st.meanSlope)}), which the slope penalty rewards.`
        : `The route bends up to ${km(n.widest.d)} to the ${n.widest.dir} and is ${lenTxt}, about ${mins(-dt)} slower than the straight line on similar ground. At this size the 20 m grid can hardly tell the two apart.`);
      timeSaid = true;
    }
    if (!timeSaid) {
      if (dt >= 60) out.push(`It is also ${mins(dt)} quicker than walking the straight line, because steep ${cause} are slow in a suit.`);
      else if (dt <= -60) out.push(`That costs about ${mins(-dt)} of extra walking.`);
    }

    // 2. What the planner traded against the quickest path the limit allows.
    let saving = 0, noQuicker = false;
    const save = f ? rt.walk - f.walk : 0;
    if (f && save >= NOTICE) {
      saving = save;
      const t = f.steep15 - rt.steep15 >= 20 ? 15 : 10;
      const fx = t === 15 ? f.steep15 : f.steep10, rx = t === 15 ? rt.steep15 : rt.steep10;
      if (fx - rx >= 10) {
        out.push(`The quickest path within the limit would save about ${mins(save)}, but it spends ${km(fx)} on slopes over ${t}° (steepest ${deg(f.max)}) against ${km(rx)} on this route. The planner gives up that time to keep the crew on gentler ground.`);
      } else if (rt.meanPenalty < f.meanPenalty - 0.01) {
        const ms = (v) => (Math.abs(rt.meanSlope - f.meanSlope) < 1 ? v.toFixed(1) : Math.round(v)) + '°';
        out.push(`The quickest path within the limit would save about ${mins(save)} on similar ground (steepest ${deg(f.max)} against ${deg(rt.max)}), but this route is gentler on average (mean slope ${ms(rt.meanSlope)} against ${ms(f.meanSlope)}), which the slope penalty rewards.`);
      } else {
        out.push(`The quickest path within the limit would save about ${mins(save)} on similar ground. At this size the difference is within what the 20 m grid can resolve.`);
      }
    } else {
      const best = Math.min(f ? f.walk : Infinity, open ? st.walk : Infinity);
      if (rt.walk - best < NOTICE) { noQuicker = true; out.push(`No path within the ${lim}° limit is noticeably quicker, so this route costs no time for its safety margin.`); }
    }

    // 3. Stops the router had to move.
    const moved = (stop, m, steep, verb) => steep
      ? `${stop.name} itself sits on ground steeper than ${lim}°, so the route ${verb} the nearest safe spot, ${km(m)} away.`
      : `${stop.name} is at the very edge of the elevation model, so the route ${verb} the nearest square it can use, ${km(m)} away.`;
    if (i === 0 && n.moved0 > 0) out.push(moved(leg.from, n.moved0, n.steep0, 'leaves from'));
    if (n.moved1 > 0 && !leg.to.isReturn) out.push(moved(leg.to, n.moved1, n.steep1, 'ends this leg at'));
    return { text: out, saving, noQuicker };
  }

  /** Explanations for every leg of a plan, plus a one-paragraph summary. */
  function analyze(p) {
    if (!p || !p.ok) return null;
    const S = MM.planner.settings();
    const lim = p.slopeLimit != null ? p.slopeLimit : S.maxSlope, pace = p.pace || S.pace;
    const legs = p.legs.map((leg, i) => {
      const n = legNumbers(leg, lim, pace), r = reasons(n, leg, lim, i);
      const nm = (s) => nameOf(s).replace(/^base$/, 'Base');
      return { i, leg, n, title: (i + 1) + ' · ' + nm(leg.from) + ' → ' + nm(leg.to), reasons: r.text, saving: r.saving, noQuicker: r.noQuicker };
    });
    let straight = 0, extra = 0, given = 0, av10 = 0, av15 = 0, savingLegs = 0;
    const blockedLegs = legs.filter((l) => l.n.straight.blocked > 0).length;
    const steepStop = legs.some((l) => l.n.steep0 || (l.n.steep1 && !l.leg.to.isReturn));
    for (const l of legs) {
      straight += l.n.straight.dist; extra += l.n.route.dist - l.n.straight.dist;
      if (l.saving > 0) {
        savingLegs++; given += l.saving;
        av10 += Math.max(0, l.n.fast.steep10 - l.n.route.steep10); av15 += Math.max(0, l.n.fast.steep15 - l.n.route.steep15);
      }
    }
    const nl = legs.length, pct = pctOf(extra, straight);
    let summary = blockedLegs
      ? `On ${blockedLegs} of ${nl} leg${nl > 1 ? 's' : ''} the straight line runs into ground steeper than your ${lim}° limit, so the route has to go round. `
      : `No straight line between your stops crosses ground steeper than your ${lim}° limit${steepStop ? ', apart from the steep ground right at a stop' : ''}. `;
    summary += pct < 1 ? 'Overall the route is about as long as straight lines between the stops' : `Overall the route is ${Math.round(pct)}% longer than straight lines between the stops`;
    if (savingLegs) {
      const t = av15 >= 20 ? 15 : 10, av = t === 15 ? av15 : av10;
      summary += `. On ${savingLegs} leg${savingLegs > 1 ? 's' : ''} it gives up about ${mins(given)} against the quickest path the limit allows` + (av >= 10 ? `, to spend ${km(av)} less on slopes over ${t}°.` : '.');
    } else summary += legs.every((l) => l.noQuicker) ? ', and no path the limit allows is noticeably quicker.' : '.';
    return { legs, summary, lim };
  }

  // ------------------------------------------------------------------ panel
  const showFast = (n) => n.fast && n.route.walk - n.fast.walk >= NOTICE;

  function table(n, lim) {
    const st = n.straight, closed = st.blocked > 0;
    const row = (label, s, cls, steepest) => `<tr class="${cls}"><th>${label}</th><td>${km(s.dist)}</td><td>${closed && cls === 'st' ? '<b class="no">closed</b>' : mins(s.walk)}</td>` +
      `<td>${km(s.steep10)}</td>${steepest}</tr>`;
    return `<table class="why-tbl"><thead><tr><th></th><th>Distance</th><th>Walking</th><th>Over 10°</th><th>Steepest</th></tr></thead><tbody>` +
      row('This route', n.route, 'me', `<td>${deg(n.route.max)}</td>`) +
      row('Straight line', st, 'st', closed ? `<td class="no">${over(st.blockedMax, lim)}</td>` : `<td>${deg(st.max)}</td>`) +
      (showFast(n) ? row('Quickest path', n.fast, 'fa', `<td>${deg(n.fast.max)}</td>`) : '') + '</tbody></table>';
  }

  function render(progress) {
    const blk = $('why-block');
    if (!blk) return;
    if (!plan || !plan.ok) { blk.hidden = true; clearMap(); return; }
    blk.hidden = false;
    if (!result) { $('why-body').innerHTML = `<div class="hint">Working out why…${progress ? ' ' + esc(progress) : ''}</div>`; return; }
    $('why-body').innerHTML = `<p class="why-sum">${esc(result.summary)}</p>` + result.legs.map((l) => `
      <div class="why-leg">
        <div class="why-h"><b>${esc(l.title)}</b><span>${km(l.n.route.dist)}</span></div>
        ${l.reasons.map((r) => `<p>${esc(r)}</p>`).join('')}
        ${table(l.n, result.lim)}
      </div>`).join('');
  }

  // ------------------------------------------------------------------ map
  function clearMap() { if (layer) { MM.map.removeLayer(layer); layer = null; } }

  function drawMap() {
    clearMap();
    if (!showMap || !result) return;
    layer = L.layerGroup().addTo(MM.map);
    for (const l of result.legs) {
      const [a, b] = legEnds(l.leg), n = l.n, s = n.straightAn.samples, closed = n.straight.blocked > 0;
      layer.addLayer(L.polyline([a, b], { color: '#ffffff', weight: 2, opacity: 0.9, dashArray: '10 8', pane: 'tracks', interactive: false }));
      for (const r of closed ? n.blocked : n.steepRuns) {
        const pts = []; for (let k = r.k0; k <= r.k1; k++) pts.push([s.lat[k], s.lon[k]]);
        layer.addLayer(L.polyline(pts, { color: closed ? '#ef476f' : '#ff8c42', weight: 6, opacity: 0.95, pane: 'tracks', lineCap: 'round', interactive: false }));
      }
      // Interactive bits must not let a click through to the map, or the click would add a stop.
      if (n.main) {
        layer.addLayer(L.circleMarker(n.mainLatLon, { radius: 6, color: '#fff', weight: 2, fillColor: '#ef476f', fillOpacity: 1, pane: 'pins', bubblingMouseEvents: false })
          .bindTooltip(`${n.blocked.length > 1 ? 'Longest closed stretch' : 'Closed stretch'} on the straight line: up to ${over(n.main.max, result.lim)} (limit ${result.lim}°)`, { direction: 'top' }));
      }
      if (showFast(n)) {
        layer.addLayer(L.polyline(n.fast.line, { color: '#59c3ff', weight: 3, opacity: 0.95, dashArray: '2 7', lineCap: 'round', pane: 'tracks', bubblingMouseEvents: false })
          .bindTooltip(`Quickest path within the ${result.lim}° limit: ${km(n.fast.dist)}, ${mins(n.fast.walk)} walking, ${km(n.fast.steep10)} over 10°`, { sticky: true }));
      }
    }
  }

  function setShowMap(on) {
    showMap = !!on;
    const b = $('why-map');
    if (b) { b.textContent = showMap ? 'Hide from map' : 'Show on map'; b.classList.toggle('on', showMap); }
    const key = $('why-key'); if (key) key.hidden = !showMap;
    drawMap();
    if (showMap && MM.app && MM.app.closePanelOnMobile) MM.app.closePanelOnMobile();   // on a phone the panel covers the map
  }

  // ------------------------------------------------------------------ wiring
  /**
   * Called by the planner after every new plan. Legs already explained are reused at once.
   * New legs are worked out one per tick after a short pause, so the route appears first and
   * the page can repaint between legs (the quickest-path search on a long leg takes a moment).
   */
  function update(p) {
    plan = p; result = null;
    const t = ++token;
    if (!p || !p.ok) { render(); return; }
    const lim = p.slopeLimit != null ? p.slopeLimit : MM.planner.settings().maxSlope, pace = p.pace || MM.planner.settings().pace;
    if (p.legs.every((l) => cache.has(keyOf(l, lim, pace)))) {
      try { result = analyze(p); } catch (e) { console.error(e); }
      render(); drawMap(); return;
    }
    clearMap(); render();
    let i = 0;
    const step = () => {
      if (t !== token) return;
      try {
        if (i < p.legs.length) { render(`(leg ${i + 1} of ${p.legs.length})`); legNumbers(p.legs[i], lim, pace); i++; setTimeout(step, 0); return; }
        result = analyze(p);
      } catch (e) { console.error(e); $('why-body').innerHTML = '<div class="hint">Could not explain this route.</div>'; return; }
      render(); drawMap();
    };
    setTimeout(step, 60);
  }

  function init() {
    const b = $('why-map');
    if (b) b.addEventListener('click', () => setShowMap(!showMap));
  }

  MM.explain = { init, update, analyze, setShowMap };
})();
