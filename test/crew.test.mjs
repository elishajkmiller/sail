import test from 'node:test';
import assert from 'node:assert/strict';
import * as treemap from '../public/js/treemap.js';
import { Deck } from '../public/js/deck.js';
import { Crew, peopleOf, rosterOf, doing, isCrewEvent, MAX_CREW } from '../public/js/crew.js';

const FILES = Array.from({ length: 60 }, (_, i) => [`src/m${i % 5}/f${i}.rs`, 100 + i * 37]);
const talk = { enabled: true, list: [1, 2, 3].map((n) => ({ number: n, title: `t${n}`, comments: n })) };
const deck = (files = FILES) => new Deck(files, treemap.build(files), [], talk);
const NOW = 1_790_000_000;
const ev = (id, actor, type, minutesAgo, extra = {}) => ({ id: String(id), type, actor, at: NOW - minutesAgo * 60, action: '', number: null, ...extra });

test('only issues and pull requests bring people aboard: not stars, forks or pushes', () => {
  for (const t of ['IssuesEvent', 'IssueCommentEvent', 'PullRequestEvent', 'PullRequestReviewEvent', 'PullRequestReviewCommentEvent']) assert.ok(isCrewEvent({ type: t }), t);
  for (const t of ['WatchEvent', 'ForkEvent', 'PushEvent', 'CreateEvent', 'ReleaseEvent']) assert.ok(!isCrewEvent({ type: t }), t);
  const list = peopleOf([ev(1, 'ann', 'WatchEvent', 3), ev(2, 'bo', 'IssuesEvent', 9, { action: 'opened', number: 7 }), ev(3, '', 'IssuesEvent', 1), ev(4, 'cy', 'PullRequestEvent', 20, { action: 'closed', number: 3 }), ev(5, 'bo', 'IssueCommentEvent', 40, { number: 7 }), ev(6, 'x y', 'IssuesEvent', 1)]);
  assert.deepEqual(list.map((p) => p.login), ['bo', 'cy']);
  assert.equal(list[0].doing, 'opened #7');
  assert.equal(doing({ type: 'PullRequestEvent', action: 'closed', number: 3 }), 'closed pull #3');
});

test('the people behind open issues and pull requests make the first crew, newest first, once each', () => {
  const issues = [{ number: 4, author: 'ann', createdAt: 100 }, { number: 9, author: 'bo', createdAt: 300 }, { number: 11, author: '', createdAt: 400 }, { number: 12, author: 'ann', createdAt: 250 }];
  const pulls = [{ number: 5, author: 'cy', at: 200 }, { number: 6, author: 'bo', at: 50 }];
  const roster = rosterOf({ issues, pulls });
  assert.deepEqual(roster.map((p) => p.login), ['bo', 'ann', 'cy']);
  assert.equal(roster[0].doing, 'found #9');
  assert.equal(roster[2].doing, 'opened pull #5');
  assert.deepEqual(rosterOf({}), []);
});

test('the crew stands on the deck, clear of the mast, the hatch and the tables', () => {
  const d = deck(), crew = new Crew(d, 5);
  crew.setPeople(rosterOf({ issues: [{ number: 1, author: 'ann', createdAt: 1 }, { number: 2, author: 'bo', createdAt: 2 }], pulls: [{ number: 3, author: 'cy', at: 3 }] }));
  assert.equal(crew.members.length, 3);
  const obstacles = crew.obstacles();
  for (const m of crew.members) {
    assert.ok(d.contains('deck', m), `${m.login} is on the deck`);
    for (const o of obstacles) assert.ok(Math.hypot(m.x - o.x, m.y - o.y) > o.r, `${m.login} is not inside something`);
  }
});

test('the crew strolls for ten minutes and never leaves the deck or walks into what stands on it', () => {
  const d = deck(), crew = new Crew(d, 9);
  crew.setPeople(Array.from({ length: 10 }, (_, i) => ({ login: `p${i}`, at: NOW - i * 500, doing: 'found #1' })));
  const start = crew.members.map((m) => [m.x, m.y]);
  let moved = 0;
  for (let t = 0; t < 600; t += 0.1) {
    crew.step(0.1);
    for (const m of crew.members) {
      assert.ok(d.contains('deck', m, -0.05), `${m.login} stays on the deck at t=${t.toFixed(1)}`);
      if (m.moving) moved++;
    }
  }
  assert.ok(moved > 500, 'they really do walk about');
  assert.ok(crew.members.some((m, i) => Math.hypot(m.x - start[i][0], m.y - start[i][1]) > 3), 'and they get somewhere');
  for (const m of crew.members) for (const o of crew.obstacles()) assert.ok(Math.hypot(m.x - o.x, m.y - o.y) > o.r - 0.35, `${m.login} is not standing in something`);
});

test('an issue brings its person to the hatch and a pull request to the stairs up, then she goes back to strolling', () => {
  const d = deck(), crew = new Crew(d, 3);
  crew.setPeople(rosterOf({ issues: [{ number: 1, author: 'ann', createdAt: 5 }] }));
  const m = crew.event(ev(9, 'ann', 'IssuesEvent', 0, { action: 'opened', number: 8 }));
  assert.equal(m.doing, 'opened #8');
  const near = (who, p) => Math.hypot(who.x - p.x, who.y - p.y) < 4.5;
  for (let t = 0; t < 60 && !near(m, d.hatch); t += 0.1) crew.step(0.1);
  assert.ok(near(m, d.hatch), 'she came to the hatch');
  for (let t = 0; t < 60; t += 0.1) crew.step(0.1);
  assert.equal(m.goal, null, 'and after a while she is free again');
  const stranger = crew.event(ev(10, 'dee', 'PullRequestEvent', 0, { action: 'opened', number: 4 }));
  assert.ok(stranger && crew.members.includes(stranger), 'a person who was not there comes aboard');
  const stairs = d.station('stairsUp');
  for (let t = 0; t < 60 && !near(stranger, stairs); t += 0.1) crew.step(0.1);
  assert.ok(near(stranger, stairs), 'a pull request is carried to the stairs up to the helm');
  assert.equal(crew.event(ev(11, 'eli', 'WatchEvent', 0)), null, 'a star brings nobody');
  assert.equal(crew.event(ev(12, '', 'IssuesEvent', 0)), null, 'nobody without a name');
});

test('there is room for fourteen: a new person sends the longest idle one off', () => {
  const crew = new Crew(deck(), 1);
  crew.setPeople(Array.from({ length: 30 }, (_, i) => ({ login: `p${i}`, at: NOW - i * 10, doing: 'found #1' })));
  assert.equal(crew.members.length, MAX_CREW);
  crew.event(ev(1, 'newcomer', 'IssuesEvent', 0, { action: 'opened', number: 2 }));
  assert.equal(crew.members.length, MAX_CREW);
  assert.ok(crew.members.some((m) => m.login === 'newcomer'));
  assert.ok(!crew.members.some((m) => m.login === 'p13'), 'the one who had been idle the longest left');
});

test('a huge ship and a small one both seat their crew, the same every time', () => {
  const big = Array.from({ length: 5000 }, (_, i) => [`d${i % 30}/f${i}.c`, 100 + (i % 50) * 20]);
  for (const files of [FILES, big]) {
    const ca = new Crew(deck(files), 4), cb = new Crew(deck(files), 4), people = [{ login: 'ann', at: 2, doing: 'x' }, { login: 'bo', at: 1, doing: 'y' }];
    ca.setPeople(people); cb.setPeople(people);
    assert.equal(ca.members.length, 2);
    assert.deepEqual(ca.members.map((m) => [m.x, m.y]), cb.members.map((m) => [m.x, m.y]));
  }
});
