// The rules of the sea, with nothing drawn: sailing the boat, landing on a ship by sailing over her hull, walking her deck, finding the
// cracks and stations. The renderer (scene.js) and the page (main.js) read this state; the tests drive it with plain numbers.
// Everything is in metres on a flat sea (x, y); the renderer puts y on the depth axis.

import { Deck, hullDepth, MARGIN } from './deck.js';
import { condition } from './github.js';

export const WALK = 6;
export const REACH = 2.2;
const PROMPTS = {
  flag: 'E: the flag (star this repo)', tavern: 'E: the tavern table (discussions)', wheel: 'E: the wheel (manage this repo)', desk: "E: the captain's desk (the owner and the top contributors)",
  hatch: 'E: climb down into the hold (the cracks are there)', ladder: 'E: climb up to the deck', door: "E: go into the captain's quarters", out: 'E: out to the deck',
  stairsUp: 'E: climb to the helm', stairsDown: 'E: down to the deck',
};
export const STATION_REACH = 1.8;
export const BOAT_TOP = 30;
const BOAT_ACC = 12;
const BOAT_TURN = 1.1;

const key = (name) => name.toLowerCase();

export class Game {
  constructor({ atlas, now = () => Math.floor(Date.now() / 1000) } = {}) {
    this.atlas = atlas;
    this.now = now;
    /** The ships that have been opened: { key, repo, files, partial, item, issues, moreIssues, checks, notes, deck, x, y } (x, y: the deck's top left corner). */
    this.sea = [];
    this.boat = { x: 0, y: 0, heading: 0, vx: 0, vy: 0, throttle: 0 };
    this.human = null;
    this.aboard = null;
    /** The ships whose hulls he took off inside: the boat is not landed on any of them again until it has sailed clear of its hull. */
    this.left = [];
    this.focus = null;
    this.reading = null;
    this.walkTo = null;
    this.prompt = '';
    this.nearCrack = -1;
    this.nearStation = null;
    this.nearRoom = -1;
    this.events = [];
    this.time = 0;
    this.asked = new Set();
    this.wantLand = null;
    /** Whether a ship of the map may be opened just now (the page says: one thing at a time). */
    this.canOpen = () => true;
  }

  find(name) { return this.sea.findIndex((m) => m.key === key(name)); }
  get pos() { return this.human ?? this.boat; }

  /**
   * Brings an opened ship into the sea at the place the atlas has for her (or a free one near the boat). A repo that is already there is
   * renewed where she lies. `arrival`: 'fly' puts the boat off her stern; 'land' lands on her if the boat is still over her.
   */
  moor(data, arrival = 'fly') {
    const deck = new Deck(data.files, data.item, data.issues);
    const k = key(data.repo.fullName);
    const old = this.find(data.repo.fullName);
    const entry = this.atlas.upsert({ name: data.repo.fullName, stars: data.repo.stars, language: data.repo.language, pushedAt: data.repo.pushedAt });
    if (!this.atlas.placed(entry)) this.atlas.placeFree(entry, this.sea.length ? this.boat.x : 0, this.sea.length ? this.boat.y : 0);
    const moored = { key: k, ...data, deck, x: entry.x - deck.size.w / 2, y: entry.y - deck.size.h / 2 };
    let at = old;
    if (old >= 0) { moored.x = this.sea[old].x; moored.y = this.sea[old].y; this.sea[old] = moored; } else { this.sea.push(moored); at = this.sea.length - 1; }
    this.asked.add(k);
    if (arrival === 'fly') {
      this.focus = at;
      this.placeBoat(at);
      this.events.push({ type: 'arrived', ship: at });
    } else if (arrival === 'land' && this.wantLand === k) {
      this.wantLand = null;
      if (this.aboard === null && this.shipUnder(this.boat) === at) this.board(at, this.boat);
    }
    return at;
  }

  /** The boat is put in the water off a ship's stern, pointing at her, standing still. */
  placeBoat(i) {
    const m = this.sea[i];
    this.human = null;
    this.aboard = null;
    this.left = [];
    this.walkTo = null;
    this.reading = null;
    Object.assign(this.boat, { x: m.x - MARGIN - 30, y: m.y + m.deck.size.h / 2, heading: 0, vx: 0, vy: 0, throttle: 0 });
  }

  /** The ship whose hull a point is over; where hulls overlap, the one it is deepest inside. `skip`: ships to leave out. */
  shipUnder(p, skip = []) {
    let best = null, bd = 0;
    this.sea.forEach((m, i) => {
      if (skip.includes(i)) return;
      const d = hullDepth(m.deck.hull, { x: p.x - m.x, y: p.y - m.y });
      if (d >= 0 && (best === null || d > bd)) { best = i; bd = d; }
    });
    return best;
  }

  /** The ship Space would land on: any but the one just left, and that one only if it is the only one there is. */
  shipToLandOn() { return this.shipUnder(this.boat, this.left) ?? this.shipUnder(this.boat); }

  local(i, p) { const m = this.sea[i]; return { x: p.x - m.x, y: p.y - m.y }; }

  /** Puts him aboard a ship on a storey, at a place of the ship's own coordinates (kept where that storey can be stood on). */
  placeAt(i, level, local) {
    const m = this.sea[i];
    if (!m) return;
    const at = m.deck.clamp(level, local);
    this.human = { x: m.x + at.x, y: m.y + at.y, face: this.human?.face ?? 0, level };
    Object.assign(this.boat, { x: this.human.x, y: this.human.y, vx: 0, vy: 0 });
    this.aboard = i;
    this.left = [];
    this.focus = i;
    this.walkTo = null;
    this.reading = null;
  }

  /** Becomes the guy on a ship's main deck, at a place (world) kept on the deck. */
  board(i, p) {
    this.placeAt(i, 'deck', this.local(i, p));
    this.events.push({ type: 'boarded', ship: i });
  }

  get level() { return this.human?.level ?? null; }

  /** Space: aboard, back into the boat where he stands (it is not landed again on a ship whose hull it left); at sea over a hull, aboard. */
  toggleBoard() {
    if (this.aboard !== null) {
      const a = this.aboard, h = this.human;
      this.left = this.sea.map((m, i) => i).filter((i) => i === a || hullDepth(this.sea[i].deck.hull, this.local(i, h)) >= 0);
      Object.assign(this.boat, { x: h.x, y: h.y, vx: 0, vy: 0 });
      this.human = null;
      this.aboard = null;
      this.walkTo = null;
      this.reading = null;
      this.events.push({ type: 'left', ship: a });
    } else {
      const i = this.shipToLandOn();
      if (i !== null) this.board(i, this.boat);
    }
  }

  /** The left bar's click on an issue: go aboard (if not already) and walk to its crack, to read it when he gets there. */
  walkToIssue(n) {
    const f = this.focus;
    if (f === null || !this.sea[f]) return;
    if (this.aboard !== f || this.level !== 'hold') {
      // the cracks are in the hold: down the ladder, beside it
      const ladder = this.sea[f].deck.station('ladder');
      this.placeAt(f, 'hold', { x: ladder.x, y: ladder.y + 0.9 });
      this.events.push({ type: 'boarded', ship: f }, { type: 'level', ship: f, level: 'hold' });
    }
    const crack = this.sea[f].deck.cracks.find((c) => c.issue === n);
    if (crack) this.walkTo = { ship: f, x: crack.pts[0].x, y: crack.pts[0].y, read: n };
    else this.reading = { ship: f, issue: n };
  }

  /** Sails to a ship: the boat is put off her stern. */
  flyTo(i) {
    if (!this.sea[i]) return;
    this.focus = i;
    this.placeBoat(i);
    this.events.push({ type: 'arrived', ship: i });
  }

  /**
   * One frame. `input`: { move: {x, y} (a world direction for walking, length up to 1), throttle (-1..1), steer (-1..1), boost, leave, interact, esc }.
   */
  step(dt, input = {}) {
    this.time += dt;
    if (input.esc) this.reading = null;
    if (this.aboard !== null) this.walk(dt, input);
    else {
      this.sail(dt, input);
      this.landIfOver();
    }
    this.lookAround();
    if (input.leave) { this.toggleBoard(); this.lookAround(); }
    if (input.interact) this.useHere();
  }

  walk(dt, input) {
    const m = this.sea[this.aboard], h = this.human;
    if (!m || !h) return;
    const local = { x: h.x - m.x, y: h.y - m.y };
    let dir = input.move && (input.move.x || input.move.y) ? { ...input.move } : null;
    if (dir) {
      this.walkTo = null;
      const len = Math.hypot(dir.x, dir.y);
      if (len > 1) dir = { x: dir.x / len, y: dir.y / len };
    } else if (this.walkTo && this.walkTo.ship === this.aboard) {
      const dx = this.walkTo.x - local.x, dy = this.walkTo.y - local.y, d = Math.hypot(dx, dy);
      if (d < 0.35) {
        if (this.walkTo.read !== null && this.walkTo.read !== undefined) this.reading = { ship: this.aboard, issue: this.walkTo.read };
        this.walkTo = null;
      } else dir = { x: dx / d, y: dy / d };
    } else this.walkTo = null;
    if (!dir) return;
    const speed = WALK * (input.boost ? 2 : 1) * dt;
    const next = m.deck.clamp(h.level, { x: local.x + dir.x * speed, y: local.y + dir.y * speed });
    if (this.walkTo && Math.hypot(next.x - local.x, next.y - local.y) < 1e-4) this.walkTo = null; // blocked by the rail
    h.x = m.x + next.x; h.y = m.y + next.y;
    h.face = Math.atan2(dir.y, dir.x);
    this.boat.x = h.x; this.boat.y = h.y;
  }

  /** The boat: the throttle pushes it the way it points, the rudder turns it (more when it moves), and the water slows it. */
  sail(dt, input) {
    const b = this.boat, boost = input.boost ? 3 : 1;
    const fx = Math.cos(b.heading), fy = Math.sin(b.heading);
    let fwd = b.vx * fx + b.vy * fy, lat = -b.vx * fy + b.vy * fx;
    b.heading += (input.steer || 0) * BOAT_TURN * dt * Math.min(1, 0.3 + Math.abs(fwd) / 4);
    b.throttle = input.throttle || 0;
    const nfx = Math.cos(b.heading), nfy = Math.sin(b.heading);
    // the push is along the heading; the keel holds the boat against sliding sideways; the water slows it
    fwd += b.throttle * BOAT_ACC * boost * dt;
    const top = BOAT_TOP * (input.boost ? 2 : 1);
    if (Math.abs(fwd) > top) fwd = Math.sign(fwd) * Math.max(top, Math.abs(fwd) - 40 * dt);
    fwd *= Math.exp(-(b.throttle ? 0.12 : 0.5) * dt);
    lat *= Math.exp(-3 * dt);
    b.vx = nfx * fwd - nfy * lat; b.vy = nfy * fwd + nfx * lat;
    b.x += b.vx * dt; b.y += b.vy * dt;
  }

  /** The boat over a hull becomes the guy on her deck by itself, unless it has just taken off from her. Over a ship of the map that has not been opened, she is asked for first. */
  landIfOver() {
    const b = this.boat;
    this.left = this.left.filter((i) => this.sea[i] && hullDepth(this.sea[i].deck.hull, this.local(i, b)) >= 0);
    const i = this.shipUnder(b, this.left);
    if (i !== null) { this.board(i, b); return; }
    if (this.left.length) return;
    const dot = this.atlas.dotUnder(b.x, b.y);
    if (dot && !this.asked.has(key(dot.name)) && this.canOpen()) {
      this.asked.add(key(dot.name));
      this.wantLand = key(dot.name);
      this.events.push({ type: 'open', name: dot.name, arrival: 'land' });
    }
  }

  /** What he is next to, and what E or Space would do. */
  lookAround() {
    this.nearCrack = -1; this.nearStation = null; this.nearRoom = -1;
    this.prompt = '';
    if (this.aboard !== null && this.human) {
      const m = this.sea[this.aboard];
      if (!m) return;
      const p = this.local(this.aboard, this.human), level = this.human.level;
      // (at a station it is the station, even where a crack is also within reach)
      this.nearStation = m.deck.stationNear(level, p, STATION_REACH);
      // the cracks and the rooms (the files) are in the hold
      if (level === 'hold') { this.nearCrack = m.deck.crackNear(p, REACH); this.nearRoom = m.deck.roomAt(p); }
      if (this.reading) this.prompt = 'E: close';
      else if (this.nearStation) this.prompt = PROMPTS[this.nearStation.id];
      else if (this.nearCrack >= 0) { const issue = m.issues[m.deck.cracks[this.nearCrack].issue]; this.prompt = `E: read #${issue.number} ${issue.title}`; }
      else if (this.nearRoom >= 0) this.prompt = `E: open ${m.files[m.deck.cells[this.nearRoom].file][0]}`;
      else this.prompt = 'Space: back to your boat';
    } else {
      const i = this.shipToLandOn();
      if (i !== null) { this.focus = i; this.prompt = `Space: land on ${this.sea[i].repo.fullName}`; } else if (this.wantLand) this.prompt = 'opening a ship...';
    }
  }

  /** E: reads the crack beside him, or uses the station, or opens the file of the room he stands in. */
  useHere() {
    if (this.reading) { this.reading = null; return; }
    if (this.aboard === null) return;
    const m = this.sea[this.aboard];
    if (this.nearStation?.to) {
      const to = this.nearStation.to;
      this.placeAt(this.aboard, to.level, { x: to.x, y: to.y });
      this.events.push({ type: 'level', ship: this.aboard, level: to.level });
    } else if (this.nearStation) this.events.push({ type: 'station', ship: this.aboard, id: this.nearStation.id });
    else if (this.nearCrack >= 0) this.reading = { ship: this.aboard, issue: m.deck.cracks[this.nearCrack].issue };
    else if (this.nearRoom >= 0) this.events.push({ type: 'file', ship: this.aboard, file: m.deck.cells[this.nearRoom].file });
  }

  /** A click on the sea or the deck (a world point; `double` is the second of two): aboard it walks him there, and to a crack to read it. */
  click(p, double = false) {
    if (this.aboard !== null) {
      const m = this.sea[this.aboard];
      const local = this.local(this.aboard, p);
      const c = this.level === 'hold' ? m.deck.crackNear(local, 1.2) : -1;
      if (c >= 0) this.walkTo = { ship: this.aboard, x: m.deck.cracks[c].pts[0].x, y: m.deck.cracks[c].pts[0].y, read: m.deck.cracks[c].issue };
      else if (m.deck.contains(this.level, local, 0.1)) this.walkTo = { ship: this.aboard, x: local.x, y: local.y, read: null };
      return;
    }
    const i = this.shipUnder(p);
    if (i !== null) {
      this.focus = i;
      if (double) this.board(i, p);
    } else if (double && this.atlas.dotUnder(p.x, p.y)) {
      Object.assign(this.boat, { x: p.x, y: p.y, vx: 0, vy: 0 });
    }
  }

  /** An opened ship's issues have changed (one was opened or closed): her cracks are made again, where they are she keeps her place. */
  setIssues(i, issues, moreIssues, checks) {
    const m = this.sea[i];
    if (!m) return;
    m.issues = issues;
    m.moreIssues = moreIssues;
    if (checks) m.checks = checks;
    m.deck = new Deck(m.files, m.item, issues);
    if (this.reading?.ship === i) this.reading = null;
    this.lookAround();
  }

  /** The condition of an opened ship now. */
  conditionOf(i) { return condition(this.sea[i].repo, this.now()); }
}
