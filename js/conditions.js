/*
 * Mars clock and surface conditions.
 * - Clock and Sun geometry are computed (Allison & McEwen 2000).
 * - Jezero weather: Perseverance MEDA reports (bundled, refreshed live when the feed answers).
 * - Seasonal norms: the full Curiosity REMS record binned by solar longitude (Ls).
 */
(function () {
  'use strict';
  const MM = (window.MM = window.MM || {});
  const SITE = { lon: 77.4509, lat: 18.4446, landing: new Date('2021-02-18T20:55:00Z') };
  let planDate = null;       // null = follow the real clock
  let medaLive = false;
  const fmt = (v, d) => (v == null || isNaN(v) ? '–' : Number(v).toFixed(d || 0));
  const num = (v) => { const n = parseFloat(v); return isNaN(n) ? null : n; };

  const now = () => MM.time.at(new Date(), SITE.lon, SITE.lat, SITE.landing);
  const planTime = () => MM.time.at(planDate || new Date(), SITE.lon, SITE.lat, SITE.landing);

  function climBin(ls) {
    const W = window.MM_WEATHER.rems;
    return W.climatology[Math.floor(MM.time.mod(ls, 360) / W.bin_deg) % W.climatology.length];
  }

  /** Best MEDA sol to use for a given Ls: only if it was measured in the same part of the year. */
  function medaFor(ls) {
    const rows = window.MM_WEATHER.meda.latest.filter((r) => num(r.min_temp) != null && num(r.max_temp) != null);
    if (!rows.length) return null;
    const r = rows[rows.length - 1];
    const d = Math.abs(MM.time.mod(num(r.ls) - ls + 180, 360) - 180);
    return d <= 20 ? r : null;
  }

  /** Everything the planner needs to know about the chosen date. */
  function current() {
    const m = planTime();
    const bin = climBin(m.ls);
    const meda = medaFor(m.ls);
    const dust = MM.time.dustRisk(m.ls);
    let tmin, tmax, tsrc;
    if (meda) { tmin = num(meda.min_temp); tmax = num(meda.max_temp); tsrc = 'Perseverance MEDA, sol ' + meda.sol; }
    else { tmin = bin.air_min ? bin.air_min[1] : -80; tmax = bin.air_max ? bin.air_max[1] : -20; tsrc = 'Curiosity REMS seasonal norm'; }
    return { mars: m, bin, meda, dust, tmin, tmax, tsrc, live: !planDate };
  }

  function tick() {
    const m = now();
    document.getElementById('tm-lmst').textContent = MM.time.hhmm(m.lmst) + ' LMST';
    document.getElementById('tm-sol').textContent = 'Sol ' + m.sol;
    document.getElementById('tm-season').textContent = m.season.replace('Northern ', 'N. ') + ' · Ls ' + m.ls.toFixed(1) + '°';
    const up = m.sunEl > 0;
    document.getElementById('tm-sun').innerHTML = (up ? '☀ up ' : '☾ down ') + '<small>' + MM.time.hhmm(m.sunriseLMST) + '–' + MM.time.hhmm(m.sunsetLMST) + '</small>';
    const d = MM.time.dustRisk(m.ls);
    const el = document.getElementById('tm-dust');
    el.textContent = d.label; el.className = 'tm-v lvl' + d.level;
  }

  function render() {
    const c = current(), m = c.mars, W = window.MM_WEATHER;
    const dateStr = (planDate || new Date()).toISOString().slice(0, 10);
    document.getElementById('opt-date').value = dateStr;

    document.getElementById('cond-now').innerHTML = [
      ['Mission sol (Perseverance)', m.sol],
      ['Mars year · solar longitude', 'MY ' + m.marsYear + ' · Ls ' + m.ls.toFixed(1) + '°'],
      ['Season at Jezero', m.season],
      ['Sunrise · sunset', MM.time.hhmm(m.sunriseLMST) + ' · ' + MM.time.hhmm(m.sunsetLMST) + ' LMST'],
      ['Daylight', m.dayHours.toFixed(1) + ' Mars hours'],
      ['Sun distance', m.sunDistAU.toFixed(3) + ' AU'],
    ].map((r) => `<div><span>${r[0]}</span><b>${r[1]}</b></div>`).join('');

    // --- outlook
    const best0 = m.sunriseLMST + 2.5, best1 = m.sunsetLMST - 2.5;
    const uvTop = Object.entries(c.bin.uv || {}).sort((a, b) => b[1] - a[1])[0];
    const opTop = Object.entries(c.bin.opacity || {}).sort((a, b) => b[1] - a[1])[0];
    document.getElementById('cond-advice').innerHTML = `
      <div class="wx-grid">
        <div class="wx"><span>Air temperature</span><b>${fmt(c.tmin)}° / ${fmt(c.tmax)}° C</b><small>night low / afternoon high</small></div>
        <div class="wx"><span>Pressure</span><b>${c.bin.pressure ? fmt(c.bin.pressure[1]) : '–'} Pa</b><small>under 1% of Earth's</small></div>
        <div class="wx"><span>UV at noon</span><b>${uvTop ? uvTop[0].replace('_', ' ') : '–'}</b><small>no ozone shield</small></div>
        <div class="wx"><span>Dust-storm risk</span><b class="lvl${c.dust.level}">${c.dust.label}</b><small>${opTop ? 'sky usually ' + opTop[0].toLowerCase() : ''}</small></div>
      </div>
      <p class="note">${c.dust.note}</p>
      <p class="note"><b>Best EVA window:</b> ${MM.time.hhmm(best0)}–${MM.time.hhmm(best1)} LMST, when the Sun is high and the ground has warmed up.
      Temperature source: ${c.tsrc}.</p>`;

    // --- MEDA table
    const rows = W.meda.latest.slice().reverse();
    document.getElementById('cond-meda').innerHTML = `
      <table class="tbl"><thead><tr><th>Sol</th><th>Earth date</th><th>Low</th><th>High</th><th>Pressure</th></tr></thead><tbody>` +
      rows.slice(0, 7).map((r) => `<tr><td>${r.sol}</td><td>${r.terrestrial_date}</td><td>${num(r.min_temp) == null ? '–' : fmt(r.min_temp, 1) + '°'}</td>
        <td>${num(r.max_temp) == null ? '–' : fmt(r.max_temp, 1) + '°'}</td><td>${num(r.pressure) == null ? '–' : fmt(r.pressure, 0) + ' Pa'}</td></tr>`).join('') +
      `</tbody></table>
      <p class="note">${medaLive ? '<em class="pill ok">live</em> Loaded from NASA\'s feed just now.' : 'Latest report bundled with the app.'}
      The public MEDA feed last reported at Ls ${fmt(num(rows[0].ls), 0)}°. Outside that part of the Mars year the planner uses the seasonal norm below.</p>`;

    // --- REMS norms
    const b = c.bin;
    const range = (a, u) => (a ? `${fmt(a[1])}${u} <small>(${fmt(a[0])} to ${fmt(a[2])})</small>` : '–');
    document.getElementById('cond-rems').innerHTML = `
      <div class="kv">
        <div><span>Ls ${b.ls0}–${b.ls0 + W.rems.bin_deg}° · sols in record</span><b>${b.n}</b></div>
        <div><span>Air, daily low</span><b>${range(b.air_min, '° C')}</b></div>
        <div><span>Air, daily high</span><b>${range(b.air_max, '° C')}</b></div>
        <div><span>Ground, daily low</span><b>${range(b.ground_min, '° C')}</b></div>
        <div><span>Ground, daily high</span><b>${range(b.ground_max, '° C')}</b></div>
        <div><span>Pressure</span><b>${range(b.pressure, ' Pa')}</b></div>
      </div>
      <p class="note">Median with the 10th to 90th percentile range, from ${W.rems.sols_in_record.toLocaleString()} sols measured by Curiosity in Gale Crater
      (${W.rems.first_date} to ${W.rems.last_date}). Gale is 3,700 km from Jezero but equally close to the equator, so it is the best long-term reference.</p>`;
    drawChart(m.ls);
  }

  function drawChart(lsNow) {
    const cv = document.getElementById('cond-chart');
    const W = window.MM_WEATHER.rems, clim = W.climatology;
    const dpr = window.devicePixelRatio || 1;
    const cssW = cv.clientWidth || 320, cssH = 160;
    cv.width = cssW * dpr; cv.height = cssH * dpr; cv.style.height = cssH + 'px';
    const g = cv.getContext('2d'); g.scale(dpr, dpr);
    const pad = { l: 34, r: 8, t: 10, b: 22 };
    const x = (ls) => pad.l + ls / 360 * (cssW - pad.l - pad.r);
    const lo = -100, hi = 20;
    const y = (t) => pad.t + (hi - t) / (hi - lo) * (cssH - pad.t - pad.b);
    g.clearRect(0, 0, cssW, cssH);
    g.fillStyle = 'rgba(255,140,66,0.10)'; g.fillRect(x(180), pad.t, x(360) - x(180), cssH - pad.t - pad.b);
    g.font = '10px system-ui, sans-serif'; g.fillStyle = '#8a93a6'; g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1;
    for (let t = lo; t <= hi; t += 20) { g.beginPath(); g.moveTo(pad.l, y(t)); g.lineTo(cssW - pad.r, y(t)); g.stroke(); g.fillText(t + '°', 4, y(t) + 3); }
    for (let l = 0; l <= 360; l += 90) g.fillText('Ls ' + l, Math.min(x(l) - 10, cssW - 34), cssH - 6);
    g.fillStyle = 'rgba(255,140,66,0.9)'; g.fillText('dust-storm season', x(180) + 6, pad.t + 11);
    const band = (key, color) => {
      g.beginPath();
      clim.forEach((b, i) => { if (b[key]) g[i ? 'lineTo' : 'moveTo'](x(b.ls0 + W.bin_deg / 2), y(b[key][2])); });
      for (let i = clim.length - 1; i >= 0; i--) if (clim[i][key]) g.lineTo(x(clim[i].ls0 + W.bin_deg / 2), y(clim[i][key][0]));
      g.closePath(); g.fillStyle = color; g.fill();
    };
    const line = (key, color) => {
      g.beginPath(); let started = false;
      clim.forEach((b) => { if (!b[key]) return; g[started ? 'lineTo' : 'moveTo'](x(b.ls0 + W.bin_deg / 2), y(b[key][1])); started = true; });
      g.strokeStyle = color; g.lineWidth = 2; g.stroke();
    };
    band('air_max', 'rgba(255,107,53,0.18)'); band('air_min', 'rgba(89,195,255,0.18)');
    line('air_max', '#ff6b35'); line('air_min', '#59c3ff');
    g.strokeStyle = '#ffd23f'; g.lineWidth = 1.5; g.setLineDash([4, 3]);
    g.beginPath(); g.moveTo(x(lsNow), pad.t); g.lineTo(x(lsNow), cssH - pad.b); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#ffd23f'; g.fillText('plan date', Math.min(x(lsNow) + 4, cssW - 52), cssH - pad.b - 4);
    document.getElementById('cond-chart-cap').innerHTML = '<i class="dot" style="background:#ff6b35"></i>daily high <i class="dot" style="background:#59c3ff"></i>daily low, air temperature through the Mars year (Curiosity REMS).';
  }

  async function refreshLive() {
    try {
      const ctl = new AbortController();
      const to = setTimeout(() => ctl.abort(), 8000);
      const r = await fetch(window.MM_WEATHER.live_feeds.meda, { signal: ctl.signal, cache: 'no-store' });
      clearTimeout(to);
      const j = await r.json();
      if (j && Array.isArray(j.sols) && j.sols.length) {
        window.MM_WEATHER.meda.latest = j.sols; medaLive = true; render();
        if (MM.planner) MM.planner.refresh();
      }
    } catch (e) { /* offline or blocked: keep the bundled report */ }
  }

  function init() {
    tick(); setInterval(tick, 5000);
    render();
    document.getElementById('opt-date').addEventListener('change', (e) => {
      const v = e.target.value;
      planDate = v ? new Date(v + 'T12:00:00Z') : null;
      if (planDate && isNaN(planDate)) planDate = null;
      render(); if (MM.planner) MM.planner.refresh();
    });
    document.getElementById('btn-today').addEventListener('click', () => { planDate = null; render(); if (MM.planner) MM.planner.refresh(); });
    window.addEventListener('resize', () => { if (document.getElementById('tab-conditions').classList.contains('active')) drawChart(planTime().ls); });
    refreshLive();
  }

  MM.conditions = { init, current, render, SITE, planDate: () => planDate, setPlanDate: (d) => { planDate = d; render(); } };
})();
