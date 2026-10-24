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

test('sailing over a hull lands on her by itself, on the main deck, and Space takes off again', () => {
  const g = fresh();
  g.step(0.02, { leave: true });
  assert.equal(g.aboard, null, 'open water: nothing to land on');
  run(g, { throttle: 1 }, 6);
  assert.equal(g.aboard, 0, 'no key was pressed');
  assert.equal(g.level, 'deck');
  assert.ok(g.human && g.sea[0].deck.contains('deck', { x: g.human.x - g.sea[0].x, y: g.human.y - g.sea[0].y }));
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

test('the guy walks the deck at walking pace and cannot walk off the ship, or through the quarters', () => {
  const g = fresh();
  g.placeAt(0, 'deck', { x: 14, y: 5 });
  const x0 = g.human.x;
  run(g, { move: { x: 1, y: 0 } }, 1);
  assert.ok(Math.abs(g.human.x - x0 - WALK) < 0.3, `a second of walking is ${WALK} m: ${g.human.x - x0}`);
  run(g, { move: { x: 0, y: 1 }, boost: true }, 30);
  run(g, { move: { x: -1, y: 0 }, boost: true }, 60);
  const m = g.sea[0], local = { x: g.human.x - m.x, y: g.human.y - m.y };
  assert.ok(m.deck.contains('deck', local), 'the rail and the quarters stop him');
  run(g, { move: { x: 0, y: -1 }, boost: true }, 5);
  assert.ok(m.deck.contains('deck', { x: g.human.x - m.x, y: g.human.y - m.y }), 'walking at the quarters from the side does not go through them');
});

test('a crack beside him in the hold is read with E and closed with E or Escape', () => {
  const g = fresh();
  const crack = g.sea[0].deck.cracks.find((c) => c.file !== null);
  g.placeAt(0, 'hold', crack.pts[0]);
  g.step(0.02, none);
  assert.ok(g.nearCrack >= 0 && g.prompt.startsWith('E: read #4'), g.prompt);
  g.step(0.02, { interact: true });
  assert.deepEqual(g.reading, { ship: 0, issue: crack.issue });
  g.step(0.02, { interact: true });
  assert.equal(g.reading, null, 'E again closes it');
  g.step(0.02, { interact: true });
  g.step(0.02, { esc: true });
  assert.equal(g.reading, null, 'Escape closes it too');
  // the same place on the deck above has no cracks to read
  g.placeAt(0, 'deck', { x: 15, y: 6 });
  g.step(0.02, none);
  assert.deepEqual([g.nearCrack, g.nearRoom], [-1, -1], 'the cracks and the rooms are in the hold');
});

test('E at a station asks for it, E at a stair or hatch changes storey, and E in a room of the hold asks for its file', () => {
  const g = fresh();
  const d = g.sea[0].deck;
  g.events.length = 0;
  for (const s of d.stations) {
    g.placeAt(0, s.level, s);
    g.step(0.02, none);
    assert.equal(g.nearStation.id, s.id, s.id);
    assert.match(g.prompt, /^E: /, s.id);
    g.step(0.02, { interact: true });
    if (s.to) {
      assert.equal(g.level, s.to.level, `${s.id} leads to ${s.to.level}`);
      assert.deepEqual(g.events.at(-1), { type: 'level', ship: 0, level: s.to.level });
    } else if (s.id === 'table') assert.deepEqual(g.events.at(-1), { type: 'station', ship: 0, id: 'table', index: 0, kind: 'locked', number: null });
    else assert.deepEqual(g.events.at(-1), { type: 'station', ship: 0, id: s.id });
  }
  const main = FILES.findIndex((f) => f[0] === 'src/main.rs');
  const c = d.cells[d.fileCell.get(main)].rect;
  g.sea[0].deck.cracks.length = 0;
  g.placeAt(0, 'hold', { x: c.x + c.w / 2, y: c.y + c.h / 2 });
  g.step(0.02, none);
  assert.equal(g.prompt, 'E: open src/main.rs');
  g.step(0.02, { interact: true });
  assert.deepEqual(g.events.at(-1), { type: 'file', ship: 0, file: main });
});

test('the whole way round: deck, down the hatch, up the ladder, up to the helm, into the quarters, and out', () => {
  const g = fresh();
  const d = g.sea[0].deck, press = () => { g.step(0.02, none); g.step(0.02, { interact: true }); };
  g.board(0, { x: g.sea[0].x + d.spawn.x, y: g.sea[0].y + d.spawn.y });
  const go = (id) => { const s = d.station(id); g.placeAt(0, s.level, s); press(); };
  go('hatch'); assert.equal(g.level, 'hold');
  go('ladder'); assert.equal(g.level, 'deck');
  go('stairsUp'); assert.equal(g.level, 'helm');
  go('stairsDown'); assert.equal(g.level, 'deck');
  go('door'); assert.equal(g.level, 'quarters');
  go('out'); assert.equal(g.level, 'deck');
  g.step(0.02, { leave: true });
  assert.equal(g.aboard, null, 'and Space takes off from any storey');
  g.placeAt(0, 'helm', d.station('wheel'));
  g.step(0.02, { leave: true });
  assert.ok(g.aboard === null && g.human === null, 'even from the helm');
});

test('clicking an issue in the bar goes down to the hold and walks to its crack to read it', () => {
  const g = fresh();
  g.walkToIssue(0);
  assert.equal(g.aboard, 0);
  assert.equal(g.level, 'hold', 'the cracks are in the hold');
  assert.equal(g.walkTo.read, 0);
  run(g, none, 40);
  assert.deepEqual(g.reading, { ship: 0, issue: 0 });
  assert.equal(g.walkTo, null);
  g.placeAt(0, 'helm', g.sea[0].deck.station('wheel'));
  g.reading = null;
  g.walkToIssue(1);
  assert.equal(g.level, 'hold', 'from the helm too');
});

test('a click walks him there on his own storey; a double click at sea boards a ship', () => {
  const g = fresh();
  const m = g.sea[0];
  g.click({ x: m.x + 20, y: m.y + 10 }, false);
  assert.deepEqual([g.aboard, g.focus], [null, 0], 'one click only picks her');
  g.click({ x: m.x + 20, y: m.y + 10 }, true);
  assert.equal(g.aboard, 0);
  assert.equal(g.level, 'deck');
  g.click({ x: m.x + 22, y: m.y + 10 }, false);
  assert.deepEqual([g.walkTo.x, g.walkTo.y], [22, 10]);
  g.click({ x: m.x - 500, y: m.y }, false);
  assert.deepEqual([g.walkTo.x, g.walkTo.y], [22, 10], 'a click in the water does nothing');
  g.click({ x: m.x + 0, y: m.y + m.deck.size.h / 2 }, false);
  assert.deepEqual([g.walkTo.x, g.walkTo.y], [22, 10], 'nor does one on the quarters, which are not the deck');
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
  const s = g.sea[0], ladder = s.deck.station('ladder');
  // a crack 1 m from the ladder, in reach of someone standing at it
  s.deck.cracks.push({ issue: 0, file: null, pts: [{ x: ladder.x - 1, y: ladder.y }, { x: ladder.x - 1.6, y: ladder.y }], branch: [], width: 0.2 });
  g.placeAt(0, 'hold', ladder);
  g.events.length = 0;
  g.step(0.02, none);
  assert.ok(g.nearCrack >= 0, 'the crack is in reach');
  assert.match(g.prompt, /^E: climb up/);
  g.step(0.02, { interact: true });
  assert.equal(g.level, 'deck');
  assert.equal(g.reading, null);
  g.placeAt(0, 'hold', { x: ladder.x - 2.6, y: ladder.y });
  g.step(0.02, none);
  assert.match(g.prompt, /^E: read #/, 'a little way off, the crack is what is there');
});

test('every discussion is a table on the deck: the prompt names it, E sits down at it, and the talk can arrive after the ship', () => {
  const g = fresh();
  assert.deepEqual(g.sea[0].deck.tables.map((t) => t.kind), ['locked'], 'with no token there is one table, and it says why');
  g.placeAt(0, 'deck', g.sea[0].deck.tables[0]);
  g.step(0.02, none);
  assert.match(g.prompt, /^E: the table \(a token lets you hear/);
  const talk = { enabled: true, list: [{ number: 7, title: 'How do I add a sail to the mast?', comments: 4 }, { number: 9, title: 'Release plans', comments: 0 }, { number: 12, title: 'x'.repeat(100), comments: 1 }] };
  g.setTalk(0, talk);
  const tables = g.sea[0].deck.tables;
  assert.equal(tables.length, 3);
  g.placeAt(0, 'deck', tables[0]);
  g.events.length = 0;
  g.step(0.02, none);
  assert.equal(g.prompt, 'E: sit at the table: How do I add a sail to the mast? (4 comments)');
  g.step(0.02, { interact: true });
  assert.deepEqual(g.events.at(-1), { type: 'station', ship: 0, id: 'table', index: 0, kind: 'talk', number: 7 });
  g.placeAt(0, 'deck', tables[1]);
  g.step(0.02, none);
  assert.equal(g.prompt, 'E: sit at the table: Release plans', 'no "(0 comments)"');
  g.placeAt(0, 'deck', tables[2]);
  g.step(0.02, none);
  assert.ok(g.prompt.length < 100 && g.prompt.endsWith('...' + (g.prompt.includes('(1 comments)') ? '' : ' (1 comments)')) || g.prompt.includes('...'), `a long title is cut: ${g.prompt}`);
  // issues changing does not lose the tables
  g.setIssues(0, [ISSUES[0]], false, null);
  assert.equal(g.sea[0].deck.tables.length, 3);
  // no discussions, and discussions off
  g.setTalk(0, { enabled: true, list: [] });
  assert.deepEqual(g.sea[0].deck.tables.map((t) => t.kind), ['empty']);
  g.setTalk(0, { enabled: false, list: [] });
  g.placeAt(0, 'deck', g.sea[0].deck.tables[0]);
  g.step(0.02, none);
  assert.match(g.prompt, /no discussions/);
  // a ship that is opened with her talk already known has the tables from the start
  const g2 = new Game({ atlas: new Atlas(), now: () => 1_790_000_000 });
  g2.moor({ ...data('deck/mast'), talk });
  assert.equal(g2.sea[0].deck.tables.length, 3);
});

test('the stairs are on both sides of the stern castle, each way up and down', () => {
  const g = fresh(), d = g.sea[0].deck;
  for (const [up, down] of [['stairsUp', 'stairsDown'], ['stairsUp2', 'stairsDown2']]) {
    g.placeAt(0, 'deck', d.station(up));
    g.step(0.02, none);
    assert.equal(g.prompt, 'E: climb to the helm', up);
    g.step(0.02, { interact: true });
    assert.equal(g.level, 'helm');
    g.step(0.02, none);
    assert.equal(g.nearStation.id, down, 'he arrives at the top of the same flight');
    g.step(0.02, { interact: true });
    assert.equal(g.level, 'deck');
  }
});
