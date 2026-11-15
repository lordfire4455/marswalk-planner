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
 *             not an abundance. tools/build_minerals.py bakes the images into a 100 m grid
 *             (data/minerals.js, 64 kB) so this works instantly and offline.
 */
(function () {
  'use strict';
  const MM = (window.MM = window.MM || {});

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

  let grid = null, state = 'idle', loading = null;
  const listeners = [];

  /** Unpack data/minerals.js (built from the CRISM browse images by tools/build_minerals.py). */
  function load() {
    if (loading) return loading;
    const G = window.MM_MINERALS;
    if (!G || typeof DecompressionStream === 'undefined') { state = 'unavailable'; return (loading = Promise.resolve(false)); }
    state = 'loading';
    const bin = atob(G.b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    loading = new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
      .then((buf) => {
        grid = { w: G.width, h: G.height, west: G.west, east: G.east, south: G.south, north: G.north, order: G.order, d: new Uint8Array(buf) };
        state = 'ready'; listeners.splice(0).forEach((f) => f()); return true;
      })
      .catch((e) => { console.warn('Mineral grid could not be read:', e); state = 'unavailable'; return false; });
    return loading;
  }
  const onReady = (f) => { if (state === 'ready') f(); else listeners.push(f); };

  /**
   * Mineral band strengths at a point: [{ key, label, level (1-3), word, value (0-1), why, color }],
   * strongest first. null when no CRISM scene covers the point, undefined when not loaded yet.
   */
  function minerals(lat, lon) {
    if (state !== 'ready') return undefined;
    const g = grid;
    if (lat <= g.south || lat >= g.north || lon <= g.west || lon >= g.east) return null;
    const c = Math.min(g.w - 1, Math.floor((lon - g.west) / (g.east - g.west) * g.w));
    const r = Math.min(g.h - 1, Math.floor((g.north - lat) / (g.north - g.south) * g.h));
    const o = (r * g.w + c) * 3, out = [];
    let covered = false;
    g.order.forEach((key, k) => {
      const b = g.d[o + (k >> 1)], q = k % 2 ? b & 15 : b >> 4;
      if (!q) return;
      covered = true;
      const raw = (q - 1) / 14 * 255, level = levelOf(raw);
      if (level > 0) out.push({ key, label: MINERALS[key].label, color: MINERALS[key].color, why: MINERALS[key].why, level, word: LEVELS[level], value: raw / 255 });
    });
    return covered ? out.sort((a, b) => b.value - a.value) : null;
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
    if (list === undefined) return state === 'unavailable' ? 'mineral data unavailable in this browser' : 'reading minerals…';
    if (list === null) return 'outside the CRISM scenes';
    if (!list.length) return 'no strong mineral signal';
    return list.slice(0, max || 2).map((m) => m.label + ' ' + m.word).join(' · ');
  }

  /** Small HTML chips for a mineral list. */
  function chips(list, max) {
    if (!list || !list.length) return `<span class="min-none">${short(list)}</span>`;
    return list.slice(0, max || 3).map((m) => `<span class="min-chip" title="${m.why} Source: MRO CRISM, 2007."><i style="background:${m.color}"></i>${m.label} <em>${m.word}</em></span>`).join('');
  }

  MM.site = { load, onReady, minerals, at, short, chips, MINERALS, state: () => state };
})();
