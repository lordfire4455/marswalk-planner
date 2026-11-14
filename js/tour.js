/*
 * Guided tour: a one-minute walk through the planner for first-time visitors
 * and judges. Each step spotlights one part of the screen and explains it in
 * plain words. Next / Back / autoplay, arrow keys and Esc.
 */
(function () {
  'use strict';
  const MM = (window.MM = window.MM || {});
  const $ = (id) => document.getElementById(id);
  const AUTO_MS = 8000;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const mobile = () => window.innerWidth <= 900;

  async function ensureRoute() {
    const P = MM.planner;
    if (P.plan() && P.plan().ok) return;
    MM.app.runPreset('depot');
    for (let i = 0; i < 60 && !(P.plan() && P.plan().ok); i++) await wait(100);
  }
  function panel(open) {
    const was = document.body.classList.contains('panel-open');
    if (was === open) return 0;
    document.body.classList.toggle('panel-open', open);
    setTimeout(() => MM.map.invalidateSize(), 260);
    return 300;
  }

  const STEPS = [
    { title: 'Welcome to Marswalk Planner', text: 'This app answers one question for a crew on Mars: can we walk this route safely today, and what science can we do on the way? The tour takes about a minute.' },
    { sel: '#map', inPanel: false, title: 'Jezero Crater from orbit', text: 'The map shows NASA orbital images of the Perseverance landing site. Inside the dashed yellow box, the planner walks over a real 20 m elevation model. The Layers tab adds more NASA data.' },
    { sel: '#presets', title: 'Start from a ready-made mission', text: 'Each card loads a real route. Next, the tour loads "Recover the sample depot": from the landing site to the Three Forks sample depot and back.' },
    { sel: '#stops', before: ensureRoute, title: 'Your waypoints', text: 'Base first, then every stop with its arrival time. Click the map to add a point, drag a pin to move it, and click a pin to remove it.' },
    { sel: '#opt-slope', block: true, title: 'Suit rules', text: 'Slope limit, pace, route priority, start time, suit hours, crew size and oxygen per suit. Any change re-plans the route and re-runs every check.' },
    { sel: ['#verdict', '#takeaway'], before: ensureRoute, title: 'One verdict, one sentence', text: 'GO, GO WITH CAUTION or NO-GO, plus a key takeaway anyone can read in five seconds.' },
    { sel: '#stats', title: 'Every number says where it comes from', text: '"NASA terrain" numbers come straight from the elevation model. "Model" numbers are planning estimates from Apollo-derived walking and metabolic models.' },
    { sel: '#checks', title: 'Safety checks', text: 'Suit time and reserve, oxygen, buddy rule, terrain, daylight, cold, dust-storm season, radio cover and hazards the crew reported. Each one explains itself.' },
    { sel: '#profile', inPanel: false, optional: true, title: 'Elevation profile', text: 'The ground under every step, coloured by slope. The strip below shows where radio contact with base drops out. Hover it to find the spot on the map.' },
    { sel: '#field-block', title: 'No-go zones and field reports', text: 'Draw an area the crew must not cross and the route goes around it. Log what the crew finds with a confidence label: Measured, Observed or Estimated.' },
    { sel: '#cmp', before: async () => { await ensureRoute(); if (!$('cmp-out').innerHTML) await MM.planner.compareRoutes(); }, title: 'Compare route options', text: 'Safest, fastest and science-rich routes side by side, also drawn on the map as dashed lines. One click switches to the one you prefer.' },
    { sel: '#btn-3d', parent: '.row-btns', title: '3D fly-through and EVA briefing', text: 'See the route on real terrain in 3D, print a one-page briefing for the crew, share the plan as a link, or export it as GeoJSON.' },
    { sel: '.tabs', title: 'More to explore', text: 'Layers: NASA imagery, minerals and heat. Science: every Perseverance sample site. Conditions: the Mars clock, seasons, dust risk and weather.' },
    { title: 'Ready for your own Marswalk', text: 'Click the map to place a base and add stops, or pick another ready-made mission. The Mission overview and this tour are always in the top bar.', last: true },
  ];

  let i = 0, open = false, timer = null, playing = false, el = null, token = 0;

  function build() {
    el = document.createElement('div');
    el.id = 'tour'; el.className = 'tour';
    el.innerHTML = `<div class="tour-spot" id="tour-spot"></div>
      <div class="tour-card" id="tour-card" role="dialog" aria-live="polite" aria-labelledby="tour-title">
        <div class="tour-k"><span id="tour-n"></span><button class="tour-x" id="tour-x" aria-label="Close the tour">×</button></div>
        <h3 id="tour-title"></h3><p id="tour-text"></p>
        <div class="tour-bars" id="tour-bars">${STEPS.map(() => '<i></i>').join('')}</div>
        <div class="tour-nav"><button class="tour-back" id="tour-back">← Back</button><button class="tour-play" id="tour-play" aria-label="Play the tour automatically">▶</button><button class="tour-next" id="tour-next">Next →</button></div>
      </div>`;
    document.body.appendChild(el);
    $('tour-x').addEventListener('click', close);
    $('tour-back').addEventListener('click', () => go(i - 1));
    $('tour-next').addEventListener('click', () => (STEPS[i].last ? close() : go(i + 1)));
    $('tour-play').addEventListener('click', () => setPlay(!playing));
    $('tour-bars').addEventListener('click', (e) => { const k = [...$('tour-bars').children].indexOf(e.target); if (k >= 0) go(k); });
    document.addEventListener('keydown', (e) => {
      if (!open) return;
      if (e.key === 'Escape') { e.stopImmediatePropagation(); close(); }
      else if (e.key === 'ArrowRight') go(Math.min(STEPS.length - 1, i + 1));
      else if (e.key === 'ArrowLeft') go(Math.max(0, i - 1));
    }, true);
    window.addEventListener('resize', () => { if (open) place(); });
    $('panel').addEventListener('scroll', () => { if (open) place(); }, { passive: true });
  }

  function targets(s) {
    if (!s.sel) return [];
    const list = (Array.isArray(s.sel) ? s.sel : [s.sel]).map((q) => document.querySelector(q)).filter(Boolean);
    return list.map((t) => (s.block ? t.closest('.block') : s.parent ? t.closest(s.parent) : t) || t);
  }
  function visible(t) { return t && !t.closest('[hidden]') && t.getClientRects().length > 0; }

  async function go(n) {
    if (n < 0 || n >= STEPS.length) return;
    const my = ++token;
    i = n;
    const s = STEPS[i];
    el.classList.add('busy');
    if (MM.intro && MM.intro.isOpen()) MM.intro.close();
    if (!$('modal').hidden) MM.app.closeModal();
    MM.app.showTab('plan');
    if (s.before) await s.before();
    if (my !== token) return;
    let ts = targets(s);
    if (s.optional && !ts.some(visible)) { go(i + (n >= i ? 1 : -1)); return; }
    if (mobile() && ts.length) {
      const inPanel = s.inPanel !== false;
      const d = panel(inPanel);
      if (d) await wait(d);
    }
    ts = targets(s).filter(visible);
    if (ts[0] && ts[0].closest('#panel')) ts[0].scrollIntoView({ block: ts[0].offsetHeight > window.innerHeight * 0.55 ? 'start' : 'center' });
    await wait(60);
    if (my !== token) return;
    $('tour-n').textContent = 'Tour · ' + (i + 1) + ' / ' + STEPS.length;
    $('tour-title').textContent = s.title;
    $('tour-text').textContent = s.text;
    [...$('tour-bars').children].forEach((b, k) => { b.classList.toggle('on', k < i); b.classList.remove('cur'); });
    const cur = $('tour-bars').children[i]; void cur.offsetWidth; cur.classList.add('cur');   // restart the autoplay fill
    $('tour-back').disabled = i === 0;
    $('tour-next').textContent = s.last ? 'Start planning' : 'Next →';
    el.classList.remove('busy');
    place();
    if (playing) arm();
  }

  function place() {
    const s = STEPS[i], spot = $('tour-spot'), card = $('tour-card');
    const ts = targets(s).filter(visible);
    const W = window.innerWidth, H = window.innerHeight, pad = 6;
    let r = null;
    if (ts.length) {
      const rs = ts.map((t) => t.getBoundingClientRect());
      r = { left: Math.min(...rs.map((x) => x.left)), top: Math.min(...rs.map((x) => x.top)), right: Math.max(...rs.map((x) => x.right)), bottom: Math.max(...rs.map((x) => x.bottom)) };
      // keep the spotlight on screen
      r = { left: Math.max(4, r.left - pad), top: Math.max(4, r.top - pad), right: Math.min(W - 4, r.right + pad), bottom: Math.min(H - 4, r.bottom + pad) };
    }
    el.classList.toggle('centered', !r);
    if (r) Object.assign(spot.style, { left: r.left + 'px', top: r.top + 'px', width: r.right - r.left + 'px', height: r.bottom - r.top + 'px' });
    const cw = card.offsetWidth, ch = card.offsetHeight, gap = 14;
    let x, y;
    if (!r) { x = (W - cw) / 2; y = (H - ch) / 2; }
    else if (W <= 600) { x = (W - cw) / 2; y = r.bottom + gap + ch < H ? r.bottom + gap : r.top - gap - ch > 0 ? r.top - gap - ch : H - ch - 12; }
    else if (W - r.right > cw + gap * 2) { x = r.right + gap; y = Math.min(Math.max(12, r.top), H - ch - 12); }
    else if (r.left > cw + gap * 2) { x = r.left - gap - cw; y = Math.min(Math.max(12, r.top), H - ch - 12); }
    else if (H - r.bottom > ch + gap) { x = Math.min(Math.max(12, r.left), W - cw - 12); y = r.bottom + gap; }
    else if (r.top > ch + gap) { x = Math.min(Math.max(12, r.left), W - cw - 12); y = r.top - gap - ch; }
    else { x = W - cw - 24; y = H - ch - 24; }
    card.style.left = Math.round(x) + 'px'; card.style.top = Math.round(y) + 'px';
  }

  function arm() { clearTimeout(timer); timer = setTimeout(() => { if (!open || !playing) return; if (STEPS[i].last) setPlay(false); else go(i + 1); }, AUTO_MS); }
  function setPlay(on) {
    playing = on;
    $('tour-play').textContent = on ? '❚❚' : '▶';
    $('tour-play').setAttribute('aria-label', on ? 'Pause the tour' : 'Play the tour automatically');
    el.classList.toggle('playing', on);
    const cur = $('tour-bars').children[i]; if (cur) { cur.classList.remove('cur'); void cur.offsetWidth; cur.classList.add('cur'); }
    if (on) arm(); else clearTimeout(timer);
  }

  function start(opts) {
    if (!el) build();
    open = true; el.hidden = false; document.body.classList.add('touring');
    setPlay(!!(opts && opts.autoplay));
    go(0);
  }
  function close() {
    if (!open) return;
    open = false; token++; clearTimeout(timer); playing = false;
    el.hidden = true; document.body.classList.remove('touring');
  }

  MM.tour = { start, close, isOpen: () => open, STEPS };
})();
