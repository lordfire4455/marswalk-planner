/*
 * 3D preview: the planned route draped over real terrain, built from the bundled
 * elevation model and textured with MRO CTX imagery when NASA's tiles are reachable.
 */
(function () {
  'use strict';
  const MM = (window.MM = window.MM || {});
  const TILE = 'https://trek.nasa.gov/tiles/Mars/EQ/JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0/1.0.0/default/default028mm/';
  let V = null; // live view state

  // ---- the Marswalker ------------------------------------------------------------------
  // Leg segment lengths in figure heights: hip to knee, knee to ankle, ankle to sole.
  const THIGH = 0.215, SHIN = 0.21, FOOT = 0.075, HIP_H = THIGH + SHIN + FOOT;

  /**
   * A suited astronaut built from simple shapes, used as the position marker in the
   * fly-through. Units are figure heights (soles at y = 0, helmet top at about 1); the caller
   * scales it. It faces +z, so its left side is +x. It is not to scale with the terrain: at
   * true size a person would be smaller than one pixel in this view.
   */
  function createMarswalker(THREE) {
    const geos = [], mats = [];
    const G = (g) => { geos.push(g); return g; };
    const M = (mt) => { mats.push(mt); return mt; };
    const suit = M(new THREE.MeshLambertMaterial({ color: 0xf2eee8, emissive: 0x2e2a26 }));
    const pack = M(new THREE.MeshLambertMaterial({ color: 0xdcd7ce, emissive: 0x24211d }));
    const joint = M(new THREE.MeshLambertMaterial({ color: 0x9096a0, emissive: 0x15171a }));
    const dark = M(new THREE.MeshLambertMaterial({ color: 0x3b3f47, emissive: 0x0c0d0f }));
    const accent = M(new THREE.MeshLambertMaterial({ color: 0xff6b35, emissive: 0x4a1a08 }));
    const visor = M(new THREE.MeshPhongMaterial({ color: 0xc8922a, specular: 0xfff4d0, shininess: 110, emissive: 0x2a1a04 }));
    const lamp = M(new THREE.MeshBasicMaterial({ color: 0xfff3c4 }));

    const sphere = G(new THREE.SphereGeometry(1, 20, 14));
    const capsule = (r, len) => G(new THREE.CapsuleGeometry(r, len, 4, 12));
    const band = (r, t) => { const g = G(new THREE.TorusGeometry(r, t, 8, 24)); g.rotateX(Math.PI / 2); return g; }; // ring around a vertical limb
    const box = (x, y, z) => G(new THREE.BoxGeometry(x, y, z));
    const mesh = (geo, mat, x, y, z) => { const o = new THREE.Mesh(geo, mat); o.position.set(x || 0, y || 0, z || 0); return o; };
    const ball = (mat, r, x, y, z) => { const o = mesh(sphere, mat, x, y, z); o.scale.setScalar(r); return o; };
    const group = (x, y, z) => { const g = new THREE.Group(); g.position.set(x || 0, y || 0, z || 0); return g; };

    const figure = new THREE.Group();          // turned to the heading by the caller
    const body = group(); figure.add(body);    // moved up and down so the standing foot stays on the ground
    const hips = group(0, HIP_H, 0); body.add(hips);
    const pelvis = ball(suit, 1, 0, 0.02, 0); pelvis.scale.set(0.125, 0.08, 0.095); hips.add(pelvis);

    function leg(side) {
      const hip = group(side * 0.068, 0, 0); hips.add(hip);
      hip.add(mesh(capsule(0.054, 0.12), suit, 0, -0.1, 0));
      hip.add(mesh(band(0.056, 0.012), accent, 0, -0.075, 0));
      const knee = group(0, -THIGH, 0); hip.add(knee);
      knee.add(ball(joint, 0.05, 0, 0, 0.004));
      knee.add(mesh(capsule(0.047, 0.12), suit, 0, -0.1, 0));
      const ankle = group(0, -SHIN, 0); knee.add(ankle);
      ankle.add(mesh(band(0.05, 0.012), joint, 0, 0, 0));
      ankle.add(mesh(box(0.1, 0.075, 0.15), dark, 0, -0.035, 0.022));         // boot
      ankle.add(mesh(box(0.108, 0.018, 0.165), joint, 0, -FOOT + 0.009, 0.024)); // sole
      return { hip, knee, ankle };
    }

    const upper = group(0, HIP_H, 0); body.add(upper);   // pivots at the hips, so it can lean into a climb
    const torso = mesh(capsule(0.12, 0.1), suit, 0, 0.16, 0); torso.scale.set(1, 1, 0.8); upper.add(torso);
    const waist = mesh(band(0.118, 0.016), joint, 0, 0.02, 0); waist.scale.set(1, 1, 0.82); upper.add(waist);
    upper.add(mesh(box(0.12, 0.065, 0.045), joint, 0, 0.17, 0.1));            // chest control box
    upper.add(mesh(box(0.07, 0.03, 0.004), dark, 0, 0.178, 0.1235));          // its display
    upper.add(mesh(box(0.02, 0.014, 0.004), accent, 0.04, 0.153, 0.1235));    // and a button

    // Backpack (life support): a rounded block with vents, a stripe and a radio antenna.
    const pw = 0.11, ph = 0.14, cr = 0.035, rr = new THREE.Shape();
    rr.moveTo(-pw + cr, -ph); rr.lineTo(pw - cr, -ph); rr.quadraticCurveTo(pw, -ph, pw, -ph + cr);
    rr.lineTo(pw, ph - cr); rr.quadraticCurveTo(pw, ph, pw - cr, ph); rr.lineTo(-pw + cr, ph);
    rr.quadraticCurveTo(-pw, ph, -pw, ph - cr); rr.lineTo(-pw, -ph + cr); rr.quadraticCurveTo(-pw, -ph, -pw + cr, -ph);
    const packG = G(new THREE.ExtrudeGeometry(rr, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.015, bevelSize: 0.015, bevelSegments: 3, curveSegments: 6 }));
    packG.translate(0, 0, -0.035);
    upper.add(mesh(packG, pack, 0, 0.19, -0.145));
    upper.add(mesh(box(0.025, 0.2, 0.006), joint, 0.05, 0.18, -0.197));
    upper.add(mesh(box(0.025, 0.2, 0.006), joint, -0.05, 0.18, -0.197));
    upper.add(mesh(box(0.2, 0.022, 0.006), accent, 0, 0.3, -0.197));
    upper.add(mesh(G(new THREE.CylinderGeometry(0.006, 0.006, 0.16, 6)), joint, 0.075, 0.425, -0.17));
    upper.add(ball(accent, 0.014, 0.075, 0.505, -0.17));

    // Helmet: hard shell, gold sun visor over the face, a lamp on each side.
    upper.add(mesh(band(0.078, 0.02), joint, 0, 0.305, 0));                  // neck ring
    const head = group(0, 0.395, 0); upper.add(head);
    head.add(ball(suit, 0.105));
    head.add(mesh(G(new THREE.SphereGeometry(0.108, 24, 14, Math.PI / 2 - 1.15, 2.3, 0.5, 1.2)), visor));
    for (const sd of [1, -1]) {
      head.add(mesh(box(0.03, 0.03, 0.05), joint, sd * 0.098, 0.045, 0.02));
      const lens = G(new THREE.CylinderGeometry(0.011, 0.011, 0.006, 12)); lens.rotateX(Math.PI / 2);
      head.add(mesh(lens, lamp, sd * 0.098, 0.045, 0.047));
    }

    function arm(side) {
      upper.add(ball(suit, 0.06, side * 0.15, 0.272, 0));                    // shoulder bearing
      const sh = group(side * 0.16, 0.27, 0); upper.add(sh);
      sh.add(mesh(capsule(0.044, 0.09), suit, 0, -0.08, 0));
      sh.add(mesh(band(0.046, 0.011), accent, 0, -0.06, 0));
      const el = group(0, -0.165, 0); sh.add(el);
      el.add(ball(joint, 0.042));
      el.add(mesh(capsule(0.04, 0.08), suit, 0, -0.07, 0));
      el.add(mesh(band(0.042, 0.01), joint, 0, -0.14, 0));                   // wrist bearing
      const glove = ball(dark, 1, 0, -0.165, 0.004); glove.scale.set(0.043, 0.05, 0.036); el.add(glove);
      return { sh, el };
    }

    const rig = { body, hips, upper, head, legs: [leg(1), leg(-1)], arms: [arm(1), arm(-1)] };   // [left, right]
    return { figure, rig, geos, mats };
  }

  /**
   * Pose the Marswalker. phase: walk cycle in radians; amp: 0 standing to 1 full stride;
   * stride: hip swing in radians at amp 1; lean: radians, + forward; wave: 0 to 1.
   */
  function poseMarswalker(W, phase, amp, stride, lean, wave, now) {
    const R = W.rig, s = Math.sin(phase), c = Math.cos(phase), A = stride * amp;
    let drop = 0;
    R.legs.forEach((L, i) => {
      const sg = i === 0 ? 1 : -1;                          // the legs are half a cycle apart
      const hip = -A * s * sg;                              // negative swings the foot forward
      const swing = Math.max(0, c * sg);                    // > 0 while this leg travels forward
      const knee = amp * (0.08 + 0.85 * swing * swing);     // the knee folds most in mid-swing
      L.hip.rotation.x = hip; L.knee.rotation.x = knee; L.ankle.rotation.x = -(hip + knee) * 0.85;
      drop = Math.max(drop, THIGH * Math.cos(hip) + SHIN * Math.cos(hip + knee) + FOOT);
    });
    R.body.position.y = drop - HIP_H;                       // the longer (standing) leg reaches the ground
    R.hips.rotation.y = -0.05 * amp * s;
    R.upper.rotation.x = lean; R.upper.rotation.y = 0.07 * amp * s;   // shoulders turn against the hips
    R.head.rotation.x = -lean * 0.6;                        // keep looking ahead, not at the ground
    R.arms.forEach((a, i) => {
      const sg = i === 0 ? 1 : -1;
      a.sh.rotation.x = 0.38 * amp * s * sg;                // each arm swings against the leg on its side
      a.sh.rotation.z = sg * 0.13;                          // clear of the bulky suit
      a.el.rotation.x = -(0.32 + 0.3 * amp * Math.max(0, -s * sg));
      a.el.rotation.z = 0;
    });
    if (wave > 0) {                                         // right arm up for a wave
      const a = R.arms[1];
      a.sh.rotation.z = -0.13 - 2.5 * wave; a.sh.rotation.x *= 1 - wave;
      a.el.rotation.x = -0.32 * (1 - wave) - 0.2 * wave;
      a.el.rotation.z = -wave * 0.45 * Math.sin(now / 140);
    }
  }

  // ---- the Marswalker Machine ----------------------------------------------------------
  const WHEEL_R = 0.26;   // metres; the machine is modelled at roughly real size, then scaled by the caller

  /** Canvas texture of crinkled gold Kapton foil (decorative). */
  function foilTexture(THREE) {
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const g = c.getContext('2d');
    g.fillStyle = '#c9971a'; g.fillRect(0, 0, 128, 128);
    let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 90; i++) {                           // facets of crumpled foil, light and dark
      const x = rnd() * 128, y = rnd() * 128, r = 6 + rnd() * 18;
      g.fillStyle = rnd() > 0.5 ? 'rgba(255, 236, 150, ' + (0.12 + rnd() * 0.25) + ')' : 'rgba(90, 55, 0, ' + (0.1 + rnd() * 0.2) + ')';
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 3; k++) g.lineTo(x + (rnd() - 0.5) * r * 2, y + (rnd() - 0.5) * r * 2);
      g.closePath(); g.fill();
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
  }
  /** Diagonal orange / dark hazard stripes. */
  function hazardTexture(THREE) {
    const c = document.createElement('canvas'); c.width = 128; c.height = 32;
    const g = c.getContext('2d');
    g.fillStyle = '#26282c'; g.fillRect(0, 0, 128, 32);
    g.fillStyle = '#ff6b35';
    for (let x = -32; x < 160; x += 32) { g.beginPath(); g.moveTo(x, 32); g.lineTo(x + 16, 32); g.lineTo(x + 32, 0); g.lineTo(x + 16, 0); g.closePath(); g.fill(); }
    return new THREE.CanvasTexture(c);
  }

  /**
   * An autonomous six-wheeled rover for the fly-through, built from primitives (no model files).
   * Metres, wheels on y = 0, faces +z, its left side is +x. Rocker-bogie suspension on each side,
   * camera mast with stereo head and laser turret, three-segment arm with an instrument turret,
   * rear power unit with cooling fins, high-gain dish and UHF whip.
   */
  function createMarsMachine(THREE) {
    const geos = [], mats = [], texs = [];
    const G = (g) => { geos.push(g); return g; };
    const M = (mt) => { mats.push(mt); return mt; };
    const foilT = foilTexture(THREE), hazT = hazardTexture(THREE); texs.push(foilT, hazT);
    const body = M(new THREE.MeshLambertMaterial({ color: 0xe6e4df, emissive: 0x222220 }));
    const foil = M(new THREE.MeshPhongMaterial({ color: 0xd4a017, specular: 0xffe066, shininess: 90, map: foilT }));
    const joint = M(new THREE.MeshLambertMaterial({ color: 0x3a3d42, emissive: 0x121416 }));
    const hazard = M(new THREE.MeshBasicMaterial({ color: 0xff6b35 }));
    const hazardStripe = M(new THREE.MeshBasicMaterial({ map: hazT }));
    const glass = M(new THREE.MeshPhongMaterial({ color: 0x1a3c5a, specular: 0x88ccff, shininess: 120 }));
    const gunmetal = M(new THREE.MeshPhongMaterial({ color: 0x4a4e55, specular: 0x666a70, shininess: 30, emissive: 0x0e0f11 }));
    const alu = M(new THREE.MeshLambertMaterial({ color: 0xb4b9c0, emissive: 0x1c1e20 }));
    const dish = M(new THREE.MeshLambertMaterial({ color: 0xf1efe9, emissive: 0x242422, side: THREE.DoubleSide }));

    const box = (x, y, z) => G(new THREE.BoxGeometry(x, y, z));
    const cyl = (r1, r2, h, seg) => G(new THREE.CylinderGeometry(r1, r2, h, seg || 16));
    const mesh = (geo, mat, x, y, z) => { const o = new THREE.Mesh(geo, mat); o.position.set(x || 0, y || 0, z || 0); return o; };
    const group = (x, y, z) => { const g = new THREE.Group(); g.position.set(x || 0, y || 0, z || 0); return g; };
    /** A strut of thickness t from point a to point b, both [y, z] in the parent's frame at lateral x. */
    const strutG = box(1, 1, 1);
    function strut(parent, x, a, b, t, mat) {
      const dy = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dy, dz);
      const o = mesh(strutG, mat, x, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      o.scale.set(t, t, len); o.rotation.x = -Math.atan2(dy, dz); parent.add(o); return o;
    }

    const machine = new THREE.Group();     // turned to the heading and pitched to the ground by the caller
    machine.rotation.order = 'YXZ';

    // ---- chassis: a chamfered box (avionics core), foil side panels, belly pan, hazard stripes
    const CW = 0.8, CL = 1.0, ch = 0.2;
    const sh = new THREE.Shape();
    sh.moveTo(-CW + ch, -CL); sh.lineTo(CW - ch, -CL); sh.lineTo(CW, -CL + ch); sh.lineTo(CW, CL - ch);
    sh.lineTo(CW - ch, CL); sh.lineTo(-CW + ch, CL); sh.lineTo(-CW, CL - ch); sh.lineTo(-CW, -CL + ch); sh.closePath();
    const chG = G(new THREE.ExtrudeGeometry(sh, { depth: 0.4, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 }));
    chG.rotateX(-Math.PI / 2);                                // extrude upwards; shape y becomes -z
    const chassis = mesh(chG, body, 0, 0.72, 0); machine.add(chassis);
    machine.add(mesh(box(1.5, 0.06, 1.9), joint, 0, 0.7, 0));                       // belly pan
    for (const sd of [1, -1]) {
      machine.add(mesh(box(0.012, 0.28, 1.5), foil, sd * (CW + 0.035), 0.93, 0));    // Kapton side panels
      machine.add(mesh(box(0.014, 0.035, 1.5), hazard, sd * (CW + 0.04), 1.12, 0));   // stripe along the top edge
    }
    machine.add(mesh(box(1.1, 0.1, 0.014), hazardStripe, 0, 0.86, CL + 0.035));        // front bumper hazard band
    machine.add(mesh(box(1.1, 0.1, 0.014), hazardStripe, 0, 0.86, -CL - 0.035));
    machine.add(mesh(box(1.2, 0.03, 1.5), joint, 0, 1.17, -0.05));                     // deck plate
    machine.add(mesh(box(0.42, 0.16, 0.38), body, -0.2, 1.26, 0.3));                   // deck avionics box
    machine.add(mesh(box(0.42, 0.02, 0.38), foil, -0.2, 1.35, 0.3));
    machine.add(mesh(box(0.26, 0.12, 0.3), body, 0.35, 1.24, -0.2));
    for (const sd of [1, -1]) {                                                        // front hazard cameras
      machine.add(mesh(box(0.14, 0.07, 0.06), joint, sd * 0.32, 0.79, CL + 0.04));
      const l = cyl(0.022, 0.022, 0.02, 12); l.rotateX(Math.PI / 2);
      machine.add(mesh(l, glass, sd * 0.32, 0.79, CL + 0.075));
    }

    // ---- rocker-bogie suspension and wheels
    const tireG = cyl(WHEEL_R, WHEEL_R, 0.36, 28); tireG.rotateZ(Math.PI / 2);
    const rimG = cyl(WHEEL_R * 0.55, WHEEL_R * 0.55, 0.37, 20); rimG.rotateZ(Math.PI / 2);
    const hubG = cyl(0.06, 0.06, 0.4, 12); hubG.rotateZ(Math.PI / 2);
    const grouserG = box(0.37, 0.022, 0.05), spokeG = box(0.02, WHEEL_R * 0.9, 0.03);
    const wheels = [];
    function wheel(parent, x, y, z) {
      const hold = group(x, y, z); parent.add(hold);
      const w = group(); hold.add(w); wheels.push(w);
      w.add(mesh(tireG, alu), mesh(rimG, joint), mesh(hubG, gunmetal));
      for (let i = 0; i < 14; i++) {                         // grousers: the grooves that show the wheel turning
        const a = i / 14 * Math.PI * 2, gr = mesh(grouserG, joint, 0, Math.cos(a) * WHEEL_R, Math.sin(a) * WHEEL_R);
        gr.rotation.x = -a; w.add(gr);
      }
      for (let i = 0; i < 6; i++) {                          // spokes on the outer face
        const a = i / 6 * Math.PI * 2, sp = mesh(spokeG, gunmetal, Math.sign(x) * 0.19, Math.cos(a) * WHEEL_R * 0.45, Math.sin(a) * WHEEL_R * 0.45);
        sp.rotation.x = -a; w.add(sp);
      }
      return hold;
    }
    const ROCK = [0.75, 0.12], BOGIE = [0.5, -0.45];          // pivots, [y, z]
    const sides = [];
    for (const sd of [1, -1]) {
      const X = sd * 1.02;
      machine.add(mesh(G(new THREE.SphereGeometry(0.07, 12, 8)), joint, sd * (CW + 0.06), ROCK[0], ROCK[1]));   // differential pivot
      const rocker = group(0, ROCK[0], ROCK[1]); machine.add(rocker);
      // rocker: pivot to the front wheel and back to the bogie pivot (coordinates relative to the rocker pivot)
      strut(rocker, X, [0, 0], [WHEEL_R + 0.2 - ROCK[0], 1.05 - ROCK[1]], 0.07, joint);
      strut(rocker, X, [WHEEL_R + 0.2 - ROCK[0], 1.05 - ROCK[1]], [WHEEL_R - ROCK[0], 1.05 - ROCK[1]], 0.06, joint);
      strut(rocker, X, [0, 0], [BOGIE[0] - ROCK[0], BOGIE[1] - ROCK[1]], 0.07, joint);
      rocker.add(mesh(box(0.2, 0.05, 0.05), joint, sd * (CW + 0.13), 0, 0));           // axle stub to the chassis
      wheel(rocker, X, WHEEL_R - ROCK[0], 1.05 - ROCK[1]);
      const bogie = group(0, BOGIE[0] - ROCK[0], BOGIE[1] - ROCK[1]); rocker.add(bogie);
      bogie.add(mesh(G(new THREE.SphereGeometry(0.055, 10, 8)), gunmetal, X, 0, 0));
      strut(bogie, X, [0, 0], [WHEEL_R - BOGIE[0], 0.05 - BOGIE[1]], 0.06, joint);
      strut(bogie, X, [0, 0], [WHEEL_R - BOGIE[0], -0.95 - BOGIE[1]], 0.06, joint);
      wheel(bogie, X, WHEEL_R - BOGIE[0], 0.05 - BOGIE[1]);
      wheel(bogie, X, WHEEL_R - BOGIE[0], -0.95 - BOGIE[1]);
      sides.push({ rocker, bogie });
    }

    // ---- camera mast: neck, stereo head and laser turret on a pan / tilt
    const mastBase = group(0.5, 1.18, 0.72); machine.add(mastBase);
    mastBase.add(mesh(cyl(0.09, 0.11, 0.1), joint, 0, 0.05, 0));
    mastBase.add(mesh(cyl(0.05, 0.06, 0.9), body, 0, 0.5, 0));
    mastBase.add(mesh(G(new THREE.TorusGeometry(0.06, 0.012, 6, 16)).rotateX(Math.PI / 2), hazard, 0, 0.3, 0));
    const pan = group(0, 0.95, 0); mastBase.add(pan);
    pan.add(mesh(cyl(0.07, 0.07, 0.1), joint, 0, 0, 0));
    const tilt = group(0, 0.1, 0); pan.add(tilt);
    tilt.add(mesh(box(0.5, 0.17, 0.2), body, 0, 0.04, 0));
    tilt.add(mesh(box(0.5, 0.025, 0.2), foil, 0, 0.135, 0));
    for (const sx of [0.15, -0.15]) {                         // stereo cameras
      const l = cyl(0.04, 0.045, 0.06, 16); l.rotateX(Math.PI / 2);
      tilt.add(mesh(l, joint, sx, 0.04, 0.12));
      const lg = cyl(0.03, 0.03, 0.012, 16); lg.rotateX(Math.PI / 2);
      tilt.add(mesh(lg, glass, sx, 0.04, 0.155));
    }
    tilt.add(mesh(box(0.2, 0.16, 0.24), body, 0, 0.21, -0.01));            // laser turret
    const big = cyl(0.065, 0.065, 0.03, 20); big.rotateX(Math.PI / 2);
    tilt.add(mesh(big, glass, 0, 0.21, 0.12));
    tilt.add(mesh(box(0.2, 0.02, 0.012), hazard, 0, 0.28, 0.115));

    // ---- robotic arm: shoulder, elbow, wrist, instrument turret (stowed in front of the bumper)
    const shoulder = group(-0.45, 0.98, CL + 0.06); machine.add(shoulder);
    shoulder.add(mesh(G(new THREE.SphereGeometry(0.08, 12, 10)), joint));
    const seg1 = 0.7, seg2 = 0.62;
    shoulder.add(mesh(box(0.08, 0.08, seg1), body, 0, 0, seg1 / 2));
    shoulder.add(mesh(box(0.084, 0.02, seg1 * 0.6), hazard, 0, 0.045, seg1 / 2));
    const elbow = group(0, 0, seg1); shoulder.add(elbow);
    elbow.add(mesh(G(new THREE.SphereGeometry(0.065, 12, 10)), joint));
    elbow.add(mesh(box(0.07, 0.07, seg2), body, 0, 0, seg2 / 2));
    const wrist = group(0, 0, seg2); elbow.add(wrist);
    wrist.add(mesh(G(new THREE.SphereGeometry(0.06, 12, 10)), joint));
    const turret = group(0, 0, 0.1); wrist.add(turret);
    turret.add(mesh(cyl(0.13, 0.13, 0.12, 18), gunmetal, 0, 0, 0));
    for (let i = 0; i < 4; i++) {                              // instruments around the turret
      const a = i / 4 * Math.PI * 2;
      const tool = mesh(box(0.07, 0.16, 0.07), i === 0 ? foil : body, Math.cos(a) * 0.14, -0.06, Math.sin(a) * 0.14);
      turret.add(tool);
    }
    turret.add(mesh(cyl(0.025, 0.025, 0.06, 10), glass, 0, -0.17, 0));

    // ---- rear power unit with cooling fins
    const rtg = group(0, 1.02, -CL - 0.25); rtg.rotation.x = -0.5; machine.add(rtg);
    rtg.add(mesh(cyl(0.17, 0.17, 0.62, 20), gunmetal));
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2, fin = mesh(box(0.018, 0.6, 0.15), gunmetal, Math.cos(a) * 0.22, 0, Math.sin(a) * 0.22);
      fin.rotation.y = -a; rtg.add(fin);
    }
    for (const y of [-0.31, 0.31]) rtg.add(mesh(cyl(0.2, 0.2, 0.04, 20), joint, 0, y, 0));
    rtg.add(mesh(G(new THREE.TorusGeometry(0.175, 0.015, 6, 20)).rotateX(Math.PI / 2), hazard, 0, 0.1, 0));
    machine.add(mesh(box(0.08, 0.08, 0.36), joint, 0, 1.0, -CL - 0.07));    // mount

    // ---- antennas: high-gain dish on a gimbal, UHF whip
    const hga = group(-0.45, 1.2, -0.55); machine.add(hga);
    hga.add(mesh(cyl(0.035, 0.05, 0.28, 10), joint, 0, 0.14, 0));
    const dishG = group(0, 0.32, 0); dishG.rotation.x = -0.9; hga.add(dishG);
    const bowl = G(new THREE.SphereGeometry(0.62, 28, 8, 0, Math.PI * 2, 0, 0.52)); bowl.translate(0, -0.62, 0); bowl.rotateX(Math.PI);
    dishG.add(mesh(bowl, dish));
    dishG.add(mesh(cyl(0.012, 0.012, 0.3, 6), joint, 0, 0.15, 0));
    dishG.add(mesh(cyl(0.035, 0.02, 0.06, 10), gunmetal, 0, 0.3, 0));
    machine.add(mesh(cyl(0.008, 0.008, 0.62, 6), joint, 0.62, 1.5, -0.8));      // UHF whip
    machine.add(mesh(G(new THREE.SphereGeometry(0.022, 8, 6)), hazard, 0.62, 1.82, -0.8));

    // ---- soft contact shadow under the wheels
    const sc = document.createElement('canvas'); sc.width = sc.height = 64;
    const sg = sc.getContext('2d'), grad = sg.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(24, 12, 6, 0.55)'); grad.addColorStop(0.65, 'rgba(24, 12, 6, 0.3)'); grad.addColorStop(1, 'rgba(24, 12, 6, 0)');
    sg.fillStyle = grad; sg.fillRect(0, 0, 64, 64);
    const shadowT = new THREE.CanvasTexture(sc); texs.push(shadowT);
    const shG = G(new THREE.PlaneGeometry(3.0, 3.2)); shG.rotateX(-Math.PI / 2);
    const shadow = mesh(shG, M(new THREE.MeshBasicMaterial({ map: shadowT, transparent: true, depthWrite: false })), 0, 0.02, -0.05);
    machine.add(shadow);

    const rig = { wheels, sides, pan, tilt, arm: { shoulder, elbow, wrist } };
    return { machine, rig, geos, mats, texs, height: 2.2 };
  }

  /**
   * Pose the machine. spin: wheel angle (rad); bend: suspension articulation (rad, + front up);
   * deploy: arm 0 stowed to 1 at the ground; look: [pan, tilt] of the mast head in radians.
   */
  function poseMarsMachine(R, spin, bend, deploy, look) {
    R.rig.wheels.forEach((w) => { w.rotation.x = spin; });
    R.rig.sides.forEach((s) => { s.rocker.rotation.x = -bend; s.bogie.rotation.x = bend * 1.6; });
    R.rig.pan.rotation.y = look[0]; R.rig.tilt.rotation.x = look[1];
    const A = R.rig.arm, mix = (a, b) => a + (b - a) * deploy;
    // Stowed: upper arm across the front bumper, forearm folded back beside it, turret down.
    A.shoulder.rotation.set(mix(0.12, 0.35), mix(1.45, 0), 0);
    A.elbow.rotation.set(mix(0.3, 0.55), mix(-3.0, 0), 0);
    A.wrist.rotation.x = mix(1.2, 0.5);
  }

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
        <span class="v3-info">${MM.planner.km(plan.distance)} · relief ${Math.round(zmax - zmin)} m · drag to rotate · right-drag/Shift to move · scroll to zoom</span>
        <span class="seg v3-seg" id="v3-exag" title="Vertical exaggeration"><button type="button" data-v="1">1×</button><button type="button" data-v="2" class="on">2×</button><button type="button" data-v="4">4×</button></span>
        <span class="seg v3-seg" id="v3-tex"><button type="button" data-v="image" class="on">Imagery</button><button type="button" data-v="hazard">Hazard</button></span>
        <span class="seg v3-seg" id="v3-avatar" title="Switch 3D Route Explorer"><button type="button" data-avatar="human">Astronaut</button><button type="button" data-avatar="machine">Machine</button></span>
        <span class="seg v3-seg" id="v3-autocam" title="Auto-camera fixation (follow route or free camera)"><button type="button" data-cam="on" class="on">Auto-camera: On</button><button type="button" data-cam="off">Off</button></span>
        <button type="button" class="primary-btn sm" id="v3-fly">▶ Fly the route</button>
        <button type="button" class="primary-btn sm" id="v3-resume" style="display: none;">▶ Resume</button>
        <button type="button" class="ghost-btn sm" id="v3-stop" style="display: none;">■ Stop</button>
        <button type="button" class="ghost-btn sm" id="v3-close">Close</button>
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
    const tubeR = span * 0.0026;                               // the Marswalker walks on top of the tube
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
      const tube = new THREE.TubeGeometry(curve, seg, tubeR, radial, false);
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
      if (V && V.flyProgress > 0 && V.curve && walker.visible) {
        placeWalker(V.curve.getPointAt(V.flyProgress));
        gait.has = false;                                      // the jump to the new surface is not a step
      }
    }

    // Position marker for the fly-through: the Marswalker, a suited astronaut who walks the
    // route, turns with it, leans into climbs, stands still while the flight is halted and
    // waves on arrival. A pulsing ring and a soft shadow mark the exact spot on the route.
    const walker = new THREE.Group(); walker.visible = false; scene.add(walker);
    const wa = span * 0.017;                                   // size unit of the pulsing ring, in metres
    const WH = span * 0.046;                                   // height of the figure in metres (not to scale)
    const walkerParts = (function () {
      const mw = createMarswalker(THREE);
      mw.figure.scale.setScalar(WH);
      const ringG = new THREE.RingGeometry(0.84, 1, 48); ringG.rotateX(-Math.PI / 2);
      const ringM = new THREE.MeshBasicMaterial({ color: 0xff6b35, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false });
      const ring = new THREE.Mesh(ringG, ringM); ring.position.y = span * 0.0002;
      // Soft contact shadow, stretched away from the sun. It stays world-aligned while the figure turns.
      const sc = document.createElement('canvas'); sc.width = sc.height = 64;
      const sg = sc.getContext('2d'), grad = sg.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(24, 12, 6, 0.5)'); grad.addColorStop(0.6, 'rgba(24, 12, 6, 0.22)'); grad.addColorStop(1, 'rgba(24, 12, 6, 0)');
      sg.fillStyle = grad; sg.fillRect(0, 0, 64, 64);
      const shadowT = new THREE.CanvasTexture(sc);
      const away = new THREE.Vector2(-sun.position.x, -sun.position.z).normalize();
      const shadowG = new THREE.CircleGeometry(0.16, 32); shadowG.rotateX(-Math.PI / 2); shadowG.scale(1.8, 1, 1);
      shadowG.rotateY(Math.atan2(-away.y, away.x)); shadowG.translate(away.x * 0.12, 0, away.y * 0.12);
      const shadowM = new THREE.MeshBasicMaterial({ map: shadowT, transparent: true, depthWrite: false });
      const shadow = new THREE.Mesh(shadowG, shadowM); shadow.scale.setScalar(WH); shadow.position.y = span * 0.0001;
      const astro = new THREE.Group(); astro.add(shadow, mw.figure);
      // The machine, at roughly its real size next to the astronaut (both are far from terrain scale).
      const mc = createMarsMachine(THREE);
      mc.machine.scale.setScalar(WH / 1.8);
      walker.add(ring, astro, mc.machine);
      return { mw, mc, astro, ring, ringM, geos: [ringG, shadowG, ...mw.geos, ...mc.geos], mats: [ringM, shadowM, ...mw.mats, ...mc.mats], texs: [shadowT, ...mc.texs] };
    })();

    // Which figure travels the route: the option the traverse allocation scored higher, unless the user picks.
    const alloc = plan.allocation;
    const avatar = { kind: alloc && alloc.machine.score > alloc.human.score ? 'machine' : 'human' };
    function setAvatar(kind) {
      avatar.kind = kind === 'machine' ? 'machine' : 'human';
      walkerParts.astro.visible = avatar.kind === 'human';
      walkerParts.mc.machine.visible = avatar.kind === 'machine';
      box.querySelectorAll('#v3-avatar button').forEach((b) => b.classList.toggle('on', b.dataset.avatar === avatar.kind));
      // Hand over the heading so the new figure faces the same way, wherever the flight is.
      const fig = walkerParts.mw.figure, mach = walkerParts.mc.machine;
      const head = V && V.fly && V.fly.head != null ? V.fly.head : (avatar.kind === 'machine' ? fig.rotation.y : mach.rotation.y);
      fig.rotation.y = head; mach.rotation.y = head;
      if (V && V.hudText && !hud.hidden) V.hudText();
    }
    // Machine state: wheel angle, suspension bend, body pitch, arm deployment.
    const rov = { spin: 0, bend: 0, pitch: 0, deploy: 0, pitchTo: 0, bendTo: 0 };

    // Walk-cycle state. grade is the real slope of the route under the walker, in degrees (+ uphill).
    const gait = { phase: 0, amp: 0, lean: 0, wave: 0, grade: 0, moving: false, arrived: false, has: false, t: 0, prev: new THREE.Vector3() };
    function placeWalker(p) { walker.position.set(p.x, p.y + tubeR, p.z); }
    let lastStep = 0;                                          // ground covered since the last frame
    const turn = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));   // shortest signed angle from a to b

    function animateWalker(now) {
      const dt = gait.t ? Math.min(0.1, (now - gait.t) / 1000) : 0; gait.t = now;
      const steep = Math.min(1, Math.abs(gait.grade) / 15);
      const stride = 0.44 * (1 - 0.35 * steep);                // shorter steps on steep ground
      lastStep = 0;
      if (gait.moving && gait.has) {
        // Advance the walk cycle by the ground actually covered, so the boots do not slide.
        const dist = Math.hypot(walker.position.x - gait.prev.x, walker.position.z - gait.prev.z);
        lastStep = dist;
        const cycle = 4 * (THIGH + SHIN) * Math.sin(stride * Math.max(0.35, gait.amp)) * WH;   // metres per full stride
        gait.phase += Math.min(2 * Math.PI * dist / cycle, 2 * Math.PI * 3.2 * dt);
      }
      gait.prev.copy(walker.position); gait.has = true;
      const f = 1 - Math.exp(-dt * 6);
      gait.amp += ((gait.moving ? 1 : 0) - gait.amp) * f;
      gait.wave += ((gait.arrived ? 1 : 0) - gait.wave) * (1 - Math.exp(-dt * 4));
      const leanTo = Math.max(-0.12, Math.min(0.3, gait.grade * 0.014)) * (gait.moving ? 1 : 0.3);   // into the hill, back a little going down
      gait.lean += (leanTo - gait.lean) * f;
      const fig = walkerParts.mw.figure;
      if (gait.arrived) {                                       // turn round to face the camera for the wave
        const toCam = Math.atan2(camera.position.x - walker.position.x, camera.position.z - walker.position.z);
        fig.rotation.y += turn(fig.rotation.y, toCam) * (1 - Math.exp(-dt * 3));
      }
      poseMarswalker(walkerParts.mw, gait.phase, gait.amp, stride, gait.lean, gait.wave, now);
      if (avatar.kind === 'machine') animateMachine(now, dt, gait.moving ? lastStep : 0);
      const pulse = (now % 1500) / 1500, rs = avatar.kind === 'machine' ? 1.7 : 1;   // the beacon ring clears the wheels
      walkerParts.ring.scale.setScalar(wa * rs * (0.9 + 1.9 * pulse)); walkerParts.ringM.opacity = 0.85 * (1 - pulse);
    }

    /**
     * The machine's cycle: wheels turn by the ground covered (d-theta = dist / r), the body pitches
     * to the ground under it, the rocker-bogie articulates with the change of slope, the mast scans
     * left and right while driving, and on arrival the arm unstows to the ground and the mast
     * turns to the camera.
     */
    function animateMachine(now, dt, dist) {
      const mc = walkerParts.mc, sc = mc.machine.scale.x;
      rov.spin += Math.min(dist / (WHEEL_R * sc), 12 * dt);   // capped so the grousers do not strobe on fast flights
      const f = 1 - Math.exp(-dt * 5);
      rov.pitch += (rov.pitchTo - rov.pitch) * f; rov.bend += (rov.bendTo - rov.bend) * f;
      rov.deploy += ((gait.arrived ? 1 : 0) - rov.deploy) * (1 - Math.exp(-dt * 1.8));
      mc.machine.rotation.x = rov.pitch;
      let look;
      if (gait.arrived) {
        const toCam = Math.atan2(camera.position.x - walker.position.x, camera.position.z - walker.position.z);
        look = [turn(mc.machine.rotation.y, toCam) * rov.deploy, -0.05];
      } else if (gait.moving) look = [0.26 * Math.sin(now / 1700), 0.05 + 0.05 * Math.sin(now / 1150)];   // 15 deg sweep each way, slight nod
      else look = [0.6 * Math.sin(now / 3200), 0.12];
      const lp = mc.rig.pan.rotation.y, lt = mc.rig.tilt.rotation.x;
      poseMarsMachine(mc, rov.spin, rov.bend, rov.deploy, [lp + (look[0] - lp) * f, lt + (look[1] - lt) * f]);
    }

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.055;
    controls.maxPolarAngle = Math.PI * 0.495;
    controls.minDistance = span * 0.02;
    controls.maxDistance = span * 3.5;
    controls.screenSpacePanning = false;   // pan horizontally across the Mars terrain plane
    controls.panSpeed = 0.85;
    controls.rotateSpeed = 0.75;
    controls.zoomSpeed = 0.85;
    controls.mouseButtons = {
      LEFT: THREE.MOUSE.ROTATE,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.PAN
    };
    controls.touches = {
      ONE: THREE.TOUCH.ROTATE,
      TWO: THREE.TOUCH.DOLLY_PAN
    };

    let camTransition = null;
    function smoothFlyTo(destPos, destTarget, duration = 850) {
      if (V && V.fly && V.autoCam) setAutoCam(false);
      camTransition = {
        t0: performance.now(),
        dur: duration,
        startPos: camera.position.clone(),
        endPos: destPos.clone(),
        startTarget: controls.target.clone(),
        endTarget: destTarget.clone()
      };
    }

    V = {
      box,
      renderer,
      scene,
      camera,
      controls,
      tex: 'image',
      hasImagery: false,
      fly: null,
      flyProgress: 0,
      autoCam: true,
      raf: 0,
      curve: null,
      exag: 2
    };
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
    // HUD line for the figure on the route: the crew's clock for the astronaut, the drive sol for the machine.
    function hudText(halted) {
      if (!V || V.hudK == null) return;
      const k = V.hudK;
      let when = MM.time.hhmm(MM.planner.settings().startH + m.clock[k] / 3600) + ' LMST';
      if (avatar.kind === 'machine' && alloc) {
        const am = alloc.machine;
        when = 'drive sol ' + Math.max(1, Math.ceil(am.effD[k] / am.solBudgetM)) + ' of ~' + am.sols;
      }
      const stopped = halted || (!V.fly && V.flyProgress > 0 && V.flyProgress < 1);
      hud.innerHTML = (stopped ? '<span style="color:var(--mars);font-weight:600">Halted</span> · ' : '') +
        `${avatar.kind === 'machine' ? 'Machine' : 'Crew'} · ${MM.planner.km(m.d[k])} of ${MM.planner.km(plan.distance)} · ${Math.round(m.z[k])} m · slope ${m.slope[k].toFixed(0)}° ${T.CLASSES[m.cls[k]].label} · ${when}`;
    }
    V.hudText = hudText;

    function setAutoCam(on) {
      if (!V) return;
      V.autoCam = !!on;
      const seg = box.querySelector('#v3-autocam');
      if (seg) {
        seg.querySelectorAll('button').forEach((b) => {
          b.classList.toggle('on', (b.dataset.cam === 'on') === V.autoCam);
        });
      }
      if (!V.fly && V.flyProgress > 0 && V.autoCam && V.curve) {
        const u = V.flyProgress;
        const p = V.curve.getPointAt(u), ahead = V.curve.getPointAt(Math.min(1, u + 0.02));
        const dir = ahead.clone().sub(p); dir.y = 0; if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0); dir.normalize();
        const back = span * 0.36, up = span * 0.2;
        const want = new THREE.Vector3(p.x - dir.x * back, p.y + up, p.z - dir.z * back);
        smoothFlyTo(want, ahead, 800);
      }
    }

    function updateFlightButtons() {
      if (!V) return;
      const btnFly = box.querySelector('#v3-fly');
      const btnResume = box.querySelector('#v3-resume');
      const btnStop = box.querySelector('#v3-stop');
      if (!btnFly || !btnResume || !btnStop) return;

      if (V.fly) {
        btnFly.style.display = 'inline-block';
        btnFly.textContent = '↺ Restart';
        btnFly.className = 'ghost-btn sm';
        btnResume.style.display = 'none';
        btnStop.style.display = 'inline-block';
        btnStop.className = 'primary-btn sm';
      } else if (V.flyProgress > 0 && V.flyProgress < 1) {
        btnFly.style.display = 'inline-block';
        btnFly.textContent = '↺ Restart';
        btnFly.className = 'ghost-btn sm';
        btnResume.style.display = 'inline-block';
        btnResume.className = 'primary-btn sm';
        btnStop.style.display = 'none';
      } else {
        btnFly.style.display = 'inline-block';
        btnFly.textContent = '▶ Fly the route';
        btnFly.className = 'primary-btn sm';
        btnResume.style.display = 'none';
        btnStop.style.display = 'none';
      }
    }

    function startFly(progress) {
      if (!V || !V.curve) return;
      const totalDur = Math.max(14000, Math.min(70000, plan.distance * 6));
      const u0 = Math.max(0, Math.min(0.999, progress || 0));
      const look = Math.min(0.04, span * 0.1 / Math.max(1, V.curve.getLength()));
      const now = performance.now();
      V.fly = {
        t0: now - u0 * totalDur,
        dur: totalDur,
        look: look,
        head: null
      };
      V.flyProgress = u0;
      walker.visible = true;
      Object.assign(gait, { moving: true, arrived: false, has: false, wave: 0 });
      rov.deploy = 0;
      hud.hidden = false;
      updateFlightButtons();
    }

    function stopFly() {
      if (!V) return;
      V.fly = null;
      gait.moving = false;                                     // the Marswalker stops and stands
      updateFlightButtons();
      if (V.flyProgress > 0 && V.flyProgress < 1) {
        const k = Math.min(m.d.length - 1, Math.round(V.flyProgress * (m.d.length - 1)));
        hud.hidden = false;
        V.hudK = k; hudText(true);
      }
    }

    // When the user starts manipulating the view (orbit, pan, zoom) during a fly-through,
    // seamlessly switch to free camera mode so the camera doesn't jerk or snap back.
    controls.addEventListener('start', () => {
      if (camTransition) camTransition = null;
      if (V && V.fly && V.autoCam) {
        setAutoCam(false);
      }
    });

    const keyState = { left: false, right: false, up: false, down: false };
    const panVelocity = new THREE.Vector3();

    function frame(now) {
      if (!V || V.box !== box) return;
      V.raf = requestAnimationFrame(frame);
      // Easing per second rather than per frame, so on a slow computer the camera and the
      // Marswalker's heading keep up with the flight instead of falling behind it.
      const fdt = V.lastFrame ? Math.min(0.25, (now - V.lastFrame) / 1000) : 1 / 60; V.lastFrame = now;
      const ease = (k) => 1 - Math.pow(1 - k, fdt * 60);         // k = share of the gap closed per 1/60 s

      // Smooth camera transition (smoothstep lerp)
      if (camTransition) {
        const t = Math.max(0, Math.min(1, (now - camTransition.t0) / camTransition.dur));
        const easeT = t * t * t * (t * (t * 6 - 15) + 10);
        camera.position.lerpVectors(camTransition.startPos, camTransition.endPos, easeT);
        controls.target.lerpVectors(camTransition.startTarget, camTransition.endTarget, easeT);
        if (t >= 1) camTransition = null;
      }

      // Smooth keyboard X/Y panning with inertia
      if (keyState.left || keyState.right || keyState.up || keyState.down || panVelocity.lengthSq() > 1e-4) {
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
        right.y = 0; if (right.lengthSq() > 1e-6) right.normalize();
        const fwd = new THREE.Vector3().crossVectors(camera.up, right);
        fwd.y = 0; if (fwd.lengthSq() > 1e-6) fwd.normalize();

        const maxSpeed = span * 0.45;
        const targetVel = new THREE.Vector3();
        if (keyState.left) targetVel.addScaledVector(right, -maxSpeed);
        if (keyState.right) targetVel.addScaledVector(right, maxSpeed);
        if (keyState.up) targetVel.addScaledVector(fwd, maxSpeed);
        if (keyState.down) targetVel.addScaledVector(fwd, -maxSpeed);

        panVelocity.lerp(targetVel, Math.min(1, fdt * 9));
        const delta = panVelocity.clone().multiplyScalar(fdt);
        camera.position.add(delta);
        controls.target.add(delta);
      }

      if (V.fly) {
        const u = Math.max(0, Math.min(1, (now - V.fly.t0) / V.fly.dur));
        V.flyProgress = u;
        // Look a fixed distance ahead rather than a fixed share of the route, so long routes keep the marker in frame.
        const p = V.curve.getPointAt(u), ahead = V.curve.getPointAt(Math.min(1, u + V.fly.look));

        const tan = V.curve.getTangentAt(u);
        if (V.autoCam) {
          const dir = ahead.clone().sub(p); dir.y = 0;
          if (dir.lengthSq() < 1e-6) { dir.set(tan.x, 0, tan.z); if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0); }   // at the very end, keep looking along the route
          dir.normalize();
          const back = span * 0.36, up = span * 0.2;
          const want = new THREE.Vector3(p.x - dir.x * back, p.y + up, p.z - dir.z * back);
          camera.position.lerp(want, ease(0.06));
          controls.target.lerp(ahead, ease(0.06));
        }

        // the marker: on the route at the current position, turned to the direction of travel
        const head = Math.atan2(tan.x, tan.z);
        if (V.fly.head == null) V.fly.head = head;
        V.fly.head += Math.atan2(Math.sin(head - V.fly.head), Math.cos(head - V.fly.head)) * ease(0.18);
        walker.visible = true;
        placeWalker(p);
        walkerParts.mw.figure.rotation.y = V.fly.head; walkerParts.mc.machine.rotation.y = V.fly.head;
        // The machine sits on the drawn (exaggerated) ground: pitch to the tube, bend the suspension
        // with the change of slope between its front and rear wheels.
        const slopeAt = (uu) => { const t = V.curve.getTangentAt(Math.max(0, Math.min(1, uu))); return Math.atan2(t.y, Math.hypot(t.x, t.z)); };
        const du = WH * 0.6 / Math.max(1, V.curve.getLength());
        const sF = slopeAt(u + du), sR = slopeAt(u - du);
        rov.pitchTo = -Math.max(-0.6, Math.min(0.6, (sF + sR) / 2));
        rov.bendTo = Math.max(-0.14, Math.min(0.14, (sF - sR) * 0.5));

        const k = Math.min(m.d.length - 1, Math.round(u * (m.d.length - 1)));
        // Real grade of the route here (not the exaggerated 3D one), so the lean matches the ground.
        const k0 = Math.max(0, k - 3), k1 = Math.min(m.d.length - 1, k + 3);
        gait.grade = m.d[k1] > m.d[k0] ? Math.atan2(m.z[k1] - m.z[k0], m.d[k1] - m.d[k0]) * 180 / Math.PI : 0;
        hud.hidden = false;
        V.hudK = k; hudText();

        if (u >= 1) {
          V.fly = null;
          V.flyProgress = 0;
          gait.moving = false; gait.arrived = true;              // stop, turn round and wave
          updateFlightButtons();
          setTimeout(() => {
            if (V && V.box === box && !V.fly && V.flyProgress === 0) {
              hud.hidden = true;
              walker.visible = false;
            }
          }, 2500);
        }
      }

      if (walker.visible) animateWalker(now); else gait.t = 0;

      controls.update();
      renderer.render(scene, camera);
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
    box.querySelector('#v3-avatar').addEventListener('click', (ev) => {
      const b = ev.target.closest('button');
      if (b && b.dataset.avatar) setAvatar(b.dataset.avatar);   // swaps the figure only; the flight carries on
    });
    setAvatar(avatar.kind);
    box.querySelector('#v3-autocam').addEventListener('click', (ev) => {
      const b = ev.target.closest('button');
      if (!b || !b.dataset.cam) return;
      setAutoCam(b.dataset.cam === 'on');
    });
    box.querySelector('#v3-fly').addEventListener('click', () => {
      startFly(0);
    });
    box.querySelector('#v3-resume').addEventListener('click', () => {
      startFly(V ? V.flyProgress : 0);
    });
    box.querySelector('#v3-stop').addEventListener('click', () => {
      stopFly();
    });

    // Double-click anywhere on the 3D scene smoothly resets the camera to the full map overview
    function onDblClick() {
      if (!V) return;
      const midY = (zmax - zmin) * 2 * 0.4;
      const overviewTarget = new THREE.Vector3(0, midY, 0);
      const overviewPos = new THREE.Vector3(span * 0.55, midY + span * 0.55, span * 0.95);
      smoothFlyTo(overviewPos, overviewTarget, 950);
    }
    renderer.domElement.addEventListener('dblclick', onDblClick);

    function onKeyDown(ev) {
      if (!V || !controls) return;
      if (ev.target && (ev.target.tagName === 'INPUT' || ev.target.tagName === 'TEXTAREA')) return;
      if (ev.key === 'Shift') {
        renderer.domElement.style.cursor = 'move';
      }
      let matched = true;
      if (ev.code === 'KeyA' || ev.code === 'ArrowLeft') keyState.left = true;
      else if (ev.code === 'KeyD' || ev.code === 'ArrowRight') keyState.right = true;
      else if (ev.code === 'KeyW' || ev.code === 'ArrowUp') keyState.up = true;
      else if (ev.code === 'KeyS' || ev.code === 'ArrowDown') keyState.down = true;
      else matched = false;

      if (matched) {
        ev.preventDefault();
        if (camTransition) camTransition = null;
        if (V.fly && V.autoCam) setAutoCam(false);
      }
    }

    function onKeyUp(ev) {
      if (ev.key === 'Shift') {
        renderer.domElement.style.cursor = 'grab';
      }
      if (ev.code === 'KeyA' || ev.code === 'ArrowLeft') keyState.left = false;
      else if (ev.code === 'KeyD' || ev.code === 'ArrowRight') keyState.right = false;
      else if (ev.code === 'KeyW' || ev.code === 'ArrowUp') keyState.up = false;
      else if (ev.code === 'KeyS' || ev.code === 'ArrowDown') keyState.down = false;
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    V.dispose = function () {
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      renderer.domElement.removeEventListener('dblclick', onDblClick);
      cancelAnimationFrame(this.raf); controls.dispose(); geo.dispose(); mat.dispose(); tex.dispose();
      block.children.forEach((c) => c.geometry.dispose()); wallMat.map.dispose(); wallMat.dispose(); floorMat.dispose();
      walkerParts.geos.forEach((g) => g.dispose()); walkerParts.mats.forEach((mt) => mt.dispose()); walkerParts.texs.forEach((t) => t.dispose());
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
