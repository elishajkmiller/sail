// The people of a ship: whoever found an issue or opened a pull request on her repo walks her main deck. They are seeded from her open issues
// and pull requests and from her live event feed, and a new event of that kind brings its person to the place on deck where it is done: an
// issue or a comment to the hatch (the cracks are down there), a pull request to the stairs up to the helm (where she is managed). Then they
// go back to strolling. Pure logic in the ship's own coordinates (metres), so the tests need no browser.

import { clamp, hash32, rng, valid } from './util.js';

export const MAX_CREW = 14;
const WALK = 1.1, HURRY = 1.9, STAY = 24;

const ISSUE_TYPES = new Set(['IssuesEvent', 'IssueCommentEvent']);
const PULL_TYPES = new Set(['PullRequestEvent', 'PullRequestReviewEvent', 'PullRequestReviewCommentEvent']);
/** Whether a feed event is one that brings a person aboard (an issue or a pull request, not a star or a push). */
export const isCrewEvent = (e) => ISSUE_TYPES.has(e.type) || PULL_TYPES.has(e.type);

/** What a feed event says its person did, in a few words. */
export function doing(e) {
  const n = e.number != null ? ` #${e.number}` : '';
  switch (e.type) {
    case 'IssuesEvent': return `${e.action || 'touched'}${n}`;
    case 'IssueCommentEvent': return `commented${n}`;
    case 'PullRequestEvent': return `${e.action || 'touched'} pull${n}`;
    case 'PullRequestReviewEvent': case 'PullRequestReviewCommentEvent': return `reviewed${n}`;
    default: return 'was here';
  }
}

/** The place on deck where each kind of event is carried out (a station of the deck). */
const stationFor = (type) => (PULL_TYPES.has(type) ? 'stairsUp' : 'hatch');

/** The distinct named people of a list of feed events (issues and pull requests only), newest first, with what they last did. */
export function peopleOf(events) {
  const seen = new Map();
  for (const e of events) if (isCrewEvent(e) && valid(e.actor) && !seen.has(e.actor)) seen.set(e.actor, { login: e.actor, at: e.at, doing: doing(e) });
  return [...seen.values()].sort((a, b) => b.at - a.at);
}

/** The people behind a ship's open issues and open pull requests (the lists github.js gives), newest first. */
export function rosterOf({ issues = [], pulls = [] }) {
  const seen = new Map();
  const add = (login, at, text) => { if (valid(login) && (!seen.has(login) || seen.get(login).at < at)) seen.set(login, { login, at, doing: text }); };
  for (const i of issues) add(i.author, i.createdAt || 0, `found #${i.number}`);
  for (const p of pulls) add(p.author, p.at || 0, `opened pull #${p.number}`);
  return [...seen.values()].sort((a, b) => b.at - a.at);
}

export class Crew {
  constructor(deck, seed = 1) {
    this.deck = deck;
    this.rand = rng(seed >>> 0);
    /** { login, x, y, face, doing, at, goal, wait, stay, moving } */
    this.members = [];
  }

  /** The things on deck a person walks around: the mast, the hatch, the tables, the flag and the stairs. */
  obstacles() {
    const d = this.deck, L = d.lines, k = clamp(L.L / 70, 1, 6), out = [];
    out.push({ x: d.mast.x, y: d.mast.y, r: 0.9 + 0.5 * k }, { x: d.hatch.x, y: d.hatch.y, r: 1.9 });
    for (const t of d.tables) out.push({ x: t.x, y: t.y, r: 2.6 });
    for (const id of ['flag', 'stairsUp', 'stairsUp2']) { const s = d.station(id); if (s) out.push({ x: s.x, y: s.y, r: id === 'flag' ? 0.9 : 2.2 }); }
    return out;
  }

  /** A free place on the deck, clear of everything on it (null if none is found). */
  freeSpot(obstacles = this.obstacles()) {
    const d = this.deck, { cy, x1, bmax } = d.lines, c = d.castle;
    for (let i = 0; i < 60; i++) {
      const p = { x: c.x1 + 1.5 + this.rand() * (x1 - 10 - c.x1), y: cy + (this.rand() * 2 - 1) * bmax };
      if (d.contains('deck', p, 1.2) && obstacles.every((o) => Math.hypot(p.x - o.x, p.y - o.y) > o.r + 0.7)) return p;
    }
    return null;
  }

  /** The place where a kind of thing is done, a little way off the station so that nobody stands in it. */
  spotFor(stationId) {
    const d = this.deck, s = d.station(stationId);
    if (!s) return this.freeSpot();
    const off = { stairsUp: { x: 2.8, y: 0 }, hatch: { x: 0, y: 2.6 } }[stationId] || { x: 1.5, y: 0 };
    const p = { x: s.x + off.x, y: s.y + off.y };
    return d.contains('deck', p, 0.5) ? p : this.freeSpot();
  }

  /** Adds a list of { login, at, doing } (as peopleOf and rosterOf give) to the people aboard, newest first, the oldest leaving when full. */
  setPeople(list) {
    const byLogin = new Map(this.members.map((m) => [m.login, m]));
    const obstacles = this.obstacles();
    for (const p of list) {
      const m = byLogin.get(p.login) || this.spawn(p.login, obstacles);
      if (!byLogin.has(p.login) || p.at >= m.at) Object.assign(m, { at: p.at, doing: p.doing });
      byLogin.set(p.login, m);
    }
    this.members = [...byLogin.values()].sort((a, b) => b.at - a.at).slice(0, MAX_CREW);
  }

  spawn(login, obstacles) {
    const p = this.freeSpot(obstacles) || { x: this.deck.castle.x1 + 4, y: this.deck.lines.cy };
    return { login, x: p.x, y: p.y, face: this.rand() * Math.PI * 2, doing: '', at: 0, goal: null, wait: this.rand() * 4, stay: 0, moving: false };
  }

  /** A new event of the feed: its person comes to the place for it (and joins the crew if she was not there; the longest idle one makes room). */
  event(e) {
    if (!isCrewEvent(e) || !valid(e.actor)) return null;
    let m = this.members.find((x) => x.login === e.actor);
    if (!m) {
      if (this.members.length >= MAX_CREW) this.members.sort((a, b) => a.at - b.at).shift();
      const door = this.deck.station('door');
      m = this.spawn(e.actor, this.obstacles());
      if (door) { m.x = door.x + 1.8; m.y = door.y; }
      this.members.push(m);
    }
    Object.assign(m, { at: e.at, doing: doing(e) });
    const spot = this.spotFor(stationFor(e.type));
    if (spot) Object.assign(m, { goal: spot, stay: STAY, wait: 0 });
    return m;
  }

  step(dt) {
    const d = this.deck, obstacles = this.obstacles();
    for (const m of this.members) {
      let speed = WALK, target = m.goal;
      if (target) speed = HURRY;
      else if (m.wait > 0) { m.wait -= dt; m.moving = false; continue; }
      else {
        if (!m.wander) m.wander = this.freeSpot(obstacles);
        target = m.wander;
        if (!target) { m.moving = false; continue; }
      }
      const dx = target.x - m.x, dy = target.y - m.y, dist = Math.hypot(dx, dy);
      if (dist < 0.25) {
        m.moving = false;
        if (m.goal) { m.stay -= dt; if (m.stay <= 0) { m.goal = null; m.wait = 1; } } else { m.wander = null; m.wait = 2 + this.rand() * 8; }
        continue;
      }
      const step = Math.min(dist, speed * dt);
      m.x += (dx / dist) * step; m.y += (dy / dist) * step;
      m.face = Math.atan2(dy, dx);
      m.moving = true;
      for (const o of obstacles) {                  // walk round, not through, what stands on deck (unless it is where one is going)
        if (Math.hypot(target.x - o.x, target.y - o.y) < o.r + 0.5) continue;
        const ox = m.x - o.x, oy = m.y - o.y, od = Math.hypot(ox, oy);
        if (od < o.r) { m.x = o.x + (od > 1e-6 ? ox / od : 1) * o.r; m.y = o.y + (od > 1e-6 ? oy / od : 0) * o.r; }
      }
      if (!d.contains('deck', m)) { const c = d.clamp('deck', m); m.x = c.x; m.y = c.y; }
    }
    for (let i = 0; i < this.members.length; i++) for (let j = i + 1; j < this.members.length; j++) {   // not on top of each other
      const a = this.members[i], b = this.members[j], dx = b.x - a.x, dy = b.y - a.y, dd = Math.hypot(dx, dy);
      if (dd < 0.8 && dd > 1e-6) { const push = (0.8 - dd) / 2; a.x -= dx / dd * push; a.y -= dy / dd * push; b.x += dx / dd * push; b.y += dy / dd * push; }
    }
  }
}

/** A colour for a person from her name, always the same. */
export const hueOf = (login) => (hash32(login) % 360) / 360;
