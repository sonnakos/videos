// The contact sheet: an irregular 12-column grid of live loops.
// Each frame keeps its clip's own aspect ratio; the grid packs them densely.
import { chipColors, esc, reducedMotion } from './util.js';
import { register } from './playback.js';

const LETTERS = 'ABCDEFGH';
const ROW_UNIT = 4; // px, matches grid-auto-rows in styles.css

// ---- one frame -------------------------------------------------------------------
export function tileEl(p, ci) {
  const c = p.clips[ci];
  const chip = chipColors(p.accent);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'tile';
  btn.dataset.slug = p.slug;
  btn.dataset.clip = ci;
  btn.style.setProperty('--ar', `${c.w} / ${c.h}`);
  btn.style.setProperty('--accent', p.accent);
  btn.style.setProperty('--chip-bg', chip.bg);
  btn.style.setProperty('--chip-fg', chip.fg);
  btn.setAttribute('aria-label', `Open project ${p.num}: ${p.name}, ${p.category}`);
  btn.innerHTML =
    `<span class="tile__in">` +
      `<video class="tile__media" muted loop playsinline preload="none" aria-hidden="true" width="${c.w}" height="${c.h}"` +
      ` data-poster="${esc(c.poster)}" data-poster720="${esc(c.poster720 || c.poster)}">` +
        `<source media="(max-width: 767px)" src="${esc(c.src720 || c.src)}" type="video/mp4">` +
        `<source src="${esc(c.src)}" type="video/mp4">` +
      `</video>` +
      `<span class="tile__num micro">${p.num}<span aria-hidden="true">${LETTERS[ci] || ''}</span></span>` +
      `<span class="tile__cap"><span class="tile__name">${esc(p.name)}</span><span class="tile__cat micro">${esc(p.category)}</span></span>` +
    `</span>`;
  return btn;
}

// posters load one screen ahead; 720px posters wherever the frame is small
const posterIO = new IntersectionObserver((list) => {
  for (const e of list) {
    if (!e.isIntersecting) continue;
    const v = e.target;
    const small = v.clientWidth * (devicePixelRatio || 1) <= 760;
    v.poster = small ? v.dataset.poster720 : v.dataset.poster;
    posterIO.unobserve(v);
  }
}, { rootMargin: '100% 0px' });

// frame-by-frame entrance: 420 ms, 60 ms apart, the first three at once; runs once per frame
let firstBatch = true;
const enterIO = new IntersectionObserver((list) => {
  const entering = list.filter((e) => e.isIntersecting).map((e) => e.target)
    .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
  entering.forEach((el, i) => {
    const delay = firstBatch ? Math.max(0, i - 2) * 60 : i * 60;
    el.style.setProperty('--d', `${delay}ms`);
    el.classList.add('is-in');
    enterIO.unobserve(el);
  });
  if (entering.length) firstBatch = false;
}, { threshold: 0.15 });

export function activate(tile) {
  const inner = tile.querySelector('.tile__in');
  const video = tile.querySelector('video');
  if (reducedMotion.matches) inner.classList.add('is-in');
  else enterIO.observe(inner);
  posterIO.observe(video);
  register(video, 'page');
}

// ---- column spans from the clip's shape ---------------------------------------------
// Each frame may take one of two widths (desktop 3/4/6 columns, mobile 1/2); the packer
// picks whichever leaves the sheet tighter. The first width is the preferred one.
function spans(c, featuredLead) {
  const ar = c.w / c.h;
  if (featuredLead) {
    return { desk: ar < 0.62 ? [4] : [6], mob: ar >= 0.9 ? [2] : [1] };
  }
  const desk = ar < 0.62 ? [3, 4] : ar < 1.25 ? [4, 3] : [6, 4]; // 9:16, 4:5 / 1:1, 16:9
  const mob = ar >= 1.25 ? [2] : [1];
  return { desk, mob };
}

// Skyline packing on the grid: frames drop where they sit highest, preferring spots that
// leave no pits under them, like prints laid onto a contact sheet. The packer may pull
// one of the next few frames forward when it fits the lowest gap better, so the sheet
// stays tight while keeping roughly its 01, 02, 03… order. Rows are 4px units, so a
// frame spans exactly its height plus one gap. CSS dense flow is the no-JS fallback.
const LOOKAHEAD = 4;

// columns narrower than the smallest frame, sunk between higher neighbours, can never be
// filled again: price them in so the packer avoids leaving them behind
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

function layout(sheet) {
  const cs = getComputedStyle(sheet);
  const cols = cs.gridTemplateColumns.split(' ').length;
  const gap = parseFloat(cs.columnGap) || 0;
  const colW = (sheet.clientWidth - gap * (cols - 1)) / cols;
  const sky = new Array(cols).fill(0); // filled height per column, in row units
  const queue = [...sheet.children];
  const minSpan = Math.min(...queue.flatMap((li) => JSON.parse(cols >= 12 ? li.dataset.span : li.dataset.spanM)));
  while (queue.length) {
    let best = null;
    queue.slice(0, LOOKAHEAD).forEach((li, qi) => {
      const options = JSON.parse(cols >= 12 ? li.dataset.span : li.dataset.spanM);
      options.forEach((opt, rank) => {
        const span = Math.min(cols, opt);
        const w = span * colW + (span - 1) * gap;
        const rows = Math.ceil(((w * Number(li.dataset.h)) / Number(li.dataset.w) + gap) / ROW_UNIT);
        for (let c = 0; c + span <= cols; c++) {
          const cover = sky.slice(c, c + span);
          const top = Math.max(...cover);
          const pits = cover.reduce((sum, h) => sum + (top - h), 0) / span;
          const after = sky.slice();
          for (let k = c; k < c + span; k++) after[k] = top + rows;
          const score = top + pits * 1.5 + (wells(after, minSpan) / cols) * 2 + rank * 12 + qi * 16;
          if (!best || score < best.score) best = { score, li, c, top, span, rows };
        }
      });
    });
    const { li, c, top, span, rows } = best;
    li.style.gridColumn = `${c + 1} / span ${span}`;
    li.style.gridRow = `${top + 1} / span ${rows}`;
    for (let k = c; k < c + span; k++) sky[k] = top + rows;
    queue.splice(queue.indexOf(li), 1);
  }
}

export function renderGallery(sheet, projects) {
  // round-robin: every project's lead frame first, then the featured projects' B and C frames
  const order = [];
  const rounds = Math.max(...projects.map((p) => p.tiles));
  for (let r = 0; r < rounds; r++) for (const p of projects) if (r < p.tiles) order.push([p, r]);

  const frag = document.createDocumentFragment();
  for (const [p, ci] of order) {
    const c = p.clips[ci];
    const { desk, mob } = spans(c, p.featured && ci === 0);
    const li = document.createElement('li');
    li.dataset.span = JSON.stringify(desk);
    li.dataset.spanM = JSON.stringify(mob);
    li.dataset.w = c.w;
    li.dataset.h = c.h;
    li.style.setProperty('--span', desk[0]);
    li.style.setProperty('--span-m', mob[0]);
    li.append(tileEl(p, ci));
    frag.append(li);
  }
  sheet.replaceChildren(frag);
  layout(sheet); // before first paint of the frames: no layout shift

  let queued = false;
  new ResizeObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; layout(sheet); });
  }).observe(sheet);

  for (const tile of sheet.querySelectorAll('.tile')) activate(tile);
  return order.length;
}
