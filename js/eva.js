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

  MM.eva = { PACES, speed, apolloSpeed, power, analyze, tempAt, MAX_SPEED, MARS_G, REST_POWER };
})();
