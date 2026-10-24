// A ship as a place to walk on, in metres (a person is about 1.8). She has three storeys over one hull:
//   the helm, a raised platform on the roof of the captain's quarters at the stern (the wheel: manage the repo);
//   the main deck (the flag, the tavern table where the discussions are, the hatch down, the door of the quarters, the stairs up);
//   the hold below deck: the file rooms and walls from the treemap, and the cracks, one for every place an open issue touches.
// Under the helm, at deck level, are the captain's quarters: the owner's profile and the top contributors.
// (0, 0) is the top left corner of the deck; x runs from stern to bow, y across. Pure geometry, so the tests need no browser.

import * as treemap from './treemap.js';
import { clamp, rng } from './util.js';

/** How far the hull reaches aft of the deck, and how far her sides stand out from it. */
export const MARGIN = 3.5;
export const SIDE = 4.5;
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
  // a long ship is not made as fat as she is long: beyond a middling size her beam grows slowly, so that a huge repo is a long ship, not a box
  return { w, h: w <= 150 ? w * 0.42 : 63 + (w - 150) * 0.14 };
}

/**
 * The lines of the ship: how wide she is at each place along her (the plan), how deep her keel is, how high her rail stands, and how far
 * from the middle her side is at a height. A fuller midship, a squarish stern that narrows a little, a long pointed bow, a keel that is
 * deepest aft and comes up forward, a rail that sweeps up at the bow, and a side that flares out as it rises.
 */
export function shipLines({ w, h }, { castle = true } = {}) {
  const cy = h / 2, x0 = -MARGIN, bow = clamp(w * 0.4, 12, 120), x1 = w + bow, L = x1 - x0, bmax = h / 2 + SIDE, xs = w * 0.45;
  const beam = (x) => {
    if (x <= x0) return bmax * 0.8;
    if (x >= x1) return 0;
    if (x < x0 + 6) { const t = (x - x0) / 6; return bmax * (0.8 + 0.2 * (1 - (1 - t) * (1 - t))); }
    if (x <= xs) return bmax;
    const r = (x - xs) / (x1 - xs);
    return bmax * (1 - r * r); // a parabola: the sides come to a true point
  };
  const u = (x) => clamp((x - x0) / L, 0, 1);
  const keel = (x) => 3.6 * (1 - 0.85 * Math.pow(u(x), 4));
  const castleX1 = castle ? x0 + clamp(w * 0.16, 7, 14) : x0, castleTop = DECK_Y + HELM_RISE - 0.25;
  const bulwark = (x) => DECK_Y + 0.9 + 2.6 * Math.pow(u(x), 5) + 0.5 * Math.pow(1 - u(x), 6);
  // the rail stands as high as the roof of the stern castle all along it, then steps down to the bulwark and sweeps up again at the bow
  const rail = (x) => {
    if (castle && x <= castleX1) return castleTop;
    const t = clamp((x - castleX1) / 0.9, 0, 1), s = t * t * (3 - 2 * t);
    return castleTop + (bulwark(x) - castleTop) * s;
  };
  // the distance of the side from the middle, at a height above the sea: flared above the water, and a box-like curve down to the keel
  const lateral = (x, y) => {
    const b = beam(x);
    if (y >= 0) return b * (0.93 + 0.07 * (y / DECK_Y));
    const t = clamp(-y / keel(x), 0, 1);
    return b * 0.93 * Math.pow(1 - Math.pow(t, 4), 0.25);
  };
  return { cy, x0, x1, L, bmax, xs, beam, keel, rail, lateral, bow, castleX1, castleTop };
}

/** The hull seen from above at the main deck (the line the rail stands on), going clockwise (y down). */
export function hullFor(size) {
  const { cy, x0, x1, xs, beam } = shipLines(size);
  const xsList = [x0, x0 + 1.5, x0 + 3, x0 + 6, (x0 + 6 + xs) / 2, xs];
  const N = clamp(Math.ceil((x1 - xs) / 5), 16, 70); // longer ships have more points along the bow, so that the outline stays true
  for (let i = 1; i < N; i++) xsList.push(xs + (x1 - xs) * (1 - Math.pow(1 - i / N, 1.6)));
  const side = xsList.map((x) => ({ x, y: cy - beam(x) }));
  const back = [...xsList].reverse().map((x) => ({ x, y: cy + beam(x) }));
  return [...side, { x: x1, y: cy }, ...back];
}

/** The hull at the water line seen from above (the hole the hull makes in the sea). */
export function waterlineFor(size) {
  const { cy, x0, x1, lateral } = shipLines(size);
  const xs = Array.from({ length: 41 }, (_, i) => x0 + ((x1 - x0) * i) / 40);
  return [...xs.map((x) => ({ x, y: cy - lateral(x, 0) })), ...[...xs].slice(0, -1).reverse().map((x) => ({ x, y: cy + lateral(x, 0) }))];
}

/** The floor of the hold seen from above: the hull's width at the height of the floor, as far forward as the keel is below it. */
export function holdHullFor(size) {
  const lines = shipLines(size), { cy, x0, x1, lateral } = lines;
  const floorDeep = (x) => lines.keel(x) > -HOLD_Y + 0.5;
  let xb = x0;
  for (let x = x0; x <= x1; x += 0.5) if (floorDeep(x)) xb = x;
  const xsList = [];
  for (let i = 0; i <= 14; i++) xsList.push(x0 + ((xb - x0) * i) / 14);
  const half = (x) => lateral(x, HOLD_Y) - 0.15;
  return [...xsList.map((x) => ({ x, y: cy - half(x) })), ...[...xsList].reverse().map((x) => ({ x, y: cy + half(x) }))];
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

const wide = (a, b, n) => Array.from({ length: n }, (_, k) => a + ((b - a) * k) / (n - 1));

/** The rectangle of the hold that the file rooms fill: as far forward as the hold is nearly as wide as amidships, and as wide as it is there. */
function fitPlan(size, lines) {
  const half = (x) => lines.lateral(x, HOLD_Y) - 0.15;
  const holdEnd = Math.max(...wide(lines.x0, lines.x1, 400).filter((x) => lines.keel(x) > -HOLD_Y + 0.5));
  const mid = half(lines.xs * 0.5);
  let xr = lines.xs;
  while (xr + 0.5 < holdEnd - 1.5 && half(xr + 0.5) >= 0.84 * mid) xr += 0.5;
  const x = 0, hy = Math.min(...wide(x, xr, 40).map(half)) - 1.9;
  return { x, y: lines.cy - hy, w: xr - x, h: 2 * hy };
}

export class Deck {
  /** files: [[path, size]], item: treemap.build(files), issues: [{ number, files, comments }], talk: null | { enabled, list } (the discussions) */
  constructor(files, item, issues, talk = null) {
    this.size = deckSize(files.length);
    const { w, h } = this.size;
    this.lines = shipLines(this.size);
    const { cy, x0, x1, beam } = this.lines;
    this.hull = hullFor(this.size);
    this.holdHull = holdHullFor(this.size);
    this.waterline = waterlineFor(this.size);
    this.bow = { x: x1, y: cy };
    // the file rooms are in the hold
    this.plan = fitPlan(this.size, this.lines);
    this.cells = treemap.layout(item, this.plan, 0.3);
    this.fileCell = new Map();
    this.cells.forEach((c, i) => { if (c.file !== null) this.fileCell.set(c.file, i); });
    // the stern castle: the whole back of the ship, the captain's quarters under the helm on its roof
    const xc1 = this.lines.castleX1;
    this.castle = { x0, x1: xc1, poly: this.castlePolygon(x0, xc1) };
    this.spawn = { x: Math.max(w * 0.5, xc1 + 8), y: cy };
    const hatch = { x: Math.max(w * 0.3, xc1 + 9), y: cy - 3.8 };
    this.hatch = hatch;
    this.mast = { x: Math.max(w * 0.42, hatch.x + 6), y: cy };
    const sy = beam(xc1 + 4) - 2.6;
    // the flag stands where the bow has narrowed to a few metres
    let fx = x1;
    while (fx > x0 && hullDepth(this.hull, { x: fx, y: cy }) < 2.6) fx -= 0.25;
    const at = (level, id, x, y, label, to) => ({ id, level, x, y, label, ...(to ? { to } : {}) });
    this.stations = [
      at('deck', 'flag', fx, cy, 'the flag'),
      at('deck', 'hatch', hatch.x, hatch.y, 'the hatch down to the hold', { level: 'hold', x: hatch.x, y: hatch.y + 2.0 }),
      at('deck', 'door', xc1 + 1.0, cy, "the captain's quarters", { level: 'quarters', x: xc1 - 1.5, y: cy }),
      at('deck', 'stairsUp', xc1 + 4.3, cy - sy, 'the stairs up to the helm', { level: 'helm', x: xc1 - 1.6, y: cy - sy }),
      at('deck', 'stairsUp2', xc1 + 4.3, cy + sy, 'the stairs up to the helm', { level: 'helm', x: xc1 - 1.6, y: cy + sy }),
      at('hold', 'ladder', hatch.x, hatch.y + 1.4, 'the ladder up to the deck', { level: 'deck', x: hatch.x, y: hatch.y + 2.4 }),
      at('helm', 'wheel', x0 + 2.2, cy, 'the wheel'),
      at('helm', 'stairsDown', xc1 - 1.2, cy - sy, 'the stairs down to the deck', { level: 'deck', x: xc1 + 5.0, y: cy - sy }),
      at('helm', 'stairsDown2', xc1 - 1.2, cy + sy, 'the stairs down to the deck', { level: 'deck', x: xc1 + 5.0, y: cy + sy }),
      at('quarters', 'desk', x0 + 1.8, cy, "the captain's desk"),
      at('quarters', 'out', xc1 - 1.0, cy, 'the door to the deck', { level: 'deck', x: xc1 + 1.8, y: cy }),
    ];
    this.setTables(talk);
    this.cracks = [];
    this.crackUp(files, issues);
  }

  /** The back of the hull from the transom to `x1`, as a polygon (the footprint of the stern castle). */
  castlePolygon(x0, x1) {
    const { cy, beam } = this.lines, xs = wide(x0, x1, 7);
    return [...xs.map((x) => ({ x, y: cy - beam(x) })), ...[...xs].reverse().map((x) => ({ x, y: cy + beam(x) }))];
  }

  /** The places a table can stand on the main deck: forward of the mast, in rows across the ship, clear of the flag. */
  tableSpots() {
    const { w } = this.size, { cy } = this.lines, flag = this.station('flag'), mx = this.mast.x, spots = [];
    const x0 = Math.max(w * 0.5, this.mast.x + 4), cols = this.size.h > 30 ? 4 : 3;
    for (let r = 0; r < 40; r++) {
      for (let c = 0; c < cols; c++) {
        const p = { x: x0 + r * 5.2, y: cy + (c - (cols - 1) / 2) * 5.8 };
        if (this.contains('deck', p, 2.2) && Math.hypot(p.x - flag.x, p.y - flag.y) > 4 && Math.hypot(p.x - mx, p.y - cy) > 2.5) spots.push(p);
      }
    }
    return spots;
  }

  /**
   * Puts a table on the deck for every discussion (the newest first, as many as there is room for, twelve at most). `talk` is null when they are
   * not known (they need a token), or { enabled, list }. With none to show there is one table that says why.
   */
  setTables(talk) {
    this.stations = this.stations.filter((s) => s.id !== 'table');
    const spots = this.tableSpots();
    const mk = (p, i, extra) => ({ id: 'table', level: 'deck', x: p.x, y: p.y, index: i, ...extra });
    const list = talk && talk.enabled ? talk.list.slice(0, Math.min(12, spots.length)) : [];
    if (list.length) list.forEach((d, i) => this.stations.push(mk(spots[i], i, { kind: 'talk', number: d.number, title: d.title, comments: d.comments, label: d.title })));
    else if (spots.length) this.stations.push(mk(spots[0], 0, { kind: talk === null ? 'locked' : talk.enabled ? 'empty' : 'off', number: null, title: '', comments: 0, label: 'the table' }));
    this.tables = this.stations.filter((s) => s.id === 'table');
  }

  stationsOf(level) { return this.stations.filter((s) => s.level === level); }
  station(id) { return this.stations.find((s) => s.id === id); }

  crackUp(files, issues) {
    const at = new Map(files.map((f, i) => [f[0], i]));
    const half = (x) => this.lines.lateral(x, HOLD_Y) - 0.15;
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
        // an issue that names no file breaks the hull itself: a crack along the side wall of the hold
        const r = rng((issue.number * 7919) ^ 0xa5a5);
        const top = r() < 0.5, x = this.plan.x + this.plan.w * (0.1 + 0.8 * r());
        const off = half(x) - 1.3 - r() * 0.5;
        this.cracks.push(makeCrack(r, n, null, { x, y: this.lines.cy + (top ? -off : off) }, 3.5 * long));
      }
    });
  }

  /** Whether a point can be stood on at a level, at least `inset` further in than the usual edge. */
  contains(level, p, inset = 0) {
    const { x0 } = this.lines, c = this.castle;
    switch (level) {
      case 'hold': return hullContains(this.holdHull, p, 0.9 + inset);
      case 'deck': return hullContains(this.hull, p, RAIL + inset) && p.x > c.x1 + 0.35 - inset;
      case 'helm': return hullContains(this.hull, p, 0.9 + inset) && p.x >= x0 + 0.3 + inset && p.x <= c.x1 - 0.2 - inset;
      case 'quarters': return hullContains(this.hull, p, 1.4 + inset) && p.x >= x0 + 0.6 + inset && p.x <= c.x1 - 0.6 - inset;
      default: return false;
    }
  }

  /** The nearest place he may stand on that level: the point itself, or the edge it ran into (a wall is slid along). */
  clamp(level, p) {
    if (this.contains(level, p)) return { x: p.x, y: p.y };
    const { x0, cy } = this.lines, c = this.castle;
    let q = { x: p.x, y: p.y };
    if (level === 'deck') q.x = Math.max(q.x, c.x1 + 0.4);
    if (level === 'helm') q.x = clamp(q.x, x0 + 0.4, c.x1 - 0.3);
    if (level === 'quarters') q.x = clamp(q.x, x0 + 0.7, c.x1 - 0.7);
    if (this.contains(level, q)) return q;
    const centre = { hold: { x: (this.plan.x + this.plan.w / 2), y: cy }, deck: { x: Math.max(this.size.w * 0.5, c.x1 + 8), y: cy }, helm: { x: (x0 + c.x1) / 2, y: cy }, quarters: { x: (x0 + c.x1) / 2, y: cy } }[level];
    let lo = 0, hi = 1;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (this.contains(level, { x: centre.x + (q.x - centre.x) * mid, y: centre.y + (q.y - centre.y) * mid })) lo = mid; else hi = mid;
    }
    return { x: centre.x + (q.x - centre.x) * lo, y: centre.y + (q.y - centre.y) * lo };
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
