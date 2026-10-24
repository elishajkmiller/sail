// What the player sees: a dusk sea, ships with their decks raised from the file plan, glowing cracks, the three stations, and the sailor.
// Built from the state in game.js with three.js (vendored, no network). Nothing here decides anything; main.js moves the camera and calls update.
// The colours are the Odysseus app's: its blue-grey night, pale cyan and warm gold, with the red it uses for trouble.

import * as THREE from '../vendor/three.module.min.js';
import { MARGIN, DECK_Y, HOLD_Y, HELM_RISE, hullFor, deckSize } from './deck.js';
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

/** The pixel the sea is drawn in, in screen pixels (made bigger on a sharp screen so that it looks the same). */
export const SEA_PIXEL = 4;

/**
 * The sea: a big plane that follows the camera, waves in the vertex shader (the hulls ride these), and a pixel-art look in the fragment
 * shader: the colour of each block of screen pixels is worked out once, from where its ray meets the water, then cut into a few flat bands;
 * the crests are hard white pixels, the sun is a hard glint, the fog is banded, and the water moves in jumps five times a second.
 */
export function makeSea() {
  const geo = new THREE.PlaneGeometry(3200, 3200, 256, 256);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 }, uSun: { value: new THREE.Vector3(-0.6, 0.18, -0.5).normalize() },
      uDeep: { value: hex(PALETTE.deep) }, uShallow: { value: hex(PALETTE.shallow) }, uHorizon: { value: hex(PALETTE.horizon) }, uZenith: { value: hex(PALETTE.zenith) },
      uFog: { value: hex(0x2a3238) }, uFoam: { value: hex(0xd6ecf1) }, uGlint: { value: hex(0xffd29a) },
      uInvVP: { value: new THREE.Matrix4() }, uRes: { value: new THREE.Vector2(1400, 900) }, uPixel: { value: SEA_PIXEL },
      // a hole in the sea where a hull is, while he is below deck in it (the hold is under the water line): the hull's outline, in the world
      uHoleOn: { value: 0 }, uHullN: { value: 0 }, uHull: { value: Array.from({ length: 24 }, () => new THREE.Vector2()) },
    },
    vertexShader: `${WAVES}
      uniform float uTime; varying vec3 vWorld;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        w.y += wave(w.xz, uTime);
        vWorld = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `${WAVES}
      uniform float uTime; uniform vec3 uSun; uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uHorizon; uniform vec3 uZenith; uniform vec3 uFog;
      uniform vec3 uFoam; uniform vec3 uGlint; uniform mat4 uInvVP; uniform vec2 uRes; uniform float uPixel;
      uniform float uHoleOn; uniform int uHullN; uniform vec2 uHull[24];
      varying vec3 vWorld;
      void main() {
        if (uHoleOn > 0.5) {
          vec2 p = vWorld.xz;
          bool inside = true;
          for (int i = 0; i < 24; i++) {
            if (i >= uHullN) break;
            vec2 a = uHull[i];
            vec2 b = uHull[(i + 1 == uHullN) ? 0 : i + 1];
            if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) < 0.0) { inside = false; break; }
          }
          if (inside) discard;
        }
        float tt = floor(uTime * 5.0) / 5.0;
        // the ray through the middle of this block of pixels, and where it meets the water (once more, for the height of the wave there)
        vec2 ndc = (floor(gl_FragCoord.xy / uPixel) * uPixel + 0.5 * uPixel) / uRes * 2.0 - 1.0;
        vec4 n0 = uInvVP * vec4(ndc, -1.0, 1.0); n0 /= n0.w;
        vec4 f0 = uInvVP * vec4(ndc, 1.0, 1.0); f0 /= f0.w;
        vec3 dir = normalize(f0.xyz - n0.xyz);
        vec3 P = vWorld;
        if (dir.y < -0.003) {
          float t = -cameraPosition.y / dir.y;
          P = cameraPosition + dir * t;
          t = (wave(P.xz, tt) - cameraPosition.y) / dir.y;
          P = cameraPosition + dir * t;
        }
        float h = wave(P.xz, tt);
        vec2 s = waveSlope(P.xz, tt);
        vec3 N = normalize(vec3(-s.x, 1.0, -s.y));
        vec3 V = normalize(cameraPosition - P);
        // flat bands of water colour by how high the wave is, and of sky colour by how much it mirrors
        float tone = floor(clamp(0.5 + 0.5 * h / 0.8, 0.0, 1.0) * 5.0) / 5.0;
        vec3 col = mix(uDeep, uShallow, tone);
        float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);
        vec3 refl = reflect(-V, N);
        vec3 sky = mix(uHorizon, uZenith, floor(clamp(refl.y, 0.0, 1.0) * 4.0) / 4.0);
        col = mix(col, sky, floor(clamp(fres * 1.2, 0.0, 1.0) * 4.0) / 4.0 * 0.8);
        // crests are white pixels, in a broken pattern; the sun is a hard glint
        float broken = wave(P.xz * 1.9 + vec2(3.1, 1.7), tt * 1.4);
        if (h > 0.42 && broken > 0.14) col = uFoam;
        if (pow(max(dot(reflect(-uSun, N), V), 0.0), 60.0) > 0.45) col = uGlint;
        float d = length(cameraPosition - P);
        float fog = floor(clamp(1.0 - exp(-d * d * 0.0000009), 0.0, 1.0) * 6.0) / 6.0;
        gl_FragColor = vec4(mix(col, uFog, fog), 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  return mesh;
}

/** Tells the sea shader where the camera is and how big the screen is (call each frame, after the camera has moved). */
export function updateSea(sea, camera, renderer) {
  const u = sea.material.uniforms;
  camera.updateMatrixWorld();
  u.uInvVP.value.copy(camera.projectionMatrix).multiply(camera.matrixWorldInverse).invert();
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  u.uRes.value.copy(size);
  // the same size of pixel on a sharp screen (its pixels are smaller)
  u.uPixel.value = Math.max(2, Math.round(SEA_PIXEL * (renderer.getPixelRatio?.() ?? 1)));
}

/** Cuts a hole in the sea the shape of a ship's hull (so that her hold, below the water line, can be seen from above), or closes it (null). */
export function setSeaHole(sea, ship) {
  const u = sea.material.uniforms;
  if (!ship) { u.uHoleOn.value = 0; return; }
  const inner = insetPolygon(ship.deck.hull, 0.45);
  if (inner.length > 24) { u.uHoleOn.value = 0; return; }
  u.uHullN.value = inner.length;
  inner.forEach((p, i) => u.uHull.value[i].set(ship.x + p.x, ship.y + p.y));
  u.uHoleOn.value = 1;
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
        vec3 col = mix(uHorizon, uZenith, floor(pow(y, 0.45) * 9.0) / 9.0);
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

export { DECK_Y, HOLD_Y } from './deck.js';
const KEEL = 2.8;

/** The solid hull from the outline (x, y of the deck) to a block from below the water to the deck (for ships far away and for the boat). */
export function hullGeometry(hull) {
  const shape = new THREE.Shape(hull.map((p) => new THREE.Vector2(p.x, p.y)));
  const geo = new THREE.ExtrudeGeometry(shape, { depth: DECK_Y + KEEL, bevelEnabled: false, steps: 1 });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, DECK_Y, 0);
  return geo;
}

/** The hull of a ship that can be gone into: the wall only, from the keel to the deck, and open in the middle (the hold). */
export function shellGeometry(hull, wall = 0.5) {
  const shape = new THREE.Shape(hull.map((p) => new THREE.Vector2(p.x, p.y)));
  shape.holes.push(new THREE.Path(insetPolygon(hull, wall).map((p) => new THREE.Vector2(p.x, p.y)).reverse()));
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

/** A flat floor from the outline, at a height, with optional square holes ({ x, y, size } in the outline's own coordinates). */
export function floorGeometry(outline, y, holes = []) {
  const shape = new THREE.Shape(outline.map((p) => new THREE.Vector2(p.x, p.y)));
  for (const h of holes) {
    const r = h.size / 2;
    shape.holes.push(new THREE.Path([new THREE.Vector2(h.x - r, h.y - r), new THREE.Vector2(h.x - r, h.y + r), new THREE.Vector2(h.x + r, h.y + r), new THREE.Vector2(h.x + r, h.y - r)]));
  }
  const geo = new THREE.ShapeGeometry(shape);
  geo.rotateX(Math.PI / 2);
  geo.translate(0, y, 0);
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
 * The ship as a group, three storeys over one hull: the hold (rooms, walls, cracks, beams), the main deck (planks, hatch, mast and sail, flag,
 * tavern table, stairs), the quarters at the stern with the helm (a platform with the wheel) on their roof, and the furniture inside.
 * `setLevel(level)` shows the storey he is on, cut away from above (the deck lifts off when he goes below, the roof when he goes in).
 * `ship` is a game.js "moored" entry. Returns { group, update(t, ...), setLevel(level), setPortraits(urls), dispose }.
 */
export function buildShipView(ship, conditionName, flagTexture = null) {
  const { deck } = ship, st = CONDITION[conditionName];
  const group = new THREE.Group();
  group.position.set(ship.x, 0, ship.y);
  const floating = new THREE.Group();
  group.add(floating);
  const woodColor = new THREE.Color(st.wood);
  const wood = mat(woodColor, { side: THREE.DoubleSide }), planks = mat(woodColor.clone().multiplyScalar(1.6), { side: THREE.DoubleSide });
  const pale = mat(woodColor.clone().multiplyScalar(1.3));
  const { w, h } = deck.size, cy = h / 2, c = deck.cabin, cl = c.x1 - c.x0, cw = c.y1 - c.y0, mid = (c.x0 + c.x1) / 2;
  const box = (sx, sy, sz, x, y, z, material = wood) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material); m.position.set(x, y, z); return m; };
  const hullG = new THREE.Group(), holdG = new THREE.Group(), deckG = new THREE.Group(), propsG = new THREE.Group(), cabinG = new THREE.Group(), helmG = new THREE.Group(), quartersG = new THREE.Group();
  floating.add(hullG, holdG, deckG, propsG, cabinG, helmG, quartersG);
  const inner = insetPolygon(deck.hull, 0.5);
  const helmY = DECK_Y + HELM_RISE;

  // the hull: a shell with the hold inside it, and the rail on top
  hullG.add(new THREE.Mesh(shellGeometry(deck.hull), wood), new THREE.Mesh(railGeometry(deck.hull), mat(woodColor.clone().multiplyScalar(0.8), { side: THREE.DoubleSide })));
  hullG.add(new THREE.Mesh(floorGeometry(inner, HOLD_Y), mat(woodColor.clone().multiplyScalar(0.7), { side: THREE.DoubleSide })));

  // ---- the hold: rooms (files), walls (folders), and the cracks with a beam each ----
  const files = deck.cells.filter((cell) => cell.file !== null), dirs = deck.cells.filter((cell) => cell.file === null);
  const rooms = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat(0xffffff), Math.max(1, files.length));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3();
  files.forEach((cell, i) => {
    const r = cell.rect;
    m4.compose(one.set(r.x + r.w / 2, HOLD_Y + 0.07, r.y + r.h / 2), q, new THREE.Vector3(Math.max(r.w - 0.06, 0.02), 0.12, Math.max(r.h - 0.06, 0.02)));
    rooms.setMatrixAt(i, m4);
    rooms.setColorAt(i, extColor(cell.label, cell.depth));
  });
  rooms.count = files.length;
  rooms.instanceMatrix.needsUpdate = true;
  if (rooms.instanceColor) rooms.instanceColor.needsUpdate = true;
  const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat(0x3a2a1c), Math.max(1, dirs.length * 4));
  let wn = 0;
  const wall = (x, z, sx, sz) => { m4.compose(one.set(x, HOLD_Y + 0.3, z), q, new THREE.Vector3(sx, 0.5, sz)); walls.setMatrixAt(wn++, m4); };
  for (const cell of dirs) {
    const r = cell.rect, t = 0.1;
    wall(r.x + r.w / 2, r.y, r.w, t); wall(r.x + r.w / 2, r.y + r.h, r.w, t); wall(r.x, r.y + r.h / 2, t, r.h); wall(r.x + r.w, r.y + r.h / 2, t, r.h);
  }
  walls.count = wn;
  walls.instanceMatrix.needsUpdate = true;
  holdG.add(rooms, walls);
  const gap = [], seam = [];
  const ribbon = (pts, width, y, out) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a2 = pts[i], b2 = pts[i + 1], dx = b2.x - a2.x, dz = b2.y - a2.y, len = Math.hypot(dx, dz) || 1, nx = (-dz / len) * width / 2, nz = (dx / len) * width / 2;
      out.push(a2.x + nx, y, a2.y + nz, a2.x - nx, y, a2.y - nz, b2.x + nx, y, b2.y + nz, b2.x + nx, y, b2.y + nz, a2.x - nx, y, a2.y - nz, b2.x - nx, y, b2.y - nz);
    }
  };
  const beamMat = new THREE.MeshBasicMaterial({ color: PALETTE.gold, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
  const beamMeshes = [], beams = new THREE.Group();
  deck.cracks.forEach((cr) => {
    ribbon(cr.pts, cr.width * 1.8, HOLD_Y + 0.15, gap); ribbon(cr.branch, cr.width * 1.1, HOLD_Y + 0.15, gap);
    ribbon(cr.pts, cr.width, HOLD_Y + 0.17, seam); ribbon(cr.branch, cr.width * 0.6, HOLD_Y + 0.17, seam);
    const b2 = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 3.4, 6, 1, true), beamMat);
    b2.position.set(cr.pts[0].x, HOLD_Y + 1.8, cr.pts[0].y);
    beams.add(b2); beamMeshes.push(b2);
  });
  const ribbonMesh = (verts, material) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3)); return new THREE.Mesh(g, material); };
  const seamMat = new THREE.MeshBasicMaterial({ color: 0xff7a2f, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
  holdG.add(ribbonMesh(gap, new THREE.MeshBasicMaterial({ color: 0x050404, side: THREE.DoubleSide })), ribbonMesh(seam, seamMat), beams);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.05, 6, 24), new THREE.MeshBasicMaterial({ color: PALETTE.gold }));
  ring.rotation.x = Math.PI / 2;
  ring.visible = false;
  holdG.add(ring);
  // the ladder up to the hatch
  const ladder = deck.station('ladder');
  for (const dz of [-0.3, 0.3]) holdG.add(box(0.08, DECK_Y - HOLD_Y, 0.08, ladder.x, (DECK_Y + HOLD_Y) / 2, ladder.y - 0.55 + dz));
  for (let i = 0; i < 9; i++) holdG.add(box(0.06, 0.06, 0.7, ladder.x, HOLD_Y + 0.4 + i * 0.5, ladder.y - 0.55));

  // ---- the main deck: planks with the hatch hole, its frame, and a glow that comes up out of the hold ----
  const hatch = deck.hatch;
  deckG.add(new THREE.Mesh(floorGeometry(inner, DECK_Y, [{ x: hatch.x, y: hatch.y, size: 2.4 }]), planks));
  for (const [sx, sz, x, z] of [[2.8, 0.2, hatch.x, hatch.y - 1.3], [2.8, 0.2, hatch.x, hatch.y + 1.3], [0.2, 2.4, hatch.x - 1.3, hatch.y], [0.2, 2.4, hatch.x + 1.3, hatch.y]]) propsG.add(box(sx, 0.3, sz, x, DECK_Y + 0.15, z, pale));
  const leak = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 2.3), new THREE.MeshBasicMaterial({ color: 0xff7a2f, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  leak.rotation.x = Math.PI / 2;
  leak.position.set(hatch.x, DECK_Y - 0.6, hatch.y);
  deckG.add(leak);

  // ---- the quarters: walls (a door in the bow side), and the helm on the roof ----
  const wallH = HELM_RISE - 0.25;
  cabinG.add(box(0.25, wallH, cw, c.x0, DECK_Y + wallH / 2, cy, pale), box(cl, wallH, 0.25, mid, DECK_Y + wallH / 2, c.y0, pale), box(cl, wallH, 0.25, mid, DECK_Y + wallH / 2, c.y1, pale));
  const side = (cw - 1.8) / 2;
  cabinG.add(box(0.25, wallH, side, c.x1, DECK_Y + wallH / 2, c.y0 + side / 2, pale), box(0.25, wallH, side, c.x1, DECK_Y + wallH / 2, c.y1 - side / 2, pale), box(0.25, wallH - 2.1, 1.8, c.x1, DECK_Y + 2.1 + (wallH - 2.1) / 2, cy, pale));
  helmG.add(box(cl + 0.8, 0.25, cw + 0.8, mid - 0.1, helmY - 0.125, cy, planks));
  const stairsX = deck.station('stairsUp').x;
  const rail = (sx, sz, x, z) => helmG.add(box(sx, 0.9, sz, x, helmY + 0.45, z, wood));
  rail(0.12, cw + 0.8, c.x0 - 0.5, cy); rail(0.12, cw + 0.8, c.x1 + 0.3, cy); rail(cl + 0.8, 0.12, mid - 0.1, c.y1 + 0.4);
  const gapW = 2.4, leftLen = stairsX - gapW / 2 - (c.x0 - 0.5), rightLen = (c.x1 + 0.3) - (stairsX + gapW / 2);
  rail(leftLen, 0.12, (c.x0 - 0.5) + leftLen / 2, c.y0 - 0.4); rail(rightLen, 0.12, stairsX + gapW / 2 + rightLen / 2, c.y0 - 0.4);
  const wheelSt = deck.station('wheel');
  const helm = new THREE.Group();
  helm.add(box(0.3, 1.1, 0.3, 0, 0.55, 0, mat(0x4a3320)));
  const wheel = new THREE.Group();
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.06, 6, 20), mat(0x6a4a2c)));
  for (let i = 0; i < 8; i++) { const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 4), mat(0x6a4a2c)); sp.rotation.z = (i / 8) * Math.PI; wheel.add(sp); }
  wheel.rotation.y = Math.PI / 2;
  wheel.position.set(0.2, 1.35, 0);
  helm.add(wheel);
  helm.position.set(wheelSt.x, helmY, wheelSt.y);
  helmG.add(helm);
  // the stairs up from the deck on the port side
  for (let i = 0; i < 6; i++) propsG.add(box(1.8, (i + 1) * (HELM_RISE / 6), 0.55, stairsX, DECK_Y + ((i + 1) * (HELM_RISE / 6)) / 2, c.y0 - 3.3 + (i + 0.5) * 0.55, planks));

  // ---- inside the quarters: a desk with a candle, a chair, a shelf of books, a rug, and three frames for the top contributors ----
  const desk = deck.station('desk');
  quartersG.add(box(1.0, 0.1, 2.2, c.x0 + 0.9, DECK_Y + 0.85, cy, mat(0x6a4a2c)), box(0.9, 0.85, 0.12, c.x0 + 0.9, DECK_Y + 0.42, cy - 1.0, mat(0x4a3320)), box(0.9, 0.85, 0.12, c.x0 + 0.9, DECK_Y + 0.42, cy + 1.0, mat(0x4a3320)));
  quartersG.add(box(0.5, 0.1, 0.5, desk.x + 0.7, DECK_Y + 0.5, cy, mat(0x5a3d24)), box(0.1, 0.6, 0.5, desk.x + 0.95, DECK_Y + 0.8, cy, mat(0x5a3d24)));
  const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.25, 8), new THREE.MeshBasicMaterial({ color: 0xffe2a8 }));
  candle.position.set(c.x0 + 0.9, DECK_Y + 1.03, cy + 0.6);
  quartersG.add(candle);
  quartersG.add(box(cl - 2.2, 0.08, 0.4, mid + 0.4, DECK_Y + 1.5, c.y1 - 0.35, mat(0x4a3320)));
  const bookColors = [0x7a2f3a, 0x2f5a7a, 0x4a7a3a, 0xd19a66, 0x6a4a8a, 0x8a5a3a];
  for (let i = 0; i < 9; i++) quartersG.add(box(0.14, 0.4 + 0.08 * (i % 3), 0.3, c.x0 + 2.2 + i * 0.2, DECK_Y + 1.75, c.y1 - 0.35, mat(bookColors[i % bookColors.length])));
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.6, 24), mat(0x7a2f3a, { side: THREE.DoubleSide }));
  rug.rotation.x = Math.PI / 2;
  rug.position.set(mid + 0.5, DECK_Y + 0.03, cy);
  quartersG.add(rug);
  const frames = [-2, 0, 2].map((dy) => {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ color: 0x3a2a1c, side: THREE.DoubleSide }));
    f.position.set(c.x0 + 0.16, DECK_Y + 1.9, cy + dy);
    f.rotation.y = Math.PI / 2;
    quartersG.add(f);
    return f;
  });

  // ---- on the main deck: the mast and sail (what state it is in tells the condition), the flag and the tavern table ----
  const mx = w * 0.42;
  if (conditionName !== 'wreck') {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 17, 8), mat(0x4a3320));
    mast.position.set(mx, DECK_Y + 8.5, cy);
    const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 10, 6), mat(0x4a3320));
    yard.rotation.x = Math.PI / 2;
    yard.position.set(mx, DECK_Y + 15, cy);
    const sail = new THREE.Mesh(new THREE.PlaneGeometry(9 * st.sailW + 0.001, 9 * st.sailH + 0.001), mat(st.sail, { side: THREE.DoubleSide, transparent: true, opacity: 0.93 }));
    sail.rotation.y = Math.PI / 2;
    sail.position.set(mx + 0.2, DECK_Y + 15 - 4.5 * st.sailH, cy);
    propsG.add(mast, yard, sail);
  } else {
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.32, 3.2, 8), mat(0x3a2a1c));
    stump.position.set(mx, DECK_Y + 1.6, cy);
    stump.rotation.z = 0.35;
    propsG.add(stump);
  }
  const flagSt = deck.station('flag'), tavernSt = deck.station('tavern');
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 9, 6), mat(0xcccccc));
  pole.position.set(flagSt.x, DECK_Y + 4.5, flagSt.y);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.2), new THREE.MeshBasicMaterial({ map: flagTexture, color: flagTexture ? 0xffffff : conditionColor(conditionName), side: THREE.DoubleSide }));
  cloth.position.set(flagSt.x, DECK_Y + 6, flagSt.y + 1.7);
  cloth.rotation.y = Math.PI / 2;
  propsG.add(pole, cloth);
  const table = new THREE.Group();
  table.add(new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.1, 16), mat(0x6a4a2c)).translateY(0.95), new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 0.95, 8), mat(0x4a3320)).translateY(0.47));
  for (let i = 0; i < 4; i++) {
    const a2 = (i / 4) * Math.PI * 2, stool = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.5, 8), mat(0x5a3d24));
    stool.position.set(Math.cos(a2) * 1.5, 0.25, Math.sin(a2) * 1.5);
    table.add(stool);
  }
  table.add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), new THREE.MeshBasicMaterial({ color: 0xffd9a0 })).translateY(1.2));
  table.position.set(tavernSt.x, DECK_Y, tavernSt.y);
  propsG.add(table);
  const sign = textSprite([ship.repo.fullName, `${conditionName} - ${ship.repo.stars} stars${ship.repo.language ? ' - ' + ship.repo.language : ''}`], { color: ['#9cdef2', '#d19a66'], size: 56, width: 1200 });
  if (sign) { sizeSprite(sign, 22); sign.position.set(mx, DECK_Y + 20, cy); propsG.add(sign); }

  let level = null;
  const setLevel = (l) => {
    level = l;
    holdG.visible = l === 'hold';
    deckG.visible = l !== 'hold';
    propsG.visible = l !== 'hold' && l !== 'quarters';
    cabinG.visible = l !== 'hold';
    helmG.visible = l !== 'hold' && l !== 'quarters';
    quartersG.visible = l === 'quarters';
  };
  setLevel(null);

  const state = { ring, flag: cloth, beams: beamMeshes, seamMat, frames, leak };
  return {
    group,
    /** The part that heaves and rocks with the waves: whatever stands on her (the sailor, the labels of the rooms) is put in this, so it moves with her. */
    floating,
    deck,
    state,
    setLevel,
    get level() { return level; },
    /** Rides the water, makes the seams pulse, and shows which crack is near and which is being read. */
    update(t, nearCrack, readingIssue, starred) {
      const cx = ship.x + w / 2, cz = ship.y + h / 2;
      const tilt = conditionName === 'wreck' ? 0.1 : 0;
      floating.position.y = waveHeight(cx, cz, t) * 0.6 - (conditionName === 'wreck' ? 0.9 : 0);
      floating.rotation.z = tilt + 0.012 * Math.sin(t * 0.9 + cx);
      floating.rotation.x = 0.01 * Math.sin(t * 0.7 + cz);
      const pulse = 0.55 + 0.45 * Math.sin(t * 3);
      seamMat.opacity = 0.55 + 0.4 * pulse;
      beamMat.opacity = 0.1 + 0.18 * pulse;
      leak.material.opacity = deck.cracks.length ? Math.min(0.55, 0.12 + deck.cracks.length * 0.02) * (0.6 + 0.4 * pulse) : 0;
      if (nearCrack >= 0) { const cr = deck.cracks[nearCrack]; ring.visible = true; ring.position.set(cr.pts[0].x, HOLD_Y + 0.2, cr.pts[0].y); } else ring.visible = false;
      cloth.position.y = DECK_Y + (starred ? 6 : 3.4) + 0.12 * Math.sin(t * 2.5);
      beamMeshes.forEach((b2, i) => { b2.visible = readingIssue === null || deck.cracks[i].issue !== readingIssue || (Math.floor(t * 4) % 2 === 0); });
    },
    /** Hangs the top contributors in the three frames of the quarters (pictures from GitHub only). */
    setPortraits(urls) {
      if (typeof document === 'undefined') return;
      urls.slice(0, 3).forEach((url, i) => {
        if (!url || !frames[i]) return;
        new THREE.TextureLoader().setCrossOrigin('anonymous').load(`${url}${url.includes('?') ? '&' : '?'}s=128`, (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          frames[i].material.map = tex; frames[i].material.color.set(0xffffff); frames[i].material.needsUpdate = true;
        }, undefined, () => { /* no picture: the frame stays empty */ });
      });
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

/** The names of the rooms near the sailor, written over them. They are put in the ship's own rocking group, so that they move with her. */
export class RoomLabels {
  constructor(n = 28) { this.group = new THREE.Group(); this.n = n; this.pool = new Map(); this.owner = null; }

  /** Moves the labels onto a ship (her `floating` group); a different ship starts with none. */
  attach(host, ownerKey) {
    if (this.owner !== ownerKey) {
      for (const s of this.pool.values()) { this.group.remove(s); s.material.map = null; s.material.dispose(); }
      this.pool.clear();
      this.owner = ownerKey;
    }
    if (this.group.parent !== host) host?.add(this.group);
  }

  detach() { this.group.parent?.remove(this.group); }

  /** `local`: where he stands in the ship's own coordinates; `floorY`: the height of the floor he stands on. */
  update(ship, local, floorY) {
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
      s.position.set(c.rect.x + c.rect.w / 2, floorY + 0.6, c.rect.y + c.rect.h / 2);
    }
  }
}
