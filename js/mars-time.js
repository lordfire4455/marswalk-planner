/*
 * Mars time and Sun geometry.
 * Algorithm: Allison & McEwen (2000), "A post-Pathfinder evaluation of areocentric
 * solar coordinates...", the same maths NASA GISS uses in Mars24.
 */
(function () {
  'use strict';
  const MM = (window.MM = window.MM || {});
  const D2R = Math.PI / 180;
  const SOL_SECONDS = 88775.244;

  const PBS = [
    [0.0071, 2.2353, 49.409], [0.0057, 2.7543, 168.173], [0.0039, 1.1177, 191.837],
    [0.0037, 15.7866, 21.736], [0.0021, 2.1354, 15.704], [0.0020, 2.4694, 95.528],
    [0.0018, 32.8493, 49.095],
  ];

  const mod = (a, n) => ((a % n) + n) % n;

  /** Core orbital state for a JS Date. */
  function orbit(date) {
    const jdUT = 2440587.5 + date.getTime() / 86400000;
    const jdTT = jdUT + 69.184 / 86400;             // TT - UTC (37 leap s + 32.184 s)
    const dt = jdTT - 2451545.0;                     // days since J2000
    const M = mod(19.3871 + 0.52402073 * dt, 360);   // mean anomaly
    const aFMS = mod(270.3871 + 0.524038496 * dt, 360); // fictitious mean sun
    let pbs = 0;
    for (const [A, tau, phi] of PBS) pbs += A * Math.cos((0.985626 * dt / tau + phi) * D2R);
    const m = M * D2R;
    const nuM = (10.691 + 3.0e-7 * dt) * Math.sin(m) + 0.623 * Math.sin(2 * m) + 0.050 * Math.sin(3 * m) +
      0.005 * Math.sin(4 * m) + 0.0005 * Math.sin(5 * m) + pbs;   // equation of centre, degrees
    const ls = mod(aFMS + nuM, 360);
    const l = ls * D2R;
    const eotDeg = 2.861 * Math.sin(2 * l) - 0.071 * Math.sin(4 * l) + 0.002 * Math.sin(6 * l) - nuM;
    const msd = (jdTT - 2405522.0028779) / 1.0274912517;         // Mars Sol Date
    const mtc = mod(24 * msd, 24);                                // Coordinated Mars Time, hours
    const decl = Math.asin(0.42565 * Math.sin(l)) / D2R + 0.25 * Math.sin(l);
    const sunDistAU = 1.52367934 * (1.0 - 0.09340 ** 2) / (1 + 0.09340 * Math.cos((M + nuM) * D2R));
    return { dt, ls, eotHours: eotDeg / 15, msd, mtc, decl, sunDistAU };
  }

  /** Mars year (Clancy et al. convention: MY 1 began 11 April 1955). */
  function marsYear(date) {
    const start = Date.UTC(1955, 3, 11, 0, 0, 0);
    return 1 + Math.floor((date.getTime() - start) / (686.9726 * 86400000));
  }

  function season(ls) {
    // Northern hemisphere seasons (Jezero is at 18.4 N).
    const names = ['Northern spring', 'Northern summer', 'Northern autumn', 'Northern winter'];
    return names[Math.floor(mod(ls, 360) / 90)];
  }

  /**
   * Local state for a site.
   * @param {Date} date
   * @param {number} lonE  east longitude, degrees
   * @param {number} lat   latitude, degrees
   * @param {Date} [landing] landing instant, to compute a mission sol count
   */
  function at(date, lonE, lat, landing) {
    const o = orbit(date);
    const lmst = mod(o.mtc + lonE / 15, 24);          // local mean solar time, hours
    const ltst = mod(lmst + o.eotHours, 24);          // local true solar time
    // Sunrise / sunset (centre of disc on a flat horizon).
    const x = -Math.tan(lat * D2R) * Math.tan(o.decl * D2R);
    const H = x >= 1 ? 0 : x <= -1 ? 180 : Math.acos(x) / D2R;   // half day arc, degrees
    const half = H / 15;
    const sunriseLMST = mod(12 - half - o.eotHours, 24);
    const sunsetLMST = mod(12 + half - o.eotHours, 24);
    // Sun elevation right now.
    const hAng = (ltst - 12) * 15 * D2R;
    const sinEl = Math.sin(lat * D2R) * Math.sin(o.decl * D2R) + Math.cos(lat * D2R) * Math.cos(o.decl * D2R) * Math.cos(hAng);
    const sunEl = Math.asin(Math.max(-1, Math.min(1, sinEl))) / D2R;
    let sol = null;
    if (landing) {
      const lo = orbit(landing);
      sol = Math.floor(o.msd + lonE / 360) - Math.floor(lo.msd + lonE / 360);
    }
    return {
      ls: o.ls, season: season(o.ls), marsYear: marsYear(date), msd: o.msd, mtc: o.mtc,
      lmst, ltst, eotHours: o.eotHours, decl: o.decl, sunDistAU: o.sunDistAU,
      sunriseLMST, sunsetLMST, dayHours: 2 * half, sunEl, sol,
    };
  }

  /** Hours (0-24, may be fractional) -> "HH:MM". */
  function hhmm(h) {
    h = mod(h, 24);
    let hh = Math.floor(h), mm = Math.round((h - hh) * 60);
    if (mm === 60) { mm = 0; hh = (hh + 1) % 24; }
    return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  }

  /** Dust-storm climatology by solar longitude (Kass et al. 2016; Zurek & Martin 1993). */
  function dustRisk(ls) {
    ls = mod(ls, 360);
    if (ls >= 205 && ls < 245) return { level: 3, label: 'High', note: 'Peak of the first regional dust-storm window ("A" storms). Global storms, when they happen, usually start now.' };
    if (ls >= 300 && ls < 340) return { level: 3, label: 'High', note: 'Late-season regional storm window ("C" storms). Sky opacity can jump within a few sols.' };
    if (ls >= 180 && ls < 360) return { level: 2, label: 'Elevated', note: 'Dust-storm season (southern spring and summer). Check orbiter dust maps before every EVA.' };
    if (ls >= 140 && ls < 180) return { level: 1, label: 'Low, rising', note: 'End of the clear season. Local dust devils become common around midday.' };
    return { level: 0, label: 'Low', note: 'Clear, cold aphelion season. Water-ice clouds are more likely than dust.' };
  }

  MM.time = { orbit, at, hhmm, season, marsYear, dustRisk, SOL_SECONDS, mod };
})();
