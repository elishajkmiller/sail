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
