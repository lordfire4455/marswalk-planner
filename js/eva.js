/*
 * EVA (Marswalk) physiology and route analysis.
 *
 * Walking speed: piecewise-linear function of slope fitted to Apollo 14 traverse
 *   data (Marquez 2008), as used by the MIT / NASA SEXTANT traverse planner.
 * Metabolic rate: Santee et al. (2001) planetary load-carriage model, evaluated
 *   with Mars gravity, also as used by SEXTANT.
 * These are planning estimates, not flight rules.
 */
(function () {
  'use strict';
  const MM = (window.MM = window.MM || {});
  const D2R = Math.PI / 180;
  const MARS_G = 3.71;

  const PACES = {
    careful: { label: 'Careful', factor: 0.5 },
    nominal: { label: 'Nominal', factor: 0.65 },
    brisk: { label: 'Brisk', factor: 0.8 },
  };

  /** Apollo-derived suited walking speed in m/s for a grade in degrees (+ uphill). */
  function apolloSpeed(deg) {
    if (deg >= 15 || deg < -20) return 0.05;
    if (deg >= 6) return -0.039 * deg + 0.634;
    if (deg >= 0) return -0.2 * deg + 1.6;
    if (deg >= -10) return 0.06 * deg + 1.6;
    return 0.095 * deg + 1.95;
  }
  function speed(gradeDeg, paceFactor) {
    return Math.max(0.03, apolloSpeed(gradeDeg) * paceFactor);
  }
  const MAX_SPEED = 1.6; // m/s at pace factor 1, flat ground

  /** Metabolic power in watts (Santee et al. 2001). mass in kg, v in m/s, grade in degrees. */
  function power(massKg, v, gradeDeg) {
    const a = gradeDeg * D2R;
    const level = (3.28 * massKg + 71.1) * (0.661 * v * Math.cos(a) + 0.115);
    let slope = 0;
    if (gradeDeg > 0) slope = 3.5 * massKg * MARS_G * v * Math.sin(a);
    else if (gradeDeg < 0) slope = 2.4 * massKg * MARS_G * v * Math.sin(a) * Math.pow(0.3, Math.abs(gradeDeg) / 7.65);
    return Math.max(80, level + slope);
  }
  const REST_POWER = 150; // W while working at a science stop (light manual work)

  /**
   * Walk a polyline and integrate everything a planner needs.
   * @param {Array<[lat,lon]>} line
   * @param {object} o  { pace, massKg, base:[lat,lon] }
   */
  function analyze(line, o) {
    const T = MM.terrain;
    const pf = PACES[o.pace || 'nominal'].factor;
    const mass = o.massKg || 150;
    const STEP = 10; // metres
    const s = { d: [], z: [], slope: [], grade: [], t: [], lat: [], lon: [], los: [], cls: [] };
    let dist = 0, time = 0, energyJ = 0, up = 0, down = 0, maxSlope = 0, maxGrade = 0;
    const classDist = new Array(T.CLASSES.length).fill(0);
    let prevZ = null, prevLat = null, prevLon = null;

    function push(lat, lon) {
      const z = T.elev(lat, lon);
      const sl = T.slopeAt(lat, lon);
      let grade = 0;
      if (prevZ !== null) {
        const seg = T.dist(prevLat, prevLon, lat, lon);
        if (seg > 0.01) {
          grade = Math.atan2(z - prevZ, seg) / D2R;
          const v = speed(grade, pf);
          const dt = Math.sqrt(seg * seg + (z - prevZ) * (z - prevZ)) / v;
          dist += seg; time += dt; energyJ += power(mass, v, grade) * dt;
          if (z > prevZ) up += z - prevZ; else down += prevZ - z;
          classDist[T.classOf(sl)] += seg;
          if (Math.abs(grade) > maxGrade) maxGrade = Math.abs(grade);
        }
      }
      if (sl > maxSlope) maxSlope = sl;
      s.d.push(dist); s.z.push(z); s.slope.push(sl); s.grade.push(grade); s.t.push(time);
      s.lat.push(lat); s.lon.push(lon); s.cls.push(T.classOf(sl));
      s.los.push(o.base ? T.los(o.base[0], o.base[1], o.baseMast || 10, lat, lon, 1.8) : true);
      prevZ = z; prevLat = lat; prevLon = lon;
    }

    for (let i = 0; i < line.length; i++) {
      if (i === 0) { push(line[0][0], line[0][1]); continue; }
      const a = line[i - 1], b = line[i];
      const seg = T.dist(a[0], a[1], b[0], b[1]);
      const n = Math.max(1, Math.round(seg / STEP));
      for (let k = 1; k <= n; k++) {
        const f = k / n;
        push(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f);
      }
    }
    let losOk = 0;
    for (const v of s.los) if (v) losOk++;
    return {
      samples: s, distance: dist, walkSeconds: time, energyJ, ascent: up, descent: down,
      maxSlope, maxGrade, classDist, losFraction: s.los.length ? losOk / s.los.length : 1,
    };
  }

  /** Air temperature at a local true solar time, from the sol's min / max (simple diurnal model). */
  function tempAt(ltst, tmin, tmax, sunriseLTST) {
    const peak = 13.5;
    const h = MM.time.mod(ltst, 24);
    if (h >= sunriseLTST && h <= peak) {
      const f = (h - sunriseLTST) / (peak - sunriseLTST);
      return tmin + (tmax - tmin) * Math.sin(f * Math.PI / 2);
    }
    // cooling from the afternoon peak to the next sunrise
    const span = 24 - peak + sunriseLTST;
    const f = (h > peak ? h - peak : h + 24 - peak) / span;
    return tmax - (tmax - tmin) * Math.pow(f, 0.6);
  }

  // ---- Traverse allocation: crew on foot, or send the machine? -----------------------------
  /*
   * Mobility profiles for the crew-or-machine comparison. These are planning settings for this
   * tool, not the spec of a real suit or rover. Where the planner already has a user setting
   * (suit hours, suit oxygen, backup oxygen) the setting wins over the default here.
   */
  const PROFILES = {
    human: {
      name: 'Crew EVA (on foot)',
      maxSlopeDeg: 18,                                    // scramble limit with trekking poles
      critSlopeDeg: 22,                                   // hard slip hazard
      nominalSpeedMps: MAX_SPEED * PACES.nominal.factor,  // flat ground at nominal pace, Apollo curve above (1.04 m/s)
      maxDurationH: 7.0,                                  // used only when no suit-limit setting is passed
      maxDistanceM: 8500,                                 // farthest an unassisted crew goes from base
      steepDeg: 12,                                       // slopes above this cost time and effort
      kcalHigh: 2200,                                     // metabolic cost above this is a hard day
      coldC: -70,                                         // below this the suit needs its glove and boot heaters
    },
    machine: {
      name: 'Marswalker Machine / Rover',
      maxSlopeDeg: 14,          // wheel traction limit on loose regolith
      critSlopeDeg: 20,         // rollover and wheel-stall limit
      driveSpeedMps: 0.042,     // ~150 m/h, a Perseverance-class top speed
      solBudgetM: 180,          // average drive per sol on good ground (~1.2 h of driving)
      critCurvature: 2.5,       // m: ground above or below the chord over a 20 m baseline (high-centre / nose-in risk)
      slipFromDeg: 12,          // above this, wheel slip ...
      slipSpeedFactor: 0.5,     // ... halves the progress made (planning assumption)
      sandRadiusM: 300,         // how close to a known sand-ripple site counts as "passing it"
    },
  };
  // Named places in the target list that sit in sand ripples (Perseverance steered around Séítah's ripple field).
  const SAND_RE = /sand ripple|s[eé][ií]tah/i;

  const fmtKm = (v) => (v >= 1000 ? (v / 1000).toFixed(1) + ' km' : Math.round(v) + ' m');
  const fmtH = (sec) => { const mn = Math.round(sec / 60); return mn < 60 ? mn + ' min' : Math.floor(mn / 60) + ':' + String(mn % 60).padStart(2, '0') + ' h'; };

  /** Largest slope held for at least minRun metres of the route (ignores one-pixel spikes). */
  function sustainedSlope(m, minRun) {
    let best = 0;
    for (let i = 0; i < m.d.length; i++) {
      let lo = Infinity;
      for (let j = i; j < m.d.length; j++) {
        lo = Math.min(lo, m.slope[j]);
        if (lo <= best) break;
        if (m.d[j] - m.d[i] >= minRun) { best = lo; break; }
      }
    }
    return best;
  }

  function verdictOf(score) { return score >= 70 ? 'GO' : score >= 40 ? 'CAUTION' : 'NO-GO'; }

  /**
   * Score one planned route for a suited crew on foot and for an autonomous machine, 0-100 each.
   * A hard limit sets the score to 0. Otherwise each problem takes points off; the biggest one is
   * the limiting factor.
   * @param plan        a planner plan (plan.ok must be true)
   * @param terrain     MM.terrain
   * @param conditions  MM.conditions.current()
   * @param opts        planner settings { startH, limitH, o2G, walkbackMin, ingressMin, reserveMin }
   */
  function evaluateTraverse(plan, terrain, conditions, opts) {
    if (!plan || !plan.ok || !plan.m || plan.m.d.length < 2) return null;
    const C = conditions || MM.conditions.current(), mars = C.mars, o = opts || {};
    const H = PROFILES.human, R = PROFILES.machine, m = plan.m, n = m.d.length, D = Math.max(1, plan.distance);

    // ---- route statistics shared by both
    let dSteep = 0, dScramble = 0, dSlip = 0, effM = 0;
    const effD = new Float32Array(n);                     // machine progress-equivalent distance at each sample
    for (let k = 1; k < n; k++) {
      const ds = m.d[k] - m.d[k - 1], sl = (m.slope[k] + m.slope[k - 1]) / 2;
      if (sl > H.steepDeg) dSteep += ds;
      if (sl > H.maxSlopeDeg) dScramble += ds;
      if (sl > R.slipFromDeg) { dSlip += ds; effM += ds / R.slipSpeedFactor; } else effM += ds;
      effD[k] = effM;
    }
    const sus = sustainedSlope(m, 20);
    // Break-overs: the middle of a 20 m baseline sits far above (crest) or below (dip) the straight line.
    let breaks = 0, inBreak = false;
    for (let k = 1; k < n - 1; k++) {
      const d1 = m.d[k] - m.d[k - 1], d2 = m.d[k + 1] - m.d[k];
      if (d1 + d2 < 15) { inBreak = false; continue; }
      const dev = m.z[k] - (m.z[k - 1] * d2 + m.z[k + 1] * d1) / (d1 + d2);
      const hit = Math.abs(dev) > R.critCurvature;
      if (hit && !inBreak) breaks++;
      inBreak = hit;
    }
    const sand = [];
    if (MM.science) for (const t of MM.science.all()) {
      if (!SAND_RE.test(t.unit + ' ' + t.name)) continue;
      for (let k = 0; k < n; k += 2) if (terrain.dist(t.lat, t.lon, m.lat[k], m.lon[k]) < R.sandRadiusM) { sand.push(t.name.replace(/\s*\(.*\)/, '')); break; }
    }
    const dustPts = C.dust.level >= 3 ? 10 : C.dust.level === 2 ? 4 : 0;

    // ---- crew on foot
    const limitH = o.limitH || H.maxDurationH, o2G = o.o2G || 600, backupMin = o.walkbackMin || 60;
    const ingress = (o.ingressMin != null ? o.ingressMin : 15) * 60, reserve = (o.reserveMin != null ? o.reserveMin : 30) * 60;
    const startH = o.startH != null ? o.startH : 9, endH = startH + plan.totalSeconds / 3600;
    const needWb = plan.walkbackSeconds + ingress, backup = backupMin * 60;
    const hum = { hard: null, pen: [] };
    const hardH = (short, long) => { if (!hum.hard) hum.hard = { short, long }; };
    if (needWb > backup) hardH('Walkback ' + Math.ceil(needWb / 60) + ' min > ' + backupMin + ' min backup O₂',
      'a suit failure at the worst point needs ' + Math.ceil(needWb / 60) + ' min to get back inside, but backup O₂ lasts ' + backupMin + ' min');
    if (startH < mars.sunriseLMST || endH > mars.sunsetLMST) hardH('Out after dark (sunset ' + MM.time.hhmm(mars.sunsetLMST) + ')',
      'the crew would still be outside in the dark and the night cold (back at ' + MM.time.hhmm(endH) + ', sunset ' + MM.time.hhmm(mars.sunsetLMST) + ' LMST)');
    if (plan.o2Grams > o2G) hardH('Needs ' + Math.ceil(plan.o2Grams) + ' g O₂, suit holds ' + o2G + ' g', 'the walk burns more oxygen (' + Math.ceil(plan.o2Grams) + ' g) than the suit holds (' + o2G + ' g)');
    if (plan.totalSeconds > limitH * 3600) hardH('EVA ' + fmtH(plan.totalSeconds) + ' > ' + limitH + ' h suit limit', 'the EVA (' + fmtH(plan.totalSeconds) + ') is longer than the ' + limitH + ' h suit limit');
    if (plan.farthest > H.maxDistanceM) hardH('Goes ' + fmtKm(plan.farthest) + ' out, foot radius ' + fmtKm(H.maxDistanceM), 'the route goes ' + fmtKm(plan.farthest) + ' from base, past the ' + fmtKm(H.maxDistanceM) + ' an unassisted crew should go');
    if (sus > H.critSlopeDeg) hardH('Slope ' + Math.round(sus) + '° past the ' + H.critSlopeDeg + '° slip limit', Math.round(sus) + '° ground is past the ' + H.critSlopeDeg + '° limit where a suited walker can slip');

    const penH = (pts, short, long) => { if (pts > 0.5) hum.pen.push({ pts, short, long }); };
    penH(Math.min(20, (plan.energyKcal - H.kcalHigh) / 40), 'Hard work: ' + Math.round(plan.energyKcal) + ' kcal', 'the walk costs ' + Math.round(plan.energyKcal) + ' kcal, a very hard day in the suit');
    penH(Math.min(15, dSteep / 40), fmtKm(dSteep) + ' on slopes above ' + H.steepDeg + '°', fmtKm(dSteep) + ' of the walk is on slopes above ' + H.steepDeg + '°');
    if (dScramble > 0) penH(Math.min(20, 6 + dScramble / 10), 'Scramble: ' + Math.round(sus) + '° (above ' + H.maxSlopeDeg + '°)', 'part of the route is a scramble on ' + Math.round(sus) + '° ground');
    const sunriseLTST = 12 - mars.dayHours / 2;
    const cold = Math.min(tempAt(startH + mars.eotHours, C.tmin, C.tmax, sunriseLTST), tempAt(endH + mars.eotHours, C.tmin, C.tmax, sunriseLTST));
    if (cold < H.coldC) penH(10, 'Cold: ' + Math.round(cold) + '° C', 'it is ' + Math.round(cold) + '° C at the airlock, below the comfortable suit range');
    if (!hum.hard && needWb > backup * 0.85) penH(15, 'Thin walkback (' + Math.ceil(needWb / 60) + ' of ' + backupMin + ' min)', 'the walkback uses ' + Math.ceil(needWb / 60) + ' of the ' + backupMin + ' min of backup oxygen');
    if (!hum.hard && plan.o2Grams > o2G * 0.85) penH(10, 'Thin O₂ margin (' + Math.round(plan.o2Grams) + ' of ' + o2G + ' g)', 'it uses ' + Math.round(plan.o2Grams) + ' of the suit\'s ' + o2G + ' g of oxygen');
    if (!hum.hard && plan.totalSeconds > limitH * 3600 - reserve) penH(10, 'Inside the suit-time reserve', 'it eats into the safety reserve on the suit clock');
    if (!hum.hard && (startH < mars.sunriseLMST + 1 || endH > mars.sunsetLMST - 1)) penH(5, 'Low Sun at ' + (endH > mars.sunsetLMST - 1 ? 'ingress' : 'egress'), 'part of it is in low Sun with long shadows');
    if (plan.losFraction < 0.5) penH(5, 'Radio shadow (' + Math.round(plan.losFraction * 100) + '% cover)', 'most of the route has no radio line of sight to base');
    penH(dustPts, 'Dust season', 'it is dust season');

    // ---- the machine
    const sols = Math.max(1, Math.ceil(effM / R.solBudgetM)), driveSec = effM / R.driveSpeedMps;
    const mac = { hard: null, pen: [], cap: 100, capWhy: null };
    if (sus > R.critSlopeDeg) mac.hard = { short: 'Slope ' + Math.round(sus) + '° past the ' + R.critSlopeDeg + '° rollover limit', long: Math.round(sus) + '° ground is past the machine\'s ' + R.critSlopeDeg + '° rollover and wheel-stall limit' };
    else if (sus > R.maxSlopeDeg) {
      mac.cap = Math.round(35 - 3 * (sus - R.maxSlopeDeg));
      mac.capWhy = { short: 'Slope ' + Math.round(sus) + '° exceeds traction limit (max ' + R.maxSlopeDeg + '°)', long: Math.round(sus) + '° ground is steeper than the machine\'s ' + R.maxSlopeDeg + '° traction limit' };
    }
    const penM = (pts, short, long) => { if (pts > 0.5) mac.pen.push({ pts, short, long }); };
    if (dSlip > 0) penM(Math.min(25, 3 + 50 * dSlip / D), fmtKm(dSlip) + ' above ' + R.slipFromDeg + '° (wheel slip)', fmtKm(dSlip) + ' is on slopes above ' + R.slipFromDeg + '° where the wheels slip');
    penM(Math.min(20, 5 * breaks), breaks + ' sharp crest' + (breaks > 1 ? 's or dips' : ' or dip'), 'the ground breaks sharply ' + breaks + ' time' + (breaks > 1 ? 's' : '') + ' (more than ' + R.critCurvature + ' m over 20 m), a high-centring risk');
    if (sand.length) penM(15, 'Sand ripples near ' + sand.join(', '), 'it passes the sand ripples near ' + sand.join(' and ') + ', where wheels can dig in');
    if (sols > 1) penM(Math.min(12, sols / 6), '~' + sols + ' sols of driving', 'the drive takes about ' + sols + ' sols');
    penM(dustPts, 'Dust season', 'it is dust season (dust on the cameras)');

    function finish(x, positive) {
      const sum = x.pen.reduce((a, p) => a + p.pts, 0);
      x.pen.sort((a, b) => b.pts - a.pts);
      let score = x.hard ? 0 : Math.max(0, Math.round(Math.min(x.cap != null ? x.cap : 100, 100 - sum)));
      const lim = x.hard || (x.capWhy && x.cap <= 100 - sum ? x.capWhy : x.pen[0]) || positive;
      return { score, verdict: x.hard ? 'NO-GO' : verdictOf(score), limitingFactor: lim.short, why: lim.long, hard: !!x.hard, penalties: x.pen.map((p) => p.short) };
    }
    // When nothing takes points off, the limiting factor is the tightest margin left.
    const margins = [
      { f: (mars.sunsetLMST - endH) / Math.max(0.1, mars.sunsetLMST - startH), short: 'Daylight margin (' + (mars.sunsetLMST - endH).toFixed(1) + ' h left)', long: 'the crew is back with ' + (mars.sunsetLMST - endH).toFixed(1) + ' h of daylight to spare' },
      { f: 1 - needWb / backup, short: 'Walkback margin (' + Math.floor((backup - needWb) / 60) + ' of ' + backupMin + ' min spare)', long: 'the walkback leaves ' + Math.floor((backup - needWb) / 60) + ' min of backup oxygen spare' },
      { f: 1 - plan.o2Grams / o2G, short: 'O₂ margin (' + Math.round(o2G - plan.o2Grams) + ' g spare)', long: Math.round(o2G - plan.o2Grams) + ' g of suit oxygen is left over' },
      { f: 1 - plan.totalSeconds / (limitH * 3600), short: 'Suit-time margin (' + fmtH(limitH * 3600 - plan.totalSeconds) + ' spare)', long: fmtH(limitH * 3600 - plan.totalSeconds) + ' of suit time is left over' },
    ].sort((a, b) => a.f - b.f);
    const human = finish(hum, margins[0]);
    const machine = finish(mac, { short: 'Within limits (~' + sols + ' sol' + (sols > 1 ? 's' : '') + ' of driving)', long: 'the ground stays inside its traction limit' });
    human.positive = 'the ' + fmtKm(plan.distance) + ' walk (' + fmtH(plan.totalSeconds) + ') fits the suit\'s oxygen and the ' + backupMin + ' min walkback';
    machine.positive = 'the machine can drive the ' + fmtKm(plan.distance) + ' in about ' + sols + ' sol' + (sols > 1 ? 's' : '') + ' on ground no steeper than ' + Math.round(sus) + '°';
    Object.assign(machine, { sols, driveHours: driveSec / 3600, slipDistance: dSlip, breakovers: breaks, sand, effD, solBudgetM: R.solBudgetM });
    Object.assign(human, { hours: plan.totalSeconds / 3600, steepDistance: dSteep });

    // ---- recommendation
    const best = machine.score > human.score ? 'machine' : 'human';
    const W = best === 'human' ? human : machine, L = best === 'human' ? machine : human;
    const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
    let rec;
    if (human.score < 40 && machine.score < 40) rec = 'Neither fits as planned: for the crew, ' + human.why + '; for the machine, ' + machine.why + '. Change the route or the settings.';
    else if (W.score >= 70 && L.score >= 70) rec = best === 'human'
      ? 'Either can do it. Crew on foot is quicker: ' + fmtH(plan.totalSeconds) + ' against about ' + sols + ' sol' + (sols > 1 ? 's' : '') + ' of driving.'
      : 'Either can do it. The machine scores higher because for the crew ' + human.why + '.';
    else if (L.score < 40) rec = (best === 'human' ? 'Crew on foot recommended: for the machine, ' : 'Send the machine: for the crew, ') + L.why + ', while ' + (best === 'human' ? human.positive : machine.positive) + '.';
    else rec = (best === 'human' ? 'Crew on foot' : 'The machine') + ' is the better option' + (W.score < 70 ? ', with care: ' + W.why : ', but ' + (best === 'human' ? 'for the machine ' : 'for the crew ') + L.why) + '.';
    return { human, machine, best, recommendation: cap(rec) };
  }

  MM.eva = { PACES, PROFILES, speed, apolloSpeed, power, analyze, tempAt, evaluateTraverse, MAX_SPEED, MARS_G, REST_POWER };
})();
