import test from 'node:test';
import assert from 'node:assert/strict';
import * as treemap from '../public/js/treemap.js';
import { Atlas } from '../public/js/atlas.js';
import { Game, WALK, REACH, BOAT_TOP } from '../public/js/game.js';
import { MARGIN } from '../public/js/deck.js';

const FILES = [['src/main.rs', 900], ['src/lib.rs', 300], ['README.md', 50]];
const ISSUES = [
  { number: 4, title: 'panic in src/main.rs', files: ['src/main.rs', 'README.md'], comments: 3, body: '', author: 'gull', createdAt: 0, labels: [] },
  { number: 5, title: 'general grumble', files: [], comments: 0, body: '', author: '', createdAt: 0, labels: [] },
];
const data = (fullName, files = FILES, issues = ISSUES) => {
  const [owner, name] = fullName.split('/');
  return { repo: { owner, name, fullName, stars: 42, language: 'Rust', pushedAt: 1_780_000_000, archived: false, defaultBranch: 'main', can: {} }, files, partial: null, item: treemap.build(files), issues, moreIssues: false, checks: { total: 0, failed: [] }, notes: [] };
};
const fresh = () => { const g = new Game({ atlas: new Atlas(), now: () => 1_790_000_000 }); g.moor(data('deck/mast')); return g; };
const run = (g, input, seconds) => { for (let t = 0; t < seconds; t += 0.02) g.step(0.02, input); };
const none = {};

test('a ship comes into the sea with her deck and cracks, and the boat is put off her stern', () => {
  const g = fresh();
  assert.equal(g.sea.length, 1);
  assert.equal(g.sea[0].deck.cracks.length, 3, '#4 cracks two rooms and #5 the hull');
  assert.equal(g.aboard, null);
  assert.ok(g.boat.x < g.sea[0].x - MARGIN, 'off her stern');
  assert.deepEqual(g.events.map((e) => e.type), ['arrived']);
  const again = g.moor(data('deck/mast'));
  assert.equal(g.sea.length, 1, 'the same repo is renewed, not added twice');
  assert.equal(again, 0);
});

test('the boat sails the way it points, keeps going, and the water slows it', () => {
  const g = fresh();
  const x0 = g.boat.x;
  run(g, { throttle: 1 }, 1);
  assert.ok(g.boat.x > x0 + 3 && Math.abs(g.boat.y - g.sea[0].y - g.sea[0].deck.size.h / 2) < 0.5, 'W pushes it the way it points');
  const speed = Math.hypot(g.boat.vx, g.boat.vy);
  assert.ok(speed > 5 && speed <= BOAT_TOP + 1, String(speed));
  run(g, none, 1);
  assert.ok(Math.hypot(g.boat.vx, g.boat.vy) < speed * 0.8 && Math.hypot(g.boat.vx, g.boat.vy) > 0, 'it drifts on, and slows');
  run(g, none, 12);
  assert.ok(Math.hypot(g.boat.vx, g.boat.vy) < 1, 'and nearly stops');
  const h = g.boat.heading;
  run(g, { steer: 1, throttle: 1 }, 1);
  assert.ok(g.boat.heading > h + 0.3, 'the rudder turns it');
  g.human = null; g.aboard = null; g.left = [];
  Object.assign(g.boat, { x: g.sea[0].x - 400, y: g.sea[0].y - 400, vx: 20, vy: 0, heading: Math.PI / 2 });
  run(g, none, 2);
  assert.ok(Math.abs(g.boat.vx) < 5, 'the keel holds it against sliding sideways');
});

test('sailing over a hull lands on her by itself, and Space takes off again', () => {
  const g = fresh();
  g.step(0.02, { leave: true });
  assert.equal(g.aboard, null, 'open water: nothing to land on');
  run(g, { throttle: 1 }, 6);
  assert.equal(g.aboard, 0, 'no key was pressed');
  assert.ok(g.human && g.sea[0].deck.contains({ x: g.human.x - g.sea[0].x, y: g.human.y - g.sea[0].y }, 0.6));
  g.step(0.02, { leave: true });
  assert.ok(g.aboard === null && g.human === null && g.left.length === 1);
  run(g, none, 1);
  assert.equal(g.aboard, null, 'it does not land straight back');
  assert.match(g.prompt, /^Space: land on deck\/mast/);
  g.boat.x = g.sea[0].x - 200;
  g.step(0.02, none);
  assert.deepEqual(g.left, [], 'clear of the hull');
  g.boat.x = g.sea[0].x + 12;
  g.step(0.02, none);
  assert.equal(g.aboard, 0, 'over the hull again, it lands');
  g.step(0.02, { leave: true });
  g.step(0.02, { leave: true });
  assert.equal(g.aboard, 0, 'and Space over the hull lands on purpose');
});

test('the guy walks the deck at walking pace and cannot walk off the ship', () => {
  const g = fresh();
  g.board(0, { x: g.sea[0].x + 3, y: g.sea[0].y + 5 });
  const x0 = g.human.x;
  run(g, { move: { x: 1, y: 0 } }, 1);
  assert.ok(Math.abs(g.human.x - x0 - WALK) < 0.3, `a second of walking is ${WALK} m: ${g.human.x - x0}`);
  run(g, { move: { x: 0, y: 1 }, boost: true }, 30);
  run(g, { move: { x: -1, y: 0 }, boost: true }, 60);
  const m = g.sea[0];
  assert.ok(m.deck.contains({ x: g.human.x - m.x, y: g.human.y - m.y }, 0.65), 'the rail stops him');
});

test('a crack beside him is read with E and closed with E or Escape', () => {
  const g = fresh();
  const crack = g.sea[0].deck.cracks.find((c) => c.file !== null);
  g.board(0, { x: g.sea[0].x + crack.pts[0].x, y: g.sea[0].y + crack.pts[0].y });
  g.step(0.02, none);
  assert.ok(g.nearCrack >= 0 && g.prompt.startsWith('E: read #4'), g.prompt);
  g.step(0.02, { interact: true });
  assert.deepEqual(g.reading, { ship: 0, issue: crack.issue });
  g.step(0.02, { interact: true });
  assert.equal(g.reading, null, 'E again closes it');
  g.step(0.02, { interact: true });
  g.step(0.02, { esc: true });
  assert.equal(g.reading, null, 'Escape closes it too');
});

test('E at a station asks for it, and E in a room asks for its file', () => {
  const g = fresh();
  const d = g.sea[0].deck;
  g.events.length = 0;
  for (const s of d.stations) {
    g.board(0, { x: g.sea[0].x + s.x, y: g.sea[0].y + s.y });
    g.step(0.02, none);
    assert.equal(g.nearStation.id, s.id);
    assert.match(g.prompt, /^E: /);
    g.step(0.02, { interact: true });
    assert.deepEqual(g.events.at(-1), { type: 'station', ship: 0, id: s.id });
  }
  const main = FILES.findIndex((f) => f[0] === 'src/main.rs');
  const c = d.cells[d.fileCell.get(main)].rect;
  g.sea[0].deck.cracks.length = 0;
  g.board(0, { x: g.sea[0].x + c.x + c.w / 2, y: g.sea[0].y + c.y + c.h / 2 });
  g.step(0.02, none);
  assert.equal(g.prompt, 'E: open src/main.rs');
  g.step(0.02, { interact: true });
  assert.deepEqual(g.events.at(-1), { type: 'file', ship: 0, file: main });
});

test('clicking an issue in the bar boards the ship and walks to its crack to read it', () => {
  const g = fresh();
  g.walkToIssue(0);
  assert.equal(g.aboard, 0);
  assert.equal(g.walkTo.read, 0);
  run(g, none, 40);
  assert.deepEqual(g.reading, { ship: 0, issue: 0 });
  assert.equal(g.walkTo, null);
});

test('a click walks him there; a double click at sea boards a ship', () => {
  const g = fresh();
  const m = g.sea[0];
  g.click({ x: m.x + 20, y: m.y + 10 }, false);
  assert.deepEqual([g.aboard, g.focus], [null, 0], 'one click only picks her');
  g.click({ x: m.x + 20, y: m.y + 10 }, true);
  assert.equal(g.aboard, 0);
  g.click({ x: m.x + 22, y: m.y + 10 }, false);
  assert.deepEqual([g.walkTo.x, g.walkTo.y], [22, 10]);
  g.click({ x: m.x - 500, y: m.y }, false);
  assert.deepEqual([g.walkTo.x, g.walkTo.y], [22, 10], 'a click in the water does nothing');
});

// two ships whose hulls overlap, as they do on a crowded sea: B laid across A's bow
function overlapping() {
  const g = fresh();
  g.moor(data('keel/hull', [['old.c', 400]]), 'quiet');
  const a = g.sea[0], b = g.sea[1];
  b.x = a.x + a.deck.size.w - 8; b.y = a.y;
  return g;
}

test('taking off where two hulls meet stays a boat, and lands by itself on a ship it was not inside', () => {
  const g = overlapping();
  const a = g.sea[0], b = g.sea[1];
  const spot = [...Array(300)].map((_, i) => ({ x: a.x + a.deck.size.w - 10 + i * 0.1, y: a.y + a.deck.size.h / 2 }))
    .find((p) => g.shipUnder(p) !== null && hullDepthBoth(g, p));
  assert.ok(spot, 'the hulls overlap');
  Object.assign(g.boat, { ...spot, heading: 0, vx: 0, vy: 0 });
  g.step(0.02, none);
  assert.notEqual(g.aboard, null, 'landed on one of the two');
  g.step(0.02, { leave: true });
  assert.ok(g.aboard === null && g.left.length === 2, `both hulls are ones he left: ${g.left}`);
  for (let i = 0; i < 50; i++) { g.step(0.02, none); assert.equal(g.aboard, null, 'not dropped onto the other ship'); }
  g.boat.x = a.x - 80;
  g.step(0.02, none);
  assert.deepEqual(g.left, [], 'clear of both');
  // taking off from A where B is not, then sailing over B: lands on B by itself
  g.boat.x = a.x + 6; g.boat.y = a.y + a.deck.size.h / 2;
  g.step(0.02, none);
  assert.equal(g.aboard, 0);
  g.step(0.02, { leave: true });
  assert.deepEqual(g.left, [0]);
  const onlyB = [...Array(400)].map((_, i) => ({ x: b.x + b.deck.size.w / 2 + i * 0.1, y: b.y + b.deck.size.h / 2 })).find((p) => g.shipUnder(p, [0]) === 1 && g.shipUnder(p) === 1);
  Object.assign(g.boat, onlyB);
  g.step(0.02, none);
  assert.equal(g.aboard, 1, 'over the other ship the boat becomes the guy at once');
});

function hullDepthBoth(g, p) {
  return g.shipUnder(p, [0]) === 1 && g.shipUnder(p, [1]) === 0;
}

test('sailing over a ship of the map opens her, and lands when she is in', () => {
  const g = fresh();
  const atlas = g.atlas;
  const kin = atlas.upsert({ name: 'keel/hull', stars: 300 });
  atlas.setPlace(kin, g.sea[0].x + 400, g.sea[0].y);
  g.boat.x = kin.x; g.boat.y = kin.y;
  g.events.length = 0;
  g.step(0.02, none);
  assert.deepEqual(g.events, [{ type: 'open', name: 'keel/hull', arrival: 'land' }]);
  assert.equal(g.aboard, null);
  assert.match(g.prompt, /opening/);
  g.step(0.02, none);
  assert.equal(g.events.length, 1, 'she is asked for once');
  g.moor(data('keel/hull', [['old.c', 400]], []), 'land');
  assert.equal(g.aboard, 1, 'landed once she was in');
  assert.ok(Math.abs(g.sea[1].x + g.sea[1].deck.size.w / 2 - kin.x) < 0.01, 'she lies where the map had her');
  const busy = fresh();
  busy.canOpen = () => false;
  const o = busy.atlas.upsert({ name: 'o/p', stars: 5 });
  busy.atlas.setPlace(o, busy.sea[0].x + 400, busy.sea[0].y);
  busy.boat.x = o.x; busy.boat.y = o.y; busy.events.length = 0;
  busy.step(0.02, none);
  assert.equal(busy.events.length, 0, 'not while another thing is being fetched');
});

test('reaching distances are sensible', () => {
  assert.ok(REACH > 1.5 && REACH < 4);
});

test('when her issues change, her cracks are made again and the reading card is let go', () => {
  const g = fresh();
  g.board(0, { x: g.sea[0].x + 3, y: g.sea[0].y + 5 });
  g.reading = { ship: 0, issue: 0 };
  g.setIssues(0, [ISSUES[0]], false, { total: 2, failed: ['t'] });
  assert.equal(g.sea[0].deck.cracks.length, 2, 'only #4 is left, in its two rooms');
  assert.deepEqual([g.reading, g.sea[0].checks.total, g.aboard], [null, 2, 0]);
});

test('standing at a station it is the station that E uses, even with a crack in reach', () => {
  const g = fresh();
  const s = g.sea[0], flag = s.deck.stations[0];
  // a crack 1 m from the flag, in reach of someone standing at it
  s.deck.cracks.push({ issue: 0, file: null, pts: [{ x: flag.x - 1, y: flag.y }, { x: flag.x - 1.6, y: flag.y }], branch: [], width: 0.2 });
  g.board(0, { x: s.x + flag.x, y: s.y + flag.y });
  g.events.length = 0;
  g.step(0.02, none);
  assert.ok(g.nearCrack >= 0, 'the crack is in reach');
  assert.match(g.prompt, /^E: the flag/);
  g.step(0.02, { interact: true });
  assert.deepEqual(g.events.at(-1), { type: 'station', ship: 0, id: 'flag' });
  assert.equal(g.reading, null);
  g.board(0, { x: s.x + flag.x - 2.4, y: s.y + flag.y });
  g.step(0.02, none);
  assert.match(g.prompt, /^E: read #/, 'a little way off, the crack is what is there');
});
