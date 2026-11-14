/*
 * Marswalk planner: stops, safest-route search, EVA timeline, go / no-go checks,
 * elevation profile and "science along the way".
 */
(function () {
  'use strict';
  const MM = (window.MM = window.MM || {});
  const EGRESS_MIN = 15, INGRESS_MIN = 15, RESERVE_MIN = 30;
  const KCAL_PER_L_O2 = 4.85, O2_G_PER_L = 1.429;

  const S = { stops: [], maxSlope: 20, pace: 'nominal', startH: 9, limitH: 8, roundTrip: true };
  let plan = null, legCache = new Map(), layer = null, hoverMarker = null, computeToken = 0;
  const $ = (id) => document.getElementById(id);
  const hm = (sec) => { const m = Math.round(sec / 60); return Math.floor(m / 60) + ' h ' + String(m % 60).padStart(2, '0') + ' min'; };
  const hmShort = (sec) => { const m = Math.round(sec / 60); return m < 60 ? m + ' min' : Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') + ' h'; };
  const km = (m) => (m >= 1000 ? (m / 1000).toFixed(2) + ' km' : Math.round(m) + ' m');
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
  function legKey(a, b) { return [a.lat.toFixed(6), a.lon.toFixed(6), b.lat.toFixed(6), b.lon.toFixed(6), S.maxSlope, S.pace].join('|'); }
  function legFor(a, b) {
    const k = legKey(a, b);
    if (legCache.has(k)) return legCache.get(k);
    const r = MM.router.route([a.lat, a.lon], [b.lat, b.lon], { maxSlope: S.maxSlope, pace: S.pace });
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

  function build() {
    const base = S.stops[0];
    const seq = S.stops.slice();
    if (S.roundTrip) seq.push(Object.assign({}, base, { isReturn: true, stopMin: 0, name: 'Back at base' }));
    const legs = [];
    const m = { d: [], z: [], slope: [], cls: [], los: [], lat: [], lon: [], clock: [], leg: [] };
    let dist = 0, clock = EGRESS_MIN * 60, walk = 0, energy = 0, up = 0, down = 0, maxSlope = 0, sci = 0;
    const classDist = new Array(MM.terrain.CLASSES.length).fill(0);
    const stopInfo = [{ stop: base, d: 0, arrive: 0, depart: clock, idx: 0 }];
    let ok = true, fail = null;
    for (let i = 0; i < seq.length - 1; i++) {
      const a = seq[i], b = seq[i + 1];
      const r = legFor(a, b);
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
      ok, fail, legs, m, stopInfo, base, roundTrip: S.roundTrip,
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
    if (!p.ok) {
      const why = { 'no-path': 'every way through is steeper than ' + S.maxSlope + '°', 'start-steep': 'the start point sits on ground steeper than ' + S.maxSlope + '°',
        'goal-steep': 'the destination sits on ground steeper than ' + S.maxSlope + '°', outside: 'a point is outside the elevation model' }[p.fail.reason] || 'no route was found';
      add(2, 'No safe route', 'From ' + p.fail.from.name + ' to ' + p.fail.to.name + ': ' + why + '. Raise the slope limit or move the point.');
      return out;
    }
    const limit = S.limitH * 3600, reserve = RESERVE_MIN * 60;
    if (p.totalSeconds > limit) add(2, 'Over the suit limit', 'This EVA needs ' + hm(p.totalSeconds) + ' but the suit supports ' + S.limitH + ' h. Drop a stop or walk less.');
    else if (p.totalSeconds > limit - reserve) add(1, 'Inside the reserve', hm(p.totalSeconds) + ' leaves less than the ' + RESERVE_MIN + ' min safety reserve on an ' + S.limitH + ' h suit.');
    else add(0, 'Time', hm(p.totalSeconds) + ' of ' + S.limitH + ' h, with ' + hmShort(limit - p.totalSeconds) + ' in reserve.');

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

    if (!p.roundTrip) {
      const last = S.stops[S.stops.length - 1];
      const gap = MM.terrain.dist(p.base.lat, p.base.lon, last.lat, last.lon);
      if (gap > 200) add(1, 'One-way walk', 'The EVA ends ' + km(gap) + ' from base. A rover pickup must be waiting at ' + last.name + '.');
    }
    return out;
  }

  // ------------------------------------------------------------------ rendering
  function renderAll() { if (MM.view3d && MM.view3d.isOpen()) MM.view3d.close(); renderMap(); renderStops(); renderSummary(); renderProfile(); renderNearby(); saveHash(); }

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
        icon: L.divIcon({ className: '', html: `<div class="spin-pin ${i === 0 ? 'base' : ''}">${i === 0 ? '⌂' : i}</div>`, iconSize: [28, 28], iconAnchor: [14, 14] }),
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
        <span class="stop-n ${i === 0 ? 'base' : ''}">${i === 0 ? '⌂' : i}</span>
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
    if (plan.ok) {
      const st = [
        ['Distance', km(plan.distance), plan.roundTrip ? 'round trip' : 'one way'],
        ['EVA time', hmShort(plan.totalSeconds), 'of ' + S.limitH + ' h suit limit'],
        ['Walking', hmShort(plan.walkSeconds), (plan.distance / Math.max(1, plan.walkSeconds) * 3.6).toFixed(1) + ' km/h average'],
        ['Science time', hmShort(plan.scienceSeconds), (S.stops.length - 1) + ' stop' + (S.stops.length === 2 ? '' : 's')],
        ['Climb', '↑' + Math.round(plan.ascent) + ' m', '↓' + Math.round(plan.descent) + ' m'],
        ['Steepest', plan.maxSlope.toFixed(0) + '°', 'limit ' + S.maxSlope + '°'],
        ['Energy', Math.round(plan.energyKcal) + ' kcal', Math.round(plan.avgWatts) + ' W average'],
        ['Oxygen', Math.round(plan.o2Grams) + ' g', 'metabolic use'],
        ['Radio contact', Math.round(plan.losFraction * 100) + '%', 'line of sight to base'],
        ['Farthest point', km(plan.farthest), 'from base'],
      ];
      $('stats').innerHTML = st.map((r) => `<div class="stat"><span>${r[0]}</span><b>${r[1]}</b><small>${r[2]}</small></div>`).join('');
      const T = MM.terrain;
      $('classbar').innerHTML = plan.classDist.map((d, k) => d > 0 ? `<i style="flex:${d};background:${T.CLASSES[k].color}" title="${T.CLASSES[k].label}: ${km(d)}"></i>` : '').join('');
      $('classbar-legend').innerHTML = plan.classDist.map((d, k) => d > 0 ? `<span><i class="dot" style="background:${T.CLASSES[k].color}"></i>${T.CLASSES[k].label} ${Math.round(d / plan.distance * 100)}%</span>` : '').join('');
    } else { $('stats').innerHTML = ''; $('classbar').innerHTML = ''; $('classbar-legend').innerHTML = ''; }
    $('checks').innerHTML = plan.checks.map((c) => `<li class="${['go', 'caution', 'nogo'][c.level]}"><b>${c.title}</b><span>${esc(c.text)}</span></li>`).join('');
    document.querySelectorAll('#btn-brief,#btn-3d,#btn-share,#btn-export').forEach((b) => { b.disabled = !plan.ok; });
  }

  function renderNearby() {
    const blk = $('nearby-block');
    if (!plan || !plan.ok) { blk.hidden = true; return; }
    const m = plan.m, T = MM.terrain, used = new Set(S.stops.map((s) => s.targetId).filter(Boolean));
    const rows = [];
    for (const t of MM.science.all()) {
      if (used.has(t.id)) continue;
      let best = Infinity, bi = 0;
      for (let k = 0; k < m.d.length; k += 2) { const d = T.dist(t.lat, t.lon, m.lat[k], m.lon[k]); if (d < best) { best = d; bi = k; } }
      if (S.stops.some((s) => T.dist(s.lat, s.lon, t.lat, t.lon) < 40)) continue;
      if (best <= 600) rows.push({ t, d: best, after: Math.min(m.leg[bi], S.stops.length - 1) });
    }
    rows.sort((a, b) => a.d - b.d);
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
      ms: S.maxSlope, p: S.pace, st: S.startH, lim: S.limitH, rt: S.roundTrip ? 1 : 0 };
  }
  function load(o, opts) {
    S.maxSlope = o.ms || 20; S.pace = o.p || 'nominal'; S.startH = o.st != null ? o.st : 9; S.limitH = o.lim || 8; S.roundTrip = !!o.rt;
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
      slope_limit_deg: S.maxSlope, pace: S.pace, verdict: ['GO', 'GO WITH CAUTION', 'NO-GO'][plan.verdict] },
      geometry: { type: 'LineString', coordinates: m.d.map((_, k) => [Number(m.lon[k].toFixed(6)), Number(m.lat[k].toFixed(6)), Number(m.z[k].toFixed(1))]) } });
    S.stops.forEach((s, i) => fc.features.push({ type: 'Feature', properties: { kind: i === 0 ? 'base' : 'stop', order: i, name: s.name, stop_minutes: s.stopMin, target: s.targetId || null },
      geometry: { type: 'Point', coordinates: [Number(s.lon.toFixed(6)), Number(s.lat.toFixed(6))] } }));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(fc, null, 1)], { type: 'application/geo+json' }));
    a.download = 'marswalk-plan.geojson'; document.body.appendChild(a); a.click(); a.remove();
  }

  // ------------------------------------------------------------------ controls
  function syncControls() {
    document.querySelectorAll('#opt-slope button').forEach((b) => b.classList.toggle('on', Number(b.dataset.v) === S.maxSlope));
    document.querySelectorAll('#opt-pace button').forEach((b) => b.classList.toggle('on', b.dataset.v === S.pace));
    $('opt-start').value = MM.time.hhmm(S.startH); $('opt-limit').value = S.limitH; $('opt-round').checked = S.roundTrip;
  }

  function init() {
    MM.map.on('click', (e) => {
      if (!$('opt-click').checked || !$('tab-plan').classList.contains('active')) return;
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

  function refresh() { if (plan) { plan.checks = evaluate(plan); plan.verdict = plan.checks.reduce((w, c) => Math.max(w, c.level), 0); } renderStops(); renderSummary(); saveHash(); }

  MM.planner = {
    init, addPoint, addTarget, clear, load, loadHash, refresh, fit, serialize, drawProfile,
    settings: () => S, plan: () => plan, EGRESS_MIN, INGRESS_MIN, RESERVE_MIN, hm, hmShort, km,
  };
})();
