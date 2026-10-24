// The sea as it has been found so far. Nothing is built beforehand: when a ship is opened, the repos that her newest stargazers also starred
// (see github.js neighbours) are put around her, closer the more strongly they are tied to her, and pulled toward any ship already on the
// map that is tied to them too. So the map grows outward from where you have been, and a place stays where it was put. Distances are in
// metres; a ship of the map that has not been opened is drawn at her place with a length that follows her stars.

import { clamp, hash32, rng, valid } from './util.js';

/** The length of a hull from her stars (before she is opened, when her files are not known). */
export const hullLength = (stars) => clamp(18 + 8 * Math.log10((stars || 0) + 10), 24, 80);

/** Roughly how long (x) and how wide (y) a ship lies on the sea, for keeping hulls apart. */
const lengthOf = (e) => hullLength(e.stars) * 1.25 + 4;
const widthOf = (e) => hullLength(e.stars) * 0.55 + 7;

/** How far apart the neighbours of a ship are put: the nearest, and a step further for each fall in how tied they are. */
export const GAP = 120;
const CELL = 250;
const key = (name) => name.toLowerCase();

export class Atlas {
  constructor() {
    /** name (lower case) -> { name, stars, language, pushedAt, x, y, neighbours: [{name, score, shared}], expandedAt } */
    this.entries = new Map();
    this.grid = new Map();
    /** name -> [{ from, score }]: who lists this ship as a neighbour */
    this.incoming = new Map();
  }

  get size() { return this.entries.size; }
  get(name) { return this.entries.get(key(name)); }
  placed(e) { return e && Number.isFinite(e.x) && Number.isFinite(e.y); }

  cellOf(x, y) { return `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`; }

  index(e) {
    const c = this.cellOf(e.x, e.y);
    if (!this.grid.has(c)) this.grid.set(c, new Set());
    this.grid.get(c).add(e);
  }

  unindex(e) { this.grid.get(this.cellOf(e.x, e.y))?.delete(e); }

  /** Makes sure a ship is known (her facts are renewed); she has no place until she is given one. */
  upsert(meta) {
    let e = this.entries.get(key(meta.name));
    if (!e) {
      e = { name: meta.name, stars: 0, language: '', pushedAt: 0, x: NaN, y: NaN, neighbours: [], expandedAt: 0 };
      this.entries.set(key(meta.name), e);
    }
    e.name = meta.name;
    if (meta.stars !== undefined) e.stars = meta.stars;
    if (meta.language !== undefined) e.language = meta.language;
    if (meta.pushedAt !== undefined) e.pushedAt = meta.pushedAt;
    return e;
  }

  setPlace(e, x, y) {
    if (this.placed(e)) this.unindex(e);
    e.x = x; e.y = y;
    this.index(e);
  }

  /** The placed ships within `reach` metres of a point that overlap an ellipse of the given size (for keeping a new ship clear of them). */
  around(x, y, reach) {
    const out = [], r = Math.ceil(reach / CELL), cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    for (let i = -r; i <= r; i++) for (let j = -r; j <= r; j++) for (const e of this.grid.get(`${cx + i},${cy + j}`) || []) out.push(e);
    return out;
  }

  /** Moves a point out of the hulls it lies in (by the smallest push), `self` being the ship that is being placed. */
  clearOf(self, x, y) {
    for (let pass = 0; pass < 40; pass++) {
      let moved = false;
      for (const o of this.around(x, y, 200)) {
        if (o === self) continue;
        const ax = (lengthOf(self) + lengthOf(o)) / 2, ay = (widthOf(self) + widthOf(o)) / 2 * 1.1;
        const dx = x - o.x, dy = y - o.y, d = Math.hypot(dx / ax, dy / ay);
        if (d < 1) {
          const ux = d > 1e-6 ? dx / ax / d : 1, uy = d > 1e-6 ? dy / ay / d : 0;
          x = o.x + ux * ax * 1.02; y = o.y + uy * ay * 1.02;
          moved = true;
        }
      }
      if (!moved) break;
    }
    return { x, y };
  }

  /** A free place near a point (a spiral out from it), for a ship that nothing ties to the map yet. */
  placeFree(e, nearX, nearY) {
    const r = rng(hash32(e.name));
    for (let k = 0; k < 400; k++) {
      const a = k * 2.399963 + r() * 0.3, d = k === 0 ? 0 : 25 + 14 * Math.sqrt(k) * 3;
      const x = nearX + Math.cos(a) * d, y = nearY + Math.sin(a) * d;
      const c = this.clearOf(e, x, y);
      if (Math.hypot(c.x - x, c.y - y) < 1) { this.setPlace(e, c.x, c.y); return e; }
    }
    const c = this.clearOf(e, nearX + 600, nearY);
    this.setPlace(e, c.x, c.y);
    return e;
  }

  /**
   * Records the neighbours found for a ship and puts the ones that have no place yet around her. A neighbour goes toward the weighted middle of
   * every placed ship that is tied to it (the one that was opened, and any other that lists it), but not nearer the opened one than a gap that
   * grows as the tie weakens; if only the opened one is tied to it, it goes round her at that gap.
   */
  addExpansion(center, found, now = Math.floor(Date.now() / 1000)) {
    const c = this.upsert(center);
    if (!this.placed(c)) this.placeFree(c, 0, 0);
    c.expandedAt = now;
    const top = Math.max(...found.map((f) => f.score), 1e-9);
    c.neighbours = found.map((f) => ({ name: f.name, score: f.score / top, shared: f.shared }));
    for (const n of c.neighbours) {
      const list = this.incoming.get(key(n.name)) || [];
      const at = list.findIndex((i) => key(i.from) === key(c.name));
      if (at >= 0) list.splice(at, 1);
      list.push({ from: c.name, score: n.score });
      this.incoming.set(key(n.name), list);
    }
    const fresh = [];
    found.forEach((f) => {
      const e = this.upsert({ name: f.name, stars: f.stars, language: f.language, pushedAt: f.pushedAt });
      if (!this.placed(e)) fresh.push(e);
    });
    fresh.forEach((e, k) => {
      const tie = c.neighbours.find((n) => key(n.name) === key(e.name)).score;
      const related = (this.incoming.get(key(e.name)) || []).map((i) => ({ e: this.get(i.from), w: i.score })).filter((r) => r.e && this.placed(r.e));
      const wsum = related.reduce((s, r) => s + r.w, 0) || 1;
      let tx = related.reduce((s, r) => s + r.e.x * r.w, 0) / wsum, ty = related.reduce((s, r) => s + r.e.y * r.w, 0) / wsum;
      const gap = GAP * (1 + 1.6 * (1 - tie));
      // never nearer the opened ship than the gap, in the direction the pull gives (or round her, when it gives none)
      const r = rng(hash32(e.name));
      let dx = tx - c.x, dy = ty - c.y, d = Math.hypot(dx, dy);
      if (d < 1) { const a = k * 2.399963 + r() * 0.5; dx = Math.cos(a); dy = Math.sin(a); d = 1; }
      const ux = dx / d, uy = dy / d, dist = Math.max(d, gap) + r() * 8;
      tx = c.x + ux * dist; ty = c.y + uy * dist;
      const p = this.clearOf(e, tx, ty);
      this.setPlace(e, p.x, p.y);
    });
    return fresh;
  }

  /** The placed ships in a rectangle of the sea. */
  dotsIn(x0, y0, x1, y1) {
    const out = [];
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) {
      for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
        for (const e of this.grid.get(`${cx},${cy}`) || []) if (e.x >= x0 && e.x <= x1 && e.y >= y0 && e.y <= y1) out.push(e);
      }
    }
    return out;
  }

  /** The placed ship whose hull (a plain ellipse of her size) a point is over, the smallest if several. */
  dotUnder(x, y) {
    let best = null, bd = Infinity;
    for (const e of this.around(x, y, 60)) {
      const d = Math.hypot((x - e.x) / (lengthOf(e) / 2), (y - e.y) / (widthOf(e) / 2));
      if (d <= 1 && d < bd) { bd = d; best = e; }
    }
    return best;
  }

  /** The placed ships near a point, nearest first. */
  near(x, y, reach) {
    return this.around(x, y, reach).filter((e) => Math.hypot(e.x - x, e.y - y) <= reach).sort((a, b) => Math.hypot(a.x - x, a.y - y) - Math.hypot(b.x - x, b.y - y));
  }

  toJSON() {
    return { v: 1, entries: [...this.entries.values()].map((e) => ({ ...e, x: this.placed(e) ? Math.round(e.x * 10) / 10 : null, y: this.placed(e) ? Math.round(e.y * 10) / 10 : null })) };
  }

  static fromJSON(obj) {
    const a = new Atlas();
    if (!obj || obj.v !== 1 || !Array.isArray(obj.entries)) return a;
    for (const raw of obj.entries.slice(0, 200000)) {
      if (typeof raw?.name !== 'string' || raw.name.split('/').length !== 2 || !raw.name.split('/').every(valid)) continue;
      const e = a.upsert({ name: raw.name, stars: Number(raw.stars) || 0, language: String(raw.language || '').slice(0, 40), pushedAt: Number(raw.pushedAt) || 0 });
      e.expandedAt = Number(raw.expandedAt) || 0;
      e.neighbours = (Array.isArray(raw.neighbours) ? raw.neighbours : []).filter((n) => typeof n?.name === 'string').slice(0, 40).map((n) => ({ name: n.name, score: Number(n.score) || 0, shared: Number(n.shared) || 0 }));
      if (Number.isFinite(raw.x) && Number.isFinite(raw.y)) a.setPlace(e, raw.x, raw.y);
    }
    for (const e of a.entries.values()) {
      for (const n of e.neighbours) {
        const list = a.incoming.get(key(n.name)) || [];
        list.push({ from: e.name, score: n.score });
        a.incoming.set(key(n.name), list);
      }
    }
    return a;
  }
}
