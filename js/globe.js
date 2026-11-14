/*
 * Mission-overview globe: a real-colour 3D Mars built at run time from NASA's
 * Viking MDIM 2.1 global colour mosaic (Solar System Treks tiles), lit by the
 * Sun, with a thin atmosphere and Jezero Crater marked. Drag to turn it.
 *
 * Without internet the globe simply does not appear and the overview keeps its
 * terrain backdrop, so nothing depends on it.
 */
(function () {
  'use strict';
  const MM = (window.MM = window.MM || {});
  const TILE = 'https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/';
  const Z = 2, COLS = 8, ROWS = 4, PX = 256;        // 2048 x 1024 equirectangular texture
  const JEZERO = { lat: 18.44, lon: 77.45 };
  const D2R = Math.PI / 180;

  let texPromise = null, G = null;

  function loadTexture() {
    if (texPromise) return texPromise;
    texPromise = new Promise((resolve, reject) => {
      const cv = document.createElement('canvas');
      cv.width = COLS * PX; cv.height = ROWS * PX;
      const g = cv.getContext('2d');
      let left = COLS * ROWS, failed = 0;
      for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
        const im = new Image();
        im.crossOrigin = 'anonymous';
        im.onload = () => { g.drawImage(im, x * PX, y * PX, PX, PX); if (--left === 0) done(); };
        im.onerror = () => { failed++; if (--left === 0) done(); };
        im.src = TILE + Z + '/' + y + '/' + x + '.jpg';
      }
      const done = () => (failed > 4 ? reject(new Error('tiles')) : resolve(cv));
      setTimeout(() => { if (left > 0) reject(new Error('timeout')); }, 20000);
    });
    return texPromise;
  }

  // Unit vector for a planetocentric lat / east lon on a three.js sphere whose texture u = 0 is lon -180.
  function vec(lat, lon, r) {
    const phi = (90 - lat) * D2R, th = (lon + 180) * D2R;
    return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th));
  }

  function atmosphere() {
    return new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
      uniforms: { c: { value: new THREE.Color(0xff9a6a) } },
      vertexShader: 'varying vec3 n; varying vec3 v; void main(){ n = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position,1.0); v = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform vec3 c; varying vec3 n; varying vec3 v; void main(){ float f = pow(clamp(1.0 - abs(dot(n, v)), 0.0, 1.0), 3.2); gl_FragColor = vec4(c, f * 0.55); }',
    });
  }

  function stars(n) {
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1, t = Math.random() * Math.PI * 2, r = 40 + Math.random() * 20;
      const s = Math.sqrt(1 - u * u);
      pos[i * 3] = r * s * Math.cos(t); pos[i * 3 + 1] = r * u; pos[i * 3 + 2] = r * s * Math.sin(t);
      const b = 0.45 + Math.random() * 0.55, warm = Math.random() < 0.2;
      col[i * 3] = b; col[i * 3 + 1] = b * (warm ? 0.88 : 0.96); col[i * 3 + 2] = b * (warm ? 0.78 : 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.09, vertexColors: true, transparent: true, opacity: 0.85, sizeAttenuation: true }));
  }

  function build(host, canvasTex) {
    const cv = host.querySelector('canvas');
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true }); } catch (e) { return null; }
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    if ('outputEncoding' in renderer) renderer.outputEncoding = THREE.sRGBEncoding;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
    camera.position.set(0, 0, 4.9);

    const tex = new THREE.CanvasTexture(canvasTex);
    if ('encoding' in tex) tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();

    const planet = new THREE.Group();
    const globe = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), new THREE.MeshStandardMaterial({ map: tex, roughness: 1, metalness: 0 }));
    planet.add(globe);
    planet.add(new THREE.Mesh(new THREE.SphereGeometry(1.06, 96, 64), atmosphere()));

    // Jezero marker: a bright dot with a pulsing ring, slightly above the surface
    const p = vec(JEZERO.lat, JEZERO.lon, 1.004);
    const dot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    dot.position.copy(p); planet.add(dot);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.022, 0.03, 48), new THREE.MeshBasicMaterial({ color: 0xff7a45, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    ring.position.copy(p); ring.lookAt(p.clone().multiplyScalar(2)); planet.add(ring);

    scene.add(planet);
    scene.add(stars(1600));
    const sun = new THREE.DirectionalLight(0xfff1e2, 2.2);
    sun.position.set(2.6, 1.2, 3.2); scene.add(sun);   // from the right, so the limb under the headline sits in night
    scene.add(new THREE.AmbientLight(0x404a5a, 0.22));

    // Start with Jezero facing the viewer, a little left of centre
    planet.rotation.x = -0.26;
    let spin = -0.6 - Math.atan2(p.x, p.z), vel = 0, drag = null;   // Jezero a little left of centre, in the open space beside the headline
    const tilt = -0.26;   // north tipped toward us so Jezero rides above the live-clock card

    const tag = host.querySelector('.globe-tag');
    function resize() {
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    }
    const onDown = (e) => { drag = { x: e.clientX, s: spin }; host.classList.add('grab'); };
    const onMove = (e) => { if (!drag) return; const ns = drag.s + (e.clientX - drag.x) * 0.006; vel = ns - spin; spin = ns; };
    const onUp = () => { drag = null; host.classList.remove('grab'); };
    host.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('resize', resize);
    resize();

    let raf = 0, last = performance.now(), running = false, t0 = last;
    const tmp = new THREE.Vector3();
    function frame(now) {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (!drag) { vel *= 0.94; spin += vel + dt * 0.035; }
      planet.rotation.y = spin; planet.rotation.x = tilt;
      const k = ((now - t0) / 1600) % 1;
      ring.scale.setScalar(1 + k * 2.2); ring.material.opacity = 0.9 * (1 - k);
      renderer.render(scene, camera);
      if (tag) {
        dot.getWorldPosition(tmp);
        const facing = tmp.clone().normalize().dot(camera.position.clone().normalize()) > 0.18;
        tmp.project(camera);
        tag.style.transform = `translate(${((tmp.x + 1) / 2 * host.clientWidth).toFixed(1)}px, ${((1 - tmp.y) / 2 * host.clientHeight).toFixed(1)}px)`;
        tag.classList.toggle('hide', !facing);
      }
    }
    return {
      start() { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(frame); },
      stop() { running = false; cancelAnimationFrame(raf); },
      resize,
    };
  }

  /** Show the globe inside `host` once the NASA texture has loaded. */
  function mount(host) {
    if (!host || !window.THREE) return;
    if (G) { G.resize(); G.start(); return; }
    loadTexture().then((cv) => {
      if (G) return;
      G = build(host, cv);
      if (!G) return;
      host.classList.add('ready');
      const box = document.getElementById('intro'); if (box) box.classList.add('has-globe');
      if (MM.intro && MM.intro.isOpen()) G.start();
    }).catch(() => { host.classList.add('offline'); });
  }
  function pause() { if (G) G.stop(); }

  MM.globe = { mount, pause };
})();
