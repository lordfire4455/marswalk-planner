/*
 * Field layer: crew-drawn no-go zones and field reports.
 *
 * No-go zones are polygons the crew draws over ground they will not cross
 * (soft sand, boulder fields, cliff edges). They are burned into a mask over
 * the 20 m elevation grid, and the route finder treats masked cells as
 * impassable, so every route re-plans around them.
 *
 * Field reports are points with a type, a note, an author, a confidence label
 * (Measured / Observed / Estimated) and a Mars + Earth time stamp. A hazard
 * report can also ask routes to keep a set distance away from it.
 *
 * Both are saved in this browser, in the share link and in the GeoJSON export.
 */
(function () {
  'use strict';
  const MM = (window.MM = window.MM || {});
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const STORE = 'marswalk-field-v1';

  const ZONE_KINDS = {
    sand: { label: 'Soft sand or dunes', icon: '≈' },
    rock: { label: 'Boulder field', icon: '▲' },
    edge: { label: 'Cliff edge or overhang', icon: '⌒' },
    other: { label: 'Other hazard', icon: '!' },
  };
  const OBS_KINDS = {
    hazard: { label: 'Hazard', icon: '!', color: '#ef476f' },
    science: { label: 'Science find', icon: '◆', color: '#c77dff' },
    resource: { label: 'Resource (ice, water)', icon: '◉', color: '#59c3ff' },
    landmark: { label: 'Landmark or waypoint', icon: '⚑', color: '#ffd23f' },
    radio: { label: 'Radio contact note', icon: '≋', color: '#2fbf71' },
  };
  const CONF = {
    measured: { label: 'Measured', text: 'Taken with an instrument (rangefinder, penetrometer, spectrometer).' },
    observed: { label: 'Observed', text: 'Seen directly by the crew, not measured.' },
    estimated: { label: 'Estimated', text: 'Inferred from orbital images or a model, not seen on the ground.' },
  };
  const AVOID = [0, 50, 100, 200];

  const F = { zones: [], obs: [] };
  let mask = null, version = 0, layer = null, mode = null, draft = [], draftLayer = null, rubber = null, seq = 1;

  // ------------------------------------------------------------------ mask
  function rebuildMask() {
    const T = MM.terrain, w = T.w, h = T.h;
    version++;
    const avoiders = F.obs.filter((o) => o.avoid > 0);
    if (!F.zones.length && !avoiders.length) { mask = null; return; }
    mask = new Uint8Array(w * h);
    for (const z of F.zones) {
      const P = z.pts.map(([la, lo]) => [T.colOf(lo), T.rowOf(la)]);
      let c0 = Infinity, c1 = -Infinity, r0 = Infinity, r1 = -Infinity;
      P.forEach(([c, r]) => { c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r); });
      c0 = Math.max(0, Math.floor(c0)); c1 = Math.min(w - 1, Math.ceil(c1)); r0 = Math.max(0, Math.floor(r0)); r1 = Math.min(h - 1, Math.ceil(r1));
      for (let r = r0; r <= r1; r++) {
        // scan-line fill: crossings of this row's centre line with the polygon edges
        const xs = [];
        for (let i = 0, j = P.length - 1; i < P.length; j = i++) {
          const [xi, yi] = P[i], [xj, yj] = P[j];
          if ((yi > r) !== (yj > r)) xs.push(xi + (r - yi) / (yj - yi) * (xj - xi));
        }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const a = Math.max(c0, Math.ceil(xs[k] - 0.5)), b = Math.min(c1, Math.floor(xs[k + 1] + 0.5));
          for (let c = a; c <= b; c++) mask[r * w + c] = 1;
        }
      }
    }
    for (const o of avoiders) {
      const c = T.colOf(o.lon), r = T.rowOf(o.lat);
      const rc = o.avoid / T.dx + 0.5, rr = o.avoid / T.dy + 0.5;
      for (let y = Math.max(0, Math.floor(r - rr)); y <= Math.min(h - 1, Math.ceil(r + rr)); y++) {
        for (let x = Math.max(0, Math.floor(c - rc)); x <= Math.min(w - 1, Math.ceil(c + rc)); x++) {
          const ex = (x - c) / rc, ey = (y - r) / rr;
          if (ex * ex + ey * ey <= 1) mask[y * w + x] = 1;
        }
      }
    }
  }

  // ------------------------------------------------------------------ time stamps
  function stamp() {
    const now = new Date(), m = MM.time.at(now, MM.conditions.SITE.lon, MM.conditions.SITE.lat, MM.conditions.SITE.landing);
    return { ts: now.toISOString(), sol: m.sol, lmst: MM.time.hhmm(m.lmst) };
  }
  function when(o) {
    const d = new Date(o.ts);
    const earth = isNaN(d) ? '' : d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
    return (o.sol != null ? 'Sol ' + o.sol + ', ' + o.lmst + ' LMST · ' : '') + earth;
  }

  // ------------------------------------------------------------------ changes
  function changed(reroute) {
    if (reroute) rebuildMask();
    save(); render();
    if (reroute && MM.planner) MM.planner.fieldChanged();
    else if (MM.planner) MM.planner.refresh();
  }
  function addZone(z) { F.zones.push(Object.assign({ id: 'z' + seq++ }, z)); changed(true); }
  function addObs(o) { F.obs.push(Object.assign({ id: 'o' + seq++ }, o)); changed(o.avoid > 0); }
  function removeZone(id) { F.zones = F.zones.filter((z) => z.id !== id); MM.map.closePopup(); changed(true); }
  function removeObs(id) { const o = F.obs.find((x) => x.id === id); F.obs = F.obs.filter((x) => x.id !== id); MM.map.closePopup(); changed(!!(o && o.avoid > 0)); }
  function clearAll() { if (!F.zones.length && !F.obs.length) return; F.zones = []; F.obs = []; changed(true); }

  // ------------------------------------------------------------------ persistence
  function serialize() {
    if (!F.zones.length && !F.obs.length) return null;
    const r6 = (v) => Number(v.toFixed(6));
    return {
      z: F.zones.map((z) => [z.kind, z.note || '', z.pts.map(([a, b]) => [r6(a), r6(b)]), z.ts || '', z.author || '']),
      o: F.obs.map((o) => [r6(o.lat), r6(o.lon), o.kind, o.conf, o.note || '', o.author || '', o.ts || '', o.sol != null ? o.sol : null, o.lmst || '', o.avoid || 0]),
    };
  }
  function load(d, opts) {
    const T = MM.terrain;
    F.zones = ((d && d.z) || []).filter((a) => Array.isArray(a[2]) && a[2].length >= 3).map((a) => ({ id: 'z' + seq++, kind: ZONE_KINDS[a[0]] ? a[0] : 'other', note: String(a[1] || '').slice(0, 300), pts: a[2].map((p) => [Number(p[0]), Number(p[1])]), ts: a[3] || '', author: String(a[4] || '').slice(0, 60) }));
    F.obs = ((d && d.o) || []).filter((a) => T.inside(a[0], a[1])).map((a) => ({ id: 'o' + seq++, lat: Number(a[0]), lon: Number(a[1]), kind: OBS_KINDS[a[2]] ? a[2] : 'landmark', conf: CONF[a[3]] ? a[3] : 'observed',
      note: String(a[4] || '').slice(0, 500), author: String(a[5] || '').slice(0, 60), ts: a[6] || '', sol: a[7], lmst: a[8] || '', avoid: AVOID.includes(Number(a[9])) ? Number(a[9]) : 0 }));
    rebuildMask(); render();
    if (!opts || opts.save !== false) save();
  }
  function save() { try { const s = serialize(); if (s) localStorage.setItem(STORE, JSON.stringify(s)); else localStorage.removeItem(STORE); } catch (e) { /* private mode */ } }
  function restore() { try { const s = localStorage.getItem(STORE); if (s) load(JSON.parse(s), { save: false }); } catch (e) { /* ignore */ } }

  // ------------------------------------------------------------------ map drawing
  function render() {
    const map = MM.map;
    if (layer) map.removeLayer(layer);
    layer = L.layerGroup().addTo(map);
    for (const z of F.zones) {
      const k = ZONE_KINDS[z.kind];
      const pg = L.polygon(z.pts, { pane: 'zones', color: '#ef476f', weight: 2, dashArray: '6 5', fillColor: '#ef476f', fillOpacity: 0.22, className: 'nogo-zone' });
      pg.bindTooltip('No-go zone: ' + esc(k.label), { sticky: true });
      pg.bindPopup(`<div class="pop"><div class="pop-kind" style="color:var(--nogo)">No-go zone</div><div class="pop-name">${esc(k.label)}</div>
        ${z.note ? '<p>' + esc(z.note) + '</p>' : ''}<div class="pop-meta">${esc(when(z))}${z.author ? ' · ' + esc(z.author) : ''}</div>
        <p class="pop-src">Routes treat this area as impassable.</p>
        <button class="ghost-btn sm danger" data-rm-zone="${z.id}">Remove zone</button></div>`, { maxWidth: 270, className: 'mm-popup' });
      pg.on('click', (e) => L.DomEvent.stopPropagation(e));
      layer.addLayer(pg);
    }
    for (const o of F.obs) {
      const k = OBS_KINDS[o.kind];
      if (o.avoid > 0) layer.addLayer(L.circle([o.lat, o.lon], { radius: o.avoid, pane: 'zones', color: '#ef476f', weight: 1.5, dashArray: '4 5', fillColor: '#ef476f', fillOpacity: 0.14, interactive: false }));
      const mk = L.marker([o.lat, o.lon], { pane: 'pins', zIndexOffset: 500,
        icon: L.divIcon({ className: '', html: `<div class="obs-pin" style="--c:${k.color}"><span>${k.icon}</span></div>`, iconSize: [24, 24], iconAnchor: [12, 24] }) });
      mk.bindTooltip(esc(k.label) + (o.note ? ': ' + esc(o.note.slice(0, 60)) : ''), { direction: 'top', offset: [0, -22] });
      mk.bindPopup(`<div class="pop"><div class="pop-kind" style="color:${k.color}">Field report · ${esc(k.label)}</div>
        <div class="pop-name">${esc(o.note || k.label)}</div>
        <div class="conf-tag ${o.conf}">${CONF[o.conf].label}</div>
        <div class="pop-meta">${esc(when(o))}${o.author ? ' · ' + esc(o.author) : ''}<br>${o.lat.toFixed(5)}° N, ${o.lon.toFixed(5)}° E</div>
        ${o.avoid ? '<p class="pop-src">Routes keep ' + o.avoid + ' m away from this point.</p>' : ''}
        <div class="row-btns" style="margin:10px 0 0"><button class="ghost-btn sm" data-edit-obs="${o.id}">Edit</button><button class="ghost-btn sm danger" data-rm-obs="${o.id}">Remove</button></div></div>`, { maxWidth: 270, className: 'mm-popup', offset: [0, -18] });
      mk.on('click', (e) => L.DomEvent.stopPropagation(e));
      layer.addLayer(mk);
    }
    renderList();
  }

  function renderList() {
    const el = $('field-list'); if (!el) return;
    const rows = F.zones.map((z) => `<li data-zone="${z.id}"><span class="fl-ico zone">${ZONE_KINDS[z.kind].icon}</span><span class="fl-main"><b>No-go: ${esc(ZONE_KINDS[z.kind].label)}</b><small>${esc(z.note || area(z))}</small></span><button data-rm-zone="${z.id}" title="Remove">×</button></li>`)
      .concat(F.obs.map((o) => { const k = OBS_KINDS[o.kind]; return `<li data-obs="${o.id}"><span class="fl-ico" style="--c:${k.color}">${k.icon}</span><span class="fl-main"><b>${esc(o.note ? o.note.slice(0, 48) : k.label)}</b><small>${esc(k.label)} · <span class="conf-tag ${o.conf}">${CONF[o.conf].label}</span>${o.avoid ? ' · keep ' + o.avoid + ' m away' : ''}${o.sol != null ? ' · sol ' + o.sol : ''}</small></span><button data-rm-obs="${o.id}" title="Remove">×</button></li>`; }));
    el.innerHTML = rows.join('');
    $('field-empty').hidden = rows.length > 0;
    $('btn-field-clear').hidden = rows.length === 0;
  }
  function area(z) {
    const T = MM.terrain; let a = 0;
    for (let i = 0, j = z.pts.length - 1; i < z.pts.length; j = i++) {
      a += (z.pts[j][1] * T.mPerDegLon) * (z.pts[i][0] * T.mPerDegLat) - (z.pts[i][1] * T.mPerDegLon) * (z.pts[j][0] * T.mPerDegLat);
    }
    a = Math.abs(a / 2);
    return (a > 1e6 ? (a / 1e6).toFixed(2) + ' km²' : Math.round(a / 100) * 100 + ' m²') + ' blocked';
  }

  // ------------------------------------------------------------------ drawing modes
  function setMode(m) {
    cancelDraft();
    mode = m;
    document.body.classList.toggle('drawing', !!m);
    $('map').classList.toggle('drawing', !!m);
    $('btn-zone').classList.toggle('on', m === 'zone');
    $('btn-obs').classList.toggle('on', m === 'obs');
    if (m === 'zone') MM.map.doubleClickZoom.disable(); else MM.map.doubleClickZoom.enable();
    drawBar();
    if (m && window.innerWidth <= 900) { document.body.classList.remove('panel-open'); setTimeout(() => MM.map.invalidateSize(), 260); }
  }
  function drawBar() {
    const bar = $('draw-bar');
    if (!mode) { bar.hidden = true; return; }
    bar.hidden = false;
    const n = draft.length;
    $('draw-msg').innerHTML = mode === 'zone'
      ? (n === 0 ? '<b>Draw a no-go zone.</b> Click the map to place the corners.' : n < 3 ? '<b>' + n + ' corner' + (n > 1 ? 's' : '') + '.</b> Keep clicking; a zone needs at least 3.' : '<b>' + n + ' corners.</b> Click the first corner or press Finish to close the zone.')
      : '<b>Add a field report.</b> Click the spot on the map.';
    $('draw-finish').hidden = mode !== 'zone';
    $('draw-finish').disabled = n < 3;
    $('draw-undo').hidden = mode !== 'zone' || n === 0;
  }
  function cancelDraft() {
    draft = [];
    if (draftLayer) { MM.map.removeLayer(draftLayer); draftLayer = null; }
    if (rubber) { MM.map.removeLayer(rubber); rubber = null; }
  }
  function redrawDraft() {
    if (draftLayer) MM.map.removeLayer(draftLayer);
    draftLayer = L.layerGroup().addTo(MM.map);
    if (draft.length > 1) draftLayer.addLayer(L.polygon(draft, { pane: 'zones', color: '#ef476f', weight: 2, dashArray: '4 4', fillOpacity: 0.12, interactive: false }));
    draft.forEach((p, i) => {
      const c = L.circleMarker(p, { pane: 'pins', radius: i === 0 ? 7 : 5, color: '#fff', weight: 2, fillColor: '#ef476f', fillOpacity: 1, bubblingMouseEvents: false });
      if (i === 0) c.on('click', (e) => { L.DomEvent.stopPropagation(e); if (draft.length >= 3) finishZone(); });
      else c.options.interactive = false;
      draftLayer.addLayer(c);
    });
    drawBar();
  }
  function onMapClick(e) {
    if (!mode) return;
    if (e.originalEvent) e.originalEvent._mmField = true;   // tells the planner this click was for drawing
    const T = MM.terrain, p = [e.latlng.lat, e.latlng.lng];
    if (!T.inside(p[0], p[1])) { MM.toast('Draw inside the elevation model (the dashed yellow box). Routes cannot be planned outside it.', 'warn'); return; }
    if (mode === 'obs') { const m = mode; setMode(null); if (m) obsForm(null, p); return; }
    if (draft.length >= 3) {
      const a = MM.map.latLngToContainerPoint(draft[0]), b = e.containerPoint;
      if (a.distanceTo(b) < 14) { finishZone(); return; }
    }
    draft.push(p); redrawDraft();
  }
  function onMouseMove(e) {
    if (mode !== 'zone' || !draft.length) return;
    const pts = [draft[draft.length - 1], [e.latlng.lat, e.latlng.lng]];
    if (!rubber) rubber = L.polyline(pts, { pane: 'zones', color: '#ef476f', weight: 1.5, dashArray: '3 5', interactive: false }).addTo(MM.map);
    else rubber.setLatLngs(pts);
  }
  function finishZone() {
    if (draft.length < 3) return;
    const pts = draft.slice();
    setMode(null);
    zoneForm(pts);
  }

  // ------------------------------------------------------------------ forms
  const opt = (obj, cur) => Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(v.label)}</option>`).join('');
  function author() { try { return localStorage.getItem('marswalk-author') || ''; } catch (e) { return ''; } }
  function rememberAuthor(a) { try { localStorage.setItem('marswalk-author', a); } catch (e) { /* ignore */ } }

  function zoneForm(pts) {
    MM.app.modal(`<form class="fform" id="fform">
      <div class="fform-k">New no-go zone</div>
      <h2>Why can't the crew cross here?</h2>
      <p class="hint">Every route will go around this area. You can remove it later from the map or the Plan tab.</p>
      <div class="field"><label for="ff-kind">Hazard</label><select id="ff-kind">${opt(ZONE_KINDS, 'sand')}</select></div>
      <div class="field"><label for="ff-note">Note (optional)</label><textarea id="ff-note" rows="2" maxlength="300" placeholder="e.g. Ripples of soft sand seen in HiRISE, boots will sink"></textarea></div>
      <div class="field"><label for="ff-author">Reported by (optional)</label><input id="ff-author" type="text" maxlength="60" value="${esc(author())}" placeholder="Name or call sign"></div>
      <div class="row-btns"><button type="submit" class="primary-btn">Save zone and re-plan</button><button type="button" class="ghost-btn" id="ff-cancel">Cancel</button></div>
    </form>`);
    $('ff-cancel').addEventListener('click', () => MM.app.closeModal());
    $('fform').addEventListener('submit', (e) => {
      e.preventDefault();
      const a = $('ff-author').value.trim(); rememberAuthor(a);
      MM.app.closeModal();
      const s = stamp();
      addZone({ kind: $('ff-kind').value, note: $('ff-note').value.trim(), pts, ts: s.ts, sol: s.sol, lmst: s.lmst, author: a });
      MM.toast('No-go zone saved. Routes now go around it.', 'ok');
    });
    setTimeout(() => $('ff-kind').focus(), 30);
  }

  function obsForm(id, p) {
    const o = id ? F.obs.find((x) => x.id === id) : null;
    const cur = o || { kind: 'hazard', conf: 'observed', note: '', author: author(), avoid: 0 };
    MM.app.modal(`<form class="fform" id="fform">
      <div class="fform-k">${o ? 'Edit field report' : 'New field report'} · ${(o ? o.lat : p[0]).toFixed(5)}° N, ${(o ? o.lon : p[1]).toFixed(5)}° E</div>
      <h2>What did the crew find?</h2>
      <div class="field two">
        <div><label for="ff-kind">Type</label><select id="ff-kind">${opt(OBS_KINDS, cur.kind)}</select></div>
        <div><label for="ff-author">Reported by</label><input id="ff-author" type="text" maxlength="60" value="${esc(cur.author)}" placeholder="Name or call sign"></div>
      </div>
      <div class="field"><label for="ff-note">Note</label><textarea id="ff-note" rows="3" maxlength="500" placeholder="e.g. Loose rocks on the slope, about 30 m wide">${esc(cur.note)}</textarea></div>
      <div class="field"><label>How do we know?</label>
        <div class="conf-pick">${Object.entries(CONF).map(([k, v]) => `<label class="conf-opt"><input type="radio" name="ff-conf" value="${k}" ${k === cur.conf ? 'checked' : ''}><span><b class="conf-tag ${k}">${v.label}</b><small>${v.text}</small></span></label>`).join('')}</div>
      </div>
      <div class="field" id="ff-avoid-row"><label for="ff-avoid">Keep routes away from this point</label>
        <div class="seg" id="ff-avoid">${AVOID.map((v) => `<button type="button" data-v="${v}" class="${v === (cur.avoid || 0) ? 'on' : ''}">${v ? v + ' m' : 'No'}</button>`).join('')}</div></div>
      <div class="row-btns"><button type="submit" class="primary-btn">${o ? 'Save changes' : 'Save report'}</button><button type="button" class="ghost-btn" id="ff-cancel">Cancel</button></div>
    </form>`);
    let avoid = cur.avoid || 0;
    const syncAvoid = () => { $('ff-avoid-row').hidden = $('ff-kind').value !== 'hazard'; };
    $('ff-kind').addEventListener('change', syncAvoid); syncAvoid();
    $('ff-avoid').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; avoid = Number(b.dataset.v); $('ff-avoid').querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); });
    $('ff-cancel').addEventListener('click', () => MM.app.closeModal());
    $('fform').addEventListener('submit', (e) => {
      e.preventDefault();
      const kind = $('ff-kind').value, a = $('ff-author').value.trim(); rememberAuthor(a);
      const vals = { kind, note: $('ff-note').value.trim(), author: a, conf: (document.querySelector('input[name=ff-conf]:checked') || {}).value || 'observed', avoid: kind === 'hazard' ? avoid : 0 };
      MM.app.closeModal();
      if (o) { const reroute = (o.avoid || 0) !== vals.avoid; Object.assign(o, vals); changed(reroute); }
      else { const s = stamp(); addObs(Object.assign({ lat: p[0], lon: p[1] }, s, vals)); MM.toast(vals.avoid ? 'Report saved. Routes now keep ' + vals.avoid + ' m away from it.' : 'Field report saved.', 'ok'); }
    });
    setTimeout(() => $('ff-note').focus(), 30);
  }

  // ------------------------------------------------------------------ planner hooks
  /** Field reports and zones that matter to a route: what it avoids and hazards it passes close to. */
  function nearRoute(m, radius) {
    const T = MM.terrain, out = [];
    for (const o of F.obs) {
      if (o.kind !== 'hazard') continue;
      let best = Infinity;
      for (let k = 0; k < m.lat.length; k += 2) { const d = T.dist(o.lat, o.lon, m.lat[k], m.lon[k]); if (d < best) best = d; }
      if (best <= (radius || 100) + (o.avoid || 0)) out.push({ o, d: best });
    }
    return out;
  }

  function geojson() {
    const f = [];
    F.zones.forEach((z) => f.push({ type: 'Feature', properties: { kind: 'no-go-zone', hazard: ZONE_KINDS[z.kind].label, note: z.note || '', reported_by: z.author || '', time_utc: z.ts || '', sol: z.sol != null ? z.sol : null },
      geometry: { type: 'Polygon', coordinates: [z.pts.concat([z.pts[0]]).map(([la, lo]) => [Number(lo.toFixed(6)), Number(la.toFixed(6))])] } }));
    F.obs.forEach((o) => f.push({ type: 'Feature', properties: { kind: 'field-report', type: OBS_KINDS[o.kind].label, confidence: CONF[o.conf].label, note: o.note || '', reported_by: o.author || '',
      time_utc: o.ts || '', sol: o.sol != null ? o.sol : null, lmst: o.lmst || '', keep_away_m: o.avoid || 0 },
      geometry: { type: 'Point', coordinates: [Number(o.lon.toFixed(6)), Number(o.lat.toFixed(6))] } }));
    return f;
  }

  function init() {
    const map = MM.map;
    map.createPane('zones').style.zIndex = 425;
    map.on('click', onMapClick);
    map.on('mousemove', onMouseMove);
    $('btn-zone').addEventListener('click', () => setMode(mode === 'zone' ? null : 'zone'));
    $('btn-obs').addEventListener('click', () => setMode(mode === 'obs' ? null : 'obs'));
    $('draw-cancel').addEventListener('click', () => setMode(null));
    $('draw-finish').addEventListener('click', finishZone);
    $('draw-undo').addEventListener('click', () => { draft.pop(); if (rubber) { map.removeLayer(rubber); rubber = null; } redrawDraft(); });
    $('btn-field-clear').addEventListener('click', clearAll);
    document.addEventListener('click', (e) => {
      const z = e.target.closest('[data-rm-zone]'); if (z) { e.stopPropagation(); removeZone(z.dataset.rmZone); return; }
      const r = e.target.closest('[data-rm-obs]'); if (r) { e.stopPropagation(); removeObs(r.dataset.rmObs); return; }
      const ed = e.target.closest('[data-edit-obs]'); if (ed) { map.closePopup(); obsForm(ed.dataset.editObs); return; }
      const li = e.target.closest('#field-list li');
      if (li) {
        const zz = F.zones.find((x) => x.id === li.dataset.zone), oo = F.obs.find((x) => x.id === li.dataset.obs);
        if (zz) map.flyToBounds(L.latLngBounds(zz.pts), { maxZoom: 16, duration: 0.6, padding: [60, 60] });
        if (oo) map.flyTo([oo.lat, oo.lon], Math.max(map.getZoom(), 15), { duration: 0.6 });
        if (window.innerWidth <= 900) document.body.classList.remove('panel-open');
      }
    });
    document.addEventListener('keydown', (e) => {
      if (!mode) return;
      if (e.key === 'Escape') { e.stopImmediatePropagation(); setMode(null); }
      else if (e.key === 'Enter' && mode === 'zone' && draft.length >= 3) finishZone();
      else if (e.key === 'Backspace' && mode === 'zone' && draft.length && !/input|textarea|select/i.test(document.activeElement.tagName)) { draft.pop(); redrawDraft(); }
    }, true);
    restore();
    render();
  }

  MM.field = {
    init, load, serialize, geojson, nearRoute, setMode,
    mask: () => mask, version: () => version, drawing: () => !!mode,
    zones: () => F.zones, observations: () => F.obs, ZONE_KINDS, OBS_KINDS, CONF,
  };
})();
