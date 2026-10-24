// What the player sees: a dusk sea, ships with their decks raised from the file plan, glowing cracks, the three stations, and the sailor.
// Built from the state in game.js with three.js (vendored, no network). Nothing here decides anything; main.js moves the camera and calls update.
// The colours are the Odysseus app's: its blue-grey night, pale cyan and warm gold, with the red it uses for trouble.

import * as THREE from '../vendor/three.module.min.js';
import { MARGIN, DECK_Y, HOLD_Y, HELM_RISE, hullFor, deckSize, shipLines, waterlineFor } from './deck.js';
import { hullLength } from './atlas.js';
import { hash32, clamp } from './util.js';

/** The layer the text sprites are on: the picture is drawn in big pixels without them, then they are drawn sharp on top. */
export const LABELS = 1;
/** How many screen pixels (CSS pixels) make one pixel of the picture. */
export const PIXEL = 3;

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
 * the crests are hard white pixels, the sun is a hard glint, and the fog is banded. The pixels are in space only: the water moves smoothly.
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
      uHoleOn: { value: 0 }, uHullN: { value: 0 }, uHull: { value: Array.from({ length: 96 }, () => new THREE.Vector2()) },
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
      uniform float uHoleOn; uniform int uHullN; uniform vec2 uHull[96];
      varying vec3 vWorld;
      void main() {
        if (uHoleOn > 0.5) {
          vec2 p = vWorld.xz;
          bool inside = true;
          for (int i = 0; i < 96; i++) {
            if (i >= uHullN) break;
            vec2 a = uHull[i];
            vec2 b = uHull[(i + 1 == uHullN) ? 0 : i + 1];
            if ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) < 0.0) { inside = false; break; }
          }
          if (inside) discard;
        }
        float tt = uTime;
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

/** Tells the sea shader where the camera is and how big the picture it draws into is, in pixels (`block`: how many of them make one pixel of the sea). Call each frame, after the camera has moved. */
export function updateSea(sea, camera, size, block = 1) {
  const u = sea.material.uniforms;
  camera.updateMatrixWorld();
  u.uInvVP.value.copy(camera.projectionMatrix).multiply(camera.matrixWorldInverse).invert();
  u.uRes.value.set(size.x, size.y);
  u.uPixel.value = block;
}

/**
 * The picture in big pixels: the scene is drawn small (every PIXEL screen pixels are one) into a target that is not smoothed, stretched to the
 * window with hard edges, and its colours are cut to a few steps. Then the text (its own layer) is drawn on top at full sharpness.
 */
export class PixelPass {
  constructor(renderer, pixel = PIXEL) {
    this.renderer = renderer;
    this.pixel = pixel;
    this.size = new THREE.Vector2(1, 1);
    this.target = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: true, stencilBuffer: false });
    this.screen = new THREE.Scene();
    this.eye = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.material = new THREE.ShaderMaterial({
      uniforms: { tMap: { value: this.target.texture }, uLevels: { value: 18 } },
      vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: 'uniform sampler2D tMap; uniform float uLevels; varying vec2 vUv; void main() { vec3 c = pow(max(texture2D(tMap, vUv).rgb, 0.0), vec3(1.0 / 2.2)); c = floor(c * uLevels + 0.5) / uLevels; gl_FragColor = vec4(c, 1.0); }',
      depthTest: false, depthWrite: false,
    });
    this.screen.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
  }

  /** The window changed size (in CSS pixels). */
  resize(width, height) {
    this.size.set(Math.max(1, Math.floor(width / this.pixel)), Math.max(1, Math.floor(height / this.pixel)));
    this.target.setSize(this.size.x, this.size.y);
  }

  render(scene, camera) {
    const r = this.renderer;
    camera.layers.set(0);
    r.setRenderTarget(this.target);
    r.clear();
    r.render(scene, camera);
    r.setRenderTarget(null);
    r.autoClear = false;
    r.clear();
    r.render(this.screen, this.eye);
    r.clearDepth();
    // (a scene with a background colour clears the whole screen when it is drawn: for the text it must not)
    const background = scene.background;
    scene.background = null;
    camera.layers.set(LABELS);
    r.render(scene, camera);
    camera.layers.set(0);
    scene.background = background;
    r.autoClear = true;
  }
}

/** Cuts a hole in the sea the shape of a ship's hull (so that her hold, below the water line, can be seen from above), or closes it (null). */
export function setSeaHole(sea, ship) {
  const u = sea.material.uniforms;
  if (!ship) { u.uHoleOn.value = 0; return; }
  const inner = insetPolygon(ship.deck.waterline, 0.25);
  if (inner.length > 96) { u.uHoleOn.value = 0; return; }
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

/**
 * The hull as a ship's: the surface that joins the sections of the ship from the transom to the bow, each from the rail down to the keel and
 * up the other side (the lines of her are in deck.js `shipLines`). Closed at the stern with a flat transom. The faces point outwards, so that
 * from inside (in the hold) only the far wall shows when the near faces are not drawn. Colours by row make the strakes: dark gunwale, planks
 * in two shades.
 */
export function hullSkinGeometry(lines, wood = new THREE.Color(0x8a6240), { maxSections = 160, lid = false } = {}) {
  const { x0, x1, cy, keel, rail, lateral } = lines;
  const nU = clamp(Math.ceil((x1 - x0) / 2), 36, maxSections), nS = 12, W = 2 * nS + 1;
  const pos = [], col = [], idx = [];
  const shade = (k) => (k === 0 ? 0.5 : k === 1 ? 0.8 : k % 2 ? 1.0 : 0.88) * (k > nS - 3 ? 0.75 : 1);
  for (let i = 0; i <= nU; i++) {
    const t = i / nU, x = x0 + (x1 - x0) * (1 - Math.pow(1 - t, 1.4));
    const top = rail(x), bottom = -keel(x);
    for (let j = 0; j < W; j++) {
      const k = j <= nS ? j : 2 * nS - j, y = top + (bottom - top) * (k / nS), side = j <= nS ? -1 : 1;
      pos.push(x, y, cy + side * lateral(x, y));
      const f = shade(k);
      col.push(wood.r * f, wood.g * f, wood.b * f);
    }
  }
  for (let i = 0; i < nU; i++) {
    for (let j = 0; j < W - 1; j++) {
      const a = i * W + j, b = a + 1, c = (i + 1) * W + j + 1, d = (i + 1) * W + j;
      idx.push(a, c, b, a, d, c);
    }
  }
  // the transom: a flat plate across the stern
  const mid = pos.length / 3;
  const top0 = rail(x0), bottom0 = -keel(x0);
  pos.push(x0, (top0 + bottom0) / 2, cy);
  col.push(wood.r * 0.9, wood.g * 0.9, wood.b * 0.9);
  for (let j = 0; j < W; j++) idx.push(mid, j, (j + 1) % W);
  if (lid) {
    // a deck laid over her, for the ships seen from far off and for the boat, which are never entered
    const base = pos.length / 3;
    for (let i = 0; i <= nU; i++) {
      for (const j of [0, W - 1]) { const o = (i * W + j) * 3; pos.push(pos[o], pos[o + 1], pos[o + 2]); col.push(wood.r * 1.15, wood.g * 1.15, wood.b * 1.15); }
    }
    for (let i = 0; i < nU; i++) {
      const a = base + i * 2, b = a + 1, a2 = a + 2, b2 = b + 2;
      idx.push(a, b, a2, b, b2, a2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

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
  s.layers.set(LABELS);
  s.userData.aspect = tex.userData.aspect;
  return s;
}

/** Sets a sprite's size so it is `worldWidth` metres wide. */
export function sizeSprite(s, worldWidth) { s.scale.set(worldWidth, worldWidth * s.userData.aspect, 1); }

// ---- one opened ship ----

let gradient = null;
/** Four flat steps of light, for cel shading (no smooth gradient from lit to dark). */
export function toonGradient() {
  if (!gradient) {
    gradient = new THREE.DataTexture(new Uint8Array([80, 140, 205, 255]), 4, 1, THREE.RedFormat);
    gradient.minFilter = gradient.magFilter = THREE.NearestFilter;
    gradient.needsUpdate = true;
  }
  return gradient;
}
const mat = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: toonGradient(), ...extra });

/** A box laid along the line from a to b (points {x, y} of the plan), `up` high, at a height. */
function along(a, b, up, thick, y, material) {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const m = new THREE.Mesh(new THREE.BoxGeometry(len, up, thick), material);
  m.position.set((a.x + b.x) / 2, y + up / 2, (a.y + b.y) / 2);
  m.rotation.y = -Math.atan2(b.y - a.y, b.x - a.x);
  return m;
}

/**
 * The ship as a group, three storeys over one hull: the hold (rooms, walls, cracks, beams), the main deck (planks, hatch, mast and sail, flag,
 * a table for every discussion, the stairs), the stern castle (the whole back of her: the captain's quarters inside it and the helm, a
 * platform with the wheel, on its roof), and the furniture inside. `setLevel(level)` shows the storey he is on, cut away from above: the
 * deck lifts off when he goes below, the roof when he goes in, and the near side of the hull is not drawn, so he sees the inside of the
 * far side. `ship` is a game.js "moored" entry. Returns { group, update(t, ...), setLevel(level), setPortraits(urls), dispose }.
 */
export function buildShipView(ship, conditionName, flagTexture = null) {
  const { deck } = ship, st = CONDITION[conditionName], L = deck.lines;
  const group = new THREE.Group();
  group.position.set(ship.x, 0, ship.y);
  const floating = new THREE.Group();
  group.add(floating);
  const woodColor = new THREE.Color(st.wood);
  const planks = mat(woodColor.clone().multiplyScalar(1.6), { side: THREE.DoubleSide });
  const dark = mat(0x3a2a1c), timber = mat(0x4a3320), pale = mat(woodColor.clone().multiplyScalar(1.3));
  const hullMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient(), side: THREE.FrontSide });
  const wallMat = mat(woodColor.clone().multiplyScalar(1.3));
  const box = (sx, sy, sz, x, y, z, material = timber) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), material); m.position.set(x, y, z); return m; };
  const { cy, x0, x1, beam } = L, c = deck.castle, xc1 = c.x1, cl = c.x1 - c.x0, mid = (c.x0 + c.x1) / 2, k = clamp(L.L / 70, 1, 6), kf = Math.min(k, 2.5);   // k: how big her rig is, in step with her length (a mast of a fifth of her length); kf: the flag
  const hullG = new THREE.Group(), holdG = new THREE.Group(), deckG = new THREE.Group(), propsG = new THREE.Group(), cabinG = new THREE.Group(), helmG = new THREE.Group(), quartersG = new THREE.Group();
  floating.add(hullG, holdG, deckG, propsG, cabinG, helmG, quartersG);
  const helmY = DECK_Y + HELM_RISE;
  const deckOutline = insetPolygon(deck.hull, 0.2);

  // ---- the hull: one surface from the keel to the rail, and the floor of the hold ----
  hullG.add(new THREE.Mesh(hullSkinGeometry(L, woodColor), hullMat));
  hullG.add(new THREE.Mesh(floorGeometry(deck.holdHull, HOLD_Y), mat(woodColor.clone().multiplyScalar(0.7), { side: THREE.DoubleSide })));

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
  const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), dark, Math.max(1, dirs.length * 4));
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
  const ladder = deck.station('ladder');
  for (const dz of [-0.3, 0.3]) holdG.add(box(0.08, DECK_Y - HOLD_Y, 0.08, ladder.x, (DECK_Y + HOLD_Y) / 2, ladder.y - 0.55 + dz));
  for (let i = 0; i < 9; i++) holdG.add(box(0.06, 0.06, 0.7, ladder.x, HOLD_Y + 0.4 + i * 0.5, ladder.y - 0.55));

  // ---- the main deck: planks with the hatch hole, its frame, and a glow that comes up out of the hold ----
  const hatch = deck.hatch;
  deckG.add(new THREE.Mesh(floorGeometry(deckOutline, DECK_Y, [{ x: hatch.x, y: hatch.y, size: 2.4 }]), planks));
  for (const [sx, sz, x, z] of [[2.8, 0.2, hatch.x, hatch.y - 1.3], [2.8, 0.2, hatch.x, hatch.y + 1.3], [0.2, 2.4, hatch.x - 1.3, hatch.y], [0.2, 2.4, hatch.x + 1.3, hatch.y]]) propsG.add(box(sx, 0.3, sz, x, DECK_Y + 0.15, z, pale));
  const leak = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 2.3), new THREE.MeshBasicMaterial({ color: 0xff7a2f, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  leak.rotation.x = Math.PI / 2;
  leak.position.set(hatch.x, DECK_Y - 0.6, hatch.y);
  deckG.add(leak);

  // ---- the stern castle: the bulkhead across the whole width with the door in it, and the windows of the stern ----
  const b1 = beam(xc1) - 0.1, wallH = HELM_RISE - 0.25, doorHalf = 0.9;
  cabinG.add(box(0.25, wallH, b1 - doorHalf, xc1, DECK_Y + wallH / 2, cy - (b1 + doorHalf) / 2, wallMat), box(0.25, wallH, b1 - doorHalf, xc1, DECK_Y + wallH / 2, cy + (b1 + doorHalf) / 2, wallMat), box(0.25, wallH - 2.1, doorHalf * 2, xc1, DECK_Y + 2.1 + (wallH - 2.1) / 2, cy, wallMat));
  const glass = new THREE.MeshBasicMaterial({ color: 0xffd9a0 });
  const bs = beam(x0) - 2.5;
  for (const wy of [-0.8, -0.4, 0, 0.4, 0.8]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.1), glass);
    win.position.set(x0 - 0.06, DECK_Y + 1.5, cy + wy * bs);
    win.rotation.y = -Math.PI / 2;
    cabinG.add(win);
  }
  cabinG.add(box(0.3, 0.3, bs * 2.1, x0 - 0.1, DECK_Y + 2.45, cy, dark));

  // ---- the helm: the roof of the castle, with its rails, the wheel and a stair up on each side ----
  const roof = new THREE.Shape(deck.castle.poly.map((p) => new THREE.Vector2(p.x, p.y)));
  const slab = new THREE.ExtrudeGeometry(roof, { depth: 0.25, bevelEnabled: false });
  slab.rotateX(Math.PI / 2);
  slab.translate(0, helmY, 0);
  helmG.add(new THREE.Mesh(slab, planks));
  const poly = deck.castle.poly, n = poly.length / 2, sy = Math.abs(deck.station('stairsUp').y - cy);
  const railOn = (a, b2) => helmG.add(along(a, b2, 0.9, 0.12, helmY, timber));
  for (let i = 0; i < n - 1; i++) railOn(poly[i], poly[i + 1]);                            // the port side
  for (let i = n; i < 2 * n - 1; i++) railOn(poly[i], poly[i + 1]);                        // the starboard side
  railOn(poly[2 * n - 1], poly[0]);                                                         // the stern
  const front = [[cy - b1, cy - sy - 1.3], [cy - sy + 1.3, cy + sy - 1.3], [cy + sy + 1.3, cy + b1]];      // the bow edge, but for the two stairs
  for (const [ya, yb] of front) if (yb - ya > 0.3) railOn({ x: xc1 - 0.1, y: ya }, { x: xc1 - 0.1, y: yb });
  const wheelSt = deck.station('wheel');
  const helm = new THREE.Group();
  helm.add(box(0.3, 1.1, 0.3, 0, 0.55, 0, timber));
  const wheel = new THREE.Group();
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.06, 6, 20), mat(0x6a4a2c)));
  for (let i = 0; i < 8; i++) { const sp = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 4), mat(0x6a4a2c)); sp.rotation.z = (i / 8) * Math.PI; wheel.add(sp); }
  wheel.rotation.y = Math.PI / 2;
  wheel.position.set(0.2, 1.35, 0);
  helm.add(wheel);
  helm.position.set(wheelSt.x, helmY, wheelSt.y);
  helmG.add(helm);
  for (const yy of [cy - sy, cy + sy]) for (let i = 0; i < 6; i++) propsG.add(box(0.66, (i + 1) * (HELM_RISE / 6), 1.8, xc1 + 4.0 - (i + 0.5) * 0.66, DECK_Y + ((i + 1) * (HELM_RISE / 6)) / 2, yy, planks));

  // ---- inside the quarters: a desk with a candle, a chair, a shelf of books, a rug, and three frames for the top contributors ----
  const desk = deck.station('desk'), side = beam(mid) - 1.1;
  quartersG.add(box(1.0, 0.1, 2.2, x0 + 1.0, DECK_Y + 0.85, cy, mat(0x6a4a2c)), box(0.9, 0.85, 0.12, x0 + 1.0, DECK_Y + 0.42, cy - 1.0), box(0.9, 0.85, 0.12, x0 + 1.0, DECK_Y + 0.42, cy + 1.0));
  quartersG.add(box(0.5, 0.1, 0.5, desk.x + 0.8, DECK_Y + 0.5, cy, mat(0x5a3d24)), box(0.1, 0.6, 0.5, desk.x + 1.05, DECK_Y + 0.8, cy, mat(0x5a3d24)));
  const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.25, 8), new THREE.MeshBasicMaterial({ color: 0xffe2a8 }));
  candle.position.set(x0 + 1.0, DECK_Y + 1.03, cy + 0.6);
  quartersG.add(candle);
  quartersG.add(box(cl - 2.4, 0.08, 0.4, mid + 0.4, DECK_Y + 1.5, cy + side, timber));
  const bookColors = [0x7a2f3a, 0x2f5a7a, 0x4a7a3a, 0xd19a66, 0x6a4a8a, 0x8a5a3a];
  for (let i = 0; i < 9; i++) quartersG.add(box(0.14, 0.4 + 0.08 * (i % 3), 0.3, x0 + 2.4 + i * 0.2, DECK_Y + 1.75, cy + side, mat(bookColors[i % bookColors.length])));
  const rug = new THREE.Mesh(new THREE.CircleGeometry(1.6, 24), mat(0x7a2f3a, { side: THREE.DoubleSide }));
  rug.rotation.x = Math.PI / 2;
  rug.position.set(mid + 0.5, DECK_Y + 0.03, cy);
  quartersG.add(rug);
  const frames = [-2, 0, 2].map((dy) => {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ color: 0x3a2a1c, side: THREE.DoubleSide }));
    f.position.set(x0 + 0.16, DECK_Y + 1.9, cy + dy);
    f.rotation.y = Math.PI / 2;
    quartersG.add(f);
    return f;
  });

  // ---- on the main deck: the mast and sail (what state it is in tells the condition), the bowsprit, the flag and a table for every discussion ----
  const mx = deck.mast.x, mastH = 15.3 * k, yardY = DECK_Y + 15 * k;
  if (conditionName !== 'wreck') {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.2 * k, 0.3 * k, mastH, 8), timber);
    mast.position.set(mx, DECK_Y + mastH / 2, cy);
    const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * k, 0.12 * k, 10 * k, 6), timber);
    yard.rotation.x = Math.PI / 2;
    yard.position.set(mx, yardY, cy);
    const sail = new THREE.Mesh(new THREE.PlaneGeometry(9 * k * st.sailW + 0.001, 9 * k * st.sailH + 0.001), mat(st.sail, { side: THREE.DoubleSide, transparent: true, opacity: 0.93 }));
    sail.rotation.y = Math.PI / 2;
    sail.position.set(mx + 0.2, yardY - 4.5 * k * st.sailH, cy);
    propsG.add(mast, yard, sail, box(1.0 * k, 0.25, 1.0 * k, mx, DECK_Y + 0.12, cy, dark));
    // stays from the mast to the bow and to the castle
    const stay = (a2, b2) => { const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a2), new THREE.Vector3(...b2)]); return new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x2a1c12 })); };
    propsG.add(stay([mx, DECK_Y + mastH, cy], [x1 + L.L * 0.05, L.rail(x1) + 0.4, cy]), stay([mx, DECK_Y + mastH, cy], [xc1, helmY + 1.2, cy]));
  } else {
    const stump = new THREE.Mesh(new THREE.CylinderGeometry(0.25 * k, 0.32 * k, 3.2, 8), dark);
    stump.position.set(mx, DECK_Y + 1.6, cy);
    stump.rotation.z = 0.35;
    propsG.add(stump);
  }
  const bowLen = clamp(L.L * 0.08, 5, 24), bowTilt = 0.22, bowStart = { x: x1 - 1.5, y: L.rail(x1) - 0.6 };
  const sprit = new THREE.Mesh(new THREE.CylinderGeometry(0.12 * k, 0.28 * k, bowLen, 6), timber);
  sprit.rotation.z = -Math.PI / 2 + bowTilt;
  sprit.position.set(bowStart.x + Math.cos(bowTilt) * bowLen / 2, bowStart.y + Math.sin(bowTilt) * bowLen / 2, cy);
  const figure = new THREE.Mesh(new THREE.SphereGeometry(0.5 * k, 8, 6), new THREE.MeshBasicMaterial({ color: 0xd19a66 }));
  figure.position.set(x1 - 0.2, L.rail(x1) + 0.3, cy);
  propsG.add(sprit, figure);
  const flagSt = deck.station('flag');
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * kf, 0.09 * kf, 9 * kf, 6), mat(0xcccccc));
  pole.position.set(flagSt.x, DECK_Y + 4.5 * kf, flagSt.y);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(3.2 * kf, 2.2 * kf), new THREE.MeshBasicMaterial({ map: flagTexture, color: flagTexture ? 0xffffff : conditionColor(conditionName), side: THREE.DoubleSide }));
  cloth.position.set(flagSt.x, DECK_Y + 6 * kf, flagSt.y + 1.7 * kf);
  cloth.rotation.y = Math.PI / 2;
  propsG.add(pole, cloth);
  // a table for each discussion, with a sign over it that says what is talked of there
  const tableSigns = [];
  for (const t of deck.tables) {
    const table = new THREE.Group();
    const lit = t.kind === 'talk';
    table.add(new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.1, 16), mat(lit ? 0x6a4a2c : 0x55504a)).translateY(0.95), new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 0.95, 8), timber).translateY(0.47));
    for (let i = 0; i < 4; i++) {
      const a2 = (i / 4) * Math.PI * 2, stool = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.5, 8), mat(0x5a3d24));
      stool.position.set(Math.cos(a2) * 1.55, 0.25, Math.sin(a2) * 1.55);
      table.add(stool);
    }
    table.add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 8), new THREE.MeshBasicMaterial({ color: lit ? 0xffd9a0 : 0x6a6660 })).translateY(1.2));
    table.position.set(t.x, DECK_Y, t.y);
    propsG.add(table);
    const words = lit ? [clean40(t.title), t.comments ? `${t.comments} comments` : 'no replies yet'] : [{ locked: 'a token lets you listen', empty: 'nobody has talked yet', off: 'no discussions here' }[t.kind]];
    const sign = textSprite(words, { color: lit ? ['#f0e6d0', '#d19a66'] : '#8a8a92', size: 52, width: 900 });
    if (sign) { sizeSprite(sign, 6.5); sign.position.set(t.x, DECK_Y + 3.0, t.y); propsG.add(sign); tableSigns.push(sign); }
  }
  const sign = textSprite([ship.repo.fullName, `${conditionName} - ${ship.repo.stars} stars${ship.repo.language ? ' - ' + ship.repo.language : ''}`], { color: ['#9cdef2', '#d19a66'], size: 56, width: 1200 });
  if (sign) { sizeSprite(sign, 22 * k); sign.position.set(mx, DECK_Y + 20 * k, cy); propsG.add(sign); }

  let level = null;
  const setLevel = (l) => {
    level = l;
    holdG.visible = l === 'hold';
    deckG.visible = l !== 'hold';
    propsG.visible = l !== 'hold' && l !== 'quarters';
    cabinG.visible = l !== 'hold';
    helmG.visible = l !== 'hold' && l !== 'quarters';
    quartersG.visible = l === 'quarters';
    // below deck and in the quarters, the near side of the hull and of the walls is not drawn: he sees the inside of the far side
    const inside = l === 'hold' || l === 'quarters';
    hullMat.side = inside ? THREE.BackSide : THREE.FrontSide;
    wallMat.side = inside ? THREE.BackSide : THREE.FrontSide;
    hullMat.needsUpdate = wallMat.needsUpdate = true;
  };
  setLevel(null);

  const state = { ring, flag: cloth, beams: beamMeshes, seamMat, frames, leak, hullMat, wallMat, tableSigns };
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
      const cx = ship.x + (x0 + x1) / 2, cz = ship.y + cy;
      // she rocks about the middle of her hull, and by an angle that keeps her ends within about half a metre of the heave however long she is
      // (a fixed angle on a ship of four hundred metres would put her bow and stern under the water)
      const pitch = Math.min(0.012, 0.55 / (L.L / 2)), roll = Math.min(0.01, 0.45 / L.bmax), list = conditionName === 'wreck' ? Math.min(0.1, 3 / (L.L / 2)) : 0;
      floating.rotation.set(roll * Math.sin(t * 0.7 + cz), 0, list + pitch * Math.sin(t * 0.9 + cx));
      const pivot = new THREE.Vector3((x0 + x1) / 2, 0, cy);
      floating.position.copy(pivot).sub(pivot.clone().applyEuler(floating.rotation));
      floating.position.y += waveHeight(cx, cz, t) * 0.6 - (conditionName === 'wreck' ? 0.9 : 0);
      const pulse = 0.55 + 0.45 * Math.sin(t * 3);
      seamMat.opacity = 0.55 + 0.4 * pulse;
      beamMat.opacity = 0.1 + 0.18 * pulse;
      leak.material.opacity = deck.cracks.length ? Math.min(0.55, 0.12 + deck.cracks.length * 0.02) * (0.6 + 0.4 * pulse) : 0;
      if (nearCrack >= 0) { const cr = deck.cracks[nearCrack]; ring.visible = true; ring.position.set(cr.pts[0].x, HOLD_Y + 0.2, cr.pts[0].y); } else ring.visible = false;
      cloth.position.y = DECK_Y + (starred ? 6 : 3.4) * kf + 0.12 * Math.sin(t * 2.5);
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

const clean40 = (t) => (t.length > 40 ? t.slice(0, 37) + '...' : t);

// ---- ships of the map that have not been opened ----

let unitHull = null, unitLen = 1;
function unitHullGeometry() {
  if (unitHull) return unitHull;
  const lines = shipLines(deckSize(30), { castle: false });
  const g = hullSkinGeometry(lines, new THREE.Color(0xffffff), { maxSections: 40, lid: true }), p = g.attributes.position;
  unitLen = lines.x1 - lines.x0;
  const cx = (lines.x0 + lines.x1) / 2;
  for (let i = 0; i < p.count; i++) p.setXYZ(i, (p.getX(i) - cx) / unitLen, p.getY(i), (p.getZ(i) - lines.cy) / unitLen);
  g.computeVertexNormals();
  unitHull = g;
  return g;
}

/** Many small hulls in one draw call: the ships the map knows but that have not been opened. */
export class DotFleet {
  constructor(capacity = 3000) {
    this.capacity = capacity;
    const material = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: toonGradient(), vertexColors: true });
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
      p.set(e.x, bob, e.y);
      s.set(len, clamp(len / unitLen, 0.6, 2.5), len);
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
  const lines = shipLines({ w: 9, h: 3.6 }, { castle: false });
  const hull = new THREE.Mesh(hullSkinGeometry(lines, new THREE.Color(0xc29a6a), { maxSections: 40, lid: true }), new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: toonGradient() }));
  hull.scale.setScalar(0.55);
  hull.position.set(-(lines.x0 + lines.x1) / 2 * 0.55 + 0.6, 0, -lines.cy * 0.55);
  boat.add(hull);
  // the mast stands on her deck, ends at the yard, and the sail hangs from the yard
  const base = lines.rail(0) * 0.55, top = base + 6.4;
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.14, top - base, 6), mat(0x4a3320));
  mast.position.set(0, (base + top) / 2, 0);
  const yard = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 4.6, 6), mat(0x4a3320));
  yard.rotation.x = Math.PI / 2;
  yard.position.set(0.05, top - 0.15, 0);
  const sail = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 3.6), mat(0xe8dcc0, { side: THREE.DoubleSide, transparent: true, opacity: 0.94 }));
  sail.rotation.y = Math.PI / 2;
  sail.position.set(0.1, top - 0.15 - 1.8, 0);
  boat.add(mast, yard, sail);

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
