import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three.module.min.js';
import * as treemap from '../public/js/treemap.js';
import { Atlas } from '../public/js/atlas.js';
import { Game } from '../public/js/game.js';
import { hullFor } from '../public/js/deck.js';
import { insetPolygon, hullGeometry, railGeometry, buildShipView, DotFleet, makeCraft, makeSea, makeSky, waveHeight, extColor, DECK_Y } from '../public/js/scene.js';

const area = (pts) => Math.abs(pts.reduce((s, a, i) => { const b = pts[(i + 1) % pts.length]; return s + a.x * b.y - b.x * a.y; }, 0)) / 2;

test('a polygon moved inward shrinks and stays inside', () => {
  const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
  const inner = insetPolygon(sq, 1);
  assert.ok(Math.abs(area(inner) - 64) < 1e-6, String(area(inner)));
  assert.ok(inner.every((p) => p.x > 0.99 && p.x < 9.01 && p.y > 0.99 && p.y < 9.01));
  const rev = insetPolygon([...sq].reverse(), 1);
  assert.ok(Math.abs(area(rev) - 64) < 1e-6, 'either way round');
  const hull = hullFor({ w: 40, h: 22 });
  const hin = insetPolygon(hull, 0.35);
  assert.ok(area(hin) < area(hull) && area(hin) > area(hull) * 0.8);
});

test('the hull and rail are solid shapes of the right size', () => {
  const hull = hullFor({ w: 40, h: 22 });
  const g = hullGeometry(hull);
  g.computeBoundingBox();
  assert.ok(Math.abs(g.boundingBox.max.y - DECK_Y) < 1e-6 && g.boundingBox.min.y < 0, 'from below the water to the deck');
  assert.ok(g.boundingBox.min.x < 0 && g.boundingBox.max.x > 40);
  const r = railGeometry(hull);
  r.computeBoundingBox();
  assert.ok(r.boundingBox.min.y >= DECK_Y - 1e-6 && r.boundingBox.max.y > DECK_Y + 0.9, 'the rail stands on the deck');
  assert.ok(r.attributes.position.count > 50);
});

const FILES = Array.from({ length: 60 }, (_, i) => [`src/m${i % 5}/f${i}.rs`, 100 + i * 37]);
const ISSUES = [{ number: 1, title: 'a', files: ['src/m0/f0.rs'], comments: 2, body: '', author: '', createdAt: 0, labels: [] }, { number: 2, title: 'b', files: [], comments: 0, body: '', author: '', createdAt: 0, labels: [] }];

function ship(name = 'deck/mast') {
  const g = new Game({ atlas: new Atlas(), now: () => 1_790_000_000 });
  g.moor({ repo: { owner: 'deck', name: 'mast', fullName: name, stars: 7, language: 'Rust', pushedAt: 1_789_000_000, archived: false, defaultBranch: 'main', can: {} }, files: FILES, partial: null, item: treemap.build(FILES), issues: ISSUES, moreIssues: false, checks: { total: 0, failed: [] }, notes: [] });
  return g;
}

test('an opened ship is built with rooms, walls, cracks and stations, in every condition', () => {
  const g = ship();
  for (const cond of ['sailing', 'anchored', 'derelict', 'wreck']) {
    const view = buildShipView(g.sea[0], cond);
    assert.equal(view.group.position.x, g.sea[0].x);
    let meshes = 0, instanced = 0;
    view.group.traverse((o) => { if (o.isMesh) meshes++; if (o.isInstancedMesh) instanced += o.count; });
    assert.ok(meshes > 12 && instanced >= FILES.length, `${cond}: ${meshes} meshes, ${instanced} instances`);
    view.update(1.5, 0, 1, true);
    view.update(2.5, -1, null, false);
    const box = new THREE.Box3().setFromObject(view.group);
    assert.ok(Number.isFinite(box.min.x) && Number.isFinite(box.max.y) && box.max.y > 8 === (cond !== 'wreck') || cond === 'wreck', `${cond} box`);
    view.dispose();
  }
});

test('the cracks are drawn where the deck says they are', () => {
  const g = ship();
  const view = buildShipView(g.sea[0], 'sailing');
  const beams = view.state.beams;
  assert.equal(beams.length, g.sea[0].deck.cracks.length);
  beams.forEach((b, i) => { const c = g.sea[0].deck.cracks[i]; assert.ok(Math.abs(b.position.x - c.pts[0].x) < 1e-9 && Math.abs(b.position.z - c.pts[0].y) < 1e-9); });
  view.update(0, 1, null, false);
  assert.ok(view.state.ring.visible);
  view.update(0, -1, null, false);
  assert.ok(!view.state.ring.visible);
  const flagUp = (() => { view.update(0, -1, null, true); return view.state.flag.position.y; })();
  const flagDown = (() => { view.update(0, -1, null, false); return view.state.flag.position.y; })();
  assert.ok(flagUp > flagDown + 2, 'a starred repo flies her flag high');
});

test('the unopened ships are one draw call, nearest first, and skip the opened ones', () => {
  const fleet = new DotFleet(50);
  const list = Array.from({ length: 200 }, (_, i) => ({ name: `o/r${i}`, x: i * 10, y: 0, stars: i * 5, language: i % 2 ? 'Rust' : 'Go' }));
  fleet.update(list, new Set(['o/r0', 'o/r1']), { x: 0, y: 0 }, 0);
  assert.equal(fleet.mesh.count, 50);
  assert.deepEqual(fleet.entries.slice(0, 2).map((e) => e.name), ['o/r2', 'o/r3'], 'the opened ones are left out');
  assert.ok(fleet.entries.every((e) => e.x <= 520));
  const m = new THREE.Matrix4();
  fleet.mesh.getMatrixAt(0, m);
  assert.ok(Math.abs(m.elements[12] - 20) < 1e-6);
});

test('the sea, the sky and the sailor build, and the water height is the shader formula', () => {
  assert.ok(makeSea().material.uniforms.uTime && makeSky().material.side === THREE.BackSide);
  const { boat, person } = makeCraft();
  assert.ok(boat.children.length >= 3 && person.children.length >= 4 && person.visible === false);
  assert.ok(Math.abs(waveHeight(0, 0, 0)) < 0.5 && Math.abs(waveHeight(3, 5, 7)) < 0.9);
  assert.notEqual(waveHeight(1, 1, 0), waveHeight(1, 1, 1));
  assert.deepEqual(extColor('a.rs').toArray().map((v) => +v.toFixed(3)), extColor('b/c.rs').toArray().map((v) => +v.toFixed(3)));
  assert.notDeepEqual(extColor('a.rs').toArray(), extColor('a.md').toArray());
});

test('the room labels take the height of the floor they stand on, and the storeys show and hide as they should', async () => {
  const { RoomLabels } = await import('../public/js/scene.js');
  const labels = new RoomLabels();
  assert.doesNotThrow(() => labels.update(ship().sea[0], { x: 5, y: 5 }, -2.2), 'a label update needs no browser');
  const g = ship();
  const view = buildShipView(g.sea[0], 'sailing');
  const groups = view.group.children[0].children; // hull, hold, deck, props, cabin, helm, quarters
  const seen = () => groups.map((o) => o.visible ? 1 : 0).join('');
  view.setLevel(null);
  assert.equal(seen(), '1011110', 'from outside: hull, deck, props, cabin and helm');
  view.setLevel('hold');
  assert.equal(seen(), '1100000', 'in the hold: only the hull and the hold, cut away from above');
  view.setLevel('deck');
  assert.equal(seen(), '1011110');
  view.setLevel('helm');
  assert.equal(seen(), '1011110');
  view.setLevel('quarters');
  assert.equal(seen(), '1010101', 'in the quarters: the roof and the deck props are lifted off and the furniture shows');
  assert.equal(view.level, 'quarters');
  assert.equal(view.state.frames.length, 3);
  assert.doesNotThrow(() => view.setPortraits(['https://avatars.githubusercontent.com/u/1', '', null]));
});

test('the sea is cut away in the shape of the hull while he is in the hold, and closed again after', async () => {
  const { setSeaHole } = await import('../public/js/scene.js');
  const sea = makeSea(), g = ship();
  setSeaHole(sea, g.sea[0]);
  const u = sea.material.uniforms;
  assert.equal(u.uHoleOn.value, 1);
  assert.ok(u.uHullN.value >= 20 && u.uHullN.value <= 24);
  const pts = u.uHull.value.slice(0, u.uHullN.value);
  const xs = pts.map((p) => p.x), zs = pts.map((p) => p.y);
  assert.ok(Math.min(...xs) > g.sea[0].x - 4 && Math.max(...xs) > g.sea[0].x + g.sea[0].deck.size.w, 'the hole lies where the ship lies, bow past the end of the deck');
  assert.ok(Math.min(...zs) > g.sea[0].y - 4 && Math.max(...zs) < g.sea[0].y + g.sea[0].deck.size.h + 4);
  setSeaHole(sea, null);
  assert.equal(u.uHoleOn.value, 0);
});

test('whatever stands on a ship is put in her rocking group and moves with her tilt, not only with her heave', () => {
  const g = ship();
  const view = buildShipView(g.sea[0], 'sailing');
  const { person } = makeCraft();
  view.floating.add(person);
  person.position.set(30, 2.2, 8);
  const scene = new THREE.Scene();
  scene.add(view.group);
  const height = (t) => { view.update(t, -1, null, false); scene.updateMatrixWorld(true); return person.getWorldPosition(new THREE.Vector3()).y; };
  const deckAt = (t) => { view.update(t, -1, null, false); scene.updateMatrixWorld(true); return view.floating.localToWorld(new THREE.Vector3(30, 2.2, 8)).y; };
  for (const t of [0, 1.3, 2.9, 5.1, 7.7]) assert.ok(Math.abs(height(t) - deckAt(t)) < 1e-9, `at t=${t} he is on the deck, not beside it`);
  assert.ok(Math.abs(deckAt(1.3) - deckAt(5.1)) > 0.05, 'and the deck really does move');
  // a point far down the deck swings more than one by the middle: that is the tilt a world-space sailor would clip through
  view.update(1.3, -1, null, false); scene.updateMatrixWorld(true);
  const far = view.floating.localToWorld(new THREE.Vector3(34, 2.2, 8)).y - view.floating.localToWorld(new THREE.Vector3(2, 2.2, 8)).y;
  view.update(4.1, -1, null, false); scene.updateMatrixWorld(true);
  const far2 = view.floating.localToWorld(new THREE.Vector3(34, 2.2, 8)).y - view.floating.localToWorld(new THREE.Vector3(2, 2.2, 8)).y;
  assert.ok(Math.abs(far - far2) > 0.05, 'the deck is not level while she rocks');
});

test('the sea knows the camera and the screen, so that each block of pixels can be worked out from where its ray meets the water', async () => {
  const { updateSea, SEA_PIXEL } = await import('../public/js/scene.js');
  const sea = makeSea();
  const cam = new THREE.PerspectiveCamera(60, 1400 / 900, 0.3, 5000);
  cam.position.set(10, 12, -30);
  cam.lookAt(10, 0, 0);
  const fakeRenderer = { getDrawingBufferSize: (v) => v.set(1400, 900), getPixelRatio: () => 1 };
  updateSea(sea, cam, fakeRenderer);
  const u = sea.material.uniforms;
  assert.deepEqual([u.uRes.value.x, u.uRes.value.y, u.uPixel.value], [1400, 900, SEA_PIXEL]);
  // the inverse of the view-projection takes the middle of the screen, far end, back to a point on the line the camera is looking along
  const near = new THREE.Vector4(0, 0, -1, 1).applyMatrix4(u.uInvVP.value), far = new THREE.Vector4(0, 0, 1, 1).applyMatrix4(u.uInvVP.value);
  const dir = new THREE.Vector3(far.x / far.w - near.x / near.w, far.y / far.w - near.y / near.w, far.z / far.w - near.z / near.w).normalize();
  assert.ok(dir.y < 0 && Math.abs(dir.x) < 0.01 && dir.z > 0, `looks down and forward: ${dir.toArray()}`);
  // where that ray meets the water, as the shader works it out
  const t = -cam.position.y / dir.y, hit = cam.position.clone().addScaledVector(dir, t);
  assert.ok(Math.abs(hit.x - 10) < 0.05 && Math.abs(hit.y) < 1e-6 && hit.z > -30 && hit.z < 1, `a point of the water in front of the camera: ${hit.toArray()}`);
  updateSea(sea, cam, { getDrawingBufferSize: (v) => v.set(2800, 1800), getPixelRatio: () => 2 });
  assert.equal(u.uPixel.value, SEA_PIXEL * 2, 'the same size of pixel on a sharp screen');
});
