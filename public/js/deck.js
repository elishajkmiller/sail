// A ship's deck as a place to walk on, in metres (a person is about 1.8): the hull, the rooms (files) and walls (folders) from the treemap,
// the three stations (flag, tavern table, wheel) and the cracks, one for every place an open issue touches. (0, 0) is the top left corner
// of the deck; x runs from stern to bow, y across. Pure geometry, so the tests need no browser.

import * as treemap from './treemap.js';
import { clamp, rng } from './util.js';

/** How far the hull reaches beyond the deck on every side but the bow. */
export const MARGIN = 3.5;
/** How near the edge of the hull he may walk. */
export const RAIL = 0.7;

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

export class Deck {
  /** files: [[path, size]], item: treemap.build(files), issues: [{ number, files, comments }] */
  constructor(files, item, issues) {
    this.size = deckSize(files.length);
    this.hull = hullFor(this.size);
    this.bow = this.hull.reduce((a, b) => (b.x > a.x ? b : a));
    this.cells = treemap.layout(item, { x: 0, y: 0, w: this.size.w, h: this.size.h }, 0.3);
    this.fileCell = new Map();
    this.cells.forEach((c, i) => { if (c.file !== null) this.fileCell.set(c.file, i); });
    const cy = this.size.h / 2;
    this.spawn = { x: 0.6, y: cy };
    // the three things a developer does on a ship: raise the flag (star), sit at the table (discussions), take the wheel (manage)
    this.stations = [
      { id: 'flag', x: this.bow.x - 1.6, y: cy, label: 'the flag' },
      { id: 'tavern', x: -1.8, y: cy - 4.2, label: 'the tavern table' },
      { id: 'wheel', x: -1.8, y: cy + 4.2, label: 'the wheel' },
    ];
    this.cracks = [];
    this.crackUp(files, issues);
  }

  crackUp(files, issues) {
    const at = new Map(files.map((f, i) => [f[0], i]));
    issues.forEach((issue, n) => {
      const rooms = (issue.files || []).map((f) => at.get(f)).filter((f) => f !== undefined && this.fileCell.has(f)).slice(0, 3);
      const grow = 1 + 0.06 * Math.min(issue.comments || 0, 10);
      for (const f of rooms) {
        const r = rng((issue.number * 7919) ^ (f * 104729));
        const c = this.cells[this.fileCell.get(f)].rect, m = Math.min(c.w, c.h) * 0.15;
        const start = { x: c.x + m + r() * Math.max(c.w - 2 * m, 0.01), y: c.y + m + r() * Math.max(c.h - 2 * m, 0.01) };
        this.cracks.push(makeCrack(r, n, f, start, clamp(Math.min(c.w, c.h) * 0.8, 0.9, 5.5) * grow));
      }
      if (!rooms.length) {
        // an issue that names no file breaks the hull itself, along the sides
        const r = rng((issue.number * 7919) ^ 0xa5a5);
        const top = r() < 0.5, x = this.size.w * (0.12 + 0.76 * r());
        const y = top ? -MARGIN + 1.1 + r() * (MARGIN - 1.6) : this.size.h + 0.5 + r() * (MARGIN - 1.6);
        this.cracks.push(makeCrack(r, n, null, { x, y: top ? y : y }, 3.5 * grow));
      }
    });
  }

  contains(p, inset = 0) { return hullContains(this.hull, p, inset); }

  /** The nearest place he may stand: the point itself, or where the line from the middle of the deck to it meets the rail. */
  clamp(p) {
    if (this.contains(p, RAIL)) return { x: p.x, y: p.y };
    const c = { x: this.size.w / 2, y: this.size.h / 2 };
    let lo = 0, hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (this.contains({ x: c.x + (p.x - c.x) * mid, y: c.y + (p.y - c.y) * mid }, RAIL)) lo = mid; else hi = mid;
    }
    return { x: c.x + (p.x - c.x) * lo, y: c.y + (p.y - c.y) * lo };
  }

  /** The room a point is in (index into cells), if it is in one. */
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

  /** The station nearest a point, if one is within `reach` of it. */
  stationNear(p, reach) {
    let best = null, bd = reach;
    for (const s of this.stations) { const d = Math.hypot(p.x - s.x, p.y - s.y); if (d <= bd) { bd = d; best = s; } }
    return best;
  }
}
