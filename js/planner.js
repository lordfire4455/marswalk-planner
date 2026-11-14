/*
 * Marswalk planner: stops, safest-route search, EVA timeline, go / no-go checks,
 * elevation profile and "science along the way".
 */
(function () {
  'use strict';
  const MM = (window.MM = window.MM || {});
  const EGRESS_MIN = 15, INGRESS_MIN = 15, RESERVE_MIN = 30;
  const KCAL_PER_L_O2 = 4.85, O2_G_PER_L = 1.429;

  const O2_RESERVE = 0.25;            // fraction of suit oxygen kept back for emergencies
  // Route priority. The hazard weight scales how strongly the route finder avoids sloping ground.
  const MODES = { safe: { label: 'Safest', k: 2.5 }, fast: { label: 'Fastest', k: 0.15 } };

  const S = { stops: [], maxSlope: 20, pace: 'nominal', startH: 9, limitH: 8, roundTrip: true, mode: 'safe', crew: 2, o2Kg: 0.6 };
  let plan = null, legCache = new Map(), layer = null, hoverMarker = null, computeToken = 0, cmp = null, cmpLayer = null;
  const $ = (id) => document.getElementById(id);
  const hm = (sec) => { const m = Math.round(sec / 60); return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min'; };
  const hmShort = (sec) => { const m = Math.round(sec / 60); return m < 60 ? m + ' min' : Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') + ' h'; };
  const km = (m) => (m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m');
  const BASE_ICO = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M2.5 7.2 8 2.8l5.5 4.4v6H2.5z"/><path d="M6.4 13.2V9.6h3.2v3.6"/></svg>';
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ------------------------------------------------------------------ stops
  function nameFor(i) { return i === 0 ? 'Base' : 'Point ' + i; }
  function relabel() { S.stops.forEach((s, i) => { if (!s.targetId && !s.custom) s.name = nameFor(i); }); }

  function addPoint(lat, lon, extra) {
    const T = MM.terrain;
    if (!T.inside(lat, lon)) { MM.toast('That spot is outside the elevation model (the dashed yellow box), so no safe route can be computed there.', 'warn'); return false; }
    S.stops.push(Object.assign({ lat, lon, name: '', stopMin: S.stops.length === 0 ? 0 : 20 }, extra || {}));
    relabel(); compute(); return true;
  }
  function addTarget(id) {
    const t = MM.science.get(id); if (!t) return;
    if (S.stops.some((s) => s.targetId === id)) { MM.toast(t.name + ' is already on your route.', 'info'); return; }
    addPoint(t.lat, t.lon, { targetId: id, name: t.name, stopMin: S.stops.length === 0 ? 0 : t.stop_min });
  }
  function insertTarget(id, afterIdx) {
    const t = MM.science.get(id); if (!t) return;
    S.stops.splice(afterIdx + 1, 0, { lat: t.lat, lon: t.lon, targetId: id, name: t.name, stopMin: t.stop_min });
    relabel(); compute();
  }
  function removeStop(i) { S.stops.splice(i, 1); if (S.stops[0]) S.stops[0].stopMin = 0; relabel(); compute(); }
  function moveStop(i, d) {
    const j = i + d; if (j < 0 || j >= S.stops.length) return;
    const t = S.stops[i]; S.stops[i] = S.stops[j]; S.stops[j] = t;
    if (S.stops[0].stopMin) { S.stops[0]._keep = S.stops[0].stopMin; S.stops[0].stopMin = 0; }
    S.stops.forEach((s, k) => { if (k > 0 && !s.stopMin) s.stopMin = s._keep || (s.targetId ? MM.science.get(s.targetId).stop_min : 20); });
    relabel(); compute();
  }
  function clear() { S.stops = []; compute(); }

  // ------------------------------------------------------------------ routing
  const fieldVersion = () => (MM.field ? MM.field.version() : 0);
  function legKey(a, b, mode) { return [a.lat.toFixed(6), a.lon.toFixed(6), b.lat.toFixed(6), b.lon.toFixed(6), S.maxSlope, S.pace, mode, fieldVersion()].join('|'); }
  function legFor(a, b, mode) {
    const k = legKey(a, b, mode);
    if (legCache.has(k)) return legCache.get(k);
    const r = MM.router.route([a.lat, a.lon], [b.lat, b.lon], { maxSlope: S.maxSlope, pace: S.pace, hazardK: MODES[mode].k, blocked: MM.field ? MM.field.mask() : null });
    if (legCache.size > 200) legCache.clear();
    legCache.set(k, r);
    return r;
  }

  function compute() {
    const token = ++computeToken;
    if (S.stops.length < 2) { plan = null; renderAll(); return Promise.resolve(); }
    $('busy').hidden = false;
    return new Promise((resolve) => setTimeout(() => {
      if (token !== computeToken) return resolve();
      try { plan = build(); } catch (e) { console.error(e); plan = null; MM.toast('Route calculation failed: ' + e.message, 'error'); }
      $('busy').hidden = true;
      renderAll(); resolve();
    }, 30));
  }

  /** Build a full plan for a list of stops. Pure: does not touch the current plan, so it also serves the route comparison. */
  function build(stops, mode) {
    stops = stops || S.stops; mode = mode || S.mode;
    const base = stops[0];
    const seq = stops.slice();
    if (S.roundTrip) seq.push(Object.assign({}, base, { isReturn: true, stopMin: 0, name: 'Back at base' }));
    const legs = [];
    const m = { d: [], z: [], slope: [], cls: [], los: [], lat: [], lon: [], clock: [], leg: [] };
    let dist = 0, clock = EGRESS_MIN * 60, walk = 0, energy = 0, up = 0, down = 0, maxSlope = 0, sci = 0;
    const classDist = new Array(MM.terrain.CLASSES.length).fill(0);
    const stopInfo = [{ stop: base, d: 0, arrive: 0, depart: clock, idx: 0 }];
    let ok = true, fail = null;
    for (let i = 0; i < seq.length - 1; i++) {
      const a = seq[i], b = seq[i + 1];
      const r = legFor(a, b, mode);
      if (!r.ok) {
        ok = false; fail = fail || { from: a, to: b, reason: r.reason };
        legs.push({ ok: false, from: a, to: b, line: [[a.lat, a.lon], [b.lat, b.lon]], reason: r.reason });
        stopInfo.push({ stop: b, d: dist, arrive: null, depart: null, idx: m.d.length });
        continue;
      }
      const an = MM.eva.analyze(r.line, { pace: S.pace, base: [base.lat, base.lon] });
      const sm = an.samples;
      for (let k = (m.d.length ? 1 : 0); k < sm.d.length; k++) {
        m.d.push(dist + sm.d[k]); m.z.push(sm.z[k]); m.slope.push(sm.slope[k]); m.cls.push(sm.cls[k]); m.los.push(sm.los[k]);
        m.lat.push(sm.lat[k]); m.lon.push(sm.lon[k]); m.clock.push(clock + sm.t[k]); m.leg.push(i);
      }
      dist += an.distance; clock += an.walkSeconds; walk += an.walkSeconds; energy += an.energyJ;
      up += an.ascent; down += an.descent; maxSlope = Math.max(maxSlope, an.maxSlope);
      an.classDist.forEach((v, k) => { classDist[k] += v; });
      const arrive = clock;
      const stay = (b.stopMin || 0) * 60;
      clock += stay; sci += stay; energy += stay * MM.eva.REST_POWER;
      legs.push({ ok: true, from: a, to: b, line: r.line, an, snapped: r.snappedGoal });
      stopInfo.push({ stop: b, d: dist, arrive, depart: clock, idx: m.d.length - 1 });
    }
    const overhead = (EGRESS_MIN + INGRESS_MIN) * 60;
    energy += overhead * MM.eva.REST_POWER;
    const total = clock + INGRESS_MIN * 60;
    let losOk = 0, far = 0, farIdx = 0;
    for (let k = 0; k < m.d.length; k++) {
      if (m.los[k]) losOk++;
      const r = MM.terrain.dist(base.lat, base.lon, m.lat[k], m.lon[k]);
      if (r > far) { far = r; farIdx = k; }
    }
    const kcal = energy / 4184;
    const p = {
      ok, fail, legs, m, stopInfo, base, stops, mode, roundTrip: S.roundTrip,
      distance: dist, walkSeconds: walk, scienceSeconds: sci, overheadSeconds: overhead, totalSeconds: total,
      ascent: up, descent: down, maxSlope, classDist, energyKcal: kcal, avgWatts: total ? energy / total : 0,
      o2Grams: kcal / KCAL_PER_L_O2 * O2_G_PER_L, losFraction: m.d.length ? losOk / m.d.length : 1,
      farthest: far, farthestClock: m.clock[farIdx] || 0,
    };
    p.checks = evaluate(p);
    p.verdict = p.checks.reduce((w, c) => Math.max(w, c.level), 0);
    return p;
  }

  // ------------------------------------------------------------------ go / no-go
  function evaluate(p) {
    const C = MM.conditions.current(), m = C.mars, out = [];
    const add = (level, title, text) => out.push({ level, title, text });
    const zones = MM.field ? MM.field.zones().length + MM.field.observations().filter((o) => o.avoid > 0).length : 0;
    if (!p.ok) {
      const why = { 'no-path': 'every way through is steeper than ' + S.maxSlope + '°' + (zones ? ' or crosses a no-go zone' : ''), 'start-steep': 'the start point sits on ground steeper than ' + S.maxSlope + '°',
        'goal-steep': 'the destination sits on ground steeper than ' + S.maxSlope + '°', 'start-zone': 'the start point is inside a no-go zone', 'goal-zone': 'the destination is inside a no-go zone',
        outside: 'a point is outside the elevation model' }[p.fail.reason] || 'no route was found';
      add(2, 'No safe route', 'From ' + p.fail.from.name + ' to ' + p.fail.to.name + ': ' + why + '. ' + (/zone/.test(why) ? 'Move the point or remove the zone.' : 'Raise the slope limit or move the point.'));
      return out;
    }
    const limit = S.limitH * 3600, reserve = RESERVE_MIN * 60;
    if (p.totalSeconds > limit) add(2, 'Over the suit limit', 'This EVA needs ' + hm(p.totalSeconds) + ' but the suit supports ' + S.limitH + ' h. Drop a stop or walk less.');
    else if (p.totalSeconds > limit - reserve) add(1, 'Inside the reserve', hm(p.totalSeconds) + ' leaves less than the ' + RESERVE_MIN + ' min safety reserve on an ' + S.limitH + ' h suit.');
    else add(0, 'Time', hm(p.totalSeconds) + ' of ' + S.limitH + ' h, with ' + hmShort(limit - p.totalSeconds) + ' in reserve.');

    const need = p.o2Grams / 1000, have = S.o2Kg, left = 1 - need / have;
    const crewNote = S.crew > 1 ? ' The crew of ' + S.crew + ' uses about ' + (need * S.crew).toFixed(2) + ' kg in total.' : '';
    if (need > have) add(2, 'Not enough oxygen', 'Each astronaut needs about ' + need.toFixed(2) + ' kg of O₂, but a suit carries ' + have.toFixed(1) + ' kg. Shorten the walk or slow the pace.');
    else if (left < O2_RESERVE) add(1, 'Oxygen reserve low', 'About ' + need.toFixed(2) + ' kg of the ' + have.toFixed(1) + ' kg in each suit, leaving ' + Math.round(left * 100) + '%. This planner keeps at least ' + Math.round(O2_RESERVE * 100) + '% back.' + crewNote);
    else add(0, 'Oxygen', 'About ' + need.toFixed(2) + ' kg per suit of ' + have.toFixed(1) + ' kg, so ' + Math.round(left * 100) + '% stays in reserve.' + crewNote);
    if (S.crew < 2) add(1, 'Solo EVA', 'Nobody is there to help if a suit or an ankle fails. Walk with at least two crew.');

    const steep = p.classDist.slice(2).reduce((a, b) => a + b, 0), hard = p.classDist.slice(3).reduce((a, b) => a + b, 0);
    const pct = (v) => Math.round(v / Math.max(1, p.distance) * 100);
    if (hard > 30) add(1, 'Steep sections', km(hard) + ' on slopes above 15° (steepest ' + p.maxSlope.toFixed(0) + '°). Use poles and a tether partner there.');
    else if (pct(steep) >= 10) add(1, 'Sloping ground', pct(steep) + '% of the walk is on slopes above 10°. Expect slow going.');
    else add(0, 'Terrain', 'Steepest slope ' + p.maxSlope.toFixed(0) + '°; ' + pct(p.classDist[0] + p.classDist[1]) + '% of the walk is on slopes under 10°.');

    const start = S.startH, end = S.startH + p.totalSeconds / 3600;
    const T = MM.time;
    if (start < m.sunriseLMST || end > m.sunsetLMST) add(2, 'Darkness', 'The EVA runs ' + T.hhmm(start) + '–' + T.hhmm(end) + ' LMST but the Sun is up only ' + T.hhmm(m.sunriseLMST) + '–' + T.hhmm(m.sunsetLMST) + '.');
    else if (start < m.sunriseLMST + 1 || end > m.sunsetLMST - 1) add(1, 'Low Sun', 'Back at ' + T.hhmm(end) + ' LMST, within an hour of sunrise or sunset (' + T.hhmm(m.sunsetLMST) + '). Long shadows hide rocks.');
    else add(0, 'Daylight', T.hhmm(start) + '–' + T.hhmm(end) + ' LMST; sunset is at ' + T.hhmm(m.sunsetLMST) + '.');

    const sunriseLTST = 12 - m.dayHours / 2;
    const t0 = MM.eva.tempAt(start + m.eotHours, C.tmin, C.tmax, sunriseLTST), t1 = MM.eva.tempAt(end + m.eotHours, C.tmin, C.tmax, sunriseLTST);
    const cold = Math.min(t0, t1);
    add(cold < -70 ? 1 : 0, 'Temperature', 'About ' + Math.round(t0) + '° C at egress and ' + Math.round(t1) + '° C at ingress (' + C.tsrc + ').' + (cold < -70 ? ' Very cold: check glove and boot heaters.' : ''));

    if (C.dust.level >= 3) add(1, 'Dust-storm window', C.dust.note);
    else if (C.dust.level === 2) add(1, 'Dust season', C.dust.note);
    else add(0, 'Dust', C.dust.label + ' risk at Ls ' + m.ls.toFixed(0) + '°.');

    const los = Math.round(p.losFraction * 100);
    if (los < 50) add(1, 'Radio shadow', 'Only ' + los + '% of the route has line of sight to a 10 m mast at base. Plan an orbiter or rover relay.');
    else if (los < 90) add(1, 'Partial radio cover', los + '% of the route has line of sight to base. Expect dropouts in the red sections of the profile.');
    else add(0, 'Radio', los + '% of the route has line of sight to base.');

    const moved = p.legs.filter((l) => l.ok && l.snapped && !l.to.isReturn).map((l) => l.to.name);
    if (moved.length) add(1, 'Steep destination', moved.join(', ') + (moved.length > 1 ? ' sit' : ' sits') + ' on ground steeper than ' + S.maxSlope + '°. The route stops at the nearest safe spot beside it.');

    if (zones) add(0, 'No-go zones', 'The route stays clear of ' + zones + ' area' + (zones > 1 ? 's' : '') + ' the crew marked as no-go.');
    const near = MM.field ? MM.field.nearRoute(p.m, 100).filter((x) => !x.o.avoid) : [];
    if (near.length) add(1, 'Hazard reported near the route', near.map((x) => '"' + (x.o.note || 'Hazard') + '" ' + Math.round(x.d) + ' m away').join('; ') + '. Check it on the map, or set the report to keep routes away.');

    if (!p.roundTrip) {
      const last = p.stops[p.stops.length - 1];
      const gap = MM.terrain.dist(p.base.lat, p.base.lon, last.lat, last.lon);
      if (gap > 200) add(1, 'One-way walk', 'The EVA ends ' + km(gap) + ' from base. A rover pickup must be waiting at ' + last.name + '.');
    }
    return out;
  }

  // ------------------------------------------------------------------ rendering
  function renderAll() { if (MM.view3d && MM.view3d.isOpen()) MM.view3d.close(); clearCompare(); renderMap(); renderStops(); renderSummary(); renderProfile(); renderNearby(); saveHash(); }

  function renderMap() {
    const map = MM.map, T = MM.terrain;
    if (layer) map.removeLayer(layer);
    layer = L.layerGroup().addTo(map);
    if (plan) {
      for (const leg of plan.legs) {
        if (!leg.ok) { layer.addLayer(L.polyline(leg.line, { color: '#ef476f', weight: 3, dashArray: '6 8', pane: 'route' })); continue; }
        layer.addLayer(L.polyline(leg.line, { color: '#0b0e14', weight: 8, opacity: 0.85, pane: 'route', lineJoin: 'round' }));
      }
      // colour by slope class
      const m = plan.m;
      let run = [], cls = -1;
      const flush = () => { if (run.length > 1) layer.addLayer(L.polyline(run, { color: T.CLASSES[cls].color, weight: 4, opacity: 1, pane: 'route', lineCap: 'round', interactive: false })); };
      for (let k = 0; k < m.d.length; k++) {
        const c = m.cls[k];
        if (c !== cls || (k > 0 && m.leg[k] !== m.leg[k - 1])) { if (run.length) { run.push([m.lat[k], m.lon[k]]); flush(); } run = [[m.lat[k], m.lon[k]]]; cls = c; }
        else run.push([m.lat[k], m.lon[k]]);
      }
      flush();
    }
    S.stops.forEach((s, i) => {
      const mk = L.marker([s.lat, s.lon], {
        draggable: true, pane: 'pins', zIndexOffset: 1000,
        icon: L.divIcon({ className: '', html: `<div class="spin-pin ${i === 0 ? 'base' : ''}">${i === 0 ? BASE_ICO : i}</div>`, iconSize: [26, 26], iconAnchor: [13, 13] }),
      });
      mk.bindTooltip(esc(s.name) + ' (drag to move, click to remove)', { direction: 'top', offset: [0, -12] });
      mk.bindPopup(`<div class="pop">
        <div class="pop-kind" style="color:var(--mars)">${i === 0 ? 'Base' : 'Stop ' + i}</div>
        <div class="pop-name">${esc(s.name)}</div>
        <div class="pop-meta">${s.lat.toFixed(5)}° N, ${s.lon.toFixed(5)}° E</div>
        <p>Drag the pin to move this point.${i === 0 && S.stops.length > 1 ? ' If you remove the base, the next point becomes the base.' : ''}</p>
        <button class="ghost-btn sm danger" data-remove-stop="${i}">Remove this point</button>
      </div>`, { maxWidth: 260, className: 'mm-popup', offset: [0, -8] });
      mk.on('dragend', () => {
        const p = mk.getLatLng();
        if (!T.inside(p.lat, p.lng)) { MM.toast('Points must stay inside the elevation model.', 'warn'); renderMap(); return; }
        s.lat = p.lat; s.lon = p.lng;
        if (s.targetId) { s.targetId = null; s.custom = false; }
        relabel(); compute();
      });
      mk.on('click', (e) => L.DomEvent.stopPropagation(e));
      layer.addLayer(mk);
    });
    if (MM.science && MM.science.declutter) MM.science.declutter();   // science markers make room for the route pins
  }

  function renderStops() {
    const el = $('stops');
    $('stops-empty').hidden = S.stops.length > 0;
    el.innerHTML = S.stops.map((s, i) => {
      const info = plan && plan.stopInfo[i];
      let meta = i === 0 ? 'Base · suit checks ' + EGRESS_MIN + ' min' : '';
      if (i > 0 && info && info.arrive != null) meta = MM.time.hhmm(S.startH + info.arrive / 3600) + ' LMST · ' + km(info.d);
      if (i > 0 && plan && info && info.arrive == null) meta = 'Not reachable';
      return `<li class="stop" data-i="${i}">
        <span class="stop-n ${i === 0 ? 'base' : ''}">${i === 0 ? BASE_ICO : i}</span>
        <span class="stop-main"><span class="stop-name">${esc(s.name)}</span><span class="stop-meta">${meta}</span></span>
        ${i > 0 ? `<label class="stop-min" title="Minutes of work at this stop"><input type="number" min="0" max="240" step="5" value="${s.stopMin}"><span>min</span></label>` : '<span class="stop-min"></span>'}
        <span class="stop-btns"><button data-act="up" title="Earlier" ${i === 0 ? 'disabled' : ''}>↑</button><button data-act="down" title="Later" ${i === S.stops.length - 1 ? 'disabled' : ''}>↓</button><button data-act="del" title="Remove">×</button></span>
      </li>`;
    }).join('');
    if (S.stops.length === 1) el.insertAdjacentHTML('beforeend', '<li class="hint">Now click a destination on the map.</li>');
  }

  function renderSummary() {
    const blk = $('summary-block');
    blk.hidden = !plan;
    if (!plan) return;
    const v = [['go', 'GO', 'This Marswalk fits the rules.'], ['caution', 'GO WITH CAUTION', 'Possible, with the cautions below.'], ['nogo', 'NO-GO', 'Change the plan before anyone leaves the airlock.']][plan.verdict];
    $('verdict').className = 'verdict ' + v[0];
    $('verdict').innerHTML = `<b>${v[1]}</b><span>${v[2]}</span>`;
    $('takeaway').innerHTML = '<span class="takeaway-k">Key takeaway</span>' + esc(takeaway(plan));
    if (plan.ok) {
      const st = [
        ['Distance', km(plan.distance), plan.roundTrip ? 'round trip' : 'one way', 'data'],
        ['EVA time', hmShort(plan.totalSeconds), 'of ' + S.limitH + ' h suit limit', 'model'],
        ['Walking', hmShort(plan.walkSeconds), (plan.distance / Math.max(1, plan.walkSeconds) * 3.6).toFixed(1) + ' km/h average', 'model'],
        ['Science time', hmShort(plan.scienceSeconds), (S.stops.length - 1) + ' stop' + (S.stops.length === 2 ? '' : 's'), 'plan'],
        ['Climb', '↑' + Math.round(plan.ascent) + ' m', '↓' + Math.round(plan.descent) + ' m', 'data'],
        ['Steepest', plan.maxSlope.toFixed(0) + '°', 'limit ' + S.maxSlope + '°', 'data'],
        ['Energy', Math.round(plan.energyKcal) + ' kcal', Math.round(plan.avgWatts) + ' W average', 'model'],
        ['Oxygen', (plan.o2Grams / 1000).toFixed(2) + ' kg', 'per suit, of ' + S.o2Kg.toFixed(1) + ' kg', 'model'],
        ['Radio contact', Math.round(plan.losFraction * 100) + '%', 'line of sight to base', 'data'],
        ['Farthest point', km(plan.farthest), 'from base', 'data'],
      ];
      $('stats').innerHTML = st.map((r) => `<div class="stat"><span>${r[0]}<em class="tt ${r[3]}" title="${TRUST[r[3]][1]}">${TRUST[r[3]][0]}</em></span><b>${r[1]}</b><small>${r[2]}</small></div>`).join('');
      const T = MM.terrain;
      $('classbar').innerHTML = plan.classDist.map((d, k) => d > 0 ? `<i style="flex:${d};background:${T.CLASSES[k].color}" title="${T.CLASSES[k].label}: ${km(d)}"></i>` : '').join('');
      $('classbar-legend').innerHTML = plan.classDist.map((d, k) => d > 0 ? `<span><i class="dot" style="background:${T.CLASSES[k].color}"></i>${T.CLASSES[k].label} ${Math.round(d / plan.distance * 100)}%</span>` : '').join('');
    } else { $('stats').innerHTML = ''; $('classbar').innerHTML = ''; $('classbar-legend').innerHTML = ''; }
    $('trust-legend').hidden = !plan.ok; $('howsure').hidden = !plan.ok; $('cmp').hidden = !plan.ok;
    $('checks').innerHTML = plan.checks.map((c) => `<li class="${['go', 'caution', 'nogo'][c.level]}"><b>${c.title}</b><span>${esc(c.text)}</span></li>`).join('');
    document.querySelectorAll('#btn-brief,#btn-3d,#btn-share,#btn-export').forEach((b) => { b.disabled = !plan.ok; });
  }

  // Where each number comes from, shown as a small tag on every stat (idea: label evidence, not just values).
  const TRUST = {
    data: ['NASA terrain', 'Computed directly from the MRO CTX elevation model, which matches Perseverance\'s own positions to about a metre.'],
    model: ['Model', 'Planning estimate from Apollo-derived walking and metabolic models. Not measured on Mars.'],
    plan: ['Your input', 'Set by you in the plan.'],
  };

  /** One plain sentence a judge or a crew member can read in five seconds. */
  function takeaway(p) {
    if (!p.ok) { const c = p.checks.find((x) => x.level === 2); return c ? c.title + '. ' + c.text : 'No safe route was found.'; }
    const n = p.stops.length - 1;
    let s = 'A ' + km(p.distance) + (p.roundTrip ? ' round trip' : ' walk') + ' with ' + n + ' stop' + (n === 1 ? '' : 's') + ' takes ' + hm(p.totalSeconds) +
      ' of the ' + S.limitH + ' h suit limit and about ' + (p.o2Grams / 1000).toFixed(2) + ' kg of oxygen per astronaut. ';
    const worst = p.checks.filter((c) => c.level === p.verdict && c.level > 0);
    if (!worst.length) return s + 'Every safety check passes.';
    return s + (p.verdict === 2 ? 'It must change: ' : 'Watch out for: ') + worst.map((c) => c.title.toLowerCase()).join(', ') + '.';
  }

  /** Science targets within 600 m of a plan's route that it does not visit yet. */
  function nearbyTargets(p) {
    const m = p.m, T = MM.terrain, stops = p.stops, used = new Set(stops.map((s) => s.targetId).filter(Boolean));
    const rows = [];
    for (const t of MM.science.all()) {
      if (used.has(t.id)) continue;
      let best = Infinity, bi = 0;
      for (let k = 0; k < m.d.length; k += 2) { const d = T.dist(t.lat, t.lon, m.lat[k], m.lon[k]); if (d < best) { best = d; bi = k; } }
      if (stops.some((s) => T.dist(s.lat, s.lon, t.lat, t.lon) < 40)) continue;
      if (best <= 600) rows.push({ t, d: best, k: bi, after: Math.min(m.leg[bi], stops.length - 1) });
    }
    return rows.sort((a, b) => a.d - b.d);
  }

  // ------------------------------------------------------------------ route comparison
  const CMP_COLORS = { safe: '#2fbf71', fast: '#59c3ff', science: '#c77dff' };
  function clearCompare() {
    cmp = null;
    if (cmpLayer) { MM.map.removeLayer(cmpLayer); cmpLayer = null; }
    const out = $('cmp-out'); if (out) out.innerHTML = '';
    const b = $('btn-compare'); if (b) b.hidden = false;
  }
  /** Insert targets near the route, in walking order, then drop the farthest until the EVA fits the suit with its reserve. */
  function scienceStops(p) {
    let rows = nearbyTargets(p).slice(0, 3);
    if (!rows.length) return null;
    const make = (rs) => {
      const out = [];
      p.stops.forEach((s, i) => {
        out.push(Object.assign({}, s));
        rs.filter((r) => r.after === i).sort((a, b) => a.k - b.k).forEach((r) => out.push({ lat: r.t.lat, lon: r.t.lon, targetId: r.t.id, name: r.t.name, stopMin: r.t.stop_min }));
      });
      return out;
    };
    const limit = S.limitH * 3600 - RESERVE_MIN * 60;
    for (;;) {
      const stops = make(rows), q = build(stops, 'safe');
      if ((q.ok && q.totalSeconds <= limit && q.verdict < 2) || rows.length === 1) return { stops, plan: q, added: rows.map((r) => r.t) };
      rows = rows.slice(0, -1);
    }
  }
  function compareRoutes() {
    if (!plan || !plan.ok) return Promise.resolve();
    const busy = $('busy'), msg = busy.lastChild, old = msg.textContent;
    msg.textContent = 'Comparing three routes…'; busy.hidden = false;
    return new Promise((resolve) => setTimeout(() => {
      try {
        const stops = S.stops.slice();
        const safe = S.mode === 'safe' ? plan : build(stops, 'safe');
        const fast = S.mode === 'fast' ? plan : build(stops, 'fast');
        const sci = scienceStops(safe);
        cmp = { safe, fast, sci };
        renderCompare();
      } catch (e) { console.error(e); MM.toast('Comparison failed: ' + e.message, 'error'); }
      busy.hidden = true; msg.textContent = old; resolve();
    }, 30));
  }
  function renderCompare() {
    if (!cmp) return;
    const opts = [
      { id: 'safe', name: 'Safest', sub: 'Stays on the gentlest ground', p: cmp.safe, cur: S.mode === 'safe' },
      { id: 'fast', name: 'Fastest', sub: 'Shortest walking time within your slope limit', p: cmp.fast, cur: S.mode === 'fast' },
      cmp.sci ? { id: 'science', name: 'Science-rich', sub: '+' + cmp.sci.added.length + ': ' + cmp.sci.added.map((t) => t.name).join(', '), p: cmp.sci.plan, cur: false }
        : { id: 'science', name: 'Science-rich', sub: 'No other targets within 600 m of this route.', p: null, cur: false },
    ];
    const ok = opts.filter((o) => o.p && o.p.ok);
    const best = (f) => Math.min(...ok.map((o) => f(o.p)));
    const bT = best((p) => p.totalSeconds), bS = best((p) => p.maxSlope), bE = best((p) => p.energyKcal), bC = best((p) => p.ascent);
    const B = (v, b, txt) => (Math.abs(v - b) < 1e-6 && ok.length > 1 ? '<b class="best">' + txt + '</b>' : txt);
    const V = ['GO', 'CAUTION', 'NO-GO'], VC = ['go', 'caution', 'nogo'];
    $('cmp-out').innerHTML = '<div class="cmp-grid">' + opts.map((o) => {
      const p = o.p;
      if (!p || !p.ok) return `<div class="cmp-card off" style="--c:${CMP_COLORS[o.id]}"><div class="cmp-h"><i></i>${o.name}</div><small>${esc(p ? 'No safe route with these stops.' : o.sub)}</small></div>`;
      return `<div class="cmp-card ${o.cur ? 'cur' : ''}" style="--c:${CMP_COLORS[o.id]}">
        <div class="cmp-h"><i></i>${o.name}<span class="cmp-v ${VC[p.verdict]}">${V[p.verdict]}</span></div>
        <small class="cmp-sub">${esc(o.sub)}</small>
        <dl>
          <div><dt>EVA time</dt><dd>${B(p.totalSeconds, bT, hmShort(p.totalSeconds))}</dd></div>
          <div><dt>Distance</dt><dd>${km(p.distance)}</dd></div>
          <div><dt>Steepest</dt><dd>${B(p.maxSlope, bS, p.maxSlope.toFixed(0) + '°')}</dd></div>
          <div><dt>Climb</dt><dd>${B(p.ascent, bC, Math.round(p.ascent) + ' m')}</dd></div>
          <div><dt>Energy</dt><dd>${B(p.energyKcal, bE, Math.round(p.energyKcal) + ' kcal')}</dd></div>
          <div><dt>Science stops</dt><dd>${p.stops.length - 1}</dd></div>
        </dl>
        ${o.cur ? '<span class="cmp-cur">Current plan</span>' : `<button class="mini-btn hot" data-cmp-use="${o.id}">Use this route</button>`}
      </div>`;
    }).join('') + '</div><div class="hint cmp-note">Coloured dashed lines on the map show the other options. Best value in each row is bold.</div>';
    $('btn-compare').hidden = true;
    if (cmpLayer) MM.map.removeLayer(cmpLayer);
    cmpLayer = L.layerGroup().addTo(MM.map);
    opts.forEach((o) => {
      if (o.cur || !o.p || !o.p.ok) return;
      o.p.legs.forEach((l) => { if (l.ok) cmpLayer.addLayer(L.polyline(l.line, { pane: 'route', color: CMP_COLORS[o.id], weight: 3, opacity: 0.95, dashArray: '7 6', interactive: false })); });
    });
  }
  function useCompare(id) {
    if (!cmp) return;
    if (id === 'safe' || id === 'fast') { S.mode = id; syncControls(); compute(); }
    else if (id === 'science' && cmp.sci) { S.stops = cmp.sci.stops.map((s) => Object.assign({}, s)); S.mode = 'safe'; syncControls(); relabel(); compute(); MM.toast('Added ' + cmp.sci.added.map((t) => t.name).join(', ') + ' to the route.', 'ok'); }
  }

  function renderNearby() {
    const blk = $('nearby-block');
    if (!plan || !plan.ok) { blk.hidden = true; return; }
    const rows = nearbyTargets(plan);
    blk.hidden = rows.length === 0;
    $('nearby').innerHTML = rows.slice(0, 6).map((r) => {
      const k = MM.science.KIND[r.t.kind];
      return `<div class="near"><span class="sci-ico" style="color:${k.color}">${k.icon}</span>
        <span class="near-main"><b>${esc(r.t.name)}</b><small>${km(r.d)} off your route · ${esc(r.t.sample || r.t.unit)}</small></span>
        <button class="mini-btn" data-near="${r.t.id}" data-after="${r.after}">Add stop</button></div>`;
    }).join('');
  }

  // ------------------------------------------------------------------ profile
  let prof = null;
  function renderProfile() {
    const box = $('profile'), openBtn = $('profile-open');
    const stage = $('stage');
    if (!plan || !plan.ok) { box.hidden = true; openBtn.hidden = true; stage.classList.remove('has-profile'); return; }
    if (box.dataset.closed === '1') { box.hidden = true; openBtn.hidden = false; stage.classList.remove('has-profile'); return; }
    box.hidden = false; openBtn.hidden = true; stage.classList.add('has-profile');
    const cv = $('profile-cv'), dpr = window.devicePixelRatio || 1;
    const W = cv.clientWidth, H = 150;
    cv.width = W * dpr; cv.height = H * dpr; cv.style.height = H + 'px';
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawProfile(g, W, H, plan, true);
    $('profile-tip').textContent = 'Hover the profile to inspect any point';
  }

  function drawProfile(g, W, H, p, dark) {
    const m = p.m, T = MM.terrain;
    const pad = { l: 50, r: 14, t: 18, b: 34 };
    let zmin = Infinity, zmax = -Infinity;
    for (const z of m.z) { if (z < zmin) zmin = z; if (z > zmax) zmax = z; }
    const span = Math.max(30, zmax - zmin); const mid = (zmax + zmin) / 2;
    zmin = mid - span * 0.6; zmax = mid + span * 0.62;
    const D = p.distance || 1;
    const x = (d) => pad.l + d / D * (W - pad.l - pad.r), y = (z) => pad.t + (zmax - z) / (zmax - zmin) * (H - pad.t - pad.b);
    const ink = dark ? '#9aa4b8' : '#444', grid = dark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.12)';
    g.clearRect(0, 0, W, H);
    g.font = '10.5px system-ui, sans-serif'; g.lineWidth = 1; g.textBaseline = 'middle';
    const zs = niceStep((zmax - zmin) / 4);
    for (let z = Math.ceil(zmin / zs) * zs; z <= zmax; z += zs) {
      g.strokeStyle = grid; g.beginPath(); g.moveTo(pad.l, y(z)); g.lineTo(W - pad.r, y(z)); g.stroke();
      g.fillStyle = ink; g.textAlign = 'right'; g.fillText(Math.round(z) + ' m', pad.l - 6, y(z));
    }
    const base = H - pad.b;
    for (let k = 1; k < m.d.length; k++) {
      g.fillStyle = T.CLASSES[m.cls[k]].color;
      g.beginPath(); g.moveTo(x(m.d[k - 1]), base); g.lineTo(x(m.d[k - 1]), y(m.z[k - 1])); g.lineTo(x(m.d[k]) + 0.6, y(m.z[k])); g.lineTo(x(m.d[k]) + 0.6, base); g.closePath(); g.fill();
    }
    g.strokeStyle = dark ? '#fff' : '#111'; g.lineWidth = 1.4; g.beginPath();
    for (let k = 0; k < m.d.length; k++) g[k ? 'lineTo' : 'moveTo'](x(m.d[k]), y(m.z[k]));
    g.stroke();
    // radio line-of-sight strip
    for (let k = 1; k < m.d.length; k++) { g.fillStyle = m.los[k] ? '#2fbf71' : '#ef476f'; g.fillRect(x(m.d[k - 1]), base + 4, Math.max(1, x(m.d[k]) - x(m.d[k - 1]) + 0.6), 4); }
    g.fillStyle = ink; g.textAlign = 'right'; g.fillText('radio', pad.l - 6, base + 6);
    // distance ticks
    const ds = niceStep(D / 6);
    g.textAlign = 'center';
    for (let d = 0; d <= D + 1; d += ds) g.fillText(d >= 1000 || ds >= 1000 ? (d / 1000).toFixed(ds < 1000 ? 1 : 0) + ' km' : d + ' m', x(d), base + 22);
    // stops
    p.stopInfo.forEach((s, i) => {
      if (s.arrive == null && i > 0) return;
      const px = x(s.d);
      g.strokeStyle = dark ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(px, pad.t - 4); g.lineTo(px, base); g.stroke(); g.setLineDash([]);
      const lab = i === 0 ? '⌂' : s.stop.isReturn ? '⌂' : String(i);
      g.fillStyle = '#ff6b35'; g.beginPath(); g.arc(px, pad.t - 8, 7, 0, 7); g.fill();
      g.fillStyle = '#fff'; g.textAlign = 'center'; g.font = 'bold 9.5px system-ui, sans-serif'; g.fillText(lab, px, pad.t - 7.5); g.font = '10.5px system-ui, sans-serif';
    });
    prof = { x, y, pad, W, H, D };
  }
  function niceStep(v) { const p = Math.pow(10, Math.floor(Math.log10(v))); const f = v / p; return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p; }

  function onProfileMove(e) {
    if (!plan || !plan.ok || !prof) return;
    const r = $('profile-cv').getBoundingClientRect();
    const d = Math.max(0, Math.min(prof.D, (e.clientX - r.left - prof.pad.l) / (prof.W - prof.pad.l - prof.pad.r) * prof.D));
    const m = plan.m; let lo = 0, hi = m.d.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (m.d[mid] < d) lo = mid + 1; else hi = mid; }
    const k = lo, T = MM.terrain;
    $('profile-tip').innerHTML = `${km(m.d[k])} · ${Math.round(m.z[k])} m · slope ${m.slope[k].toFixed(1)}° <i class="dot" style="background:${T.CLASSES[m.cls[k]].color}"></i>${T.CLASSES[m.cls[k]].label} · ${MM.time.hhmm(S.startH + m.clock[k] / 3600)} LMST · radio ${m.los[k] ? 'OK' : 'blocked'}`;
    if (!hoverMarker) hoverMarker = L.circleMarker([m.lat[k], m.lon[k]], { radius: 7, color: '#fff', weight: 2, fillColor: '#ff6b35', fillOpacity: 1, pane: 'pins', interactive: false }).addTo(MM.map);
    else hoverMarker.setLatLng([m.lat[k], m.lon[k]]);
  }
  function onProfileLeave() { if (hoverMarker) { MM.map.removeLayer(hoverMarker); hoverMarker = null; } $('profile-tip').textContent = 'Hover the profile to inspect any point'; }

  // ------------------------------------------------------------------ persistence
  function serialize() {
    return { v: 1, s: S.stops.map((s) => [Number(s.lat.toFixed(6)), Number(s.lon.toFixed(6)), s.targetId || (s.custom ? s.name : ''), s.stopMin, s.custom ? 1 : 0]),
      ms: S.maxSlope, p: S.pace, st: S.startH, lim: S.limitH, rt: S.roundTrip ? 1 : 0, md: S.mode, cr: S.crew, o2: S.o2Kg,
      f: MM.field ? MM.field.serialize() || undefined : undefined };
  }
  function load(o, opts) {
    S.maxSlope = o.ms || 20; S.pace = o.p || 'nominal'; S.startH = o.st != null ? o.st : 9; S.limitH = o.lim || 8; S.roundTrip = !!o.rt;
    S.mode = MODES[o.md] ? o.md : 'safe';
    if (o.cr >= 1 && o.cr <= 6) S.crew = Math.round(o.cr);
    if (o.o2 >= 0.2 && o.o2 <= 5) S.o2Kg = Number(o.o2);
    if (o.f && MM.field) MM.field.load(o.f);
    S.stops = (o.s || []).map((a) => {
      const t = a[2] && !a[4] ? MM.science.get(a[2]) : null;
      return { lat: a[0], lon: a[1], targetId: t ? t.id : null, name: t ? t.name : (a[4] ? a[2] : ''), custom: !!a[4], stopMin: a[3] || 0 };
    }).filter((s) => MM.terrain.inside(s.lat, s.lon));
    relabel(); syncControls();
    MM.layers.redrawHazard();
    return compute().then(() => { if (!opts || opts.fit !== false) fit(); });
  }
  function saveHash() {
    try {
      if (S.stops.length < 2) { if (location.hash) history.replaceState(null, '', location.pathname + location.search); return; }
      history.replaceState(null, '', '#plan=' + btoa(unescape(encodeURIComponent(JSON.stringify(serialize())))));
    } catch (e) { /* file:// in some browsers */ }
  }
  function loadHash() {
    const mth = /#plan=([A-Za-z0-9+/=]+)/.exec(location.hash);
    if (!mth) return false;
    try { load(JSON.parse(decodeURIComponent(escape(atob(mth[1]))))); return true; } catch (e) { return false; }
  }
  function fit() {
    if (S.stops.length === 0) return;
    const pts = plan && plan.ok ? plan.m.lat.map((la, k) => [la, plan.m.lon[k]]) : S.stops.map((s) => [s.lat, s.lon]);
    const left = window.innerWidth > 900 ? 30 : 20;
    MM.map.flyToBounds(L.latLngBounds(pts), { paddingTopLeft: [left, 40], paddingBottomRight: [40, 210], maxZoom: 16, duration: 0.8 });
  }

  function exportGeoJSON() {
    if (!plan || !plan.ok) return;
    const m = plan.m;
    const fc = { type: 'FeatureCollection', name: 'marswalk-plan', crs: { type: 'name', properties: { name: 'IAU:49900 (Mars 2000 sphere, planetocentric, east-positive)' } }, features: [] };
    fc.features.push({ type: 'Feature', properties: { kind: 'route', distance_m: Math.round(plan.distance), eva_minutes: Math.round(plan.totalSeconds / 60), walking_minutes: Math.round(plan.walkSeconds / 60),
      ascent_m: Math.round(plan.ascent), descent_m: Math.round(plan.descent), max_slope_deg: Number(plan.maxSlope.toFixed(1)), energy_kcal: Math.round(plan.energyKcal),
      slope_limit_deg: S.maxSlope, pace: S.pace, route_priority: MODES[S.mode].label, crew: S.crew, o2_per_suit_kg: Number((plan.o2Grams / 1000).toFixed(3)), o2_supply_per_suit_kg: S.o2Kg, verdict: ['GO', 'GO WITH CAUTION', 'NO-GO'][plan.verdict] },
      geometry: { type: 'LineString', coordinates: m.d.map((_, k) => [Number(m.lon[k].toFixed(6)), Number(m.lat[k].toFixed(6)), Number(m.z[k].toFixed(1))]) } });
    S.stops.forEach((s, i) => fc.features.push({ type: 'Feature', properties: { kind: i === 0 ? 'base' : 'stop', order: i, name: s.name, stop_minutes: s.stopMin, target: s.targetId || null },
      geometry: { type: 'Point', coordinates: [Number(s.lon.toFixed(6)), Number(s.lat.toFixed(6))] } }));
    if (MM.field) fc.features.push(...MM.field.geojson());
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(fc, null, 1)], { type: 'application/geo+json' }));
    a.download = 'marswalk-plan.geojson'; document.body.appendChild(a); a.click(); a.remove();
  }

  // ------------------------------------------------------------------ controls
  function syncControls() {
    document.querySelectorAll('#opt-slope button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === S.maxSlope));
    document.querySelectorAll('#opt-pace button').forEach((b) => b.classList.toggle('on', b.dataset.v === S.pace));
    document.querySelectorAll('#opt-mode button').forEach((b) => b.classList.toggle('on', b.dataset.v === S.mode));
    $('opt-start').value = MM.time.hhmm(S.startH); $('opt-limit').value = S.limitH; $('opt-round').checked = S.roundTrip;
    $('opt-crew').value = S.crew; $('opt-o2').value = S.o2Kg.toFixed(1);
  }

  function init() {
    MM.map.on('click', (e) => {
      if (!$('opt-click').checked || !$('tab-plan').classList.contains('active') || (MM.field && MM.field.drawing()) || (e.originalEvent && e.originalEvent._mmField)) return;
      addPoint(e.latlng.lat, e.latlng.lng);
    });
    $('opt-click').addEventListener('change', () => { $('map').classList.toggle('adding', $('opt-click').checked); });
    $('map').classList.add('adding');
    $('btn-clear').addEventListener('click', clear);
    document.addEventListener('click', (e) => {            // "Remove this point" in a pin's popup
      const b = e.target.closest('[data-remove-stop]'); if (!b) return;
      const i = Number(b.dataset.removeStop);
      MM.map.closePopup();
      if (i >= 0 && i < S.stops.length) removeStop(i);
    });
    $('btn-undo').addEventListener('click', () => { if (S.stops.length) removeStop(S.stops.length - 1); });
    $('opt-slope').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.maxSlope = Number(b.dataset.v); syncControls(); MM.layers.redrawHazard(); compute(); });
    $('opt-pace').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; S.pace = b.dataset.v; syncControls(); compute(); });
    $('opt-start').addEventListener('change', (e) => { const p = e.target.value.split(':'); if (p.length === 2) { S.startH = Number(p[0]) + Number(p[1]) / 60; refresh(); } });
    $('opt-limit').addEventListener('change', (e) => { const v = parseFloat(e.target.value); if (v >= 1 && v <= 12) { S.limitH = v; refresh(); } });
    $('opt-round').addEventListener('change', (e) => { S.roundTrip = e.target.checked; compute(); });
    $('opt-mode').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b || b.dataset.v === S.mode) return; S.mode = b.dataset.v; syncControls(); compute(); });
    $('opt-crew').addEventListener('change', (e) => { const v = Math.round(parseFloat(e.target.value)); if (v >= 1 && v <= 6) { S.crew = v; refresh(); } else syncControls(); });
    $('opt-o2').addEventListener('change', (e) => { const v = parseFloat(e.target.value); if (v >= 0.2 && v <= 5) { S.o2Kg = v; refresh(); } else syncControls(); });
    $('btn-compare').addEventListener('click', compareRoutes);
    $('cmp-out').addEventListener('click', (e) => { const b = e.target.closest('[data-cmp-use]'); if (b) useCompare(b.dataset.cmpUse); });
    $('stops').addEventListener('click', (e) => {
      const li = e.target.closest('.stop'); if (!li) return;
      const i = Number(li.dataset.i), b = e.target.closest('button');
      if (b) { if (b.dataset.act === 'del') removeStop(i); else moveStop(i, b.dataset.act === 'up' ? -1 : 1); return; }
      if (!e.target.closest('input')) MM.map.flyTo([S.stops[i].lat, S.stops[i].lon], Math.max(MM.map.getZoom(), 14), { duration: 0.6 });
    });
    $('stops').addEventListener('change', (e) => {
      const li = e.target.closest('.stop'); if (!li || e.target.type !== 'number') return;
      S.stops[Number(li.dataset.i)].stopMin = Math.max(0, Math.min(240, parseFloat(e.target.value) || 0)); compute();
    });
    $('nearby').addEventListener('click', (e) => { const b = e.target.closest('[data-near]'); if (b) insertTarget(b.dataset.near, Number(b.dataset.after)); });
    $('btn-export').addEventListener('click', exportGeoJSON);
    $('btn-share').addEventListener('click', () => {
      const url = location.href;
      (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(
        () => MM.toast('Link copied. Anyone who opens it sees this exact plan.', 'ok'),
        () => MM.toast('Copy the address bar to share this plan.', 'info'));
    });
    $('btn-brief').addEventListener('click', () => MM.briefing.open());
    $('btn-3d').addEventListener('click', () => MM.view3d.open());
    $('profile-3d').addEventListener('click', () => MM.view3d.open());
    const cv = $('profile-cv');
    cv.addEventListener('mousemove', onProfileMove); cv.addEventListener('mouseleave', onProfileLeave);
    cv.addEventListener('touchmove', (e) => { if (e.touches[0]) onProfileMove(e.touches[0]); }, { passive: true });
    $('profile-close').addEventListener('click', () => { $('profile').dataset.closed = '1'; renderProfile(); });
    $('profile-open').addEventListener('click', () => { $('profile').dataset.closed = ''; renderProfile(); });
    window.addEventListener('resize', () => renderProfile());
    syncControls();
  }

  function refresh() { if (plan) { plan.checks = evaluate(plan); plan.verdict = plan.checks.reduce((w, c) => Math.max(w, c.level), 0); } clearCompare(); renderStops(); renderSummary(); saveHash(); }
  /** No-go zones changed: routes must be searched again. */
  function fieldChanged() { compute(); if (S.stops.length < 2) saveHash(); }

  MM.planner = {
    init, addPoint, addTarget, clear, load, loadHash, refresh, fit, serialize, drawProfile, fieldChanged, compareRoutes, takeaway,
    settings: () => S, plan: () => plan, EGRESS_MIN, INGRESS_MIN, RESERVE_MIN, MODES, hm, hmShort, km,
  };
})();
