import test from 'node:test';
import assert from 'node:assert/strict';
import * as treemap from '../public/js/treemap.js';
import { Deck, deckSize, hullFor, holdHullFor, shipLines, hullContains, hullDepth, MARGIN, RAIL, HOLD_RAIL, LEVELS, levelY, DECK_Y, HOLD_Y, crackDistance } from '../public/js/deck.js';

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
const mk = (issues, talk = null, list = files) => new Deck(list, treemap.build(list), issues, talk);
const many = (n) => Array.from({ length: n }, (_, i) => [`d${i % 40}/e${Math.floor(i / 40) % 30}/f${i}.rs`, 100 + ((i * 7919) % 5000)]);

test('a bigger repo is a longer ship, within limits', () => {
  assert.equal(deckSize(0).w, 35);
  assert.ok(deckSize(100).w > deckSize(10).w);
  assert.equal(deckSize(1e7).w, 300);
});

test('she has three storeys, and a person can stand up in the hold', () => {
  assert.deepEqual(LEVELS, ['hold', 'deck', 'helm', 'quarters']);
  assert.ok(levelY('hold') === HOLD_Y && levelY('deck') === DECK_Y && levelY('helm') > DECK_Y + 2 && levelY('quarters') === DECK_Y);
  assert.ok(DECK_Y - HOLD_Y > 3.5);
});

test('the hull is a real ship\'s: a long pointed bow, a squarer stern, fullest amidships, a keel that rises forward and a rail that sweeps up', () => {
  for (const n of [0, 100, 2000]) {
    const size = deckSize(n), L = shipLines(size);
    assert.ok(L.beam(L.x1) === 0 && L.beam(L.x1 - 0.01) < 1.2, 'it comes to a point');
    assert.ok(L.beam(L.x0) > 0.75 * L.bmax && L.beam(L.x0) < L.bmax, 'the stern is nearly as wide as the middle, and a little narrower');
    assert.equal(L.beam(L.xs), L.bmax, 'fullest amidships');
    assert.ok(L.beam((L.xs + L.x1) / 2) < L.beam(L.xs) && L.beam(L.x1 - 2) < L.beam((L.xs + L.x1) / 2), 'and it narrows steadily forward');
    assert.ok(L.keel(L.x0) > L.keel(L.x1) + 2, 'the keel is deep aft and comes up forward');
    assert.ok(L.rail(L.x1) > L.rail(L.xs) + 1.5, 'the rail sweeps up at the bow');
    assert.ok(L.lateral(L.xs, DECK_Y + 0.5) > L.lateral(L.xs, 0.5) && L.lateral(L.xs, 0.5) > L.lateral(L.xs, -2.5), 'the side flares out as it rises and the hull curves in below the water');
    assert.ok(L.lateral(L.xs, -L.keel(L.xs)) < 0.01, 'and closes at the keel');
    // convex, so that "inside the hull" is simple
    const hull = hullFor(size), turn = (a, b, c) => (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    const signs = hull.map((p, i) => Math.sign(Math.round(turn(p, hull[(i + 1) % hull.length], hull[(i + 2) % hull.length]) * 1e6)));
    assert.ok(!(signs.includes(1) && signs.includes(-1)), 'the outline is convex');
    assert.ok(hull.length >= 36, 'and smooth');
  }
});

test('the file rooms fit inside the hold, whatever the size of the ship', () => {
  for (const n of [3, 100, 2000]) {
    const d = mk([], null, many(n)), P = d.plan;
    for (const p of [{ x: P.x, y: P.y }, { x: P.x + P.w, y: P.y }, { x: P.x, y: P.y + P.h }, { x: P.x + P.w, y: P.y + P.h }, { x: P.x + P.w / 2, y: P.y + P.h / 2 }]) assert.ok(d.contains('hold', p), `n=${n}: ${JSON.stringify(p)} is in the hold`);
    for (const c of d.cells.filter((c) => c.file !== null).slice(0, 300)) assert.ok(c.rect.x >= P.x - 1e-6 && c.rect.x + c.rect.w <= P.x + P.w + 1e-6 && c.rect.y >= P.y - 1e-6 && c.rect.y + c.rect.h <= P.y + P.h + 1e-6, 'every room is inside the plan');
  }
});

test('the whole back of the ship is the castle: the helm on its roof, the captain\'s quarters under it, and the deck begins forward of it', () => {
  const d = mk([]), c = d.castle, L = d.lines;
  assert.ok(c.x0 === L.x0 && c.x1 > c.x0 + 6, 'it starts at the transom and is several metres long');
  // across the full width: a point near either side of the castle is inside it, and not on the deck
  for (const side of [-1, 1]) {
    const p = { x: (c.x0 + c.x1) / 2, y: L.cy + side * (L.beam((c.x0 + c.x1) / 2) - 2) };
    assert.ok(d.contains('helm', p) && d.contains('quarters', p) && !d.contains('deck', p), 'at the sides too: there is no way round it');
  }
  assert.ok(!d.contains('deck', { x: c.x1, y: L.cy }) && d.contains('deck', { x: c.x1 + 1, y: L.cy }));
  const pushed = d.clamp('deck', { x: c.x1 - 3, y: L.cy + 4 });
  assert.ok(d.contains('deck', pushed) && Math.abs(pushed.y - (L.cy + 4)) < 0.05, 'pushed out at the front, sliding along it');
  const out = d.clamp('quarters', { x: c.x1 + 20, y: L.cy });
  assert.ok(d.contains('quarters', out) && out.x < c.x1);
  assert.ok(d.castle.poly.length >= 12);
});

test('a point far away is put back aboard on every storey', () => {
  const d = mk([]);
  for (const level of ['deck', 'hold', 'helm', 'quarters']) for (const far of [{ x: -400, y: 2 }, { x: d.size.w * 3, y: d.size.h / 2 }, { x: 15, y: 500 }, { x: 15, y: -500 }]) {
    const q = d.clamp(level, far);
    assert.ok(d.contains(level, q), `${level}: ${JSON.stringify(far)} was put at ${JSON.stringify(q)}`);
  }
  const mid = d.spawn;
  assert.deepEqual(d.clamp('deck', mid), mid);
});

test('every station is where its level can be stood on, and every stair leads to a place that can', () => {
  for (const n of [3, 100, 2000]) {
    const d = mk([], null, many(n));
    assert.deepEqual([...new Set(d.stations.map((s) => s.id))].sort(), ['desk', 'door', 'flag', 'hatch', 'ladder', 'out', 'stairsDown', 'stairsDown2', 'stairsUp', 'stairsUp2', 'table', 'wheel']);
    for (const s of d.stations) {
      assert.ok(d.contains(s.level, s), `n=${n}: ${s.id} is on its level`);
      if (s.to) assert.ok(d.contains(s.to.level, s.to), `n=${n}: ${s.id} leads to a place on ${s.to.level}`);
    }
  }
  const d = mk([]);
  assert.deepEqual(d.stationsOf('helm').map((s) => s.id).sort(), ['stairsDown', 'stairsDown2', 'wheel']);
  assert.deepEqual(d.stationsOf('quarters').map((s) => s.id).sort(), ['desk', 'out']);
  assert.deepEqual(d.stationsOf('hold').map((s) => s.id), ['ladder']);
  assert.equal(d.stationNear('hold', d.station('flag'), 1), null, 'a station is only on its own level');
  assert.equal(d.station('hatch').to.level, 'hold');
  assert.equal(d.station('stairsUp').to.level, 'helm');
  assert.ok(d.station('stairsUp').y < d.lines.cy && d.station('stairsUp2').y > d.lines.cy, 'a stair on each side');
  assert.ok(Math.hypot(d.station('ladder').to.x - d.hatch.x, d.station('ladder').to.y - d.hatch.y) < 4);
});

test('the discussions are tables on the deck, one each, labelled with their titles', () => {
  const talk = { enabled: true, list: Array.from({ length: 5 }, (_, i) => ({ number: 10 + i, title: `question ${i}`, comments: i })) };
  const d = mk([], talk, many(200));
  assert.equal(d.tables.length, 5);
  assert.deepEqual(d.tables.map((t) => [t.index, t.number, t.title, t.kind]), talk.list.map((x, i) => [i, x.number, x.title, 'talk']));
  const pts = d.tables.map((t) => `${t.x.toFixed(1)},${t.y.toFixed(1)}`);
  assert.equal(new Set(pts).size, 5, 'each has its own place');
  for (const t of d.tables) { assert.ok(d.contains('deck', t, 2), 'on the deck, clear of the rail'); assert.ok(Math.hypot(t.x - d.station('flag').x, t.y - d.station('flag').y) > 4); }
  for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) assert.ok(Math.hypot(d.tables[i].x - d.tables[j].x, d.tables[i].y - d.tables[j].y) > 4, 'tables are not on top of each other');
  assert.equal(d.stationNear('deck', d.tables[2], 1).index, 2);
  // twelve at most
  const lots = mk([], { enabled: true, list: Array.from({ length: 40 }, (_, i) => ({ number: i, title: 't' + i, comments: 0 })) }, many(2000));
  assert.equal(lots.tables.length, 12);
  // no token, none, and off: one table that says which
  assert.deepEqual([mk([]).tables.map((t) => t.kind), mk([], { enabled: true, list: [] }).tables.map((t) => t.kind), mk([], { enabled: false, list: [] }).tables.map((t) => t.kind)], [['locked'], ['empty'], ['off']]);
  // and they can change as the talk arrives
  const e = mk([]);
  e.setTables(talk);
  assert.equal(e.tables.length, Math.min(5, e.tableSpots().length));
  assert.ok(e.tables.every((t) => t.kind === 'talk'));
});

test('rooms are found by where they are, in the hold', () => {
  const d = mk([]);
  const i = d.fileCell.get(0), c = d.cells[i].rect;
  assert.equal(d.roomAt({ x: c.x + c.w / 2, y: c.y + c.h / 2 }), i);
  assert.equal(d.roomAt({ x: -30, y: -30 }), -1);
});

test('every place an issue touches is cracked, in the hold, and one that names no file cracks the wall of the hold', () => {
  const issues = [issue(4, ['src/main/java/A.java', 'README.md']), issue(5, []), issue(6, ['no/such/file.rs'])];
  const d = mk(issues);
  assert.equal(d.cracks.length, 4, 'two rooms for #4, the wall for #5 and for #6 (its file is not on the ship)');
  const rooms = d.cracks.filter((c) => c.file !== null);
  assert.equal(rooms.length, 2);
  for (const c of rooms) {
    const r = d.cells[d.fileCell.get(c.file)].rect, s = c.pts[0];
    assert.ok(s.x >= r.x - 0.01 && s.x <= r.x + r.w + 0.01 && s.y >= r.y - 0.01 && s.y <= r.y + r.h + 0.01, 'the crack begins in its room');
  }
  for (const c of d.cracks.filter((c) => c.file === null)) assert.ok(d.contains('hold', c.pts[0]), 'a wall crack is where he can walk in the hold');
  assert.deepEqual(d.cracks.map((c) => c.pts), mk(issues).cracks.map((c) => c.pts), 'the same cracks every time');
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
  const big = many(30000);
  const issues = Array.from({ length: 100 }, (_, i) => issue(i + 1, [big[(i * 37) % big.length][0]], i % 7));
  const t = Date.now();
  const d = new Deck(big, treemap.build(big), issues);
  assert.ok(d.cells.length > 0 && d.cracks.length > 0 && Date.now() - t < 5000);
});

test('the hold floor is narrower than the deck, and ends where the keel comes up', () => {
  const size = deckSize(100), deck = hullFor(size), hold = holdHullFor(size);
  const width = (poly) => Math.max(...poly.map((p) => p.y)) - Math.min(...poly.map((p) => p.y));
  assert.ok(width(hold) < width(deck) && width(hold) > 0.8 * width(deck));
  assert.ok(Math.max(...hold.map((p) => p.x)) < Math.max(...deck.map((p) => p.x)) - 10, 'the hold stops well short of the point of the bow');
  assert.ok(hullDepth(hold, { x: 20, y: size.h / 2 }) > 5 && RAIL < HOLD_RAIL && MARGIN > 0);
  assert.ok(hullContains(deck, { x: 20, y: size.h / 2 }, 5));
});
