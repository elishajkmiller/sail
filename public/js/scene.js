// What the player sees: a dusk sea, ships with their decks raised from the file plan, glowing cracks, the three stations, and the sailor.
// Built from the state in game.js with three.js (vendored, no network). Nothing here decides anything; main.js moves the camera and calls update.
// The colours are the Odysseus app's: its blue-grey night, pale cyan and warm gold, with the red it uses for trouble.

import * as THREE from '../vendor/three.module.min.js';
import { MARGIN } from './deck.js';
import { hullFor, deckSize } from './deck.js';
import { hullLength } from './atlas.js';
import { hash32 } from './util.js';

export const PALETTE = {
  bg: 0x282c34, fg: 0x9cdef2, panel: 0x111111, border: 0x355a66, gold: 0xd19a66, red: 0xe06c75, green: 0x50fa7b,
  deep: 0x0d2a3c, shallow: 0x23606e, horizon: 0xc98a5a, zenith: 0x1c2f45,
};

/** The height of the water at a point: the same formula the sea shader uses, so boats and ships can ride it. */
export function waveHeight(x, z, t) {
  return 0.35 * Math.sin(0.11 * x + 0.8 * t) + 0.25 * Math.sin(0.17 * z - 1.1 * t + 1.3) + 0.15 * Math.sin(0.31 * (x + z) + 1.7 * t) + 0.08 * Math.sin(0.9 * x - 0.7 * z + 2.3 * t);
}

const WAVES = `
float wave(vec2 p, float t) {
  return 0.35 * sin(0.11 * p.x + 0.8 * t) + 0.25 * sin(0.17 * p.y - 1.1 * t + 1.3) + 0.15 * sin(0.31 * (p.x + p.y) + 1.7 * t) + 0.08 * sin(0.9 * p.x - 0.7 * p.y + 2.3 * t);
}
vec2 waveSlope(vec2 p, float t) {
  float dx = 0.35 * 0.11 * cos(0.11 * p.x + 0.8 * t) + 0.15 * 0.31 * cos(0.31 * (p.x + p.y) + 1.7 * t) + 0.08 * 0.9 * cos(0.9 * p.x - 0.7 * p.y + 2.3 * t);
  float dz = 0.25 * 0.17 * cos(0.17 * p.y - 1.1 * t + 1.3) + 0.15 * 0.31 * cos(0.31 * (p.x + p.y) + 1.7 * t) - 0.08 * 0.7 * cos(0.9 * p.x - 0.7 * p.y + 2.3 * t);
  return vec2(dx, dz);
}`;

const hex = (c) => new THREE.Color(c);

/** The sea: a big plane that follows the camera, waves in the vertex shader, sky and the low sun in the fragment shader. */
export function makeSea() {
  const geo = new THREE.PlaneGeometry(3200, 3200, 256, 256);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uSun: { value: new THREE.Vector3(-0.6, 0.18, -0.5).normalize() },
      uDeep: { value: hex(PALETTE.deep) }, uShallow: { value: hex(PALETTE.shallow) }, uHorizon: { value: hex(PALETTE.horizon) }, uZenith: { value: hex(PALETTE.zenith) },
      uFog: { value: hex(0x2a3238) },
    },
    vertexShader: `${WAVES}
      uniform float uTime; varying vec3 vWorld; varying vec3 vNormal;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        w.y += wave(w.xz, uTime);
        vec2 s = waveSlope(w.xz, uTime);
        vNormal = normalize(vec3(-s.x, 1.0, -s.y));
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform vec3 uSun; uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uHorizon; uniform vec3 uZenith; uniform vec3 uFog;
      varying vec3 vWorld; varying vec3 vNormal;
      void main() {
        vec3 N = normalize(vNormal);
        vec3 V = normalize(cameraPosition - vWorld);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        vec3 refl = reflect(-V, N);
        vec3 sky = mix(uHorizon, uZenith, pow(clamp(refl.y, 0.0, 1.0), 0.5));
        vec3 col = mix(mix(uDeep, uShallow, 0.35 + 0.35 * N.y * N.y), sky, clamp(fres * 0.85 + 0.05, 0.0, 1.0));
        float spec = pow(max(dot(reflect(-uSun, N), V), 0.0), 90.0);
        col += vec3(1.0, 0.78, 0.5) * spec * 0.9;
        float d = length(cameraPosition - vWorld);
        float fog = 1.0 - exp(-d * d * 0.0000009);
        gl_FragColor = vec4(mix(col, uFog, clamp(fog, 0.0, 1.0)), 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

/** The sky: a dome with a warm horizon and the low sun. */
export function makeSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uSun: { value: new THREE.Vector3(-0.6, 0.18, -0.5).normalize() }, uHorizon: { value: hex(PALETTE.horizon) }, uZenith: { value: hex(PALETTE.zenith) } },
    vertexShader: 'varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 uSun; uniform vec3 uHorizon; uniform vec3 uZenith; varying vec3 vDir;
      void main() {
        float y = max(vDir.y, 0.0);
        vec3 col = mix(uHorizon, uZenith, pow(y, 0.45));
        float s = max(dot(normalize(vDir), uSun), 0.0);
        col += vec3(1.0, 0.7, 0.4) * (pow(s, 600.0) * 2.0 + pow(s, 12.0) * 0.35);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(2600, 24, 16), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

/** The lights: warm low sun and a cool sky. */
export function makeLights() {
  const g = new THREE.Group();
  g.add(new THREE.HemisphereLight(0x9cb8c8, 0x1a2a34, 0.9));
  const sun = new THREE.DirectionalLight(0xffc890, 1.5);
  sun.position.set(-60, 18, -50);
  g.add(sun);
  return g;
}

// ---- hulls ----

/** A convex polygon (points {x, y}) moved inward by `d` on every side. */
export function insetPolygon(pts, d) {
  let area = 0;
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; area += a.x * b.y - b.x * a.y; }
  const turn = area >= 0 ? 1 : -1;
  const lines = pts.map((a, i) => {
    const b = pts[(i + 1) % pts.length];
    const ex = b.x - a.x, ey = b.y - a.y, len = Math.hypot(ex, ey) || 1;
    // the inward normal of a convex polygon, whichever way it goes round
    const nx = (-ey / len) * turn, ny = (ex / len) * turn;
    return { px: a.x + nx * d, py: a.y + ny * d, dx: ex / len, dy: ey / len };
  });
  return lines.map((l2, i) => {
    const l1 = lines[(i + lines.length - 1) % lines.length];
    const cross = l1.dx * l2.dy - l1.dy * l2.dx;
    if (Math.abs(cross) < 1e-9) return { x: l2.px, y: l2.py };
    const t = ((l2.px - l1.px) * l2.dy - (l2.py - l1.py) * l2.dx) / cross;
    return { x: l1.px + l1.dx * t, y: l1.py + l1.dy * t };
  });
}

export const DECK_Y = 1.6;
const KEEL = 1.4;

/** The solid hull from the outline (x, y of the deck) to a block from below the water to the deck. */
export function hullGeometry(hull) {
  const shape = new THREE.Shape(hull.map((p) => new THREE.Vector2(p.x, p.y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: DECK_Y + KEEL, bevelEnabled: false, steps: 1 });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, DECK_Y, 0);
  return geo;
}

/** The rail round the deck: a low wall along the outline. */
export function railGeometry(hull) {
  const shape = new THREE.Shape(hull.map((p) => new THREE.Vector2(p.x, p.y)));
  shape.holes.push(new THREE.Path(insetPolygon(hull, 0.35).map((p) => new THREE.Vector2(p.x, p.y)).reverse()));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 1.0, bevelEnabled: false });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, DECK_Y + 1.0, 0);
  return geo;
}

/** A file's colour from its extension (the same kind of file, the same colour); deeper files are a little darker. */
export function extColor(name, depth = 0) {
  const ext = (name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : name).toLowerCase();
  return new THREE.Color().setHSL((hash32(ext) % 360) / 360, 0.42, Math.max(0.3, 0.5 - 0.03 * Math.min(depth, 5)));
}

const CONDITION = {
  sailing: { wood: 0x8a6240, sail: 0xe8dcc0, sailW: 1, sailH: 1, state: 'full sail' },
  anchored: { wood: 0x7d6444, sail: 0xd8ccb0, sailW: 0.22, sailH: 1, state: 'sails furled' },
  derelict: { wood: 0x5c564e, sail: 0x8a8880, sailW: 0.7, sailH: 0.45, state: 'sail in rags' },
  wreck: { wood: 0x4a423e, sail: 0x000000, sailW: 0, sailH: 0, state: 'wrecked' },
};
export const conditionColor = (c) => ({ sailing: PALETTE.green, anchored: PALETTE.gold, derelict: 0x9a9aa6, wreck: PALETTE.red })[c];

// ---- text and pictures on sprites (a browser only) ----

const labelCache = new Map();
/** A sprite with text on it, or null where there is no canvas (the tests). */
export function textSprite(lines, { color = '#9cdef2', size = 44, width = 1024 } = {}) {
  if (typeof document === 'undefined') return null;
  const k = lines.join('\n') + color + size;
  let tex = labelCache.get(k);
  if (!tex) {
    const c = document.createElement('canvas');
    c.width = width; c.height = lines.length * size * 1.35 + 20;
    const g = c.getContext('2d');
    g.font = `${size}px "Fira Code", ui-monospace, monospace`;
    g.textAlign = 'center'; g.textBaseline = 'top';
    g.shadowColor = 'rgba(0,0,0,0.9)'; g.shadowBlur = 8;
    lines.forEach((l, i) => { g.fillStyle = Array.isArray(color) ? color[i] : color; g.fillText(l, width / 2, 10 + i * size * 1.35, width - 20); });
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.userData = { aspect: c.height / c.width };
    if (labelCache.size > 300) labelCache.clear();
    labelCache.set(k, tex);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  s.userData.aspect = tex.userData.aspect;
  return s;
}

/** Sets a sprite's size so it is `worldWidth` metres wide. */
export function sizeSprite(s, worldWidth) { s.scale.set(worldWidth, worldWidth * s.userData.aspect, 1); }

// ---- one opened ship ----

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.05, ...extra });

/**
 * The ship as a group: hull, rail, rooms, walls, cracks with their beams, the mast and sail, the flag, the tavern table and the wheel.
 * `ship` is a game.js "moored" entry. Returns { group, update(t, state), dispose }.
 */
export function buildShipView(ship, conditionName, flagTexture = null) {
  const { deck } = ship, st = CONDITION[conditionName];
  const group = new THREE.Group();
  group.position.set(ship.x, 0, ship.y);
  const floating = new THREE.Group();
  group.add(floating);
  const wood = mat(st.wood);

  floating.add(new THREE.Mesh(hullGeometry(deck.hull), wood));
  floating.add(new THREE.Mesh(railGeometry(deck.hull), mat(new THREE.Color(st.wood).multiplyScalar(0.8))));

  // the deck planks: one dark plane under the rooms
  const plank = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(insetPolygon(deck.hull, 0.35).map((p) => new THREE.Vector2(p.x, p.y)))), mat(new THREE.Color(st.wood).multiplyScalar(1.15), { side: THREE.DoubleSide }));
  plank.rotation.x = Math.PI / 2;
  plank.position.y = DECK_Y + 0.02;
  floating.add(plank);

  // rooms (files) and walls (folders), one draw call each
  const files = deck.cells.filter((c) => c.file !== null), dirs = deck.cells.filter((c) => c.file === null);
  const rooms = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat(0xffffff), Math.max(1, files.length));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3();
  files.forEach((c, i) => {
    const r = c.rect;
    m4.compose(one.set(r.x + r.w / 2, DECK_Y + 0.07, r.y + r.h / 2), q, new THREE.Vector3(Math.max(r.w - 0.06, 0.02), 0.12, Math.max(r.h - 0.06, 0.02)));
    rooms.setMatrixAt(i, m4);
    rooms.setColorAt(i, extColor(c.label, c.depth));
  });
  rooms.count = files.length;
  rooms.instanceMatrix.needsUpdate = true;
  if (rooms.instanceColor) rooms.instanceColor.needsUpdate = true;
  floating.add(rooms);
  const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat(0x3a2a1c), Math.max(1, dirs.length * 4));
  let w = 0;
  const wall = (x, z, sx, sz) => { m4.compose(one.set(x, DECK_Y + 0.28, z), q, new THREE.Vector3(sx, 0.5, sz)); walls.setMatrixAt(w++, m4); };
  for (const c of dirs) {
    const r = c.rect, t = 0.1;
    wall(r.x + r.w / 2, r.y, r.w, t); wall(r.x + r.w / 2, r.y + r.h, r.w, t); wall(r.x, r.y + r.h / 2, t, r.h); wall(r.x + r.w, r.y + r.h / 2, t, r.h);
  }
  walls.count = w;
  walls.instanceMatrix.needsUpdate = true;
  floating.add(walls);

  // cracks: a dark gap with a glowing seam, and a beam above each so that they are seen from across the deck
  const gap = [], seam = [], beams = new THREE.Group();
  const ribbon = (pts, width, y, out) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1], dx = b.x - a.x, dz = b.y - a.y, len = Math.hypot(dx, dz) || 1, nx = (-dz / len) * width / 2, nz = (dx / len) * width / 2;
      out.push(a.x + nx, y, a.y + nz, a.x - nx, y, a.y - nz, b.x + nx, y, b.y + nz, b.x + nx, y, b.y + nz, a.x - nx, y, a.y - nz, b.x - nx, y, b.y - nz);
    }
  };
  const beamMat = new THREE.MeshBasicMaterial({ color: PALETTE.gold, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
  const beamMeshes = [];
  deck.cracks.forEach((c) => {
    ribbon(c.pts, c.width * 1.8, DECK_Y + 0.15, gap); ribbon(c.branch, c.width * 1.1, DECK_Y + 0.15, gap);
    ribbon(c.pts, c.width, DECK_Y + 0.17, seam); ribbon(c.branch, c.width * 0.6, DECK_Y + 0.17, seam);
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 4, 6, 1, true), beamMat);
    b.position.set(c.pts[0].x, DECK_Y + 2.1, c.pts[0].y);
    beams.add(b); beamMeshes.push(b);
  });
  const ribbonMesh = (verts, material) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    return new THREE.Mesh(g, material);
  };
  floating.add(ribbonMesh(gap, new THREE.MeshBasicMaterial({ color: 0x050404, side: THREE.DoubleSide })));
  const seamMat = new THREE.MeshBasicMaterial({ color: 0xff7a2f, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  floating.add(ribbonMesh(seam, seamMat));
  floating.add(beams);
  // the ring that shows which crack he is next to
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.05, 6, 24), new THREE.MeshBasicMaterial({ color: PALETTE.gold }));
  ring.rotation.x = Math.PI / 2;
  ring.visible = false;
  floating.add(ring);

  // the mast, the yard and the sail (what state it is in tells the condition)
  const cy = deck.size.h / 2, mx = deck.size.w * 0.42;
  if (conditionName !== 'wreck') {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 17, 8), mat(0x4a3320));
    mast.position.set(mx, DECK_Y + 8.5, cy);
    const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 10, 6), mat(0x4a3320));
    yard.rotation.x = Math.PI / 2;
    yard.position.set(mx, DECK_Y + 15, cy);
    const sail = new THREE.Mesh(new THREE.PlaneGeometry(9 * st.sailW + 0.001, 9 * st.sailH + 0.001), mat(st.sail, { side: THREE.DoubleSide, transparent: true, opacity: 0.93 }));
    sail.rotation.y = Math.PI / 2;
    sail.position.set(mx + 0.2, DECK_Y + 15 - 4.5 * st.sailH, cy);
    floating.add(mast, yard, sail);
  } else {
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.32, 3.2, 8), mat(0x3a2a1c));
    stump.position.set(mx, DECK_Y + 1.6, cy);
    stump.rotation.z = 0.35;
    floating.add(stump);
  }

  // the stations
  const [flagSt, tavernSt, wheelSt] = ['flag', 'tavern', 'wheel'].map((id) => deck.stations.find((s) => s.id === id));
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 9, 6), mat(0xcccccc));
  pole.position.set(flagSt.x, DECK_Y + 4.5, flagSt.y);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.2), new THREE.MeshBasicMaterial({ map: flagTexture, color: flagTexture ? 0xffffff : conditionColor(conditionName), side: THREE.DoubleSide }));
  cloth.position.set(flagSt.x, DECK_Y + 6, flagSt.y + 1.7);
  cloth.rotation.y = Math.PI / 2;
  floating.add(pole, cloth);
  const table = new THREE.Group();
  table.add(new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.1, 16), mat(0x6a4a2c)).translateY(0.95), new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 0.95, 8), mat(0x4a3320)).translateY(0.47));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2, stool = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.5, 8), mat(0x5a3d24));
    stool.position.set(Math.cos(a) * 1.5, 0.25, Math.sin(a) * 1.5);
    table.add(stool);
  }
  table.add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffd9a0 })).translateY(1.2));
  table.position.set(tavernSt.x, DECK_Y, tavernSt.y);
  const helm = new THREE.Group();
  helm.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 1.1, 0.3), mat(0x4a3320)).translateY(0.55));
  const wheel = new THREE.Group();
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.06, 6, 20), mat(0x6a4a2c)));
  for (let i = 0; i < 8; i++) { const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 4), mat(0x6a4a2c)); sp.rotation.z = (i / 8) * Math.PI; wheel.add(sp); }
  wheel.position.set(0, 1.35, 0.2);
  helm.add(wheel);
  helm.position.set(wheelSt.x, DECK_Y, wheelSt.y);
  floating.add(table, helm);

  // the name above her
  const sign = textSprite([ship.repo.fullName, `${conditionName} - ${ship.repo.stars} stars${ship.repo.language ? ' - ' + ship.repo.language : ''}`], { color: ['#9cdef2', '#d19a66'], size: 56, width: 1200 });
  if (sign) { sizeSprite(sign, 34); sign.position.set(mx, DECK_Y + 22, cy); floating.add(sign); }

  const state = { ring, flag: cloth, beams: beamMeshes, seamMat };
  return {
    group,
    deck,
    state,
    /** Rides the water, makes the seams pulse, and shows which crack is near and which is being read. */
    update(t, nearCrack, readingIssue, starred) {
      const cx = ship.x + deck.size.w / 2, cz = ship.y + deck.size.h / 2;
      const tilt = conditionName === 'wreck' ? 0.1 : 0;
      floating.position.y = waveHeight(cx, cz, t) * 0.6 - (conditionName === 'wreck' ? 0.9 : 0);
      floating.rotation.z = tilt + 0.012 * Math.sin(t * 0.9 + cx);
      floating.rotation.x = 0.01 * Math.sin(t * 0.7 + cz);
      const pulse = 0.55 + 0.45 * Math.sin(t * 3);
      seamMat.opacity = 0.55 + 0.4 * pulse;
      beamMat.opacity = 0.1 + 0.18 * pulse;
      if (nearCrack >= 0) { const c = deck.cracks[nearCrack]; ring.visible = true; ring.position.set(c.pts[0].x, DECK_Y + 0.2, c.pts[0].y); } else ring.visible = false;
      cloth.position.y = DECK_Y + (starred ? 6 : 3.4) + 0.12 * Math.sin(t * 2.5);
      beamMeshes.forEach((b, i) => { b.visible = readingIssue === null || deck.cracks[i].issue !== readingIssue || (Math.floor(t * 4) % 2 === 0); });
    },
    dispose() {
      group.traverse((o) => { o.geometry?.dispose?.(); if (o.material) [].concat(o.material).forEach((m) => m.dispose?.()); });
    },
  };
}

// ---- ships of the map that have not been opened ----

let unitHull = null;
function unitHullGeometry() {
  if (unitHull) return unitHull;
  const hull = hullFor(deckSize(30));
  const xs = hull.map((p) => p.x), ys = hull.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2, len = Math.max(...xs) - Math.min(...xs);
  const g = hullGeometry(hull.map((p) => ({ x: (p.x - cx) / len, y: (p.y - cy) / len })));
  unitHull = g;
  return g;
}

/** Many small hulls in one draw call: the ships the map knows but that have not been opened. */
export class DotFleet {
  constructor(capacity = 3000) {
    this.capacity = capacity;
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
    this.mesh = new THREE.InstancedMesh(unitHullGeometry(), material, capacity);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.entries = [];
  }

  /** Puts the nearest `capacity` entries of the list at their places. `skip` is a Set of lower case names to leave out (the opened ones). */
  update(list, skip, around, time) {
    const near = list.filter((e) => !skip.has(e.name.toLowerCase())).map((e) => ({ e, d: Math.hypot(e.x - around.x, e.y - around.y) })).sort((a, b) => a.d - b.d).slice(0, this.capacity);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), c = new THREE.Color();
    this.entries = near.map((n) => n.e);
    near.forEach(({ e }, i) => {
      const len = hullLength(e.stars) * 1.0;
      const bob = waveHeight(e.x, e.y, time) * 0.6;
      p.set(e.x, bob + 0.2, e.y);
      s.set(len, 1.2, len);
      m4.compose(p, q, s);
      this.mesh.setMatrixAt(i, m4);
      const hue = (hash32(e.language || e.name.split('/')[0]) % 360) / 360;
      this.mesh.setColorAt(i, c.setHSL(hue, 0.3, 0.38));
    });
    this.mesh.count = near.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

// ---- the player ----

/** The boat (a small galley with a sail) and the sailor on foot; main.js shows one of them. */
export function makeCraft() {
  const boat = new THREE.Group();
  const hull = new THREE.Mesh(hullGeometry(hullFor({ w: 9, h: 3.6 }).map((p) => ({ x: p.x * 0.5, y: p.y * 0.5 }))), mat(0x8a6240));
  hull.position.set(-2, 0, -0.9);
  boat.add(hull);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, 7, 6), mat(0x4a3320));
  mast.position.set(0, 4, 0);
  const sail = new THREE.Mesh(new THREE.PlaneGeometry(4, 4.6), mat(0xe8dcc0, { side: THREE.DoubleSide, transparent: true, opacity: 0.94 }));
  sail.rotation.y = Math.PI / 2;
  sail.position.set(0.1, 4.6, 0);
  boat.add(mast, sail);

  const person = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 1.1, 10), mat(PALETTE.gold));
  body.position.y = 0.95;
  const cloak = new THREE.Mesh(new THREE.ConeGeometry(0.46, 1.3, 10, 1, true), mat(0x7a2f3a, { side: THREE.DoubleSide }));
  cloak.position.set(-0.12, 0.95, 0);
  cloak.rotation.z = 0.12;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), mat(0xd9b38c));
  head.position.y = 1.78;
  const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.5, 8), mat(0x3a4a54));
  legs.position.y = 0.25;
  person.add(body, cloak, head, legs);
  person.visible = false;
  return { boat, person, parts: { body, cloak, head } };
}

// ---- names above the nearest unopened ships ----

export class LabelPool {
  constructor(scene, n = 12) {
    this.scene = scene; this.sprites = []; this.n = n; this.shown = new Map();
  }

  /** Shows a name over each of the given entries (at most n); the rest are hidden. */
  update(entries, time) {
    if (typeof document === 'undefined') return;
    const want = new Map(entries.slice(0, this.n).map((e) => [e.name, e]));
    for (const [name, s] of this.shown) if (!want.has(name)) { s.visible = false; this.shown.delete(name); this.sprites.push(s); }
    for (const [name, e] of want) {
      let s = this.shown.get(name);
      if (!s) {
        s = textSprite([name], { size: 60, width: 900 });
        if (!s) return;
        sizeSprite(s, 24);
        this.scene.add(s);
        this.shown.set(name, s);
      }
      s.visible = true;
      s.position.set(e.x, waveHeight(e.x, e.y, time) * 0.6 + 7, e.y);
    }
  }
}

/** A floating text over a point in the world (room names near the player). */
export class RoomLabels {
  constructor(parent, n = 28) { this.group = new THREE.Group(); parent.add(this.group); this.n = n; this.pool = new Map(); }

  update(ship, local, time, y) {
    if (typeof document === 'undefined') return;
    const near = ship.deck.cells
      .filter((c) => c.file !== null && Math.abs(c.rect.x + c.rect.w / 2 - local.x) < 22 && Math.abs(c.rect.y + c.rect.h / 2 - local.y) < 22 && c.rect.w > 1.6 && c.rect.h > 0.9)
      .sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h).slice(0, this.n);
    const want = new Set(near.map((c) => c.file));
    for (const [f, s] of this.pool) if (!want.has(f)) s.visible = false;
    for (const c of near) {
      let s = this.pool.get(c.file);
      if (!s) {
        s = textSprite([c.label], { size: 54, width: 700, color: '#f0e6d0' });
        if (!s) return;
        sizeSprite(s, Math.min(c.rect.w * 0.9, 4.5));
        this.group.add(s);
        this.pool.set(c.file, s);
      }
      s.visible = true;
      s.position.set(ship.x + c.rect.x + c.rect.w / 2, y + DECK_Y + 0.5, ship.y + c.rect.y + c.rect.h / 2);
    }
  }
}
