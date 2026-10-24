// A ship as a place to walk on, in metres (a person is about 1.8). She has three storeys over one hull:
//   the helm, a raised platform on the roof of the captain's quarters at the stern (the wheel: manage the repo);
//   the main deck (the flag, the tavern table where the discussions are, the hatch down, the door of the quarters, the stairs up);
//   the hold below deck: the file rooms and walls from the treemap, and the cracks, one for every place an open issue touches.
// Under the helm, at deck level, are the captain's quarters: the owner's profile and the top contributors.
// (0, 0) is the top left corner of the deck; x runs from stern to bow, y across. Pure geometry, so the tests need no browser.

import * as treemap from './treemap.js';
import { clamp, rng } from './util.js';

/** How far the hull reaches beyond the deck on every side but the bow. */
export const MARGIN = 3.5;
/** How near the edge of the hull he may walk on deck, and in the hold (where the hull's walls are thicker). */
export const RAIL = 0.7;
export const HOLD_RAIL = 1.1;
/** Heights above the sea: the main deck, the floor of the hold (below the deck), and how far the helm is above the deck. */
export const DECK_Y = 2.2;
export const HOLD_Y = -2.2;
export const HELM_RISE = 3.0;
/** The storeys, and how high a person stands on each. */
export const LEVELS = ['hold', 'deck', 'helm', 'quarters'];
export const levelY = (level) => ({ hold: HOLD_Y, deck: DECK_Y, helm: DECK_Y + HELM_RISE, quarters: DECK_Y })[level];

/** How big the deck of a ship with this many files is: more files, a longer ship (but never a dinghy, and never a harbour). */
export function deckSize(files) {
  const w = clamp(25 + 7 * Math.sqrt(files), 35, 300);
  return { w, h: w * 0.55 };
}

/** The hull: a long deck with chamfered stern corners and a rounded, pointed bow, going clockwise (y down). */
export function hullFor({ w, h }) {
  const bowLen = clamp(w * 0.18, 8, 35), cx = w + 1, cy = h / 2, ry = h / 2 + MARGIN;
  const pts = [{ x: -MARGIN + 2, y: -MARGIN }, { x: cx, y: -MARGIN }];
  for (let k = 1; k <= 15; k++) {
    const a = -Math.PI / 2 + (Math.PI * k) / 16;
    pts.push({ x: cx + bowLen * Math.cos(a), y: cy + ry * Math.sin(a) });
  }
  pts.push({ x: cx, y: h + MARGIN }, { x: -MARGIN + 2, y: h + MARGIN }, { x: -MARGIN, y: h + MARGIN - 2 }, { x: -MARGIN, y: -MARGIN + 2 });
  return pts;
}

/** How far inside a convex outline a point is: the distance to the nearest edge, negative outside. */
export function hullDepth(hull, p) {
  let area = 0;
  for (let i = 0; i < hull.length; i++) { const a = hull[i], b = hull[(i + 1) % hull.length]; area += a.x * b.y - b.x * a.y; }
  const turn = area >= 0 ? 1 : -1;
  let depth = Infinity;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i], b = hull[(i + 1) % hull.length];
    const ex = b.x - a.x, ey = b.y - a.y, len = Math.hypot(ex, ey);
    if (len < 1e-6) continue;
    depth = Math.min(depth, (turn * (ex * (p.y - a.y) - ey * (p.x - a.x))) / len);
  }
  return depth;
}

export const hullContains = (hull, p, inset = 0) => hullDepth(hull, p) >= inset;

export function distToSegment(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y, len2 = abx * abx + aby * aby;
  const t = len2 > 0 ? clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / len2, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + abx * t), p.y - (a.y + aby * t));
}

/** A crooked line of about `len` long, going `heading` ways. */
function jagged(r, start, heading, len, steps) {
  const pts = [start];
  let h = heading;
  for (let i = 0; i < steps; i++) {
    h += (r() - 0.5) * 1.4;
    const last = pts[pts.length - 1], l = (len / steps) * (0.6 + r() * 0.8);
    pts.push({ x: last.x + Math.cos(h) * l, y: last.y + Math.sin(h) * l });
  }
  return pts;
}

function makeCrack(r, issue, file, start, len) {
  const heading = file !== null ? r() * Math.PI * 2 : start.y < 0 ? Math.PI / 2 + (r() - 0.5) * 0.8 : -Math.PI / 2 + (r() - 0.5) * 0.8;
  const pts = jagged(r, start, heading, len, 7 + Math.floor(r() * 4));
  const from = pts[pts.length >> 1], side = r() < 0.5 ? 0.9 : -0.9;
  const branch = jagged(r, from, heading + side, len * 0.45, 3 + Math.floor(r() * 2));
  return { issue, file, pts, branch, width: 0.1 + len * 0.02 };
}

export function crackDistance(c, p) {
  let d = Infinity;
  for (const line of [c.pts, c.branch]) for (let i = 0; i + 1 < line.length; i++) d = Math.min(d, distToSegment(p, line[i], line[i + 1]));
  return d;
}

const inRect = (r, p) => p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;
const grow = (r, d) => ({ x0: r.x0 - d, y0: r.y0 - d, x1: r.x1 + d, y1: r.y1 + d });

export class Deck {
  /** files: [[path, size]], item: treemap.build(files), issues: [{ number, files, comments }] */
  constructor(files, item, issues) {
    this.size = deckSize(files.length);
    this.hull = hullFor(this.size);
    this.bow = this.hull.reduce((a, b) => (b.x > a.x ? b : a));
    // the file rooms are in the hold
    this.cells = treemap.layout(item, { x: 0, y: 0, w: this.size.w, h: this.size.h }, 0.3);
    this.fileCell = new Map();
    this.cells.forEach((c, i) => { if (c.file !== null) this.fileCell.set(c.file, i); });
    const { w, h } = this.size, cy = h / 2;
    this.spawn = { x: w * 0.5, y: cy };
    // the captain's quarters at the stern, and the helm on their roof
    const cw = clamp(h * 0.45, 7, 12), cl = clamp(w * 0.12, 6, 9);
    this.cabin = { x0: -MARGIN + 1, y0: cy - cw / 2, x1: -MARGIN + 1 + cl, y1: cy + cw / 2 };
    const c = this.cabin, hatch = { x: w * 0.3, y: cy - 3.8 }, stairsX = c.x0 + 3;
    this.hatch = hatch;
    const at = (level, id, x, y, label, to) => ({ id, level, x, y, label, ...(to ? { to } : {}) });
    this.stations = [
      at('deck', 'flag', this.bow.x - 1.6, cy, 'the flag'),
      at('deck', 'tavern', w * 0.62, cy + 4.2, 'the tavern table'),
      at('deck', 'hatch', hatch.x, hatch.y, 'the hatch down to the hold', { level: 'hold', x: hatch.x, y: hatch.y + 2.0 }),
      at('deck', 'door', c.x1 + 1.0, cy, "the captain's quarters", { level: 'quarters', x: c.x1 - 1.5, y: cy }),
      at('deck', 'stairsUp', stairsX, c.y0 - 3.9, 'the stairs up to the helm', { level: 'helm', x: stairsX, y: c.y0 + 1.5 }),
      at('hold', 'ladder', hatch.x, hatch.y + 1.4, 'the ladder up to the deck', { level: 'deck', x: hatch.x, y: hatch.y + 2.4 }),
      at('helm', 'wheel', c.x0 + 1.8, cy, 'the wheel'),
      at('helm', 'stairsDown', stairsX, c.y0 + 1.1, 'the stairs down to the deck', { level: 'deck', x: stairsX, y: c.y0 - 4.3 }),
      at('quarters', 'desk', c.x0 + 1.5, cy, "the captain's desk"),
      at('quarters', 'out', c.x1 - 1.0, cy, 'the door to the deck', { level: 'deck', x: c.x1 + 1.8, y: cy }),
    ];
    this.cracks = [];
    this.crackUp(files, issues);
  }

  stationsOf(level) { return this.stations.filter((s) => s.level === level); }
  station(id) { return this.stations.find((s) => s.id === id); }

  crackUp(files, issues) {
    const at = new Map(files.map((f, i) => [f[0], i]));
    issues.forEach((issue, n) => {
      const rooms = (issue.files || []).map((f) => at.get(f)).filter((f) => f !== undefined && this.fileCell.has(f)).slice(0, 3);
      const long = 1 + 0.06 * Math.min(issue.comments || 0, 10);
      for (const f of rooms) {
        const r = rng((issue.number * 7919) ^ (f * 104729));
        const c = this.cells[this.fileCell.get(f)].rect, m = Math.min(c.w, c.h) * 0.15;
        const start = { x: c.x + m + r() * Math.max(c.w - 2 * m, 0.01), y: c.y + m + r() * Math.max(c.h - 2 * m, 0.01) };
        this.cracks.push(makeCrack(r, n, f, start, clamp(Math.min(c.w, c.h) * 0.8, 0.9, 5.5) * long));
      }
      if (!rooms.length) {
        // an issue that names no file breaks the hull itself, along the sides of the hold
        const r = rng((issue.number * 7919) ^ 0xa5a5);
        const top = r() < 0.5, x = this.size.w * (0.12 + 0.76 * r());
        const y = top ? -MARGIN + HOLD_RAIL + 0.1 + r() * (MARGIN - HOLD_RAIL - 0.6) : this.size.h + 0.5 + r() * (MARGIN - HOLD_RAIL - 0.6);
        this.cracks.push(makeCrack(r, n, null, { x, y }, 3.5 * long));
      }
    });
  }

  /** Whether a point can be stood on at a level, at least `inset` further in than the usual edge. */
  contains(level, p, inset = 0) {
    switch (level) {
      case 'hold': return hullContains(this.hull, p, HOLD_RAIL + inset);
      case 'deck': return hullContains(this.hull, p, RAIL + inset) && !inRect(grow(this.cabin, 0.35 - inset), p);
      case 'helm': return inRect(grow(this.cabin, -(0.4 + inset)), p);
      case 'quarters': return inRect(grow(this.cabin, -(0.6 + inset)), p);
      default: return false;
    }
  }

  /** The nearest place he may stand on that level: the point itself, or the edge it ran into (a wall is slid along). */
  clamp(level, p) {
    if (this.contains(level, p)) return { x: p.x, y: p.y };
    if (level === 'helm' || level === 'quarters') {
      const r = grow(this.cabin, -(level === 'helm' ? 0.4 : 0.6));
      return { x: clamp(p.x, r.x0, r.x1), y: clamp(p.y, r.y0, r.y1) };
    }
    let q = { x: p.x, y: p.y };
    if (level === 'deck') {
      const r = grow(this.cabin, 0.35);
      if (inRect(r, q)) {
        const sides = [[q.x - r.x0, 'x0'], [r.x1 - q.x, 'x1'], [q.y - r.y0, 'y0'], [r.y1 - q.y, 'y1']].sort((a, b) => a[0] - b[0]);
        const side = sides[0][1];
        q = side === 'x0' || side === 'x1' ? { x: r[side], y: q.y } : { x: q.x, y: r[side] };
      }
      if (this.contains('deck', q)) return q;
    }
    const c = { x: this.size.w * 0.55, y: this.size.h / 2 };
    let lo = 0, hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (this.contains(level, { x: c.x + (q.x - c.x) * mid, y: c.y + (q.y - c.y) * mid })) lo = mid; else hi = mid;
    }
    return { x: c.x + (q.x - c.x) * lo, y: c.y + (q.y - c.y) * lo };
  }

  /** The room (of the hold) a point is in (index into cells), if it is in one. */
  roomAt(p) {
    for (let i = this.cells.length - 1; i >= 0; i--) {
      const c = this.cells[i];
      if (c.file !== null && p.x >= c.rect.x && p.x <= c.rect.x + c.rect.w && p.y >= c.rect.y && p.y <= c.rect.y + c.rect.h) return i;
    }
    return -1;
  }

  /** The crack nearest a point, if one is within `reach` of it (index into cracks, else -1). */
  crackNear(p, reach) {
    let best = -1, bd = reach;
    this.cracks.forEach((c, i) => { const d = crackDistance(c, p); if (d <= bd) { bd = d; best = i; } });
    return best;
  }

  /** The station of a level nearest a point, if one is within `reach` of it. */
  stationNear(level, p, reach) {
    let best = null, bd = reach;
    for (const s of this.stationsOf(level)) { const d = Math.hypot(p.x - s.x, p.y - s.y); if (d <= bd) { bd = d; best = s; } }
    return best;
  }
}
