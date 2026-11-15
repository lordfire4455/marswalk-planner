/*
 * Mission overview: the entrance screen. Explains the project in one view, shows live
 * Jezero time, and jumps straight into any of the four planner views.
 * Everything drawn here comes from the bundled data (elevation model, rover traverse,
 * science targets), so it works offline like the rest of the app.
 */
(function () {
  'use strict';
  const MM = (window.MM = window.MM || {});
  const $ = (id) => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';

  // Part of the elevation model used as the backdrop, in DEM cells. The landing site sits at FOCUS.
  const CROP = { x: 0, y: 430, w: 1300, h: 731 };
  const FOCUS = { x: 0.66, y: 0.53 };
  // Smaller window used for the four card pictures: delta front, Three Forks and the landing site.
  const CARD = { x: 520, y: 690, w: 480, h: 200 };

  let built = false, timer = 0, lastFocus = null;

  // ------------------------------------------------------------------ backdrop
  function buildBackdrop(relief) {
    const T = MM.terrain, R = window.MM_ROVER;
    const cv = $('intro-relief');
    cv.width = CROP.w; cv.height = CROP.h;
    cv.getContext('2d').drawImage(relief, CROP.x, CROP.y, CROP.w, CROP.h, 0, 0, CROP.w, CROP.h);

    const svg = $('intro-svg');
    svg.setAttribute('viewBox', `0 0 ${CROP.w} ${CROP.h}`);
    const X = (lon) => T.colOf(lon) - CROP.x, Y = (lat) => T.rowOf(lat) - CROP.y;
    const inCrop = (x, y) => x >= 0 && y >= 0 && x <= CROP.w && y <= CROP.h;
    const el = (name, attrs, text) => {
      const n = document.createElementNS(NS, name);
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      if (text) n.textContent = text;
      svg.appendChild(n); return n;
    };

    // Perseverance's real traverse, drawn as it happened. Parts outside the backdrop are skipped.
    let d = '', pen = false;
    R.traverse.forEach((p) => {
      const x = X(p[0]), y = Y(p[1]);
      if (!inCrop(x, y)) { pen = false; return; }
      d += (pen ? 'L' : 'M') + x.toFixed(1) + ' ' + y.toFixed(1);
      pen = true;
    });
    el('path', { d, class: 'in-trk-glow', pathLength: 1 });
    el('path', { d, class: 'in-trk', pathLength: 1 });

    // Science targets appear one by one along the track.
    const KIND = MM.science.KIND;
    MM.science.all().forEach((t, i) => {
      const x = X(t.lon), y = Y(t.lat);
      if (!inCrop(x, y)) return;
      el('circle', { cx: x, cy: y, r: t.kind === 'depot' ? 5.5 : 3.6, fill: KIND[t.kind].color, class: 'in-dot', style: `animation-delay:${(1.6 + i * 0.16).toFixed(2)}s` });
    });

    // Landing site marker and a few place names.
    const S = MM.conditions.SITE, lx = X(S.lon), ly = Y(S.lat);
    el('circle', { cx: lx, cy: ly, r: 6, class: 'in-ring' });
    el('circle', { cx: lx, cy: ly, r: 6, class: 'in-ring late' });
    el('circle', { cx: lx, cy: ly, r: 4.5, class: 'in-base' });
    el('text', { x: lx - 17, y: ly + 5, class: 'in-lbl strong', 'text-anchor': 'end' }, 'Octavia E. Butler Landing');
  }

  /** Size the backdrop to cover the screen while keeping the landing site in view. */
  function layoutArt() {
    const box = $('intro'), w = box.clientWidth, h = box.clientHeight;
    if (!w || !h) return;
    const k = Math.max(w / CROP.w, h / CROP.h), aw = CROP.w * k, ah = CROP.h * k;
    const want = w > 900 ? FOCUS.x : 0.5;   // on phones the landing site sits mid-screen
    const left = Math.min(0, Math.max(w - aw, w * want - aw * FOCUS.x));
    const top = Math.min(0, Math.max(h - ah, h * 0.5 - ah * FOCUS.y));
    box.querySelectorAll('.intro-art-in').forEach((n) => {
      n.style.width = aw + 'px'; n.style.height = ah + 'px'; n.style.left = left + 'px'; n.style.top = top + 'px';
    });
  }

  // ------------------------------------------------------------------ card pictures
  const ctxOf = (id) => $(id).getContext('2d');
  const blit = (g, src, x0, x1) => {      // copy the card window of a full-size raster, optionally only columns x0..x1
    x0 = x0 || 0; x1 = x1 == null ? CARD.w : x1;
    g.drawImage(src, CARD.x + x0, CARD.y, x1 - x0, CARD.h, x0, 0, x1 - x0, CARD.h);
  };
  const cx = (lon) => MM.terrain.colOf(lon) - CARD.x, cy = (lat) => MM.terrain.rowOf(lat) - CARD.y;
  function fade(g) {                       // darken the bottom edge so the card text sits on it cleanly
    const gr = g.createLinearGradient(0, CARD.h * 0.6, 0, CARD.h);
    gr.addColorStop(0, 'rgba(16, 20, 29, 0)'); gr.addColorStop(1, 'rgba(16, 20, 29, .92)');
    g.fillStyle = gr; g.fillRect(0, 0, CARD.w, CARD.h);
  }
  function pin(g, x, y, label, base) {
    g.beginPath(); g.arc(x, y, 13, 0, 7); g.fillStyle = base ? '#fff' : '#ff6b35'; g.fill();
    g.lineWidth = 2.5; g.strokeStyle = base ? '#ff6b35' : '#fff'; g.stroke();
    g.fillStyle = '#1a0b04'; g.font = 'bold 16px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, x, y + 0.5);
  }

  function drawPlan(relief, hazard) {
    const g = ctxOf('ia-plan'), T = MM.terrain;
    blit(g, relief); g.globalAlpha = 0.9; blit(g, hazard); g.globalAlpha = 1;
    const a = MM.science.get('oeb'), b = MM.science.get('threeforks');
    if (a && b) {
      const r = MM.router.route([a.lat, a.lon], [b.lat, b.lon], { maxSlope: 20, pace: 'nominal' });
      if (r.ok) {
        const trace = () => { g.beginPath(); r.line.forEach((p, i) => { const x = cx(p[1]), y = cy(p[0]); if (i) g.lineTo(x, y); else g.moveTo(x, y); }); };
        g.lineJoin = g.lineCap = 'round';
        trace(); g.lineWidth = 8; g.strokeStyle = 'rgba(10, 13, 19, .85)'; g.stroke();
        trace(); g.lineWidth = 4; g.strokeStyle = T.CLASSES[0].color; g.stroke();
      }
      pin(g, cx(a.lon), cy(a.lat), '⌂', true); pin(g, cx(b.lon), cy(b.lat), '1');
    }
    fade(g);
  }

  function drawLayers(relief, hazard, elevation) {
    const g = ctxOf('ia-layers'), W = CARD.w, H = CARD.h, lean = 46;
    const band = (src, x0, x1, extra) => {
      g.save(); g.beginPath();
      g.moveTo(x0 + lean, 0); g.lineTo(x1 + lean, 0); g.lineTo(x1 - lean, H); g.lineTo(x0 - lean, H); g.closePath(); g.clip();
      blit(g, relief); if (src) { g.globalAlpha = extra || 1; blit(g, src); }
      g.restore();
    };
    band(null, -lean, W / 3); band(elevation, W / 3, 2 * W / 3, 0.95); band(hazard, 2 * W / 3, W + lean, 0.95);
    g.strokeStyle = 'rgba(255, 255, 255, .85)'; g.lineWidth = 1.5;
    [W / 3, 2 * W / 3].forEach((x) => { g.beginPath(); g.moveTo(x + lean, 0); g.lineTo(x - lean, H); g.stroke(); });
    fade(g);
    g.font = '600 15px ui-monospace, Menlo, Consolas, monospace'; g.textAlign = 'center'; g.fillStyle = 'rgba(233, 237, 245, .92)';
    ['RELIEF', 'ELEVATION', 'SLOPE HAZARD'].forEach((t, i) => g.fillText(t, W / 6 + i * W / 3 - lean * 0.6, H - 14));
  }

  function drawScience(relief) {
    const g = ctxOf('ia-science'), R = window.MM_ROVER, KIND = MM.science.KIND;
    blit(g, relief); g.fillStyle = 'rgba(10, 13, 19, .38)'; g.fillRect(0, 0, CARD.w, CARD.h);
    g.beginPath(); let pen = false;
    R.traverse.forEach((p) => {
      const x = cx(p[0]), y = cy(p[1]);
      if (x < -20 || y < -20 || x > CARD.w + 20 || y > CARD.h + 20) { pen = false; return; }
      if (pen) g.lineTo(x, y); else g.moveTo(x, y); pen = true;
    });
    g.setLineDash([5, 4]); g.lineWidth = 2; g.strokeStyle = 'rgba(255, 255, 255, .85)'; g.stroke(); g.setLineDash([]);
    MM.science.all().forEach((t) => {
      const x = cx(t.lon), y = cy(t.lat), c = KIND[t.kind].color, r = t.kind === 'depot' ? 10 : 7;
      if (x < 0 || y < 0 || x > CARD.w || y > CARD.h) return;
      g.shadowColor = c; g.shadowBlur = 12;
      g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath();
      g.fillStyle = c; g.fill(); g.shadowBlur = 0; g.lineWidth = 1.5; g.strokeStyle = '#10141d'; g.stroke();
    });
    fade(g);
  }

  /** Sun path for today at Jezero over the real skyline profile through the landing site. */
  function drawConditions() {
    const g = ctxOf('ia-conditions'), T = MM.terrain, W = CARD.w, H = CARD.h;
    const S = MM.conditions.SITE, m = MM.time.at(new Date(), S.lon, S.lat, S.landing);
    const day = m.sunEl > 0, ground = H - 62;
    const sky = g.createLinearGradient(0, 0, 0, ground);
    if (day) { sky.addColorStop(0, '#7a5a48'); sky.addColorStop(1, '#d9a273'); }   // butterscotch daytime sky
    else { sky.addColorStop(0, '#0b0f1a'); sky.addColorStop(1, '#27324a'); }       // night
    g.fillStyle = sky; g.fillRect(0, 0, W, H);
    if (!day) { let s = 11; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647; g.fillStyle = 'rgba(255,255,255,.7)'; for (let i = 0; i < 46; i++) g.fillRect(rnd() * W, rnd() * ground * 0.9, 1.2, 1.2); }
    // sun arc from sunrise to sunset
    const x0 = 56, x1 = W - 56, top = 26;
    const arc = (f) => [x0 + (x1 - x0) * f, ground - Math.sin(Math.PI * f) * (ground - top)];
    g.beginPath(); for (let i = 0; i <= 60; i++) { const p = arc(i / 60); if (i) g.lineTo(p[0], p[1]); else g.moveTo(p[0], p[1]); }
    g.setLineDash([6, 7]); g.lineWidth = 2; g.strokeStyle = day ? 'rgba(255, 255, 255, .7)' : 'rgba(255, 255, 255, .32)'; g.stroke(); g.setLineDash([]);
    if (day) {
      const f = Math.max(0, Math.min(1, (m.lmst - m.sunriseLMST) / (m.sunsetLMST - m.sunriseLMST))), p = arc(f);
      const glow = g.createRadialGradient(p[0], p[1], 0, p[0], p[1], 34);
      glow.addColorStop(0, 'rgba(255, 244, 220, .95)'); glow.addColorStop(0.25, 'rgba(190, 220, 255, .55)'); glow.addColorStop(1, 'rgba(190, 220, 255, 0)');
      g.fillStyle = glow; g.fillRect(p[0] - 36, p[1] - 36, 72, 72);
      g.beginPath(); g.arc(p[0], p[1], 8, 0, 7); g.fillStyle = '#fff'; g.fill();
    }
    // skyline: the real elevation profile along the row through the landing site
    const row = Math.round(T.rowOf(S.lat)); let lo = Infinity, hi = -Infinity; const zs = [];
    for (let i = 0; i <= W; i += 4) { const z = T.z[row * T.w + CARD.x + i]; zs.push(z); lo = Math.min(lo, z); hi = Math.max(hi, z); }
    g.beginPath(); g.moveTo(0, H);
    zs.forEach((z, i) => g.lineTo(i * 4, ground + 10 - (z - lo) / Math.max(1, hi - lo) * 22));
    g.lineTo(W, H); g.closePath(); g.fillStyle = day ? '#5b3523' : '#141a27'; g.fill();
    fade(g);
    g.font = '600 16px ui-monospace, Menlo, Consolas, monospace'; g.fillStyle = 'rgba(233, 237, 245, .92)';
    g.textAlign = 'left'; g.fillText('☀ ' + MM.time.hhmm(m.sunriseLMST), 16, H - 14);
    g.textAlign = 'right'; g.fillText(MM.time.hhmm(m.sunsetLMST) + ' ☾', W - 16, H - 14);
    g.textAlign = 'center'; g.fillText(day ? 'Sun is up' : 'Night now', W / 2, H - 14);
  }

  // ------------------------------------------------------------------ live panel
  function tick() {
    const S = MM.conditions.SITE, m = MM.time.at(new Date(), S.lon, S.lat, S.landing);
    $('in-lmst').textContent = MM.time.hhmm(m.lmst);
    $('in-sol').textContent = m.sol.toLocaleString();
    $('in-season').textContent = m.season.replace('Northern ', 'N. ').replace('Southern ', 'S. ') + ' · Ls ' + m.ls.toFixed(1) + '°';
    $('in-sun').textContent = (m.sunEl > 0 ? 'Up' : 'Down') + ' · ' + MM.time.hhmm(m.sunriseLMST) + ' to ' + MM.time.hhmm(m.sunsetLMST);
    const d = MM.time.dustRisk(m.ls), el = $('in-dust');
    el.textContent = d.label; el.className = 'lvl' + d.level;
  }

  // ------------------------------------------------------------------ build once
  function build() {
    if (built) return; built = true;
    const T = MM.terrain, D = window.MM_DEM, n = MM.science.all().length;
    $('in-ntargets').textContent = n;
    $('intro-stats').innerHTML = [
      ['6', 'NASA missions'], ['11', 'published datasets'],
      [(D.width * D.height / 1e6).toFixed(1) + 'M', 'terrain cells routed'], [String(n), 'science targets'],
    ].map((s) => `<div><b>${s[0]}</b><span>${s[1]}</span></div>`).join('');

    const safe = (fn) => { try { fn(); } catch (err) { console.warn('Overview picture skipped:', err); } };
    const relief = T.renderRelief();
    safe(() => buildBackdrop(relief));
    const hazard = T.renderHazard(20), elevation = T.renderElevation();
    safe(() => drawPlan(relief, hazard));
    safe(() => drawLayers(relief, hazard, elevation));
    safe(() => drawScience(relief));

    const box = $('intro'), sc = $('intro-scroll');
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-go]'); if (b) { go(b.dataset.go, !!b.dataset.plain, b.dataset.focus); return; }
      const sTo = e.target.closest('[data-scroll]');
      if (sTo) { const id = sTo.dataset.scroll; if (id === 'top') sc.scrollTo({ top: 0, behavior: 'smooth' }); else $(id).scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
      if (e.target.closest('[data-about]')) MM.app.about();
    });
    $('intro-tour-top').addEventListener('click', () => { close(); MM.tour.start(); });
    safe(buildProof);
    $('pf-show').addEventListener('click', showValidation);
    $('intro-demo').addEventListener('click', () => { close(); MM.app.runPreset('depot'); });
    $('intro-tour').addEventListener('click', () => { close(); MM.tour.start(); });
    $('intro-about').addEventListener('click', () => MM.app.about());
    window.addEventListener('resize', () => { if (!box.hidden) { layoutArt(); cue(); } });
    // The traverse drawing belongs to the hero: it fades away as the page scrolls to the cards.
    const over = box.querySelector('.intro-art.over');
    const globe = $('intro-globe');
    sc.addEventListener('scroll', () => {
      over.style.setProperty('--fade', Math.max(0, 1 - sc.scrollTop / 260).toFixed(2));
      globe.style.setProperty('--fade', Math.max(0.12, 1 - sc.scrollTop / 520).toFixed(2));
      cue(); spy();
    }, { passive: true });
    // The globe sits behind the scrolling page so it can be dragged; pass mouse-wheel scrolling over it on to the page.
    box.addEventListener('wheel', (e) => { if (!sc.contains(e.target)) sc.scrollTop += e.deltaY; }, { passive: true });
    $('intro-more-btn').addEventListener('click', () => box.querySelector('.intro-cards').scrollIntoView({ behavior: 'smooth', block: 'center' }));
  }

  // ------------------------------------------------------------------ proof section
  /** Fill the "Proof" section from data/validation.js and, once read, the CRISM minerals. */
  function buildProof() {
    const V = window.MM_VALIDATION;
    if (V) {
      const S = V.summary, pct = (v) => Math.round(v * 100) + '%';
      $('pf-within').textContent = pct(S.within100_overall);
      $('pf-method').textContent = `We cut Perseverance's real drive into ${S.stretches} stretches of about 1 km (${S.rover_km} km in all), gave the planner only each stretch's start and end, and compared its route with the rover's track on the same CTX elevation model.`;
      const ok = V.stretches.filter((x) => x.ok);
      $('pf-chart').innerHTML = '<div class="pf-bars">' + ok.map((x) => `<i style="height:${Math.max(4, x.within100 * 100)}%" title="${(x.rover_m / 1000).toFixed(2)} km stretch: ${pct(x.within100)} within 100 m, mean gap ${x.mean_offset_m} m"></i>`).join('') +
        '</div><div class="pf-axis"><span>each bar: one stretch of the drive</span><span>% of route within 100 m</span></div>';
      const st = [
        [S.mean_offset_median_m + ' m', 'median gap between the two paths'],
        [(S.plan_steep15 * 100).toFixed(1) + '% vs ' + (S.rover_steep15 * 100).toFixed(1) + '%', 'of the path on slopes over 15°, planner vs rover'],
        [S.plan_over25_m + ' m', 'of planned route over the 25° limit'],
      ];
      $('pf-stats').innerHTML = st.map((r) => `<div><b>${r[0]}</b><span>${r[1]}</span></div>`).join('');
      const steepPlanM = Math.round(S.plan_steep15 * S.plan_km * 1000), straightPct = S.straight_over15_m / (S.straight_km * 1000);
      $('pf-gain').innerHTML = [
        [`${(S.straight_over15_m / 1000).toFixed(1)} km`, `of slopes over 15° on straight lines between the same points. The planner's routes cross ${(steepPlanM / 1000).toFixed(1)} km, ${Math.round(steepPlanM / (S.plan_km * 1000) * 100)}% of the distance instead of ${Math.round(straightPct * 100)}%.`],
        ['0 m', 'over the crew\'s slope limit on any planned route. Steeper cells are impassable to the search.'],
        ['Every plan', 'shows its own measured impact: steep ground avoided, the detour it costs, science per EVA hour and oxygen left.'],
        ['GO / NO-GO', 'from 10 checks a crew lead can read in five seconds, with the source of every number.'],
      ].map((r) => `<li><b>${r[0]}</b><span>${r[1]}</span></li>`).join('');
    }
    if (MM.site) { MM.site.load(); MM.site.onReady(proofSites); if (MM.site.state() === 'unavailable') $('pf-sites').innerHTML = '<li class="pf-wait">Open the online version to read the CRISM mineral maps.</li>'; }
  }
  /** Three science targets with the strongest, different mineral signals. */
  function proofSites() {
    const seen = new Set(), rows = [];
    const scored = MM.science.all().map((t) => ({ t, m: MM.site.minerals(t.lat, t.lon) })).filter((x) => x.m && x.m.length && x.m[0].level >= 2).sort((a, b) => b.m[0].value - a.m[0].value);
    for (const x of scored) { if (seen.has(x.m[0].key)) continue; seen.add(x.m[0].key); rows.push(x); if (rows.length === 3) break; }
    $('pf-sites').innerHTML = rows.map((x) => `<li><b>${x.t.name}</b><div class="min-row">${MM.site.chips(x.m, 2)}</div><p>${x.m[0].why}</p></li>`).join('') || '<li class="pf-wait">No strong mineral signals at the targets.</li>';
  }
  function showValidation() {
    go('layers', true);
    setTimeout(() => {
      MM.layers.toggle('validation', true);
      const pts = []; (window.MM_VALIDATION ? window.MM_VALIDATION.stretches : []).forEach((x) => { if (x.ok) pts.push(...x.line); });
      if (pts.length) MM.map.fitBounds(L.latLngBounds(pts), { padding: [30, 30] });
    }, 350);
  }

  /** Header: a glass bar once the page scrolls, and the link for the section in view lit up. */
  function spy() {
    const sc = $('intro-scroll'), top = $('intro-top');
    top.classList.toggle('stuck', sc.scrollTop > 8);
    let cur = 'top';
    ['intro-proof', 'intro-brief', 'intro-datasec'].forEach((id) => { const el = $(id); if (el && el.getBoundingClientRect().top < window.innerHeight * 0.45) cur = id; });
    $('snav').querySelectorAll('[data-scroll]').forEach((a) => a.classList.toggle('on', a.dataset.scroll === cur));
  }

  /** On short screens the cards start below the fold: show a pointer to them until the page is scrolled. */
  function cue() {
    const box = $('intro'), sc = $('intro-scroll');
    const below = box.querySelector('.intro-cards').getBoundingClientRect().top > box.clientHeight - 50;
    $('intro-more').hidden = !(below && sc.scrollTop < 30);
  }

  // ------------------------------------------------------------------ open / close / jump
  function open() {
    build();
    const box = $('intro');
    lastFocus = document.activeElement;
    box.classList.remove('leaving');
    box.hidden = false;
    document.body.classList.add('intro-open');
    $('intro-scroll').scrollTop = 0;
    box.querySelector('.intro-art.over').style.removeProperty('--fade');
    $('intro-globe').style.removeProperty('--fade');
    layoutArt(); tick(); cue(); spy();
    try { drawConditions(); } catch (err) { console.warn('Overview picture skipped:', err); }
    clearInterval(timer); timer = setInterval(tick, 1000);
    if (MM.globe) MM.globe.mount($('intro-globe'));
    box.setAttribute('tabindex', '-1'); box.focus({ preventScroll: true });   // keyboard users start inside the dialog, without a ring on the button
  }

  function close() {
    const box = $('intro');
    if (box.hidden || box.classList.contains('leaving')) return;
    clearInterval(timer);
    if (MM.globe) setTimeout(() => MM.globe.pause(), 420);
    box.classList.add('leaving');
    document.body.classList.remove('intro-open');
    setTimeout(() => { box.hidden = true; box.classList.remove('leaving'); }, 420);
    if (lastFocus && lastFocus.focus && lastFocus !== document.body) lastFocus.focus({ preventScroll: true });
  }

  /**
   * Leave the overview and show one planner view. From a card ("plain" is false) the Plan
   * view loads the demo mission when no route exists yet, so there is something to look at.
   */
  function go(tab, plain, focusId) {
    close();
    MM.app.showTab(tab);
    const phone = window.innerWidth <= 900;
    const hasRoute = MM.planner.serialize().s.length >= 2;
    if (tab === 'plan' && !plain && !hasRoute) MM.app.runPreset('depot');
    else if (phone && !(tab === 'plan' && plain)) document.body.classList.add('panel-open');
    setTimeout(() => MM.map.invalidateSize(), 300);
    if (focusId) {                          // wait for the route, then bring that block into view
      if (phone) document.body.classList.add('panel-open');
      let tries = 0;
      const t = setInterval(() => {
        const el = $(focusId);
        if (el && !el.hidden) { clearInterval(t); el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        else if (++tries > 40) clearInterval(t);
      }, 150);
    }
  }

  MM.intro = { open, close, go, isOpen: () => !$('intro').hidden };
})();
