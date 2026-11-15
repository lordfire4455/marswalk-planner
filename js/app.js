/*
 * App shell: boot sequence, tabs, modal, toasts, ready-made missions, about.
 * The entrance screen lives in intro.js.
 */
(function () {
  'use strict';
  const MM = (window.MM = window.MM || {});
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------------ toasts
  MM.toast = function (text, kind, ms) {
    const el = document.createElement('div');
    el.className = 'toast ' + (kind || 'info');
    el.textContent = text;
    $('toasts').appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 400); }, ms || 5000);
  };

  // ------------------------------------------------------------------ modal
  function modal(html, cls) {
    $('modal-body').innerHTML = html;
    $('modal').className = 'modal ' + (cls || '');
    $('modal').hidden = false;
    document.body.classList.add('modal-open');
  }
  function closeModal() { $('modal').hidden = true; document.body.classList.remove('modal-open'); }

  // ------------------------------------------------------------------ tabs
  function showTab(name) {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
    document.querySelectorAll('.tabpane').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + name));
    if (name === 'conditions') MM.conditions.render();
    $('map').classList.toggle('adding', name === 'plan' && $('opt-click').checked);
  }
  function closePanelOnMobile() { if (window.innerWidth <= 900) document.body.classList.remove('panel-open'); }

  // ------------------------------------------------------------------ ready-made missions
  const PRESETS = [
    { id: 'depot', icon: '★', title: 'Recover the sample depot', sub: 'Landing site to Three Forks and back. Ten sealed sample tubes are waiting.', stops: ['oeb', 'threeforks'] },
    { id: 'delta', icon: '◆', title: 'Delta-front search for life', sub: 'Four sample sites in ancient lake mud at the foot of the delta.', stops: ['threeforks', 'hidden', 'amalik', 'wildcat', 'skinner'] },
    { id: 'floor', icon: '◆', title: 'Crater-floor volcanic tour', sub: 'Landing site, Sid, the Séítah olivine rocks and Rochette.', stops: ['oeb', 'sid', 'brac', 'issole', 'rochette', 'roubion'] },
    { id: 'bright', icon: '✦', title: 'Bright Angel sortie', sub: 'Rover drop-off at Bunsen Peak, then on foot to the Cheyava Falls rock.', stops: ['bunsen', 'cheyava'] },
  ];
  function runPreset(id) {
    const p = PRESETS.find((x) => x.id === id); if (!p) return;
    const stops = p.stops.map((tid, i) => { const t = MM.science.get(tid); return [t.lat, t.lon, t.id, i === 0 ? 0 : t.stop_min, 0]; });
    MM.planner.load({ s: stops, ms: 20, p: 'nominal', st: 9, lim: 8, rt: 1 });
    showTab('plan'); closePanelOnMobile();
  }

  // ------------------------------------------------------------------ about
  function about() {
    const D = window.MM_DEM, R = window.MM_ROVER, W = window.MM_WEATHER;
    modal(`
      <div class="about">
        <h2>Data &amp; methods</h2>
        <p>Marswalk Planner combines eleven published datasets from six NASA missions into one planning view of Jezero Crater. Nothing is simulated: every layer is a published mission product, and the route engine runs in your browser on the bundled elevation model.</p>
        <h3>Data sources</h3>
        <table class="tbl">
          <thead><tr><th>Layer</th><th>Mission · instrument</th><th>Product and provider</th></tr></thead>
          <tbody>
            <tr><td>Elevation, slope, hazards, routing</td><td>Mars Reconnaissance Orbiter · CTX stereo</td><td>Jezero DTM, 20 m/px (${D.width} × ${D.height} cells), USGS Astrogeology for the Mars 2020 landing; via NASA Mars Trek</td></tr>
            <tr><td>Imagery 6 m</td><td>MRO · CTX</td><td>Jezero controlled orthomosaic, USGS; NASA Mars Trek tiles</td></tr>
            <tr><td>Imagery 25 cm</td><td>MRO · HiRISE</td><td>Jezero controlled orthomosaic, USGS / University of Arizona; NASA Mars Trek tiles</td></tr>
            <tr><td>Minerals</td><td>MRO · CRISM</td><td>MTRDR browse products MAF, CAR, PFM for 4 targeted scenes (2007); NASA PDS Geosciences Node</td></tr>
            <tr><td>Night-time heat</td><td>Mars Odyssey · THEMIS</td><td>Night IR controlled mosaic 100 m, USGS; NASA Mars Trek tiles</td></tr>
            <tr><td>Regional relief</td><td>Mars Global Surveyor · MOLA (with Mars Express HRSC)</td><td>Blended colour hillshade 200 m, USGS; NASA Mars Trek tiles</td></tr>
            <tr><td>Global colour</td><td>Viking Orbiters</td><td>MDIM 2.1 colour mosaic, USGS; NASA Mars Trek tiles</td></tr>
            <tr><td>Rover traverse, sample sites</td><td>Mars 2020 Perseverance</td><td>Mission localization to sol ${R.last_sol} (${R.total_km} km driven); NASA/JPL-Caltech</td></tr>
            <tr><td>Helicopter flights</td><td>Mars 2020 Ingenuity</td><td>Flight paths 1 to ${R.flights.length}; NASA/JPL-Caltech</td></tr>
            <tr><td>Jezero weather</td><td>Perseverance · MEDA</td><td>Daily reports; NASA/JPL-Caltech and CAB (CSIC-INTA)</td></tr>
            <tr><td>Seasonal norms</td><td>MSL Curiosity · REMS</td><td>${W.rems.sols_in_record.toLocaleString()} sols, ${W.rems.first_date} to ${W.rems.last_date}; NASA/JPL-Caltech and CAB (CSIC-INTA)</td></tr>
          </tbody>
        </table>
        <h3>How the planner works</h3>
        <ul>
          <li><b>Slope.</b> Horn's method on the 20 m elevation grid, corrected for the map projection.</li>
          <li><b>Safest route.</b> A* search over 2.4 million cells with 16 directions of movement. The cost of each step is walking time multiplied by a hazard factor that grows with slope. Cells steeper than your limit are impassable.</li>
          <li><b>Walking speed.</b> Function of slope fitted to Apollo 14 traverse data (Marquez 2008), the model inside the NASA / MIT SEXTANT planner, scaled by your chosen pace.</li>
          <li><b>Energy and oxygen.</b> Santee et al. (2001) load-carriage model at Mars gravity (3.71 m/s²) for a 150 kg suited astronaut; oxygen from 4.85 kcal per litre of O₂.</li>
          <li><b>Radio cover.</b> Line of sight from each step to a 10 m mast at base over the elevation model, including the curvature of Mars.</li>
          <li><b>Mars time and Sun.</b> Allison &amp; McEwen (2000), the algorithm behind NASA's Mars24. It reproduces the sol numbers and sunrise times in the mission weather feeds.</li>
          <li><b>Dust risk.</b> Seasonal storm windows by solar longitude (Kass et al. 2016).</li>
          <li><b>Oxygen.</b> Metabolic use per astronaut is checked against the usable oxygen in each suit (0.6 kg by default, close to the primary tank of NASA's ISS spacesuit; editable), keeping 25% in reserve. A crew of one is flagged: EVAs are walked in pairs.</li>
          <li><b>No-go zones and field reports.</b> Areas the crew draws are burned into a mask over the 20 m grid, and the route search treats those cells as impassable. A hazard report can keep routes 50 to 200 m away. Each report carries a confidence label: Measured, Observed or Estimated.</li>
          <li><b>Route options.</b> "Safest" weights slope strongly (hazard factor 1 + 2.5 (s / limit)²); "Fastest" nearly ignores slope below the limit; "Science-rich" adds up to three targets near the route while the suit reserve still holds.</li>
        </ul>
        ${window.MM_VALIDATION ? (() => { const V = window.MM_VALIDATION.summary; return `<h3>Validation against Perseverance</h3>
        <p>${window.MM_VALIDATION.method}</p>
        <ul>
          <li><b>Agreement.</b> ${Math.round(V.within100_overall * 100)}% of the planned routes lie within 100 m of the rover's track (median stretch ${Math.round(V.within100_median * 100)}%, median gap ${V.mean_offset_median_m} m) over ${V.stretches} stretches and ${V.rover_km} km of driving.</li>
          <li><b>Steep ground.</b> ${(V.plan_steep15 * 100).toFixed(1)}% of the planned routes is on slopes over 15°, against ${(V.rover_steep15 * 100).toFixed(1)}% for the rover and ${(V.straight_over15_m / V.straight_km / 10).toFixed(1)}% for straight lines between the same points.</li>
          <li><b>Length.</b> The planner's routes are ${Math.round((1 - V.length_ratio) * 100)}% shorter than the rover's drive, which also detoured to science targets and turned on the spot.</li>
          <li><b>Reproduce it.</b> <code>node tools/validate_routes.js</code> rebuilds <code>data/validation.js</code> from the bundled data.</li>
        </ul>`; })() : ''}
        <h3>Minerals at a point</h3>
        <p>Each CRISM browse image stores three spectral band indices as its red, green and blue channels (Viviano-Beck et al. 2014): MAF for olivine and pyroxene, CAR for clay, carbonate and hydration, PFM for chlorite and Fe/Mg clays. We average the pixels in each 100 m cell (tools/build_minerals.py) and the planner reports a relative strength at each stop: weak, moderate or strong. It shows where a mineral is likely, not how much is there.</p>
        <h3>Limits you should know</h3>
        <ul>
          <li>A 20 m grid cannot see individual rocks or sand ripples. Use the HiRISE layer to check the last metres by eye.</li>
          <li>Weather is a seasonal outlook, not a forecast. The public MEDA feed is not updated every sol.</li>
          <li>Speed and energy models come from Apollo lunar data and are planning estimates.</li>
        </ul>
        <p class="note">Built for the NASA Space Apps Challenge. NASA does not endorse this project. Map library: Leaflet (BSD-2). 3D: three.js (MIT). Source code: <a href="https://github.com/lordfire4455/marswalk-planner" target="_blank" rel="noopener">github.com/lordfire4455/marswalk-planner</a>.</p>
      </div>`, 'wide');
  }

  // ------------------------------------------------------------------ boot
  async function boot() {
    try {
      await MM.terrain.load();
      $('boot-msg').textContent = 'Drawing the map…';
      await new Promise((r) => setTimeout(r, 30));
      MM.layers.init();
      MM.science.init();
      MM.conditions.init();
      MM.field.init();
      MM.planner.init();
      if (MM.site) MM.site.load().then((ok) => { if (ok) { MM.science.refresh(); MM.planner.refresh(); } });

      $('presets').innerHTML = PRESETS.map((p, i) => `<button class="preset" data-preset="${p.id}"><span class="preset-ico">${String(i + 1).padStart(2, '0')}</span><span><b>${p.title}</b><small>${p.sub}</small></span></button>`).join('');
      $('presets').addEventListener('click', (e) => { const b = e.target.closest('[data-preset]'); if (b) runPreset(b.dataset.preset); });
      const onTab = (e) => { const t = e.target.closest('.tab'); if (t) showTab(t.dataset.tab); };
      document.querySelector('.tabs').addEventListener('click', onTab);
      $('topnav').addEventListener('click', onTab);
      $('btn-about').addEventListener('click', about);
      $('nav-about').addEventListener('click', about);
      $('nav-home').addEventListener('click', () => MM.intro.open());
      $('modal-x').addEventListener('click', closeModal);
      $('modal').addEventListener('click', (e) => { if (e.target === $('modal')) closeModal(); });
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (!$('modal').hidden) closeModal(); else MM.intro.close();
      });
      $('btn-intro').addEventListener('click', () => MM.intro.open());
      $('btn-tour').addEventListener('click', () => MM.tour.start());
      $('brand').addEventListener('click', () => MM.intro.open());
      $('menu-btn').addEventListener('click', () => { document.body.classList.toggle('panel-open'); setTimeout(() => MM.map.invalidateSize(), 260); });
      if (window.innerWidth > 900) document.body.classList.add('panel-open');

      $('boot').classList.add('done');
      setTimeout(() => $('boot').remove(), 500);
      // A shared route link opens straight on that route; everyone else lands on the mission overview.
      if (!MM.planner.loadHash()) MM.intro.open();
    } catch (err) {
      console.error(err);
      $('boot-msg').textContent = 'Could not start: ' + err.message;
      $('boot').classList.add('error');
    }
  }

  MM.app = { modal, closeModal, showTab, closePanelOnMobile, runPreset, about, PRESETS };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
