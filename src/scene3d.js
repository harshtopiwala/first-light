/**
 * The 3D scene.
 *
 * Not a decorative render. The sun is placed from the same NOAA solar position
 * the rest of the project uses, the massing is the surveyed footprint extruded
 * to the dimensioned eave and ridge, the shadow is cast by the renderer, and
 * the snow on the ground is the melt model's output cell by cell at half-metre
 * resolution.
 *
 * The twelve arcs overhead are the sun's actual track on the fifteenth of each
 * month at this latitude. The spread between the December arc and the June arc
 * is the whole argument of the project in one picture.
 */

import { sunPosition } from './solar.js';

const M_PER_CELL = 0.5;
const PX_PER_M = 12;
const DOME = 46;

export function createScene(container, opts) {
  const { model, cells, lat, lon } = opts;
  const THREE = window.THREE;
  if (!THREE) throw new Error('three.js did not load');

  const W = model.lotWidth, D = model.lotDepth, PAD = 9;

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  Object.assign(renderer.domElement.style,
    { display: 'block', width: '100%', touchAction: 'none', cursor: 'grab' });

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.5, 500);
  const target = new THREE.Vector3(W / 2, 2.5, -D / 2);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(220, 32, 16),
    new THREE.MeshBasicMaterial({ color: 0x9dc4e8, side: THREE.BackSide })
  );
  scene.add(sky);

  // ---- orbit (r128 ships no OrbitControls) --------------------------------
  const orbit = { az: -0.66, el: 0.55, r: 62 };
  function placeCamera() {
    orbit.el = Math.max(0.08, Math.min(1.4, orbit.el));
    camera.position.set(
      target.x + orbit.r * Math.cos(orbit.el) * Math.sin(orbit.az),
      target.y + orbit.r * Math.sin(orbit.el),
      target.z + orbit.r * Math.cos(orbit.el) * Math.cos(orbit.az)
    );
    camera.lookAt(target);
  }
  let drag = null;
  const dom = renderer.domElement;
  dom.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY };
    dom.style.cursor = 'grabbing';
    dom.setPointerCapture(e.pointerId);
  });
  dom.addEventListener('pointermove', (e) => {
    if (!drag) return;
    orbit.az -= (e.clientX - drag.x) * 0.006;
    orbit.el += (e.clientY - drag.y) * 0.005;
    drag = { x: e.clientX, y: e.clientY };
    placeCamera();
  });
  const release = () => { drag = null; dom.style.cursor = 'grab'; };
  dom.addEventListener('pointerup', release);
  dom.addEventListener('pointercancel', release);
  dom.addEventListener('wheel', (e) => {
    e.preventDefault();
    orbit.r = Math.max(26, Math.min(130, orbit.r + e.deltaY * 0.05));
    placeCamera();
  }, { passive: false });

  // ---- surrounding land ---------------------------------------------------
  const landMat = new THREE.MeshLambertMaterial({ color: 0x8fa86a });
  const land = new THREE.Mesh(new THREE.CircleGeometry(150, 64), landMat);
  land.rotation.x = -Math.PI / 2;
  land.position.set(W / 2, -0.06, -D / 2);
  land.receiveShadow = true;
  scene.add(land);

  // ---- lot surface, painted from the model --------------------------------
  const gw = W + PAD * 2, gd = D + PAD * 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(gw * PX_PER_M);
  canvas.height = Math.round(gd * PX_PER_M);
  const ctx = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 4;

  const lotMesh = new THREE.Mesh(
    new THREE.PlaneGeometry(gw, gd),
    new THREE.MeshLambertMaterial({ map: tex })
  );
  lotMesh.rotation.x = -Math.PI / 2;
  lotMesh.position.set(W / 2, 0, -D / 2);
  lotMesh.receiveShadow = true;
  scene.add(lotMesh);

  const SUN_STOPS = [[203, 216, 176], [232, 214, 150], [216, 168, 96], [176, 92, 28]];
  const zoneRects = model.zones();

  function paintGround(field, mode) {
    const px = (x) => (x + PAD) * PX_PER_M;
    const pz = (y) => (D - y + PAD) * PX_PER_M;
    const size = M_PER_CELL * PX_PER_M + 1;

    // Bare ground first, always. Snow is an overlay drawn only where the model
    // says there is snow - otherwise a lot with no snow left on it still comes
    // out white, which is what a snow-coloured base fill would give you in July.
    let mean = 0;
    for (let i = 0; i < field.length; i++) mean += field[i] || 0;
    mean = field.length ? mean / field.length : 0;
    const wintry = mode === 'snow' ? Math.min(1, mean / 8) : 0;

    ctx.fillStyle = '#8FA86A';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Paving reads darker than lawn, and damp while snow is still melting off.
    ctx.fillStyle = wintry > 0.05 ? '#6E6A62' : '#8C8A83';
    for (const k of ['driveway', 'front_walk']) {
      const [x0, y0, x1, y1] = zoneRects[k].rect;
      ctx.fillRect(px(x0), pz(y1), (x1 - x0) * PX_PER_M, (y1 - y0) * PX_PER_M);
    }

    const max = mode === 'snow' ? 45 : Math.max(0.001, ...field);
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const t = Math.max(0, Math.min(1, (field[i] || 0) / max));
      const X = px(c.x - 0.25), Y = pz(c.y + 0.25);
      if (mode === 'snow') {
        if (t > 0.002) {
          // Patchy at low depth, solid white once the pack covers the ground.
          const cover = Math.min(1, t * 4);
          ctx.fillStyle = `rgba(252,253,255,${(0.30 + 0.70 * cover).toFixed(3)})`;
          ctx.fillRect(X, Y, size, size);
        }
      } else {
        const s = t * 3, k = Math.min(2, Math.floor(s)), f = s - k;
        const col = SUN_STOPS[k].map((v, j) => Math.round(v + (SUN_STOPS[k + 1][j] - v) * f));
        ctx.fillStyle = `rgb(${col.join(',')})`;
        ctx.fillRect(X, Y, size, size);
      }
    }

    ctx.strokeStyle = '#5C5A54';
    ctx.lineWidth = 2;
    ctx.strokeRect(px(0), pz(D), W * PX_PER_M, D * PX_PER_M);
    tex.needsUpdate = true;

    // The land beyond the lot follows the same snow the lot has, so the scene
    // does not sit as a green island in a white field or the reverse.
    const g = [0x8f, 0xa8, 0x6a], w = [0xdc, 0xde, 0xd9];
    const blend = g.map((v, i) => Math.round(v + (w[i] - v) * wintry));
    landMat.color.set((blend[0] << 16) | (blend[1] << 8) | blend[2]);
  }

  // ---- house --------------------------------------------------------------
  const house = new THREE.Group();
  scene.add(house);

  const MAT = {
    siding: new THREE.MeshLambertMaterial({ color: 0xb9b3a4 }),
    gable: new THREE.MeshLambertMaterial({ color: 0x8a8375 }),
    stone: new THREE.MeshLambertMaterial({ color: 0x746a5e }),
    roof: new THREE.MeshLambertMaterial({ color: 0x43464b }),
    snow: new THREE.MeshLambertMaterial({ color: 0xfbfcfe }),
    glass: new THREE.MeshLambertMaterial({ color: 0x2f4356 }),
    door: new THREE.MeshLambertMaterial({ color: 0x27384a }),
    garage: new THREE.MeshLambertMaterial({ color: 0xe6e2d9 }),
    deck: new THREE.MeshLambertMaterial({ color: 0xa87f4e }),
    fence: new THREE.MeshLambertMaterial({ color: 0xb08d5f }),
  };

  const base = model.houseDatum;
  const shape = new THREE.Shape();
  model.footprint.forEach(([x, y], i) => (i ? shape.lineTo(x, -y) : shape.moveTo(x, -y)));

  function addExtrude(h, mat, y) {
    const m = new THREE.Mesh(
      new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false }), mat);
    m.rotation.x = Math.PI / 2;
    m.position.y = y + h;
    m.castShadow = true; m.receiveShadow = true;
    house.add(m);
  }
  addExtrude(model.eave, MAT.siding, base);
  addExtrude(0.95, MAT.stone, base + 0.003);

  const rise = model.ridge - model.eave;
  const x0 = model.houseMinX, x1 = model.houseMaxX;
  const y0 = model.houseMinY, y1 = model.houseMaxY;
  const xm = model.ridgeX, hip = y1 - model.halfWidth;
  const top = base + model.eave;
  const OVER = 0.35;

  function roofGeometry(lift) {
    const v = [];
    const P = (x, y, h) => [x, top + h + lift, -y];
    const tri = (a, b, c) => v.push(...a, ...b, ...c);
    const ye0 = y0 - OVER, ye1 = y1 + OVER;
    for (const s of [-1, 1]) {
      const xe = s < 0 ? x0 - OVER : x1 + OVER;
      tri(P(xe, ye0, 0), P(xm, ye0, rise), P(xm, hip, rise));
      tri(P(xe, ye0, 0), P(xm, hip, rise), P(xe, hip, 0));
      tri(P(xe, hip, 0), P(xm, hip, rise), P(xm, ye1, 0));
      tri(P(xe, hip, 0), P(xm, ye1, 0), P(xe, ye1, 0));
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    return g;
  }

  const roof = new THREE.Mesh(roofGeometry(0), MAT.roof);
  roof.castShadow = true; roof.receiveShadow = true;
  house.add(roof);

  const roofSnow = new THREE.Mesh(roofGeometry(0.10), MAT.snow);
  roofSnow.castShadow = true;
  roofSnow.visible = false;
  house.add(roofSnow);

  // Front gable face, so the house reads as a house rather than a box.
  const gableGeo = new THREE.BufferGeometry();
  gableGeo.setAttribute('position', new THREE.Float32BufferAttribute(
    [x0, top, -y0, x1, top, -y0, xm, top + rise, -y0], 3));
  gableGeo.computeVertexNormals();
  const gable = new THREE.Mesh(gableGeo, MAT.gable);
  gable.castShadow = true;
  house.add(gable);

  /**
   * Openings, front and rear only. Both side elevations on the drawing set are
   * blank - soffit vents and nothing else - which is exactly why orientation
   * decides everything on this house.
   */
  function opening(w, h, cx, cy, faceZ, mat, d = 0.16) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(cx, cy, faceZ);
    house.add(m);
  }
  const FRONT = -(y0 - 0.06), REAR = -(y1 + 0.06);
  const mainSill = base + 2.05, upperSill = base + 4.6;

  opening(4.6, 2.15, x1 - 2.9, base + 1.08, FRONT, MAT.garage, 0.22);
  opening(1.05, 2.10, x0 + 1.75, base + 1.05, FRONT, MAT.door, 0.2);
  opening(1.30, 1.20, x0 + 0.85, mainSill, FRONT, MAT.glass);
  opening(1.50, 1.25, x0 + 1.75, upperSill, FRONT, MAT.glass);
  opening(2.40, 1.25, x1 - 2.30, upperSill, FRONT, MAT.glass);

  opening(2.20, 2.10, xm, base + 1.05, REAR, MAT.glass, 0.2);
  opening(2.30, 1.50, x0 + 1.60, mainSill, REAR, MAT.glass);
  opening(1.90, 1.50, x1 - 1.60, mainSill, REAR, MAT.glass);
  opening(1.60, 1.25, x0 + 1.80, upperSill, REAR, MAT.glass);
  opening(2.40, 1.25, x1 - 2.10, upperSill, REAR, MAT.glass);

  const dk = model.building.deck;
  const deck = new THREE.Mesh(new THREE.BoxGeometry(dk.width_m, 0.2, dk.depth_m), MAT.deck);
  deck.position.set((x0 + x1) / 2, base + 0.65 - dk.surface_below_main_floor_m,
    -(y1 + dk.depth_m / 2));
  deck.castShadow = true; deck.receiveShadow = true;
  house.add(deck);

  const fence = new THREE.Group();
  scene.add(fence);
  function buildFence() {
    fence.clear();
    if (!model.opts.fence) return;
    const h = model.opts.fenceHeight;
    const seg = (cx, cy, w, d) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), MAT.fence);
      m.position.set(cx, model.groundHeight(cy) + h / 2, -cy);
      m.castShadow = true; m.receiveShadow = true;
      fence.add(m);
    };
    const yA = model.houseMaxY, len = D - yA;
    seg(0.06, yA + len / 2, 0.12, len);
    seg(W - 0.06, yA + len / 2, 0.12, len);
    seg(W / 2, D - 0.06, W, 0.12);
  }
  buildFence();

  // ---- twelve sun paths ---------------------------------------------------
  const paths = new THREE.Group();
  scene.add(paths);
  const arcs = [];

  function sunPoint(p, r = DOME) {
    const v = model.sunVector(p.azimuth, p.apparentElevation);
    return new THREE.Vector3(target.x + v.x * r, Math.max(0.25, v.z * r), target.z - v.y * r);
  }

  function buildArcs() {
    paths.clear();
    arcs.length = 0;
    for (let m = 0; m < 12; m++) {
      const midnight = Date.UTC(2026, m, 15);
      const pts = [];
      for (let t = 0; t <= 1440; t += 10) {
        const p = sunPosition(new Date(midnight + t * 60000), lat, lon);
        if (p.apparentElevation > -0.5) pts.push(sunPoint(p));
      }
      if (pts.length < 2) continue;
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0x7f8fa0, transparent: true, opacity: 0.3 })
      );
      paths.add(line);
      arcs[m] = line;
    }
  }
  buildArcs();

  function highlightMonth(m) {
    for (let i = 0; i < arcs.length; i++) {
      const line = arcs[i];
      if (!line) continue;
      const on = i === m;
      line.material.color.set(on ? 0xe8912c : 0x7f8fa0);
      line.material.opacity = on ? 1 : 0.26;
    }
  }

  const sunBall = new THREE.Mesh(new THREE.SphereGeometry(1.5, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0xffc23d }));
  const sunGlow = new THREE.Mesh(new THREE.SphereGeometry(3.0, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0xffd77a, transparent: true, opacity: 0.26 }));
  scene.add(sunBall, sunGlow);

  // ---- compass -----------------------------------------------------------
  function labelSprite(text) {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 64;
    const g = c.getContext('2d');
    g.fillStyle = '#2b2f36';
    g.font = 'bold 42px Inter, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 64, 34);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({
      map: new THREE.CanvasTexture(c), transparent: true,
    }));
    s.scale.set(5, 2.5, 1);
    return s;
  }
  for (const [text, azimuth] of [['N', 0], ['E', 90], ['S', 180], ['W', 270]]) {
    const v = model.sunVector(azimuth, 0);
    const s = labelSprite(text);
    s.position.set(target.x + v.x * (DOME + 5), 2, target.z - v.y * (DOME + 5));
    scene.add(s);
  }

  // ---- light -------------------------------------------------------------
  const hemi = new THREE.HemisphereLight(0xcfe0f2, 0x7f8d63, 0.7);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff3e0, 1.05);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera,
    { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 260 });
  sun.target.position.copy(target);
  scene.add(sun, sun.target);

  function setSun(date) {
    const p = sunPosition(date, lat, lon);
    const up = p.apparentElevation > 0;
    const v = model.sunVector(p.azimuth, Math.max(p.apparentElevation, 0.2));

    sun.position.set(target.x + v.x * 120, Math.max(1, v.z * 120), target.z - v.y * 120);
    sun.intensity = up ? 0.4 + 0.85 * Math.min(1, p.apparentElevation / 40) : 0;
    hemi.intensity = up ? 0.7 : 0.3;

    const at = sunPoint(p, DOME);
    sunBall.position.copy(at);
    sunGlow.position.copy(at);
    sunBall.visible = up;
    sunGlow.visible = up;

    // The sky warms as the sun drops, and goes to dusk below the horizon.
    const k = Math.max(0, Math.min(1, p.apparentElevation / 25));
    sky.material.color.setHSL(0.58 - 0.045 * (1 - k), 0.45 + 0.15 * (1 - k),
      up ? 0.60 + 0.13 * k : 0.32);
    return p;
  }

  function resize() {
    const w = container.clientWidth || 900;
    const h = Math.round(w * (window.innerWidth < 900 ? 0.8 : 0.58));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();
  placeCamera();

  let raf = null;
  (function loop() { renderer.render(scene, camera); raf = requestAnimationFrame(loop); })();

  return {
    setSun,
    paintGround,
    highlightMonth,
    setRoofSnow(mm) { roofSnow.visible = mm > 3; },
    rebuildFence: buildFence,
    dispose() { cancelAnimationFrame(raf); renderer.dispose(); },
  };
}
