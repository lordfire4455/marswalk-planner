/*
 * "What the data says here": reads the real NASA products under any point.
 *
 *   Terrain   height and slope from the MRO CTX 20 m elevation model.
 *   Minerals  MRO CRISM browse products (Viviano-Beck et al. 2014). Each colour channel of a
 *             browse image is one spectral band index, stretched so that 0 means no detection:
 *               MAF  R olivine (OLINDEX3)      G low-Ca pyroxene (LCPINDEX2)  B high-Ca pyroxene (HCPINDEX2)
 *               CAR  R Fe/Mg clay (D2300)       G carbonate (BD2500_2)          B hydration (BD1900_2)
 *               PFM  R chlorite / Fe-Ca carbonate (BD2355)  G Fe/Mg clay (D2300)  B Fe/Mg-OH (BD2290)
 *             The value we report is a relative band strength (none / weak / moderate / strong),
 *             not an abundance. The pixels are read once from the bundled PNGs.
 *
 * Over file:// a browser will not let a page read image pixels, so minerals are then skipped.
 */
(function () {
  'use strict';
  const MM = (window.MM = window.MM || {});

  const CHANNELS = {
    maf: ['olivine', 'pyroxene', 'pyroxene'],
    car: ['clay', 'carbonate', 'hydrated'],
    pfm: ['chlorite', 'clay', 'clay'],
  };
  /** What each mineral means for a crew deciding where to spend time. */
  const MINERALS = {
    carbonate: { label: 'Carbonate', color: '#e8e36a', why: 'Forms in liquid water. On Earth carbonates preserve fossil microbial mats, so this is a prime biosignature target.' },
    clay:      { label: 'Fe/Mg clay', color: '#3fd0d8', why: 'Settles out of standing water and protects organic molecules from radiation. Top priority for life-detection samples.' },
    hydrated:  { label: 'Hydrated minerals', color: '#5a7dff', why: 'Water locked into the rock. Evidence of past water, and a possible water resource for a crew.' },
    olivine:   { label: 'Olivine', color: '#e5484d', why: 'Igneous rock. Where water altered it, it makes carbonate and hydrogen, a possible energy source for microbes.' },
    pyroxene:  { label: 'Pyroxene', color: '#6c7bff', why: 'Volcanic rock that can be dated. Tells the age of the crater floor that the lake sediments sit on.' },
    chlorite:  { label: 'Chlorite or Fe/Ca carbonate', color: '#e6b23c', why: 'Altered by warm water. Records how hot the old lake system got.' },
  };
  const LEVELS = ['none', 'weak', 'moderate', 'strong'];
  const levelOf = (v) => (v < 48 ? 0 : v < 110 ? 1 : v < 180 ? 2 : 3);

  let scenes = null, state = 'idle', loading = null;
  const listeners = [];

  function loadImage(src) {
    return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
  }

  /** Read every CRISM browse image into memory once. Resolves true when minerals can be read. */
  function load() {
    if (loading) return loading;
    const C = window.MM_CRISM;
    if (!C || location.protocol === 'file:') { state = 'unavailable'; return (loading = Promise.resolve(false)); }
    state = 'loading';
    loading = Promise.all(C.scenes.map(async (s) => {
      const out = { id: s.id, date: s.date, bounds: s.bounds, px: {} };
      for (const prod of Object.keys(CHANNELS)) {
        if (!s.files[prod]) continue;
        const im = await loadImage(s.files[prod]);
        const cv = document.createElement('canvas'); cv.width = im.naturalWidth; cv.height = im.naturalHeight;
        const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(im, 0, 0);
        out.px[prod] = { w: cv.width, h: cv.height, d: g.getImageData(0, 0, cv.width, cv.height).data };
      }
      return out;
    })).then((list) => { scenes = list; state = 'ready'; listeners.splice(0).forEach((f) => f()); return true; })
      .catch((e) => { console.warn('CRISM pixels could not be read:', e); state = 'unavailable'; return false; });
    return loading;
  }
  const onReady = (f) => { if (state === 'ready') f(); else listeners.push(f); };

  /**
   * Mineral band strengths at a point: [{ key, label, level (1-3), word, value (0-1), scene, date, why }],
   * strongest first. null when no CRISM scene covers the point, undefined when not loaded.
   */
  function minerals(lat, lon) {
    if (state !== 'ready') return undefined;
    const best = {};
    let covered = false;
    for (const s of scenes) {
      const [[south, west], [north, east]] = s.bounds;
      if (lat < south || lat > north || lon < west || lon > east) continue;
      for (const prod in s.px) {
        const P = s.px[prod];
        const cx = Math.round((lon - west) / (east - west) * P.w - 0.5), cy = Math.round((north - lat) / (north - south) * P.h - 0.5);
        // mean of a 5 x 5 pixel window (about 90 m) over the pixels that hold data
        const sum = [0, 0, 0]; let n = 0;
        for (let y = cy - 2; y <= cy + 2; y++) for (let x = cx - 2; x <= cx + 2; x++) {
          if (x < 0 || y < 0 || x >= P.w || y >= P.h) continue;
          const i = (y * P.w + x) * 4;
          if (P.d[i + 3] < 128) continue;
          sum[0] += P.d[i]; sum[1] += P.d[i + 1]; sum[2] += P.d[i + 2]; n++;
        }
        if (n < 6) continue;
        covered = true;
        CHANNELS[prod].forEach((key, c) => {
          const v = sum[c] / n;
          if (!best[key] || v > best[key].raw) best[key] = { raw: v, scene: s.id, date: s.date };
        });
      }
    }
    if (!covered) return null;
    return Object.keys(best).map((key) => {
      const b = best[key], level = levelOf(b.raw);
      return { key, label: MINERALS[key].label, color: MINERALS[key].color, why: MINERALS[key].why, level, word: LEVELS[level], value: b.raw / 255, scene: b.scene, date: b.date };
    }).filter((m) => m.level > 0).sort((a, b) => b.value - a.value);
  }

  /** Everything we can measure at a point, from the bundled NASA data. */
  function at(lat, lon) {
    const T = MM.terrain;
    const r = { inside: T.inside(lat, lon) };
    if (r.inside) { r.elev = T.elev(lat, lon); r.slope = T.slopeAt(lat, lon); r.cls = T.CLASSES[T.classOf(r.slope)]; }
    r.minerals = minerals(lat, lon);
    return r;
  }

  /** "Carbonate moderate · olivine strong" (top two), or a short reason when there is nothing to show. */
  function short(list, max) {
    if (list === undefined) return state === 'unavailable' ? 'minerals need the online version' : 'reading minerals…';
    if (list === null) return 'outside the CRISM scenes';
    if (!list.length) return 'no strong mineral signal';
    return list.slice(0, max || 2).map((m) => m.label + ' ' + m.word).join(' · ');
  }

  /** Small HTML chips for a mineral list. */
  function chips(list, max) {
    if (!list || !list.length) return `<span class="min-none">${short(list)}</span>`;
    return list.slice(0, max || 3).map((m) => `<span class="min-chip" title="${m.why} CRISM ${m.scene}, ${m.date}."><i style="background:${m.color}"></i>${m.label} <em>${m.word}</em></span>`).join('');
  }

  MM.site = { load, onReady, minerals, at, short, chips, MINERALS, state: () => state };
})();
