/*
 * Science targets: Perseverance sample sites, the sample depot and landmarks.
 */
(function () {
  'use strict';
  const MM = (window.MM = window.MM || {});
  const KIND = {
    sample: { label: 'Sample site', icon: '◆', color: '#f2c14e' },
    depot: { label: 'Sample depot', icon: '★', color: '#f4845f' },
    landmark: { label: 'Landmark', icon: '●', color: '#5fd3ef' },
  };
  let targets = [], markers = {}, filter = 'all';

  function build() {
    targets = window.MM_TARGETS_ROVER.map((t) => Object.assign({}, t));
    // Ingenuity landmarks come straight from the flight-path data.
    const fl = window.MM_ROVER.flights;
    const T = MM.terrain;
    const add = (id, name, p, sol, why, sample) => targets.push({
      id, name, kind: 'landmark', sol, unit: 'Crater floor', sample: sample || null, why, stop_min: 15,
      lon: p[0], lat: p[1], elev_m: Math.round(T.elev(p[1], p[0]) * 10) / 10,
      source: 'Position: Ingenuity flight-path data (NASA/JPL-Caltech)',
    });
    if (fl && fl.length) {
      const f1 = fl[0], fN = fl[fl.length - 1];
      add('wright', 'Wright Brothers Field', f1.pts[0], f1.sol,
        'Where Ingenuity made the first powered, controlled flight on another planet on 19 April 2021. A heritage site for every future aviator on Mars.');
      add('valinor', 'Valinor Hills Station', fN.pts[fN.pts.length - 1], fN.sol,
        'Ingenuity\'s final resting place after flight 72 in January 2024. The airframe is a long-duration materials exposure experiment waiting to be inspected.', 'Ingenuity airframe');
    }
    targets.sort((a, b) => a.sol - b.sol);
    return targets;
  }

  function popupHtml(t) {
    const k = KIND[t.kind];
    return `<div class="pop">
      <div class="pop-kind" style="color:${k.color}">${k.icon} ${k.label} · sol ${t.sol}</div>
      <div class="pop-name">${t.name}</div>
      <div class="pop-meta">${t.unit}${t.sample ? ' · <b>' + t.sample + '</b>' : ''}</div>
      <p>${t.why}</p>
      <div class="pop-meta">${t.lat.toFixed(5)}° N, ${t.lon.toFixed(5)}° E · ${Math.round(t.elev_m)} m · suggested stop ${t.stop_min} min</div>
      <div class="pop-src">${t.source}</div>
      <button class="primary-btn sm" data-add-target="${t.id}">Add to route</button>
    </div>`;
  }

  function init() {
    build();
    const grp = MM.layers.targetsGroup();
    for (const t of targets) {
      const k = KIND[t.kind];
      const m = L.marker([t.lat, t.lon], {
        pane: 'pins', riseOnHover: true,
        icon: L.divIcon({ className: '', html: `<div class="tpin ${t.kind}" style="--c:${k.color}">${k.icon}</div>`, iconSize: [22, 22], iconAnchor: [11, 11] }),
      });
      m.bindTooltip(t.name, { direction: 'top', offset: [0, -8] });
      m.bindPopup(popupHtml(t), { maxWidth: 300, className: 'mm-popup' });
      m.on('click', (e) => { L.DomEvent.stopPropagation(e); });
      grp.addLayer(m);
      markers[t.id] = m;
    }
    document.addEventListener('click', (e) => {
      const b = e.target.closest('[data-add-target]');
      if (b) { MM.planner.addTarget(b.dataset.addTarget); MM.map.closePopup(); MM.app.showTab('plan'); }
      const s = e.target.closest('[data-show-target]');
      if (s) show(s.dataset.showTarget);
    });
    document.getElementById('sci-filter').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      filter = b.dataset.v;
      document.querySelectorAll('#sci-filter button').forEach((n) => n.classList.toggle('on', n === b));
      renderList();
    });
    renderList();
    MM.map.on('zoomend', declutter);
    grp.on('add', declutter);
    declutter();
  }

  /**
   * Keep the map readable when zoomed out. Markers are placed in order of importance; one that
   * would sit on top of a marker already placed shrinks to a small dot (still hoverable and
   * clickable), and one that is a stop on the current route hides behind its numbered pin.
   * Zooming in separates them and every marker returns to full size.
   */
  const RANK = { depot: 0, landmark: 1, sample: 2 };
  function declutter() {
    const map = MM.map;
    if (!map || !targets.length) return;
    const z = map.getZoom();
    map.getContainer().classList.toggle('zoomed-out', z < 12.5);
    const stops = MM.planner && MM.planner.serialize ? MM.planner.serialize().s : [];
    const onRoute = new Set(stops.map((a) => a[2]).filter(Boolean));
    const pins = stops.map((a) => map.latLngToLayerPoint([a[0], a[1]]));
    const near = (list, p, r) => list.some((q) => Math.abs(q.x - p.x) < r && Math.abs(q.y - p.y) < r && q.distanceTo(p) < r);
    const placed = [];
    targets.slice().sort((a, b) => RANK[a.kind] - RANK[b.kind] || (a.id === 'oeb' ? -1 : b.id === 'oeb' ? 1 : a.sol - b.sol)).forEach((t) => {
      const el = markers[t.id] && markers[t.id].getElement();
      if (!el) return;
      const p = map.latLngToLayerPoint([t.lat, t.lon]);
      const hide = onRoute.has(t.id) || near(pins, p, 12) || near(placed, p, 9);   // 9 px: effectively the same spot
      const mini = !hide && (z < 10.5 || near(pins, p, 27) || near(placed, p, 25));
      el.classList.toggle('t-hide', hide);
      el.classList.toggle('t-mini', mini);
      markers[t.id].setZIndexOffset(mini ? -1000 : 0);                              // dots tuck behind full markers
      if (!hide && !mini) placed.push(p);
    });
  }

  function renderList() {
    const el = document.getElementById('sci-list');
    el.innerHTML = targets.filter((t) => filter === 'all' || t.kind === filter).map((t) => {
      const k = KIND[t.kind];
      return `<div class="sci">
        <div class="sci-top"><span class="sci-ico" style="color:${k.color}">${k.icon}</span>
          <div><div class="sci-name">${t.name}</div><div class="sci-meta">${t.unit} · sol ${t.sol}${t.sample ? ' · ' + t.sample : ''}</div></div></div>
        <p>${t.why}</p>
        <div class="row-btns"><button class="ghost-btn sm" data-show-target="${t.id}">Show on map</button>
          <button class="primary-btn sm" data-add-target="${t.id}">Add to route</button></div>
      </div>`;
    }).join('');
  }

  function show(id) {
    const t = get(id); if (!t) return;
    if (!MM.layers.isOn('targets')) MM.layers.toggle('targets', true);
    MM.map.flyTo([t.lat, t.lon], Math.max(MM.map.getZoom(), 14.5), { duration: 0.8 });
    setTimeout(() => markers[id].openPopup(), 850);
    MM.app.closePanelOnMobile();
  }

  const get = (id) => targets.find((t) => t.id === id);
  MM.science = { init, get, all: () => targets, show, declutter, KIND };
})();
