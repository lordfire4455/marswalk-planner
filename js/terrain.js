/*
 * Terrain model: decodes the bundled CTX DEM and derives slope, shaded relief,
 * hazard rasters, elevation sampling and line-of-sight.
 */
(function () {
  'use strict';
  const MM = (window.MM = window.MM || {});
  const D2R = Math.PI / 180;

  // Slope classes used everywhere (map legend, route colouring, statistics).
  const CLASSES = [
    { max: 5, label: 'Easy', range: '0–5°', color: '#34b27d', rgb: [52, 178, 125] },
    { max: 10, label: 'Moderate', range: '5–10°', color: '#a7c75f', rgb: [167, 199, 95] },
    { max: 15, label: 'Caution', range: '10–15°', color: '#e9c24f', rgb: [233, 194, 79] },
    { max: 20, label: 'Difficult', range: '15–20°', color: '#e8874a', rgb: [232, 135, 74] },
    { max: 25, label: 'Severe', range: '20–25°', color: '#d94f6a', rgb: [217, 79, 106] },
    { max: 91, label: 'No-go', range: '> 25°', color: '#7c1d3c', rgb: [124, 29, 60] },
  ];
  function classOf(slopeDeg) {
    for (let i = 0; i < CLASSES.length; i++) if (slopeDeg < CLASSES[i].max) return i;
    return CLASSES.length - 1;
  }

  const T = {
    ready: false, w: 0, h: 0, z: null, slope: null, shade: null,
    west: 0, east: 0, south: 0, north: 0, dx: 0, dy: 0, CLASSES, classOf,
  };

  async function gunzipBase64(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('This browser is too old to unpack the terrain data. Please use a current Chrome, Edge, Firefox or Safari.');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Response(stream).arrayBuffer();
  }

  T.load = async function () {
    const d = window.MM_DEM;
    if (!d) throw new Error('Terrain data (data/dem.js) is missing.');
    const buf = await gunzipBase64(d.b64);
    const delta = new Int16Array(buf);
    const w = d.width, h = d.height;
    if (delta.length !== w * h) throw new Error('Terrain data is corrupted.');
    const z = new Float32Array(w * h);
    let first = 0;
    for (let r = 0; r < h; r++) {
      const o = r * w;
      first += delta[o];
      let v = first;
      z[o] = v / 10;
      for (let c = 1; c < w; c++) { v += delta[o + c]; z[o + c] = v / 10; }
    }
    Object.assign(T, { w, h, z, west: d.west, east: d.east, south: d.south, north: d.north, source: d.source });
    T.minElev = d.min_m; T.maxElev = d.max_m;
    T.dy = d.pixel_m;                                             // metres per row (north-south)
    T.dx = d.pixel_m * Math.cos(((d.south + d.north) / 2) * D2R); // metres per column (east-west)
    T.mPerDegLat = d.radius_m * D2R;
    T.mPerDegLon = d.radius_m * D2R * Math.cos(((d.south + d.north) / 2) * D2R);
    T.radius = d.radius_m;
    derive();
    T.ready = true;
    window.MM_DEM.b64 = null; // free ~2 MB
    return T;
  };

  /** Horn (1981) slope plus a north-west lit hillshade, in one pass. */
  function derive() {
    const { w, h, z, dx, dy } = T;
    const slope = new Float32Array(w * h);
    const shade = new Uint8Array(w * h);
    const az = 315 * D2R, alt = 42 * D2R, zf = 4.5; // light direction and vertical exaggeration
    const lx = Math.sin(az) * Math.cos(alt), ly = Math.cos(az) * Math.cos(alt), lz = Math.sin(alt);
    for (let r = 0; r < h; r++) {
      const rn = r > 0 ? r - 1 : r, rs = r < h - 1 ? r + 1 : r;
      for (let c = 0; c < w; c++) {
        const cw = c > 0 ? c - 1 : c, ce = c < w - 1 ? c + 1 : c;
        const nw = z[rn * w + cw], n = z[rn * w + c], ne = z[rn * w + ce];
        const wv = z[r * w + cw], e = z[r * w + ce];
        const sw = z[rs * w + cw], s = z[rs * w + c], se = z[rs * w + ce];
        const gx = ((ne + 2 * e + se) - (nw + 2 * wv + sw)) / (8 * dx);   // + east
        const gy = ((nw + 2 * n + ne) - (sw + 2 * s + se)) / (8 * dy);    // + north
        const i = r * w + c;
        slope[i] = Math.atan(Math.sqrt(gx * gx + gy * gy)) / D2R;
        const nx = -gx * zf, ny = -gy * zf;
        const v = (nx * lx + ny * ly + lz) / Math.sqrt(nx * nx + ny * ny + 1);
        shade[i] = v <= 0 ? 0 : Math.min(255, Math.round(v * 255 / 0.95));
      }
    }
    T.slope = slope; T.shade = shade;
  }

  // ---- coordinate helpers -------------------------------------------------
  T.colOf = (lon) => (lon - T.west) / (T.east - T.west) * T.w - 0.5;
  T.rowOf = (lat) => (T.north - lat) / (T.north - T.south) * T.h - 0.5;
  T.lonOf = (col) => T.west + (col + 0.5) / T.w * (T.east - T.west);
  T.latOf = (row) => T.north - (row + 0.5) / T.h * (T.north - T.south);
  T.inside = (lat, lon) => lat > T.south && lat < T.north && lon > T.west && lon < T.east;
  T.cellOf = function (lat, lon) {
    const c = Math.round(T.colOf(lon)), r = Math.round(T.rowOf(lat));
    if (c < 0 || r < 0 || c >= T.w || r >= T.h) return -1;
    return r * T.w + c;
  };
  T.bounds = () => [[T.south, T.west], [T.north, T.east]];

  /** Bilinear elevation in metres (MOLA areoid), or NaN outside the DEM. */
  T.elev = function (lat, lon) {
    const x = T.colOf(lon), y = T.rowOf(lat);
    if (x < 0 || y < 0 || x > T.w - 1 || y > T.h - 1) return NaN;
    const c = Math.min(T.w - 2, Math.floor(x)), r = Math.min(T.h - 2, Math.floor(y));
    const fx = x - c, fy = y - r, i = r * T.w + c, z = T.z;
    return (z[i] * (1 - fx) + z[i + 1] * fx) * (1 - fy) + (z[i + T.w] * (1 - fx) + z[i + T.w + 1] * fx) * fy;
  };
  T.slopeAt = function (lat, lon) {
    const i = T.cellOf(lat, lon);
    return i < 0 ? NaN : T.slope[i];
  };
  /** Ground distance in metres between two lat/lon points (small-area approximation). */
  T.dist = function (lat1, lon1, lat2, lon2) {
    const dx = (lon2 - lon1) * T.mPerDegLon, dy = (lat2 - lat1) * T.mPerDegLat;
    return Math.sqrt(dx * dx + dy * dy);
  };

  /**
   * Radio / visual line of sight between two points, with antenna heights (m)
   * above ground and planetary curvature. Returns true when unobstructed.
   */
  T.los = function (lat1, lon1, h1, lat2, lon2, h2) {
    const d = T.dist(lat1, lon1, lat2, lon2);
    const n = Math.ceil(d / 20);
    if (n < 2) return true;
    const za = T.elev(lat1, lon1) + h1, zb = T.elev(lat2, lon2) + h2;
    if (isNaN(za) || isNaN(zb)) return false;
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const ground = T.elev(lat1 + (lat2 - lat1) * t, lon1 + (lon2 - lon1) * t);
      const bulge = (d * t) * (d * (1 - t)) / (2 * T.radius);
      if (ground + bulge > za + (zb - za) * t) return false;
    }
    return true;
  };

  // ---- rasters for the map --------------------------------------------------
  function canvasOf(fill) {
    const cv = document.createElement('canvas');
    cv.width = T.w; cv.height = T.h;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(T.w, T.h);
    fill(img.data);
    ctx.putImageData(img, 0, 0);
    return cv;
  }

  /** Traffic-light slope hazard raster. Cells above maxSlope are drawn as no-go. */
  T.renderHazard = function (maxSlope) {
    return canvasOf((px) => {
      const s = T.slope, n = s.length;
      for (let i = 0, j = 0; i < n; i++, j += 4) {
        const v = s[i];
        let k = classOf(v);
        if (v > maxSlope) k = CLASSES.length - 1;
        const rgb = CLASSES[k].rgb;
        px[j] = rgb[0]; px[j + 1] = rgb[1]; px[j + 2] = rgb[2];
        px[j + 3] = k === 0 ? 46 : k === 1 ? 120 : 205;
      }
    });
  };

  const RAMP = [ // elevation colour ramp (low -> high)
    [0.00, [38, 70, 120]], [0.18, [62, 130, 150]], [0.36, [120, 170, 120]], [0.54, [214, 196, 128]],
    [0.72, [196, 128, 86]], [0.88, [150, 86, 70]], [1.00, [240, 232, 224]],
  ];
  function ramp(t) {
    t = Math.max(0, Math.min(1, t));
    for (let i = 1; i < RAMP.length; i++) {
      if (t <= RAMP[i][0]) {
        const a = RAMP[i - 1], b = RAMP[i], f = (t - a[0]) / (b[0] - a[0]);
        return [a[1][0] + (b[1][0] - a[1][0]) * f, a[1][1] + (b[1][1] - a[1][1]) * f, a[1][2] + (b[1][2] - a[1][2]) * f];
      }
    }
    return RAMP[RAMP.length - 1][1];
  }
  T.elevColor = (z) => ramp((z - T.minElev) / (T.maxElev - T.minElev));

  /** Colour-by-elevation with 50 m contours (bold every 250 m). */
  T.renderElevation = function () {
    return canvasOf((px) => {
      const { w, h, z } = T;
      for (let r = 0; r < h; r++) {
        for (let c = 0; c < w; c++) {
          const i = r * w + c, j = i * 4, v = z[i];
          const rgb = ramp((v - T.minElev) / (T.maxElev - T.minElev));
          const sh = 0.55 + 0.45 * (T.shade[i] / 255);
          let R = rgb[0] * sh, G = rgb[1] * sh, B = rgb[2] * sh, A = 215;
          if (c < w - 1 && r < h - 1) {
            const a = Math.floor(v / 50), b = Math.floor(z[i + 1] / 50), d = Math.floor(z[i + w] / 50);
            if (a !== b || a !== d) {
              const level = Math.max(a, b, d) * 50;
              const bold = level % 250 === 0;
              R *= bold ? 0.25 : 0.55; G *= bold ? 0.25 : 0.55; B *= bold ? 0.25 : 0.55; A = 235;
            }
          }
          px[j] = R; px[j + 1] = G; px[j + 2] = B; px[j + 3] = A;
        }
      }
    });
  };

  /** Mars-tinted shaded relief, used as the offline base map. */
  T.renderRelief = function () {
    return canvasOf((px) => {
      const n = T.z.length;
      for (let i = 0, j = 0; i < n; i++, j += 4) {
        const sh = T.shade[i] / 255;
        const t = (T.z[i] - T.minElev) / (T.maxElev - T.minElev);
        const k = 0.18 + 1.05 * sh;
        px[j] = Math.min(255, (150 + 60 * t) * k);
        px[j + 1] = Math.min(255, (98 + 62 * t) * k);
        px[j + 2] = Math.min(255, (70 + 56 * t) * k);
        px[j + 3] = 255;
      }
    });
  };

  MM.terrain = T;
})();
