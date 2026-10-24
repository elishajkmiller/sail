import test from 'node:test';
import assert from 'node:assert/strict';
import { Atlas, GAP, hullLength } from '../public/js/atlas.js';

const found = (names, stars = 500) => names.map((name, i) => ({ name, score: 1 - i * 0.06, shared: 20 - i, stars, language: 'Rust', pushedAt: 100 }));
const names = (n, p = 'o') => Array.from({ length: n }, (_, i) => `${p}/r${i}`);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

test('a ship that is opened gets her neighbours around her, nearer the stronger the tie, and none on top of another', () => {
  const a = new Atlas();
  const fresh = a.addExpansion({ name: 'deck/mast', stars: 900 }, found(names(14)));
  assert.equal(fresh.length, 14);
  const c = a.get('deck/mast');
  assert.deepEqual([c.x, c.y], [0, 0], 'the first ship lies at the middle');
  for (const n of c.neighbours) assert.ok(a.placed(a.get(n.name)), n.name);
  assert.ok(c.neighbours.every((n) => n.score > 0 && n.score <= 1) && c.neighbours[0].score === 1, 'scores are relative to the strongest');
  const ds = names(14).map((n) => dist(a.get(n), c));
  assert.ok(ds.every((d) => d >= GAP * 0.99), `none nearer than the gap: ${Math.min(...ds)}`);
  assert.ok(ds[0] < ds[13], 'the strongest tie is nearer than the weakest');
  const all = [...a.entries.values()];
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) assert.ok(dist(all[i], all[j]) > 20, `${all[i].name} on top of ${all[j].name}`);
});

test('the same ship opened again gives the same map', () => {
  const make = () => { const a = new Atlas(); a.addExpansion({ name: 'deck/mast', stars: 9 }, found(names(10))); return [...a.entries.values()].map((e) => [e.name, e.x, e.y]); };
  assert.deepEqual(make(), make());
});

test('a ship tied to two opened ships lies between them, and the map grows outward from the second', () => {
  const a = new Atlas();
  a.addExpansion({ name: 'a/one', stars: 500 }, found(['b/two', ...names(8, 'x')]));
  const two = a.get('b/two');
  a.addExpansion({ name: 'b/two', stars: 500 }, [{ name: 'shared/kin', score: 1, shared: 9, stars: 100 }, ...found(names(8, 'y'))]);
  a.addExpansion({ name: 'a/one', stars: 500 }, [{ name: 'shared/kin', score: 0.9, shared: 9, stars: 100 }]);
  const kin = a.get('shared/kin'), one = a.get('a/one');
  assert.ok(a.placed(kin));
  const d1 = dist(kin, two), d2 = dist(kin, one);
  assert.ok(d1 < dist(one, two) + GAP * 3 && d2 < dist(one, two) + GAP * 3, `near both: ${d1} ${d2}`);
  assert.ok(names(8, 'y').every((n) => a.placed(a.get(n))), 'the second ship has her own neighbours now');
  assert.ok(a.get('x/r0') && dist(a.get('x/r0'), one) >= GAP * 0.99);
  assert.ok(a.get('a/one').x === 0 && a.get('a/one').y === 0, 'what was placed stays where it was');
});

test('a ship that nothing ties to the map is put in free water near a point', () => {
  const a = new Atlas();
  a.addExpansion({ name: 'deck/mast', stars: 900 }, found(names(14)));
  const e = a.placeFree(a.upsert({ name: 'new/ship', stars: 100 }), 10, 10);
  assert.ok(a.placed(e));
  for (const o of a.entries.values()) if (o !== e) assert.ok(dist(o, e) > 20);
});

test('queries find ships by place', () => {
  const a = new Atlas();
  a.addExpansion({ name: 'deck/mast', stars: 900 }, found(names(14)));
  assert.equal(a.dotsIn(-1000, -1000, 1000, 1000).length, 15);
  assert.equal(a.dotsIn(5000, 5000, 6000, 6000).length, 0);
  assert.equal(a.dotUnder(0, 0).name, 'deck/mast');
  assert.equal(a.dotUnder(2000, 2000), null);
  const c = a.get('deck/mast');
  assert.deepEqual(a.near(0, 0, 400).slice(0, 1).map((e) => e.name), ['deck/mast']);
  assert.ok(a.near(0, 0, 400).every((e) => dist(e, { x: 0, y: 0 }) <= 400));
  assert.ok(hullLength(0) < hullLength(1e6) && hullLength(1e9) <= 80 && hullLength(0) >= 24);
  assert.ok(c);
});

test('the map is kept and read back, and junk in a saved map is ignored', () => {
  const a = new Atlas();
  a.addExpansion({ name: 'deck/mast', stars: 900 }, found(names(5)));
  const b = Atlas.fromJSON(JSON.parse(JSON.stringify(a)));
  assert.equal(b.size, a.size);
  for (const e of a.entries.values()) {
    const f = b.get(e.name);
    assert.ok(Math.abs(f.x - e.x) < 0.06 && Math.abs(f.y - e.y) < 0.06, e.name);
  }
  assert.equal(b.dotUnder(0, 0).name, 'deck/mast', 'the index is rebuilt');
  assert.ok(b.incoming.get('o/r0'), 'and who lists whom');
  const junk = Atlas.fromJSON({ v: 1, entries: [{ name: '../evil' }, { name: 'ok/fine', x: 1, y: 2 }, null, { name: 5 }] });
  assert.deepEqual([...junk.entries.keys()], ['ok/fine']);
  assert.equal(Atlas.fromJSON({ v: 9 }).size, 0);
  assert.equal(Atlas.fromJSON(null).size, 0);
});
