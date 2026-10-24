import test from 'node:test';
import assert from 'node:assert/strict';
import * as treemap from '../public/js/treemap.js';
import { Deck, deckSize, hullFor, hullContains, hullDepth, MARGIN, RAIL, crackDistance } from '../public/js/deck.js';

const area = (r) => r.w * r.h;
const R = { x: 10, y: 20, w: 400, h: 300 };

test('squarified rows fill the rectangle without overlap and follow the sizes', () => {
  const weights = [50, 30, 20, 10, 5, 5, 1];
  const cells = treemap.squarify(weights, R);
  assert.equal(cells.length, weights.length);
  assert.ok(Math.abs(cells.reduce((s, c) => s + area(c), 0) - area(R)) < 1);
  for (const c of cells) assert.ok(c.x >= R.x - 0.01 && c.y >= R.y - 0.01 && c.x + c.w <= R.x + R.w + 0.01 && c.y + c.h <= R.y + R.h + 0.01);
  for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) {
    const a = cells[i], b = cells[j];
    const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    assert.ok(!(ox > 0.01 && oy > 0.01), `${i} overlaps ${j}`);
  }
  assert.ok(Math.abs(area(cells[0]) / area(R) - 50 / 121) < 0.001);
  assert.deepEqual(treemap.squarify([], R), []);
  assert.ok(treemap.squarify([1, 2], { x: 0, y: 0, w: 0, h: 10 }).every((c) => c.w === 0 && c.h === 0));
});

const files = [['src/main/java/A.java', 600], ['src/main/java/B.java', 300], ['README.md', 100], ['docs/guide.md', 200], ['docs/empty.md', 0]];

test('folders that hold one folder are joined, and every file is a room inside its folder', () => {
  const root = treemap.build(files);
  assert.equal(root.size, 1200);
  assert.deepEqual(root.kids.map((k) => k.name), ['README.md', 'docs', 'src/main/java']);
  const cells = treemap.layout(root, { x: 0, y: 0, w: 80, h: 60 }, 0.1);
  assert.deepEqual(cells.filter((c) => c.file !== null).map((c) => c.file).sort(), [0, 1, 2, 3, 4], 'even the empty file has its sliver');
  const java = cells.find((c) => c.label === 'src/main/java');
  for (const c of cells.filter((c) => c.file === 0 || c.file === 1)) {
    assert.ok(c.rect.x >= java.rect.x && c.rect.x + c.rect.w <= java.rect.x + java.rect.w + 1e-6 && c.rect.y >= java.rect.y && c.rect.y + c.rect.h <= java.rect.y + java.rect.h + 1e-6);
    assert.equal(c.depth, java.depth + 1);
  }
  const a = cells.find((c) => c.file === 0), b = cells.find((c) => c.file === 1);
  assert.ok(area(a.rect) > area(b.rect) * 1.8, '600 bytes take about twice the room of 300');
  assert.ok(treemap.layout(root, { x: 0, y: 0, w: 80, h: 60 }, 3).every((c) => c.file !== 4), 'a sliver under the minimum is left out');
});

test('a big repo is laid out quickly', () => {
  const big = Array.from({ length: 60000 }, (_, i) => [`d${i % 40}/e${Math.floor(i / 40) % 30}/f${i}.rs`, 100 + ((i * 7919) % 5000)]);
  const t = Date.now();
  const cells = treemap.layout(treemap.build(big), { x: 0, y: 0, w: 300, h: 165 }, 0.3);
  assert.ok(cells.length > 0 && Date.now() - t < 5000, `took ${Date.now() - t} ms`);
});

const issue = (number, f, comments = 0) => ({ number, files: f, comments });
const mk = (issues) => new Deck(files, treemap.build(files), issues);

test('a bigger repo is a longer ship, within limits', () => {
  assert.equal(deckSize(0).w, 35);
  assert.ok(deckSize(100).w > deckSize(10).w);
  assert.equal(deckSize(1e7).w, 300);
  const s = deckSize(400);
  assert.ok(Math.abs(s.h / s.w - 0.55) < 1e-9);
});

test('the hull holds the deck, and a point far away is put back aboard', () => {
  const d = mk([]);
  assert.ok(d.contains({ x: d.size.w / 2, y: d.size.h / 2 }) && d.contains(d.spawn));
  assert.ok(d.contains({ x: 0, y: 0 }, 0.5) && d.contains({ x: d.size.w, y: d.size.h }, 0.5), 'the corners of the deck are inside the hull');
  assert.ok(!d.contains({ x: -30, y: 10 }) && !d.contains({ x: d.size.w + 100, y: 0 }));
  for (const far of [{ x: -400, y: 2 }, { x: d.size.w * 3, y: d.size.h / 2 }, { x: 15, y: 500 }, { x: 15, y: -500 }]) {
    const q = d.clamp(far);
    assert.ok(d.contains(q, RAIL - 0.01), `${JSON.stringify(far)} was put at ${JSON.stringify(q)}`);
  }
  assert.deepEqual(d.clamp({ x: 5, y: 5 }), { x: 5, y: 5 });
  assert.ok(d.bow.x > d.size.w, 'the bow reaches past the end of the deck');
  assert.ok(hullDepth(d.hull, { x: d.size.w / 2, y: d.size.h / 2 }) > 5);
  assert.ok(hullDepth(d.hull, { x: -100, y: 0 }) < 0);
});

test('every station is on the deck', () => {
  const d = mk([]);
  assert.deepEqual(d.stations.map((s) => s.id), ['flag', 'tavern', 'wheel']);
  for (const s of d.stations) assert.ok(d.contains(s, RAIL), s.id);
  assert.equal(d.stationNear(d.stations[1], 1).id, 'tavern');
  assert.equal(d.stationNear({ x: 20, y: 3 }, 2), null);
});

test('rooms are found by where they are', () => {
  const d = mk([]);
  const i = d.fileCell.get(0), c = d.cells[i].rect;
  assert.equal(d.roomAt({ x: c.x + c.w / 2, y: c.y + c.h / 2 }), i);
  assert.equal(d.roomAt({ x: -3, y: -3 }), -1, 'the hull is not a room');
});

test('every place an issue touches is cracked, and one that names no file cracks the hull', () => {
  const issues = [issue(4, ['src/main/java/A.java', 'README.md']), issue(5, []), issue(6, ['no/such/file.rs'])];
  const d = mk(issues);
  assert.equal(d.cracks.length, 4, 'two rooms for #4, the hull for #5 and for #6 (its file is not on the ship)');
  const rooms = d.cracks.filter((c) => c.file !== null);
  assert.equal(rooms.length, 2);
  for (const c of rooms) {
    const r = d.cells[d.fileCell.get(c.file)].rect, s = c.pts[0];
    assert.ok(s.x >= r.x - 0.01 && s.x <= r.x + r.w + 0.01 && s.y >= r.y - 0.01 && s.y <= r.y + r.h + 0.01, 'the crack begins in its room');
  }
  for (const c of d.cracks.filter((c) => c.file === null)) {
    assert.ok(c.pts[0].y < 0 || c.pts[0].y > d.size.h, 'a hull crack is along the side, not on the deck');
    assert.ok(d.contains(c.pts[0]), 'and on the ship');
  }
  const again = mk(issues);
  assert.deepEqual(d.cracks.map((c) => c.pts), again.cracks.map((c) => c.pts), 'the same cracks every time');
  assert.ok(d.cracks.every((c) => c.pts.length >= 8 && c.branch.length > 0 && c.width > 0.1));
});

test('a busy issue cracks deeper, and a crack is found when he is beside it', () => {
  const span = (c) => c.pts.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - c.pts[i].x, p.y - c.pts[i].y), 0);
  assert.ok(span(mk([issue(9, [], 10)]).cracks[0]) > span(mk([issue(9, [], 0)]).cracks[0]) * 1.4);
  const d = mk([issue(4, ['src/main/java/A.java'])]);
  const c = d.cracks[0], at = c.pts[3];
  assert.ok(crackDistance(c, at) < 1e-9);
  assert.equal(d.crackNear({ x: at.x, y: at.y + 0.3 }, 1), 0);
  assert.equal(d.crackNear({ x: at.x + 90, y: at.y + 90 }, 1), -1);
});

test('many files and many issues build quickly', () => {
  const big = Array.from({ length: 30000 }, (_, i) => [`d${i % 40}/e${Math.floor(i / 40) % 30}/f${i}.rs`, 100 + ((i * 7919) % 5000)]);
  const issues = Array.from({ length: 100 }, (_, i) => issue(i + 1, [big[(i * 37) % big.length][0]], i % 7));
  const t = Date.now();
  const d = new Deck(big, treemap.build(big), issues);
  assert.ok(d.cells.length > 0 && d.cracks.length > 0 && Date.now() - t < 5000);
});

test('the hull is convex and clockwise', () => {
  const hull = hullFor({ w: 80, h: 44 });
  assert.ok(hullContains(hull, { x: 40, y: 22 }, MARGIN));
  assert.ok(!hullContains(hull, { x: 40, y: 22 + 22 + MARGIN + 0.1 }));
});
