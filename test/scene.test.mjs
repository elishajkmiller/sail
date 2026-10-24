import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../public/vendor/three.module.min.js';
import * as treemap from '../public/js/treemap.js';
import { Atlas } from '../public/js/atlas.js';
import { Game } from '../public/js/game.js';
import { hullFor, shipLines } from '../public/js/deck.js';
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
  assert.ok(u.uHullN.value >= 20 && u.uHullN.value <= 96, 'the whole outline of the waterline, within what the shader holds');
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

test('the sea knows the camera and the picture it draws into, so that each block of pixels can be worked out from where its ray meets the water', async () => {
  const { updateSea } = await import('../public/js/scene.js');
  const sea = makeSea();
  const cam = new THREE.PerspectiveCamera(60, 1400 / 900, 0.3, 5000);
  cam.position.set(10, 12, -30);
  cam.lookAt(10, 0, 0);
  updateSea(sea, cam, new THREE.Vector2(466, 300), 1);
  const u = sea.material.uniforms;
  assert.deepEqual([u.uRes.value.x, u.uRes.value.y, u.uPixel.value], [466, 300, 1]);
  const near = new THREE.Vector4(0, 0, -1, 1).applyMatrix4(u.uInvVP.value), far = new THREE.Vector4(0, 0, 1, 1).applyMatrix4(u.uInvVP.value);
  const dir = new THREE.Vector3(far.x / far.w - near.x / near.w, far.y / far.w - near.y / near.w, far.z / far.w - near.z / near.w).normalize();
  assert.ok(dir.y < 0 && Math.abs(dir.x) < 0.01 && dir.z > 0, `looks down and forward: ${dir.toArray()}`);
  const t = -cam.position.y / dir.y, hit = cam.position.clone().addScaledVector(dir, t);
  assert.ok(Math.abs(hit.x - 10) < 0.05 && Math.abs(hit.y) < 1e-6 && hit.z > -30 && hit.z < 1, `a point of the water in front of the camera: ${hit.toArray()}`);
  updateSea(sea, cam, new THREE.Vector2(2800, 1800), 6);
  assert.deepEqual([u.uRes.value.x, u.uPixel.value], [2800, 6]);
});

test('the sea moves smoothly: its time is not cut into steps', async () => {
  const sea = makeSea();
  assert.ok(!/floor\(uTime/.test(sea.material.fragmentShader), 'no stop-motion');
  assert.ok(/float tt = uTime;/.test(sea.material.fragmentShader));
});

test('the picture is drawn small, stretched with hard edges, and the text is drawn after it, sharp', async () => {
  const { PixelPass, PIXEL, LABELS, textSprite, toonGradient } = await import('../public/js/scene.js');
  const calls = [];
  const fake = { setRenderTarget: (t) => calls.push(['target', t ? 'low' : 'screen']), clear: () => calls.push(['clear']), render: (s, c) => calls.push(['render', s.type, [...Array(2).keys()].map((l) => c.layers.isEnabled(l)).join('')]), clearDepth: () => calls.push(['clearDepth']), autoClear: true };
  const pass = new PixelPass(fake);
  pass.resize(1400, 900);
  assert.deepEqual([pass.size.x, pass.size.y], [Math.floor(1400 / PIXEL), Math.floor(900 / PIXEL)]);
  assert.equal(pass.target.texture.magFilter, THREE.NearestFilter, 'no smoothing: the pixels have hard edges');
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera();
  scene.background = new THREE.Color(0x123456);
  const seen = [];
  fake.render = ((was) => (s, c) => { seen.push(s.background ? 'background' : 'none'); was(s, c); })(fake.render);
  pass.render(scene, cam);
  assert.deepEqual(seen, ['background', 'none', 'none'], 'the background is drawn into the small picture only: it must not wipe the big one');
  assert.equal(scene.background.getHex(), 0x123456, 'and is put back');
  assert.deepEqual(calls.map((c) => c.join(':')), ['target:low', 'clear', 'render:Scene:truefalse', 'target:screen', 'clear', 'render:Scene:truefalse', 'clearDepth', 'render:Scene:falsetrue']);
  assert.equal(fake.autoClear, true);
  // (the second picture is the flat quad that shows the small one, drawn with its own camera; the third is the text, on layer 1 only)
  assert.equal(cam.layers.isEnabled(0) && !cam.layers.isEnabled(LABELS), true, 'the camera is left as it was');
  assert.equal(toonGradient().image.data.length, 4, 'the light comes in four flat steps');
});

test('the sail hangs from the top of the mast, and no mast stands in or above anything it should not', () => {
  const box = (o) => new THREE.Box3().setFromObject(o);
  const { boat } = makeCraft();
  const [hull, mast, yard, sail] = boat.children;
  const m = box(mast), y = box(yard), s = box(sail), h = box(hull);
  const deckAtMast = shipLines({ w: 9, h: 3.6 }, { castle: false }).rail(0) * 0.55;
  assert.ok(Math.abs(m.min.y - deckAtMast) < 0.05 && m.min.y < h.max.y, `the boat's mast starts on her deck at the mast, not inside the hull: ${m.min.y} vs ${deckAtMast}`);
  assert.ok(m.max.y - y.max.y < 0.35 && m.max.y >= y.max.y - 0.01, 'the mast ends at the yard: no extra stick above the sail');
  assert.ok(Math.abs(s.max.y - y.max.y) < 0.25, 'the sail hangs from the yard');
  assert.ok(s.min.y > deckAtMast + 1.5, 'and well clear of her deck: the foot of the sail does not touch the floor');
  const g = ship();
  const view = buildShipView(g.sea[0], 'sailing');
  const parts = view.group.children[0].children[3].children; // the deck props
  const cyl = parts.filter((o) => o.geometry?.type === 'CylinderGeometry').map((o) => [o, box(o)]);
  const tall = cyl.filter(([, b]) => b.max.y - b.min.y > 12).map(([, b]) => b)[0];
  const yardB = cyl.filter(([, b]) => b.max.x - b.min.x > 8 || b.max.z - b.min.z > 8).map(([, b]) => b)[0];
  const sailB = parts.filter((o) => o.geometry?.type === 'PlaneGeometry' && o.material.transparent).map(box)[0];
  assert.ok(tall && yardB && sailB, 'a mast, a yard and a sail');
  assert.ok(tall.max.y - yardB.max.y < 0.5 && tall.max.y >= yardB.max.y - 0.01, `her mast ends at the yard: ${tall.max.y} vs ${yardB.max.y}`);
  assert.ok(Math.abs(sailB.max.y - yardB.max.y) < 0.3, 'her sail hangs from the yard');
});

test('a huge ship rocks about her middle by a small angle: her bow and stern do not go under the sea', () => {
  const files = Array.from({ length: 6000 }, (_, i) => [`d${i % 40}/f${i}.c`, 100 + (i % 97) * 50]);
  const g = new Game({ atlas: new Atlas(), now: () => 1_790_000_000 });
  g.moor({ repo: { owner: 'big', name: 'kernel', fullName: 'big/kernel', stars: 9000, language: 'C', pushedAt: 1_789_000_000, archived: false, defaultBranch: 'main', can: {} }, files, partial: null, item: treemap.build(files), issues: [], moreIssues: false, checks: { total: 0, failed: [] }, notes: [] });
  const { deck } = g.sea[0], L = deck.lines;
  assert.ok(deck.size.h * 2.2 < deck.size.w, `she is long, not a box: ${deck.size.w} by ${deck.size.h}`);
  const rig = buildShipView(g.sea[0], 'sailing'), top = new THREE.Box3().setFromObject(rig.group).max.y;
  assert.ok(top > 0.18 * L.L, `her mast is in step with her length: ${top.toFixed(0)} m over a hull of ${L.L.toFixed(0)} m`);
  for (const condition of ['sailing', 'wreck']) {
    const view = buildShipView(g.sea[0], condition), scene = new THREE.Scene();
    scene.add(view.group);
    for (const t of [0, 1.1, 2.3, 4.9, 8.2, 13.7]) {
      view.update(t, -1, null, false); scene.updateMatrixWorld(true);
      view.update(t, -1, null, false);
      const middle = view.floating.localToWorld(new THREE.Vector3((L.x0 + L.x1) / 2, 2.2, L.cy)).y;
      for (const x of [L.x0, L.x1]) assert.ok(Math.abs(view.floating.localToWorld(new THREE.Vector3(x, 2.2, L.cy)).y - middle) < (condition === "wreck" ? 3.8 : 1.2), `${condition}: the end of her deck stays near the middle's height at t=${t}`);
    }
  }
});
