/*
 * Printable EVA briefing: the one page a crew would take to the airlock.
 */
(function () {
  'use strict';
  const MM = (window.MM = window.MM || {});
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function profileImage(plan) {
    const W = 900, H = 230, cv = document.createElement('canvas');
    cv.width = W * 2; cv.height = H * 2;
    const g = cv.getContext('2d'); g.scale(2, 2);
    g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    MM.planner.drawProfile(g, W, H, plan, false);
    return cv.toDataURL('image/png');
  }

  function open() {
    const P = MM.planner, plan = P.plan(), S = P.settings();
    if (!plan || !plan.ok) return;
    const C = MM.conditions.current(), m = C.mars, T = MM.time;
    const verdict = [['go', 'GO'], ['caution', 'GO WITH CAUTION'], ['nogo', 'NO-GO']][plan.verdict];
    const when = (sec) => T.hhmm(S.startH + sec / 3600);
    const planDate = (MM.conditions.planDate() || new Date()).toISOString().slice(0, 10);

    let rows = `<tr><td>⌂</td><td><b>${esc(plan.base.name)}</b><br><small>Egress and suit checks</small></td><td>${when(0)}</td><td>${P.EGRESS_MIN} min</td><td>–</td><td>–</td><td>–</td><td>Depart ${when(P.EGRESS_MIN * 60)}</td></tr>`;
    plan.stopInfo.slice(1).forEach((s, i) => {
      const leg = plan.legs[i], an = leg.an, t = s.stop.targetId ? MM.science.get(s.stop.targetId) : null;
      const what = s.stop.isReturn ? 'Ingress, ' + P.INGRESS_MIN + ' min' : t ? esc((t.sample ? t.sample + '. ' : '') + t.unit) : 'Crew-defined stop';
      rows += `<tr><td>${s.stop.isReturn ? '⌂' : i + 1}</td><td><b>${esc(s.stop.name)}</b>${t ? '<br><small>' + t.lat.toFixed(5) + '° N, ' + t.lon.toFixed(5) + '° E</small>' : '<br><small>' + s.stop.lat.toFixed(5) + '° N, ' + s.stop.lon.toFixed(5) + '° E</small>'}</td>
        <td>${when(s.arrive)}</td><td>${s.stop.isReturn ? '–' : (s.stop.stopMin || 0) + ' min'}</td><td>${P.km(an.distance)}</td><td>${P.hmShort(an.walkSeconds)}</td>
        <td>↑${Math.round(an.ascent)} ↓${Math.round(an.descent)} m<br><small>max ${an.maxSlope.toFixed(0)}°</small></td><td>${what}</td></tr>`;
    });
    const end = plan.totalSeconds;

    const sci = plan.stopInfo.slice(1).map((s) => s.stop.targetId && MM.science.get(s.stop.targetId)).filter(Boolean);
    let why = null;
    try { why = MM.explain ? MM.explain.analyze(plan) : null; } catch (e) { console.error(e); }
    const html = `
    <div class="brief">
      <div class="brief-head">
        <div><div class="brief-kicker">EVA BRIEFING · JEZERO CRATER, MARS</div>
          <h2>${esc(plan.base.name)} ${plan.roundTrip ? 'round trip' : 'traverse'} · ${P.km(plan.distance)}</h2>
          <div class="brief-sub">Plan date ${planDate} (Earth, UTC) · Perseverance mission sol ${m.sol} · Mars year ${m.marsYear}, Ls ${m.ls.toFixed(1)}° · ${m.season}</div></div>
        <div class="brief-verdict ${verdict[0]}">${verdict[1]}</div>
      </div>
      <p class="brief-take"><b>Key takeaway.</b> ${esc(P.takeaway(plan))}</p>
      <div class="brief-grid">
        <div><span>Airlock open</span><b>${when(0)} LMST</b></div>
        <div><span>Airlock closed</span><b>${when(end)} LMST</b></div>
        <div><span>EVA duration</span><b>${P.hm(end)}</b></div>
        <div><span>Suit limit / reserve</span><b>${S.limitH} h / ${P.hmShort(Math.max(0, S.limitH * 3600 - end))}</b></div>
        <div><span>Distance / farthest from base</span><b>${P.km(plan.distance)} / ${P.km(plan.farthest)}</b></div>
        <div><span>Climb / descent</span><b>${Math.round(plan.ascent)} m / ${Math.round(plan.descent)} m</b></div>
        <div><span>Steepest slope</span><b>${plan.maxSlope.toFixed(0)}° (limit ${S.maxSlope}°)</b></div>
        <div><span>Pace</span><b>${MM.eva.PACES[S.pace].label}, ${(plan.distance / Math.max(1, plan.walkSeconds) * 3.6).toFixed(1)} km/h avg</b></div>
        <div><span>Metabolic energy</span><b>${Math.round(plan.energyKcal)} kcal (${Math.round(plan.avgWatts)} W avg)</b></div>
        <div><span>Crew / route priority</span><b>${S.crew} astronaut${S.crew > 1 ? 's' : ''} / ${P.MODES[S.mode].label}</b></div>
        <div><span>Oxygen used / in suit</span><b>${Math.round(plan.o2Grams)} g / ${S.o2G} g</b></div>
        <div><span>Radio line of sight</span><b>${Math.round(plan.losFraction * 100)}% of route</b></div>
        <div><span>Walkback + airlock / backup O₂</span><b>${Math.ceil(plan.walkbackSeconds / 60 + P.INGRESS_MIN)} min / ${S.walkbackMin} min</b></div>
      </div>

      <h3>Go / no-go</h3>
      <ul class="brief-checks">${plan.checks.map((c) => `<li class="${['go', 'caution', 'nogo'][c.level]}"><b>${c.title}.</b> ${esc(c.text)}</li>`).join('')}</ul>

      ${plan.allocation ? (() => {
        const a = plan.allocation, cls = (r) => ({ GO: 'go', CAUTION: 'caution', 'NO-GO': 'nogo' }[r.verdict]);
        return `<h3>Traverse allocation: crew or machine</h3>
      <div class="brief-alloc">
        <div><span>Crew on foot</span><b class="${cls(a.human)}">${a.human.score}% · ${a.human.verdict}</b><small>${esc(a.human.limitingFactor)}</small></div>
        <div><span>Mars machine (rover)</span><b class="${cls(a.machine)}">${a.machine.score}% · ${a.machine.verdict}</b><small>${esc(a.machine.limitingFactor)}${/sol/.test(a.machine.limitingFactor) ? '' : ' · about ' + a.machine.sols + ' sol' + (a.machine.sols > 1 ? 's' : '') + ' of driving'}</small></div>
      </div>
      <p class="brief-cap"><b>Recommendation:</b> ${esc(a.recommendation)}</p>`;
      })() : ''}

      ${why ? `<h3>Why this route</h3>
      <p class="brief-cap">${esc(why.summary)}</p>
      <ul class="brief-sci">${why.legs.map((l) => `<li><b>${esc(l.title)}.</b> ${esc(l.reasons.join(' '))}</li>`).join('')}</ul>` : ''}

      <h3>Timeline</h3>
      <table class="brief-tbl"><thead><tr><th>#</th><th>Location</th><th>Arrive (LMST)</th><th>Work</th><th>Leg</th><th>Walk</th><th>Terrain</th><th>Task</th></tr></thead><tbody>${rows}</tbody></table>

      <h3>Elevation profile</h3>
      <img class="brief-prof" alt="Elevation profile coloured by slope hazard" src="${profileImage(plan)}">
      <div class="brief-cap">Fill colour is the slope class of the ground under each step (green easy, red severe). The strip underneath shows radio line of sight to a 10 m mast at base.</div>

      <h3>Conditions</h3>
      <div class="brief-grid">
        <div><span>Sunrise / sunset</span><b>${T.hhmm(m.sunriseLMST)} / ${T.hhmm(m.sunsetLMST)} LMST</b></div>
        <div><span>Air temperature</span><b>${Math.round(C.tmin)}° to ${Math.round(C.tmax)}° C</b></div>
        <div><span>${esc(C.plabel)}</span><b>${C.pressure != null ? Math.round(C.pressure) + ' Pa' : '–'}</b></div>
        <div><span>Dust-storm risk</span><b>${C.dust.label}</b></div>
      </div>
      <div class="brief-cap">${esc(C.dust.note)} Temperature source: ${esc(C.tsrc)}. Pressure source: ${esc(C.psrc)}.</div>

      ${MM.site && MM.site.state() === 'ready' && plan.stops.length > 1 ? '<h3>Minerals at each stop (MRO CRISM)</h3><ul class="brief-sci">' + plan.stops.slice(1).map((s) => { const m = MM.site.minerals(s.lat, s.lon); return `<li><b>${esc(s.name)}</b>: ${esc(MM.site.short(m, 3))}.</li>`; }).join('') + '</ul>' : ''}

      ${sci.length ? '<h3>Science objectives</h3><ul class="brief-sci">' + sci.map((t) => `<li><b>${esc(t.name)}</b> (${esc(t.unit)}${t.sample ? '; ' + esc(t.sample) : ''}). ${esc(t.why)}</li>`).join('') + '</ul>' : ''}

      ${fieldHtml()}

      <div class="brief-foot">Generated by Marswalk Planner from NASA data: MRO CTX elevation model (USGS), Mars 2020 localization, Perseverance MEDA and Curiosity REMS weather.
      Walking speed and metabolic cost follow the Apollo-derived models used by NASA / MIT SEXTANT (Marquez 2008; Santee et al. 2001). Planning estimate only.</div>
      <div class="row-btns no-print"><button class="primary-btn" id="brief-print">Print or save as PDF</button></div>
    </div>`;
    MM.app.modal(html, 'wide');
    document.getElementById('brief-print').addEventListener('click', () => window.print());
  }

  function fieldHtml() {
    const F = MM.field; if (!F) return '';
    const z = F.zones(), o = F.observations();
    if (!z.length && !o.length) return '';
    const rows = z.map((x) => `<li><b>No-go zone: ${esc(F.ZONE_KINDS[x.kind].label)}.</b> ${esc(x.note || '')} <small>Route avoids it.</small></li>`)
      .concat(o.map((x) => `<li><b>${esc(F.OBS_KINDS[x.kind].label)}</b> [${F.CONF[x.conf].label}] at ${x.lat.toFixed(5)}° N, ${x.lon.toFixed(5)}° E. ${esc(x.note || '')}${x.avoid ? ' <small>Route keeps ' + x.avoid + ' m away.</small>' : ''}${x.author ? ' <small>(' + esc(x.author) + (x.sol != null ? ', sol ' + x.sol : '') + ')</small>' : ''}</li>`));
    return '<h3>Hazards and field reports</h3><ul class="brief-sci">' + rows.join('') + '</ul>';
  }

  MM.briefing = { open };
})();
