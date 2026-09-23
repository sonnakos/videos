// Contact-sheet packing, kept free of the DOM so it can be tested in Node.
//
// Skyline packing, like prints laid onto a contact sheet: each frame drops where it sits
// highest, preferring spots that leave no pits under it. Greedy packing depends on its
// weights and on the order frames arrive in, so a few dozen weightings and a few gently
// shuffled orders are tried, and the tightest sheet wins: fewest interior holes first,
// then the most even bottom edge. Heights are in grid rows (4px units).

// Columns narrower than the smallest frame, sunk between higher neighbours, can never be
// filled again: price them in while packing.
function wells(sky, minSpan) {
  let cost = 0;
  for (let i = 0; i < sky.length;) {
    let j = i;
    while (j + 1 < sky.length && sky[j + 1] === sky[i]) j++;
    const left = i > 0 ? sky[i - 1] : Infinity;
    const right = j < sky.length - 1 ? sky[j + 1] : Infinity;
    if (j - i + 1 < minSpan && sky[i] < left && sky[i] < right) cost += (Math.min(left, right) - sky[i]) * (j - i + 1);
    i = j + 1;
  }
  return cost;
}

function packOnce(items, cols, w) {
  const sky = new Array(cols).fill(0);
  const minSpan = Math.min(...items.flatMap((it) => it.spans));
  const queue = items.slice();
  const placed = [];
  let holes = 0;
  while (queue.length) {
    let best = null;
    for (let qi = 0; qi < Math.min(w.look, queue.length); qi++) {
      const it = queue[qi];
      it.spans.forEach((opt, rank) => {
        const span = Math.min(cols, opt);
        const rows = it.rows(span);
        for (let c = 0; c + span <= cols; c++) {
          let top = 0;
          for (let k = c; k < c + span; k++) top = Math.max(top, sky[k]);
          let pits = 0;
          for (let k = c; k < c + span; k++) pits += top - sky[k];
          const after = sky.slice();
          for (let k = c; k < c + span; k++) after[k] = top + rows;
          const score = top + (pits / span) * w.pit + (wells(after, minSpan) / cols) * w.well + rank * w.rank + qi * w.order;
          if (!best || score < best.score) best = { score, it, c, top, span, rows, pits };
        }
      });
    }
    for (let k = best.c; k < best.c + best.span; k++) sky[k] = best.top + best.rows;
    holes += best.pits;
    placed.push(best);
    queue.splice(queue.indexOf(best.it), 1);
  }
  const height = Math.max(...sky);
  const ragged = sky.reduce((s, h) => s + (height - h), 0);
  return { placed, cost: holes * 2 + ragged, holes, ragged, height, sky };
}

// the weightings that won across screen widths 760–1920 px in a sweep of 48 × 8 candidates
const WEIGHTS = [];
for (const look of [4, 6]) for (const pit of [1, 3]) WEIGHTS.push({ look, pit, well: 2, rank: 20, order: 10 });

// deterministic "shuffles": a few neighbouring swaps, so 01, 02, 03… stays roughly in order
function nudged(items, seed) {
  if (!seed) return items;
  let s = seed * 2654435761 >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const out = items.slice();
  for (let i = 0; i < out.length - 1; i++) if (rnd() < 0.35) [out[i], out[i + 1]] = [out[i + 1], out[i]];
  return out;
}
const SEEDS = [0, 1, 2, 3, 4, 6];

// frames: [{ w, h, spans: [preferred, …alternatives] }] in reading order
export function plan(frames, cols, colW, gap, rowUnit = 4) {
  const items = frames.map((f, index) => ({
    index,
    spans: f.spans,
    rows: (span) => Math.ceil((((span * colW + (span - 1) * gap) * f.h) / f.w + gap) / rowUnit),
  }));
  let best = null;
  for (const seed of SEEDS) {
    const order = nudged(items, seed);
    for (const w of WEIGHTS) {
      const run = packOnce(order, cols, w);
      if (!best || run.cost < best.cost) best = run;
    }
  }
  return {
    placements: best.placed.map(({ it, c, top, span, rows }) => ({ index: it.index, c, top, span, rows })),
    holes: best.holes,
    ragged: best.ragged,
    height: best.height,
    sky: best.sky,
  };
}
