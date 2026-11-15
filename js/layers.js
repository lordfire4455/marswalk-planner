/*
 * Map, base maps and data layers.
 * Tiles come live from NASA Solar System Treks (trek.nasa.gov). Terrain-derived
 * layers are rendered in the browser from the bundled DEM, so they work offline.
 */
(function () {
  'use strict';
  const MM = (window.MM = window.MM || {});
  const TREK = 'https://trek.nasa.gov/tiles/Mars/EQ/';
  const trek = (id, ext) => TREK + id + '/1.0.0/default/default028mm/{z}/{y}/{x}.' + ext;
  const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
  const JEZERO = { lat: 18.4446, lon: 77.4509 };

  const L_ = {};
  let map;
  const state = { base: 'imagery', overlays: {}, opacity: {} };
  const tileStats = { ok: 0, err: 0, switched: false };

  function tile(id, ext, o) {
    const layer = L.tileLayer(trek(id, ext), Object.assign({
      tileSize: 256, noWrap: true, maxZoom: 19, errorTileUrl: BLANK, keepBuffer: 3,
      attribution: 'NASA Solar System Treks',
    }, o));
    layer.on('tileload', (e) => { if (e.tile && String(e.tile.src).indexOf('data:') !== 0) tileStats.ok++; });
    layer.on('tileerror', () => { tileStats.err++; });
    return layer;
  }

  // ------------------------------------------------------------------ registry
  const BASES = [
    { id: 'imagery', name: 'Orbital imagery', tag: 'MRO CTX 6 m · HiRISE 25 cm', online: true,
      note: 'Mars Reconnaissance Orbiter. Zoom in past 150 m scale and the 25 cm HiRISE mosaic takes over: you can see individual boulders.' },
    { id: 'relief', name: 'Bundled terrain', tag: 'MRO CTX stereo DEM 20 m', online: false,
      note: 'Shaded relief drawn in your browser from the bundled elevation model. Works with no internet connection.' },
    { id: 'mola', name: 'Regional colour relief', tag: 'MGS MOLA + Mars Express HRSC 200 m', online: true,
      note: 'Wide-area topography for context: Jezero sits on the western rim of the Isidis basin.' },
    { id: 'viking', name: 'Global colour mosaic', tag: 'Viking Orbiter 232 m', online: true,
      note: 'True-colour view of the planet from the Viking orbiters.' },
  ];

  const CRISM_INFO = {
    maf: { name: 'Olivine & pyroxene', key: 'MAF', legend: [['#e5484d', 'Olivine'], ['#3ad6a3', 'Low-calcium pyroxene'], ['#6c7bff', 'High-calcium pyroxene']],
      note: 'Igneous minerals. Red marks olivine, the mineral of the Séítah cumulate rocks and the carbonate-forming unit around the crater margin.' },
    car: { name: 'Carbonates', key: 'CAR', legend: [['#e8e36a', 'Mg-carbonate (green to yellow-white)'], ['#d04fb0', 'Fe/Mg clay (red to magenta)'], ['#5a7dff', 'Other hydrated minerals']],
      note: 'Carbonates form in water and can lock in biosignatures. Jezero\'s "bathtub ring" of carbonate is one reason the site was chosen.' },
    pfm: { name: 'Clay minerals', key: 'PFM', legend: [['#3fd0d8', 'Fe/Mg smectite clay (cyan)'], ['#e6b23c', 'Chlorite, prehnite or Fe/Ca carbonate (red to yellow)']],
      note: 'Clays settle out of standing water. The delta is rich in Fe/Mg smectite washed in from the watershed.' },
  };

  const OVERLAYS = [
    { id: 'hazard', group: 'Terrain', name: 'Slope hazard', tag: 'Computed · MRO CTX DEM', on: true, opacity: 0.6,
      note: 'Slope of every 20 m cell. Green is easy walking; anything above your slope limit is drawn as no-go.' },
    { id: 'elevation', group: 'Terrain', name: 'Elevation & contours', tag: 'MRO CTX DEM', on: false, opacity: 0.75,
      note: 'Height above the Mars reference surface. Thin contours every 50 m, bold every 250 m.' },
    { id: 'themis', group: 'Surface', name: 'Night-time heat', tag: 'Mars Odyssey THEMIS 100 m', on: false, opacity: 0.7, online: true,
      note: 'Infrared at night. Bright ground stayed warm: bedrock and boulders, firm footing. Dark ground cooled fast: loose sand and dust, soft footing.' },
    { id: 'crism_maf', group: 'Minerals', name: CRISM_INFO.maf.name, tag: 'MRO CRISM', on: false, opacity: 0.8, note: CRISM_INFO.maf.note },
    { id: 'crism_car', group: 'Minerals', name: CRISM_INFO.car.name, tag: 'MRO CRISM', on: false, opacity: 0.8, note: CRISM_INFO.car.note },
    { id: 'crism_pfm', group: 'Minerals', name: CRISM_INFO.pfm.name, tag: 'MRO CRISM', on: false, opacity: 0.8, note: CRISM_INFO.pfm.note },
    { id: 'rover', group: 'Missions', name: 'Perseverance traverse', tag: 'Mars 2020 rover', on: true, opacity: 1,
      note: 'Every metre the rover has driven: a proven, hazard-checked path through this terrain.' },
    { id: 'heli', group: 'Missions', name: 'Ingenuity flights', tag: 'Mars Helicopter', on: false, opacity: 1,
      note: 'Ground tracks of all 72 flights of the first aircraft on another planet.' },
    { id: 'targets', group: 'Missions', name: 'Science targets', tag: 'Mars 2020 sample sites', on: true, opacity: 1,
      note: 'Sample sites, the Three Forks depot and landmarks. Click one for details.' },
    { id: 'validation', group: 'Proof', name: 'Planner vs Perseverance', tag: 'Validation · 40 stretches', on: false, opacity: 1,
      note: 'Cyan: the route this planner picks between the same start and end as each 1 km of Perseverance\'s real drive (white). The two agree within 100 m for most of the way.' },
  ];

  // ------------------------------------------------------------------ helpers
  function canvasOverlay(render, pane, opacity) {
    // Lazy: the raster is only rendered the first time the layer is shown.
    const holder = L.layerGroup();
    holder._mmRender = function () {
      if (holder._img) return;
      const cv = render();
      holder._img = L.imageOverlay(cv.toDataURL('image/png'), MM.terrain.bounds(), { pane, opacity, interactive: false });
      holder.addLayer(holder._img);
    };
    holder.on('add', holder._mmRender);
    holder.setOpacity = (v) => { holder._opacity = v; if (holder._img) holder._img.setOpacity(v); };
    holder._redraw = function () {
      if (!holder._img) return;
      holder.removeLayer(holder._img); holder._img = null;
      if (map.hasLayer(holder)) { holder._mmRender(); if (holder._opacity != null) holder._img.setOpacity(holder._opacity); }
    };
    return holder;
  }

  function crismLayer(prod, opacity) {
    const grp = L.layerGroup();
    const imgs = [];
    for (const s of window.MM_CRISM.scenes) {
      if (!s.files[prod]) continue;
      const im = L.imageOverlay(s.files[prod], s.bounds, { pane: 'raster', opacity, interactive: false });
      imgs.push(im); grp.addLayer(im);
    }
    grp.setOpacity = (v) => imgs.forEach((i) => i.setOpacity(v));
    return grp;
  }

  /** The planner's routes for each validated stretch of Perseverance's drive (data/validation.js). */
  function validationLayer() {
    const grp = L.layerGroup(), V = window.MM_VALIDATION;
    if (!V) return grp;
    for (const s of V.stretches) {
      if (!s.ok) continue;
      grp.addLayer(L.polyline(s.line, { pane: 'tracks', color: '#5fd3ef', weight: 3, opacity: 0.95, interactive: true })
        .bindTooltip(`Planner ${(s.plan_m / 1000).toFixed(2)} km · rover ${(s.rover_m / 1000).toFixed(2)} km · ${Math.round(s.within100 * 100)}% within 100 m`, { sticky: true }));
      grp.addLayer(L.circleMarker(s.from, { pane: 'tracks', radius: 3, color: '#5fd3ef', weight: 1, fillOpacity: 1, interactive: false }));
    }
    return grp;
  }

  function roverLayer() {
    const R = window.MM_ROVER;
    const grp = L.layerGroup();
    const line = R.traverse.map((p) => [p[1], p[0]]);
    grp.addLayer(L.polyline(line, { color: '#0b0e14', weight: 5, opacity: 0.55, pane: 'tracks', interactive: false }));
    grp.addLayer(L.polyline(line, { color: '#ffffff', weight: 2, opacity: 0.95, pane: 'tracks', dashArray: '1 5', lineCap: 'round', interactive: false }));
    // Sol tick marks every 100 sols.
    let next = 100;
    for (const w of R.waypoints) {
      if (w[0] >= next) {
        grp.addLayer(L.circleMarker([w[2], w[1]], { radius: 3, color: '#0b0e14', weight: 1, fillColor: '#fff', fillOpacity: 1, pane: 'tracks' })
          .bindTooltip('Perseverance, sol ' + w[0] + ' · ' + (w[4] / 1000).toFixed(1) + ' km driven', { direction: 'top' }));
        while (next <= w[0]) next += 100;
      }
    }
    const last = R.waypoints[R.waypoints.length - 1];
    grp.addLayer(L.marker([last[2], last[1]], { pane: 'tracks', icon: L.divIcon({ className: '', html: '<div class="rover-pin" title="Perseverance rover, latest position"><i></i><span>Perseverance</span></div>', iconSize: [14, 14], iconAnchor: [7, 7] }) })
      .bindTooltip('Perseverance position on sol ' + last[0] + ' (latest bundled data): ' + R.total_km + ' km driven', { direction: 'top' }));
    return grp;
  }

  function heliLayer() {
    const R = window.MM_ROVER;
    const grp = L.layerGroup();
    for (const f of R.flights) {
      if (f.pts.length < 2) continue;
      grp.addLayer(L.polyline(f.pts.map((p) => [p[1], p[0]]), { color: '#59c3ff', weight: 2, opacity: 0.9, pane: 'tracks' })
        .bindTooltip('Ingenuity flight ' + f.n + ' · sol ' + f.sol + ' · ' + Math.round(f.len_m) + ' m', { sticky: true }));
    }
    return grp;
  }

  // ------------------------------------------------------------------ init
  function init() {
    const T = MM.terrain;
    const MarsCRS = L.extend({}, L.CRS.EPSG4326, { R: T.radius, code: 'IAU:49900' });
    map = L.map('map', {
      crs: MarsCRS, center: [18.452, 77.418], zoom: 12, minZoom: 6, maxZoom: 18, zoomSnap: 0.5, zoomDelta: 0.5,
      maxBounds: [[10, 69], [27, 86]], maxBoundsViscosity: 0.8, zoomControl: false, preferCanvas: false, worldCopyJump: false,
    });
    L.control.zoom({ position: 'topright' }).addTo(map);
    L.control.scale({ position: 'bottomright', imperial: false, maxWidth: 140 }).addTo(map);
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');

    const pane = (name, z) => { map.createPane(name).style.zIndex = z; };
    pane('raster', 300); pane('hazard', 320); pane('tracks', 410); pane('route', 430); pane('pins', 620);
    map.getPane('hazard').style.imageRendering = 'auto';

    const jez = L.latLngBounds([[18.2110274, 77.1604655], [18.7211945, 77.6991776]]);
    const jezHi = L.latLngBounds([[18.3067994, 77.2229331], [18.669315, 77.583964]]);
    const region = L.latLngBounds([[15.9058484, 75.1537692], [19.4453003, 78.8717121]]);

    L_.base = {
      imagery: L.layerGroup([
        tile('Mars_Viking_MDIM21_ClrMosaic_global_232m', 'jpg', { maxNativeZoom: 7 }),
        tile('Jezero_CTX_BlockAdj_dd', 'png', { maxNativeZoom: 12, bounds: region, minZoom: 7 }),
        tile('JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0', 'png', { maxNativeZoom: 13, bounds: jez, minZoom: 9 }),
        tile('JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd', 'png', { maxNativeZoom: 17, bounds: jezHi, minZoom: 14 }),
      ]),
      relief: (function () {
        const g = canvasOverlay(() => T.renderRelief(), 'tilePane', 1);
        return g;
      })(),
      mola: L.layerGroup([tile('Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw', 'jpg', { maxNativeZoom: 8 })]),
      viking: L.layerGroup([tile('Mars_Viking_MDIM21_ClrMosaic_global_232m', 'jpg', { maxNativeZoom: 7 })]),
    };

    L_.over = {
      hazard: canvasOverlay(() => T.renderHazard(MM.planner ? MM.planner.settings().maxSlope : 20), 'hazard', 0.6),
      elevation: canvasOverlay(() => T.renderElevation(), 'raster', 0.75),
      themis: tile('THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018', 'png', { maxNativeZoom: 9, pane: 'raster', opacity: 0.7 }),
      crism_maf: crismLayer('maf', 0.8), crism_car: crismLayer('car', 0.8), crism_pfm: crismLayer('pfm', 0.8),
      rover: roverLayer(), heli: heliLayer(), targets: L.layerGroup(), validation: validationLayer(),
    };

    // DEM footprint: shows where routing and terrain layers are available.
    L.rectangle(T.bounds(), { color: '#ffd23f', weight: 1, dashArray: '4 6', fill: false, interactive: false, pane: 'tracks', opacity: 0.6 }).addTo(map);

    setBase('imagery');
    for (const o of OVERLAYS) { state.opacity[o.id] = o.opacity; if (o.on) toggle(o.id, true); }
    buildPanel();
    updateLegend();

    map.on('mousemove', onMove);
    map.on('mouseout', () => { document.getElementById('readout').textContent = 'Move the pointer over the map'; });

    // If NASA's tile servers cannot be reached, fall back to the bundled terrain.
    setTimeout(() => {
      if (!tileStats.switched && tileStats.ok === 0 && state.base !== 'relief') {
        tileStats.switched = true;
        setBase('relief');
        MM.toast('NASA map tiles are not reachable right now, so the bundled terrain map is shown. Routing, hazards and science data all still work.', 'warn', 9000);
      }
    }, 7000);
    MM.map = map;
    return map;
  }

  function onMove(e) {
    const T = MM.terrain, el = document.getElementById('readout');
    const { lat, lng } = e.latlng;
    let s = lat.toFixed(4) + '° N  ' + lng.toFixed(4) + '° E';
    if (T.inside(lat, lng)) {
      const z = T.elev(lat, lng), sl = T.slopeAt(lat, lng);
      if (!isNaN(z)) {
        const lim = MM.planner ? MM.planner.settings().maxSlope : 20;      // same rule as the hazard layer and legend
        const c = T.CLASSES[sl > lim ? T.CLASSES.length - 1 : T.classOf(sl)];
        s += '   ·   ' + Math.round(z) + ' m   ·   slope ' + sl.toFixed(1) + '° <i class="dot" style="background:' + c.color + '"></i>' + c.label;
      }
    } else s += '   ·   outside the elevation model';
    if (MM.site && MM.site.state() === 'ready') { const m = MM.site.minerals(lat, lng); if (m && m.length) s += '   ·   CRISM: ' + MM.site.short(m, 2).toLowerCase(); }
    el.innerHTML = s;
  }

  function setBase(id) {
    for (const k in L_.base) if (map.hasLayer(L_.base[k])) map.removeLayer(L_.base[k]);
    L_.base[id].addTo(map);
    state.base = id;
    document.querySelectorAll('#base-list .layer').forEach((n) => n.classList.toggle('on', n.dataset.id === id));
    document.querySelectorAll('#base-list input').forEach((n) => { n.checked = n.value === id; });
  }

  function toggle(id, on) {
    const layer = L_.over[id];
    // Mineral maps are read one at a time: stacking them mixes the colours.
    if (on && id.indexOf('crism_') === 0) for (const k in L_.over) if (k !== id && k.indexOf('crism_') === 0 && state.overlays[k]) toggle(k, false);
    if (on) layer.addTo(map); else map.removeLayer(layer);
    if (on && id === 'validation' && !state.overlays.rover) toggle('rover', true);   // the comparison needs the rover's own track
    state.overlays[id] = on;
    if (on && layer.setOpacity) layer.setOpacity(state.opacity[id]);
    const row = document.querySelector('#overlay-list .layer[data-id="' + id + '"]');
    if (row) { row.classList.toggle('on', on); row.querySelector('input[type=checkbox]').checked = on; }
    updateLegend();
  }

  function setOpacity(id, v) {
    state.opacity[id] = v;
    const layer = L_.over[id];
    if (layer.setOpacity) layer.setOpacity(v);
  }

  function buildPanel() {
    const bl = document.getElementById('base-list');
    bl.innerHTML = BASES.map((b) => `
      <label class="layer" data-id="${b.id}">
        <input type="radio" name="base" value="${b.id}">
        <span class="layer-main"><span class="layer-name">${b.name}${b.online ? '' : ' <em class="pill ok">offline</em>'}</span>
        <span class="layer-tag">${b.tag}</span><span class="layer-note">${b.note}</span></span>
      </label>`).join('');
    bl.addEventListener('change', (e) => { if (e.target.name === 'base') setBase(e.target.value); });

    const ol = document.getElementById('overlay-list');
    let html = '', group = '';
    for (const o of OVERLAYS) {
      if (o.group !== group) { group = o.group; html += `<div class="layer-group">${group}</div>`; }
      const slider = o.id === 'rover' || o.id === 'heli' || o.id === 'targets' ? '' :
        `<input type="range" class="op" min="0.1" max="1" step="0.05" value="${o.opacity}" aria-label="Opacity">`;
      html += `
      <div class="layer" data-id="${o.id}">
        <label class="layer-top"><input type="checkbox">
          <span class="layer-main"><span class="layer-name">${o.name}</span><span class="layer-tag">${o.tag}</span></span></label>
        <span class="layer-note">${o.note}</span>${slider}
      </div>`;
    }
    ol.innerHTML = html;
    ol.addEventListener('change', (e) => {
      const row = e.target.closest('.layer'); if (!row) return;
      if (e.target.type === 'checkbox') toggle(row.dataset.id, e.target.checked);
    });
    ol.addEventListener('input', (e) => {
      const row = e.target.closest('.layer'); if (!row || e.target.type !== 'range') return;
      setOpacity(row.dataset.id, parseFloat(e.target.value));
    });
    for (const id in state.overlays) {
      const row = ol.querySelector('.layer[data-id="' + id + '"]');
      if (row && state.overlays[id]) { row.classList.add('on'); row.querySelector('input[type=checkbox]').checked = true; }
    }
  }

  function updateLegend() {
    const el = document.getElementById('legend');
    const T = MM.terrain;
    let html = '';
    if (state.overlays.hazard) {
      // Match the raster: every class that starts below the slope limit keeps its colour,
      // and everything steeper than the limit is drawn as no-go.
      const lim = MM.planner ? MM.planner.settings().maxSlope : 20;
      const last = T.CLASSES.length - 1, rows = [];
      for (let i = 0; i < last; i++) {
        const lo = i === 0 ? 0 : T.CLASSES[i - 1].max;
        if (lo >= lim) break;
        rows.push([T.CLASSES[i], lo + '–' + Math.min(T.CLASSES[i].max, lim) + '°']);
      }
      rows.push([T.CLASSES[last], '> ' + lim + '°']);
      html += '<div class="lg"><div class="lg-h">Slope hazard</div>' + rows.map(([c, range]) =>
        `<div class="lg-r"><i style="background:${c.color}"></i>${c.label}<span>${range}</span></div>`).join('') + '</div>';
    }
    if (state.overlays.elevation) {
      const stops = [0, 0.25, 0.5, 0.75, 1].map((t) => { const c = T.elevColor(T.minElev + t * (T.maxElev - T.minElev)); return `rgb(${c.map(Math.round).join(',')}) ${t * 100}%`; });
      html += `<div class="lg"><div class="lg-h">Elevation</div><div class="lg-ramp" style="background:linear-gradient(90deg,${stops.join(',')})"></div>
        <div class="lg-ends"><span>${Math.round(T.minElev)} m</span><span>${Math.round(T.maxElev)} m</span></div></div>`;
    }
    for (const p of ['maf', 'car', 'pfm']) {
      if (!state.overlays['crism_' + p]) continue;
      const info = CRISM_INFO[p];
      html += `<div class="lg"><div class="lg-h">CRISM · ${info.name}</div>` + info.legend.map((r) =>
        `<div class="lg-r"><i style="background:${r[0]}"></i>${r[1]}</div>`).join('') + '</div>';
    }
    if (state.overlays.themis) {
      html += '<div class="lg"><div class="lg-h">THEMIS night infrared</div><div class="lg-ramp" style="background:linear-gradient(90deg,#111,#eee)"></div><div class="lg-ends"><span>Loose sand, dust</span><span>Rock</span></div></div>';
    }
    el.innerHTML = html;
    el.hidden = !html;
  }

  MM.layers = {
    init, setBase, toggle, setOpacity, updateLegend, state, JEZERO, OVERLAYS, BASES,
    redrawHazard: () => { L_.over.hazard._redraw(); updateLegend(); },
    targetsGroup: () => L_.over.targets,
    isOn: (id) => !!state.overlays[id],
  };
})();
