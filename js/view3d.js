/*
 * 3D preview: the planned route draped over real terrain, built from the bundled
 * elevation model and textured with MRO CTX imagery when NASA's tiles are reachable.
 */
(function () {
  'use strict';
  const MM = (window.MM = window.MM || {});
  const TILE = 'https://trek.nasa.gov/tiles/Mars/EQ/JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0/1.0.0/default/default028mm/';
  let V = null; // live view state

  function open() {
    const plan = MM.planner.plan();
    if (!plan || !plan.ok) return;
    if (!window.THREE) { MM.toast('3D view could not load.', 'error'); return; }
    close();
    const T = MM.terrain, m = plan.m;

    // ---- area: route bounding box plus a margin, kept roughly square
    let s = Infinity, n = -Infinity, w = Infinity, e = -Infinity;
    for (let k = 0; k < m.lat.length; k++) { s = Math.min(s, m.lat[k]); n = Math.max(n, m.lat[k]); w = Math.min(w, m.lon[k]); e = Math.max(e, m.lon[k]); }
    let hx = (e - w) * T.mPerDegLon / 2, hy = (n - s) * T.mPerDegLat / 2;
    const half = Math.max(700, Math.max(hx, hy) * 1.45);
    const clat = (s + n) / 2, clon = (w + e) / 2;
    s = Math.max(T.south + 0.001, clat - half / T.mPerDegLat); n = Math.min(T.north - 0.001, clat + half / T.mPerDegLat);
    w = Math.max(T.west + 0.001, clon - half / T.mPerDegLon); e = Math.min(T.east - 0.001, clon + half / T.mPerDegLon);
    const widthM = (e - w) * T.mPerDegLon, heightM = (n - s) * T.mPerDegLat;
    const N = Math.min(280, Math.max(60, Math.round(Math.max(widthM, heightM) / T.dy)));
    const nx = Math.max(2, Math.round(N * widthM / Math.max(widthM, heightM))), ny = Math.max(2, Math.round(N * heightM / Math.max(widthM, heightM)));

    let zmin = Infinity, zmax = -Infinity;
    const heights = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const z = T.elev(n - (n - s) * j / (ny - 1), w + (e - w) * i / (nx - 1));
      heights[j * nx + i] = z; if (z < zmin) zmin = z; if (z > zmax) zmax = z;
    }
    const toX = (lon) => (lon - (w + e) / 2) * T.mPerDegLon, toZ = (lat) => -(lat - (s + n) / 2) * T.mPerDegLat;

    // ---- DOM
    const box = document.createElement('div');
    box.id = 'view3d';
    box.innerHTML = `
      <div class="v3-bar">
        <span class="v3-title">3D route preview</span>
        <span class="v3-info">${MM.planner.km(plan.distance)} · relief ${Math.round(zmax - zmin)} m · drag to orbit, scroll to zoom</span>
        <span class="seg v3-seg" id="v3-exag" title="Vertical exaggeration"><button data-v="1">1×</button><button data-v="2" class="on">2×</button><button data-v="4">4×</button></span>
        <span class="seg v3-seg" id="v3-tex"><button data-v="image" class="on">Imagery</button><button data-v="hazard">Hazard</button></span>
        <button class="primary-btn sm" id="v3-fly">▶ Fly the route</button>
        <button class="ghost-btn sm" id="v3-close">Close</button>
      </div>
      <div class="v3-hud" id="v3-hud" hidden></div>`;
    document.getElementById('stage').appendChild(box);

    // ---- three.js
    const THREE = window.THREE;
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: true }); }
    catch (err) { box.remove(); MM.toast('This device cannot show 3D graphics (WebGL is off).', 'warn'); return; }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    box.insertBefore(renderer.domElement, box.firstChild);
    const scene = new THREE.Scene();
    const sky = new THREE.Color(0xc79a72);
    scene.background = sky;
    const span = Math.max(widthM, heightM);
    scene.fog = new THREE.Fog(sky, span * 1.2, span * 4.2);
    const camera = new THREE.PerspectiveCamera(45, 1, span / 2000, span * 8);
    scene.add(new THREE.AmbientLight(0xffe2cc, 0.62));
    const sun = new THREE.DirectionalLight(0xfff1dd, 0.95);
    sun.position.set(-span, span * 0.9, -span * 0.4); scene.add(sun);
    const fill = new THREE.DirectionalLight(0xffd2b0, 0.3);          // soft light on the cut faces nearest the camera
    fill.position.set(span * 0.5, span * 0.35, span); scene.add(fill);

    // terrain mesh
    const geo = new THREE.PlaneGeometry(widthM, heightM, nx - 1, ny - 1);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const mesh = new THREE.Mesh(geo, mat); scene.add(mesh);
    // Solid block: four cross-section walls hang from the terrain edge down to a flat
    // floor, so the terrain reads as one watertight piece of ground with no gap under it.
    const wallMat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: strataTexture() });
    const floorMat = new THREE.MeshLambertMaterial({ color: 0x1c110a, side: THREE.DoubleSide });
    const block = new THREE.Group(); scene.add(block);

    /** Layered-rock texture for the cut faces of the block (decorative, not data). */
    function strataTexture() {
      const c = document.createElement('canvas'); c.width = 512; c.height = 256;
      const g = c.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0, '#8a5a3e'); grad.addColorStop(0.45, '#5e3b28'); grad.addColorStop(1, '#2b1a11');
      g.fillStyle = grad; g.fillRect(0, 0, 512, 256);
      let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      for (let y = 6; y < 256; y += 5 + rnd() * 16) {           // strata lines, gently wavy and seamless in x
        const amp = 1 + rnd() * 2.5, waves = 1 + Math.floor(rnd() * 3), ph = rnd() * 6.28;
        g.beginPath();
        for (let x = 0; x <= 512; x += 8) { const yy = y + Math.sin(x / 512 * 6.2832 * waves + ph) * amp; if (x) g.lineTo(x, yy); else g.moveTo(x, yy); }
        g.strokeStyle = rnd() > 0.5 ? 'rgba(20, 10, 5, .42)' : 'rgba(255, 196, 150, .15)';
        g.lineWidth = 1 + rnd() * 2.2; g.stroke();
      }
      const t = new THREE.CanvasTexture(c);
      t.wrapS = THREE.RepeatWrapping; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
      return t;
    }

    /** Height of the drawn terrain surface (metres above the lowest point, exaggerated). */
    function surfaceY(lat, lon, exag) {
      const fx = Math.max(0, Math.min(nx - 1, (lon - w) / (e - w) * (nx - 1)));
      const fy = Math.max(0, Math.min(ny - 1, (n - lat) / (n - s) * (ny - 1)));
      const i = Math.min(nx - 2, Math.floor(fx)), j = Math.min(ny - 2, Math.floor(fy)), tx = fx - i, ty = fy - j, o = j * nx + i;
      const z = (heights[o] * (1 - tx) + heights[o + 1] * tx) * (1 - ty) + (heights[o + nx] * (1 - tx) + heights[o + nx + 1] * tx) * ty;
      return (z - zmin) * exag;
    }

    /** Rebuild the walls and floor for the current vertical exaggeration. */
    function buildBlock(exag) {
      while (block.children.length) { const c = block.children.pop(); c.geometry.dispose(); }
      const relief = (zmax - zmin) * exag;
      const baseT = Math.max(span * 0.035, relief * 0.22);       // rock shown below the lowest point
      const total = relief + baseT;
      const X = (i) => -widthM / 2 + widthM * i / (nx - 1), Z = (j) => -heightM / 2 + heightM * j / (ny - 1);
      const Y = (i, j) => (heights[j * nx + i] - zmin) * exag;
      const sides = [   // each: number of points, grid index of point k, outward normal
        { len: nx, at: (k) => [k, 0], nrm: [0, 0, -1] },          // north
        { len: nx, at: (k) => [k, ny - 1], nrm: [0, 0, 1] },      // south
        { len: ny, at: (k) => [0, k], nrm: [-1, 0, 0] },          // west
        { len: ny, at: (k) => [nx - 1, k], nrm: [1, 0, 0] },      // east
      ];
      const pos = [], nor = [], uv = [], idx = [];
      sides.forEach((sd) => {
        const base = pos.length / 3;
        for (let k = 0; k < sd.len; k++) {
          const ij = sd.at(k), x = X(ij[0]), z = Z(ij[1]), y = Y(ij[0], ij[1]);
          const u = (sd.nrm[0] ? z : x) / span * 2.5;
          pos.push(x, y, z, x, -baseT, z);
          nor.push(sd.nrm[0], 0, sd.nrm[2], sd.nrm[0], 0, sd.nrm[2]);
          uv.push(u, (y + baseT) / total, u, 0);
        }
        // Winding that faces outward: along +x the south wall is seen left to right, the north wall right to left, and so on.
        const flip = sd.nrm[2] === -1 || sd.nrm[0] === 1;
        for (let k = 0; k < sd.len - 1; k++) {
          const t0 = base + k * 2, b0 = t0 + 1, t1 = t0 + 2, b1 = t0 + 3;
          if (flip) idx.push(b0, t1, b1, b0, t0, t1); else idx.push(b0, b1, t1, b0, t1, t0);
        }
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      block.add(new THREE.Mesh(g, wallMat));
      const fg = new THREE.PlaneGeometry(widthM, heightM); fg.rotateX(Math.PI / 2); fg.translate(0, -baseT, 0);
      block.add(new THREE.Mesh(fg, floorMat));
      V.baseT = baseT;
    }

    // textures
    const TEX = 1024;
    const mk = () => { const c = document.createElement('canvas'); c.width = TEX; c.height = Math.max(64, Math.round(TEX * heightM / widthM)); return c; };
    const cvRelief = mk(), cvHazard = mk(), cvImage = mk();
    paintFromDem(cvRelief, false); paintFromDem(cvHazard, true);
    cvImage.getContext('2d').drawImage(cvRelief, 0, 0);
    const tex = new THREE.CanvasTexture(cvImage);
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    mat.map = tex;

    function paintFromDem(cv, hazard) {
      const sw = Math.min(cv.width, nx * 3), sh = Math.max(2, Math.round(sw * heightM / widthM));
      const small = document.createElement('canvas'); small.width = sw; small.height = sh;
      const ctx = small.getContext('2d'), img = ctx.createImageData(sw, sh), px = img.data;
      for (let j = 0; j < sh; j++) for (let i = 0; i < sw; i++) {
        const lat = n - (n - s) * (j + 0.5) / sh, lon = w + (e - w) * (i + 0.5) / sw;
        const ci = T.cellOf(lat, lon), o = (j * sw + i) * 4;
        const shd = ci < 0 ? 0.6 : 0.35 + 0.8 * T.shade[ci] / 255;
        let r = 176, g = 118, b = 84;
        if (hazard && ci >= 0) {
          let k = T.classOf(T.slope[ci]); if (T.slope[ci] > MM.planner.settings().maxSlope) k = T.CLASSES.length - 1;
          const c = T.CLASSES[k].rgb, a = k === 0 ? 0.35 : 0.8;
          r = r * (1 - a) + c[0] * a; g = g * (1 - a) + c[1] * a; b = b * (1 - a) + c[2] * a;
        }
        px[o] = Math.min(255, r * shd); px[o + 1] = Math.min(255, g * shd); px[o + 2] = Math.min(255, b * shd); px[o + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      const c2 = cv.getContext('2d'); c2.imageSmoothingEnabled = true; c2.drawImage(small, 0, 0, cv.width, cv.height);
    }

    // real imagery, when the tile server answers
    (function loadImagery() {
      let z = 13;
      const count = (zz) => { const d = 180 / Math.pow(2, zz); return (Math.floor((e + 180) / d) - Math.floor((w + 180) / d) + 1) * (Math.floor((90 - s) / d) - Math.floor((90 - n) / d) + 1); };
      while (z > 8 && count(z) > 42) z--;
      const d = 180 / Math.pow(2, z);
      const x0 = Math.floor((w + 180) / d), x1 = Math.floor((e + 180) / d), y0 = Math.floor((90 - n) / d), y1 = Math.floor((90 - s) / d);
      const stage = mk(), ctx = stage.getContext('2d');
      ctx.drawImage(cvRelief, 0, 0);
      let pending = (x1 - x0 + 1) * (y1 - y0 + 1), okCount = 0;
      const done = () => {
        if (--pending > 0 || !V || V.box !== box) return;
        if (okCount === 0) return;
        try { stage.getContext('2d').getImageData(0, 0, 1, 1); } catch (err) { return; }
        V.hasImagery = true;
        cvImage.getContext('2d').drawImage(stage, 0, 0);
        if (V.tex === 'image') tex.needsUpdate = true;
      };
      for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
        const im = new Image(); im.crossOrigin = 'anonymous';
        im.onload = () => {
          const lonL = tx * d - 180, latT = 90 - ty * d;
          ctx.drawImage(im, (lonL - w) / (e - w) * stage.width, (n - latT) / (n - s) * stage.height, d / (e - w) * stage.width + 0.5, d / (n - s) * stage.height + 0.5);
          okCount++; done();
        };
        im.onerror = done;
        im.src = TILE + z + '/' + ty + '/' + tx + '.png';
      }
    })();

    // route tube, coloured by slope class
    const group = new THREE.Group(); scene.add(group);
    function build(exag) {
      const pos = geo.attributes.position;
      for (let k = 0; k < heights.length; k++) pos.setY(k, (heights[k] - zmin) * exag);
      pos.needsUpdate = true; geo.computeVertexNormals();
      buildBlock(exag);
      while (group.children.length) { const c = group.children.pop(); if (c.geometry) c.geometry.dispose(); if (c.material) { if (c.material.map) c.material.map.dispose(); c.material.dispose(); } }
      const lift = span * 0.004;
      const pts = [];
      const step = Math.max(1, Math.floor(m.lat.length / 700));
      const cls = [];
      for (let k = 0; k < m.lat.length; k += step) { pts.push(new THREE.Vector3(toX(m.lon[k]), surfaceY(m.lat[k], m.lon[k], exag) + lift, toZ(m.lat[k]))); cls.push(m.cls[k]); }
      const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.3);
      const seg = Math.min(1400, pts.length * 2), radial = 6;
      const tube = new THREE.TubeGeometry(curve, seg, span * 0.0026, radial, false);
      const colors = new Float32Array((seg + 1) * (radial + 1) * 3), col = new THREE.Color();
      for (let i = 0; i <= seg; i++) {
        col.set(T.CLASSES[cls[Math.min(cls.length - 1, Math.round(i / seg * (cls.length - 1)))]].color);
        for (let j = 0; j <= radial; j++) { const o = (i * (radial + 1) + j) * 3; colors[o] = col.r; colors[o + 1] = col.g; colors[o + 2] = col.b; }
      }
      tube.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      group.add(new THREE.Mesh(tube, new THREE.MeshBasicMaterial({ vertexColors: true })));
      // stops
      plan.stopInfo.forEach((si, i) => {
        if (si.stop.isReturn) return;
        // Pins stand on the drawn surface: the pole starts just under the ground and a foot ring marks the contact point.
        const st = si.stop, y = surfaceY(st.lat, st.lon, exag), poleH = span * 0.05, sink = span * 0.004;
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(span * 0.0015, span * 0.0015, poleH + sink, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        pole.position.set(toX(st.lon), y + (poleH - sink) / 2, toZ(st.lat)); group.add(pole);
        const foot = new THREE.Mesh(new THREE.CylinderGeometry(span * 0.0065, span * 0.0065, span * 0.0022, 20), new THREE.MeshBasicMaterial({ color: i === 0 ? 0xffffff : 0xff6b35 }));
        foot.position.set(toX(st.lon), y + lift, toZ(st.lat)); group.add(foot);
        const c = document.createElement('canvas'); c.width = c.height = 128;
        const g = c.getContext('2d');
        g.fillStyle = i === 0 ? '#ffffff' : '#ff6b35'; g.beginPath(); g.arc(64, 64, 56, 0, 7); g.fill();
        g.lineWidth = 8; g.strokeStyle = i === 0 ? '#ff6b35' : '#ffffff'; g.stroke();
        g.fillStyle = '#1a0b04'; g.font = 'bold 68px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(i === 0 ? '⌂' : String(i), 64, 68);
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c) }));
        sp.scale.set(span * 0.03, span * 0.03, 1); sp.position.set(toX(st.lon), y + poleH + span * 0.012, toZ(st.lat)); sp.renderOrder = 10; group.add(sp);
      });
      V.curve = curve; V.exag = exag;
    }

    // Position marker for the fly-through: a navigation arrow that travels along the route and
    // points the way the astronaut is walking, with a pulsing ring on the ground beneath it.
    const walker = new THREE.Group(); walker.visible = false; scene.add(walker);
    const wa = span * 0.017;                                   // half the arrow's length, in metres
    const walkerParts = (function () {
      const sh = new THREE.Shape();
      sh.moveTo(0, 1); sh.lineTo(0.8, -0.9); sh.lineTo(0, -0.42); sh.lineTo(-0.8, -0.9); sh.closePath();
      const bodyG = new THREE.ExtrudeGeometry(sh, { depth: 0.24, bevelEnabled: false });
      bodyG.rotateX(Math.PI / 2); bodyG.translate(0, 0.24, 0);                 // lie flat, tip toward +z
      const rimG = new THREE.ShapeGeometry(sh); rimG.rotateX(Math.PI / 2); rimG.scale(1.34, 1, 1.34); rimG.translate(0, -0.02, -0.06);
      const bodyM = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x9a9a9a });
      const rimM = new THREE.MeshBasicMaterial({ color: 0xff6b35, side: THREE.DoubleSide });
      const arrow = new THREE.Group();
      arrow.add(new THREE.Mesh(bodyG, bodyM), new THREE.Mesh(rimG, rimM));
      arrow.scale.setScalar(wa); arrow.rotation.x = -0.3;                       // nose up a little so it reads from behind
      const ringG = new THREE.RingGeometry(0.84, 1, 48); ringG.rotateX(-Math.PI / 2);
      const ringM = new THREE.MeshBasicMaterial({ color: 0xff6b35, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
      const ring = new THREE.Mesh(ringG, ringM); ring.position.y = span * 0.0045;
      const dotG = new THREE.CircleGeometry(0.34, 24); dotG.rotateX(-Math.PI / 2);
      const dot = new THREE.Mesh(dotG, rimM); dot.scale.setScalar(wa); dot.position.y = span * 0.0045;
      walker.add(arrow, ring, dot);
      return { arrow, ring, ringM, geos: [bodyG, rimG, ringG, dotG], mats: [bodyM, rimM, ringM] };
    })();

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08; controls.maxPolarAngle = Math.PI * 0.495;
    controls.minDistance = span * 0.03; controls.maxDistance = span * 3;

    V = { box, renderer, scene, camera, controls, tex: 'image', hasImagery: false, fly: null, raf: 0, curve: null, exag: 2 };
    build(2);
    const midY = (zmax - zmin) * 2 * 0.4;
    controls.target.set(0, midY, 0);
    camera.position.set(span * 0.55, midY + span * 0.55, span * 0.95);

    function resize() {
      const r = box.getBoundingClientRect();
      renderer.setSize(r.width, r.height, false);
      renderer.domElement.style.width = r.width + 'px'; renderer.domElement.style.height = r.height + 'px';
      camera.aspect = r.width / Math.max(1, r.height); camera.updateProjectionMatrix();
    }
    V.resize = resize; resize(); window.addEventListener('resize', resize);

    const hud = box.querySelector('#v3-hud');
    function frame(now) {
      if (!V || V.box !== box) return;
      V.raf = requestAnimationFrame(frame);
      if (V.fly) {
        const u = Math.max(0, Math.min(1, (now - V.fly.t0) / V.fly.dur));
        // Look a fixed distance ahead rather than a fixed share of the route, so long routes keep the marker in frame.
        const p = V.curve.getPointAt(u), ahead = V.curve.getPointAt(Math.min(1, u + V.fly.look));
        const dir = ahead.clone().sub(p); dir.y = 0; if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0); dir.normalize();
        const back = span * 0.36, up = span * 0.2;
        const want = new THREE.Vector3(p.x - dir.x * back, p.y + up, p.z - dir.z * back);
        camera.position.lerp(want, 0.06); controls.target.lerp(ahead, 0.1);
        // the marker: on the route at the current position, turned to the direction of travel
        const tan = V.curve.getTangentAt(u), head = Math.atan2(tan.x, tan.z);
        if (V.fly.head == null) V.fly.head = head;
        V.fly.head += Math.atan2(Math.sin(head - V.fly.head), Math.cos(head - V.fly.head)) * 0.18;
        walker.visible = true; walker.position.copy(p); walker.rotation.y = V.fly.head;
        walkerParts.arrow.position.y = wa * (1.05 + 0.14 * Math.sin(now / 320));
        const pulse = (now % 1500) / 1500;
        walkerParts.ring.scale.setScalar(wa * (0.9 + 1.9 * pulse)); walkerParts.ringM.opacity = 0.85 * (1 - pulse);
        const k = Math.min(m.d.length - 1, Math.round(u * (m.d.length - 1)));
        hud.hidden = false;
        hud.innerHTML = `${MM.planner.km(m.d[k])} of ${MM.planner.km(plan.distance)} · ${Math.round(m.z[k])} m · slope ${m.slope[k].toFixed(0)}° ${T.CLASSES[m.cls[k]].label} · ${MM.time.hhmm(MM.planner.settings().startH + m.clock[k] / 3600)} LMST`;
        if (u >= 1) { V.fly = null; box.querySelector('#v3-fly').textContent = '▶ Fly the route'; setTimeout(() => { if (V && V.box === box && !V.fly) { hud.hidden = true; walker.visible = false; } }, 2500); }
      }
      controls.update(); renderer.render(scene, camera);
    }
    V.raf = requestAnimationFrame(frame);

    box.querySelector('#v3-close').addEventListener('click', close);
    box.querySelector('#v3-exag').addEventListener('click', (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      box.querySelectorAll('#v3-exag button').forEach((x) => x.classList.toggle('on', x === b));
      build(Number(b.dataset.v));
    });
    box.querySelector('#v3-tex').addEventListener('click', (ev) => {
      const b = ev.target.closest('button'); if (!b) return;
      box.querySelectorAll('#v3-tex button').forEach((x) => x.classList.toggle('on', x === b));
      V.tex = b.dataset.v;
      tex.image = V.tex === 'hazard' ? cvHazard : cvImage; tex.needsUpdate = true;
    });
    box.querySelector('#v3-fly').addEventListener('click', (ev) => {
      if (V.fly) { V.fly = null; walker.visible = false; hud.hidden = true; ev.target.textContent = '▶ Fly the route'; return; }
      V.fly = { t0: performance.now(), dur: Math.max(14000, Math.min(70000, plan.distance * 6)), head: null,
        look: Math.min(0.04, span * 0.1 / Math.max(1, V.curve.getLength())) };
      ev.target.textContent = '■ Stop';
    });
    V.dispose = function () {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(this.raf); controls.dispose(); geo.dispose(); mat.dispose(); tex.dispose();
      block.children.forEach((c) => c.geometry.dispose()); wallMat.map.dispose(); wallMat.dispose(); floorMat.dispose();
      walkerParts.geos.forEach((g) => g.dispose()); walkerParts.mats.forEach((mt) => mt.dispose());
      renderer.dispose();
      if (renderer.forceContextLoss) renderer.forceContextLoss();
    };
  }

  function close() {
    if (!V) return;
    const v = V; V = null;
    try { v.dispose(); } catch (e) { /* ignore */ }
    v.box.remove();
  }

  MM.view3d = { open, close, isOpen: () => !!V };
})();
