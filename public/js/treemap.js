// The deck plan: a squarified treemap of a ship's files. Every file is a room whose area is its size in bytes; every folder is a wall round
// its rooms. Pure geometry, in metres.

/** The files [path, size] as folders and files. A folder that holds only one folder is joined to it (`src/main/java` is one wall). */
export function build(files) {
  const root = { kids: new Map(), file: null, size: 0 };
  files.forEach(([path, size], i) => {
    let at = root;
    for (const part of path.split('/').filter(Boolean)) {
      if (!at.kids.has(part)) at.kids.set(part, { kids: new Map(), file: null, size: 0 });
      at = at.kids.get(part);
    }
    at.file = i;
    at.size = size;
  });
  const item = (name, node) => {
    const kids = [...node.kids].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([n, k]) => item(n, k));
    return { name, size: node.file !== null ? node.size : kids.reduce((s, k) => s + k.size, 0), file: node.file, kids };
  };
  const join = (it) => {
    while (it.file === null && it.kids.length === 1 && it.kids[0].file === null) {
      const only = it.kids[0];
      it = { ...only, name: `${it.name}/${only.name}` };
    }
    it.kids = it.kids.map(join);
    return it;
  };
  const top = item('', root);
  top.kids = top.kids.map(join);
  return top;
}

/** Rows of the squarified treemap: `weights` (biggest first) fill `rect`, each with the area its share of the total asks for. */
export function squarify(weights, rect) {
  const total = weights.reduce((a, b) => a + b, 0);
  let { x, y, w, h } = rect;
  if (!weights.length || total <= 0 || w <= 0 || h <= 0) return weights.map(() => ({ x: rect.x, y: rect.y, w: 0, h: 0 }));
  const scale = (w * h) / total, out = [];
  let i = 0;
  while (i < weights.length) {
    const side = Math.min(w, h);
    let j = i, sum = 0, best = Infinity;
    while (j < weights.length) {
      const s2 = sum + weights[j] * scale;
      const big = weights[i] * scale, small = Math.max(weights[j] * scale, 1e-12);
      const worst = Math.max((side * side * big) / (s2 * s2), (s2 * s2) / (side * side * small));
      if (j > i && worst > best) break;
      best = worst; sum = s2; j++;
    }
    const thick = side > 0 ? sum / side : 0;
    let at = 0;
    for (let k = i; k < j; k++) {
      const len = sum > 0 ? (weights[k] * scale) / Math.max(thick, 1e-12) : 0;
      out.push(w >= h ? { x, y: y + at, w: thick, h: len } : { x: x + at, y, w: len, h: thick });
      at += len;
    }
    if (w >= h) { x += thick; w -= thick; } else { y += thick; h -= thick; }
    i = j;
  }
  return out;
}

/**
 * Every cell of the plan inside `rect`: { rect, depth, file, label }. A cell thinner than `minSide` is left out and so is everything in it.
 * `pad` is the width of a folder's wall: the files in it lie inside that.
 */
export function layout(root, rect, minSide = 0.3, pad = 0.12) {
  const out = [];
  const place = (dir, r, depth) => {
    const kids = dir.kids.filter((k) => k.size > 0 || k.file !== null).sort((a, b) => b.size - a.size || (a.name < b.name ? -1 : 1));
    // an empty file still gets a sliver, so that it can be found and can carry a crack
    const rects = squarify(kids.map((k) => Math.max(k.size, 1)), r);
    kids.forEach((kid, n) => {
      const c = rects[n];
      if (c.w < minSide || c.h < minSide) return;
      out.push({ rect: c, depth, file: kid.file, label: kid.name });
      if (kid.file === null) {
        const inner = { x: c.x + pad, y: c.y + pad, w: c.w - 2 * pad, h: c.h - 2 * pad };
        if (inner.w >= minSide && inner.h >= minSide) place(kid, inner, depth + 1);
      }
    });
  };
  place(root, rect, 0);
  return out;
}
