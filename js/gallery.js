// The contact sheet: an irregular 12-column grid of live loops.
// Each frame keeps its clip's own aspect ratio; the grid packs them densely.
import { chipColors, esc, reducedMotion } from './util.js';
import { register } from './playback.js';
import { plan } from './pack.js';

const LETTERS = 'ABCDEFGH';
const ROW_UNIT = 4; // px, matches grid-auto-rows in styles.css

// small stable hash, so each frame keeps the same pencil loop and tilt on every visit
const hash = (str) => [...str].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7);

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
  const h = hash(`${p.slug}-${ci}`);
  btn.style.setProperty('--rot', `${(h % 9) - 4}deg`);
  btn.setAttribute('aria-label', `Open project ${p.num}: ${[p.name, p.category].filter(Boolean).join(', ')}`);
  btn.innerHTML =
    `<span class="tile__in">` +
      `<video class="tile__media" muted loop playsinline preload="none" aria-hidden="true" width="${c.w}" height="${c.h}"` +
      ` data-poster="${esc(c.poster)}" data-poster720="${esc(c.poster720 || c.poster)}">` +
        `<source media="(max-width: 767px)" src="${esc(c.src720 || c.src)}" type="video/mp4">` +
        `<source src="${esc(c.src)}" data-src720="${esc(c.src720 || c.src)}" type="video/mp4">` +
      `</video>` +
      `<span class="tile__num micro">${p.num}<span aria-hidden="true">${LETTERS[ci] || ''}</span></span>` +
      `<span class="tile__cap"><span class="tile__name">${esc(p.name)}</span><span class="tile__cat micro">${esc(p.category)}</span></span>` +
    `</span>` +
    `<svg class="tile__mark" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true" focusable="false"><use href="#loop-${((h >>> 4) % 3) + 1}"/></svg>`;
  return btn;
}

// a frame this small on screen gets the 720px files (the <source media> rule only knows the viewport)
const small = (v) => v.clientWidth * (devicePixelRatio || 1) <= 760;

// posters load one screen ahead
const posterIO = new IntersectionObserver((list) => {
  for (const e of list) {
    if (!e.isIntersecting) continue;
    const v = e.target;
    v.poster = small(v) ? v.dataset.poster720 : v.dataset.poster;
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
  if (small(video)) {
    const fallback = video.querySelector('source[data-src720]');
    fallback.src = fallback.dataset.src720;
  }
  if (reducedMotion.matches) inner.classList.add('is-in');
  else enterIO.observe(inner);
  posterIO.observe(video);
  register(video, 'page');
}

// ---- column spans from the clip's shape ---------------------------------------------
// Each frame may take one of a few widths (desktop 3/4/6 columns, mobile 1/2); the packer
// picks whichever leaves the sheet tighter. The first width is the preferred one, and a
// featured project's lead frame prefers the larger size.
function spans(c, featuredLead) {
  const ar = c.w / c.h;
  if (featuredLead) return { desk: ar < 0.62 ? [4, 3] : ar < 1.25 ? [6, 4] : [6], mob: ar >= 0.9 ? [2] : [1] };
  const desk = ar < 0.62 ? [3, 4] : ar < 1.25 ? [4, 3, 6] : [6, 4, 3]; // 9:16, 4:5 / 1:1, 16:9
  return { desk, mob: ar >= 1.25 ? [2, 1] : [1] };
}

// Places every frame (js/pack.js) and puts the DOM in the order the sheet is seen,
// so Tab and screen readers go top to bottom. CSS dense flow is the no-JS fallback.
function layout(sheet, order) {
  const cs = getComputedStyle(sheet);
  const cols = cs.gridTemplateColumns.split(' ').length;
  const gap = parseFloat(cs.columnGap) || 0;
  const colW = (sheet.clientWidth - gap * (cols - 1)) / cols;
  const frames = order.map((li) => ({
    w: Number(li.dataset.w),
    h: Number(li.dataset.h),
    spans: JSON.parse(cols >= 12 ? li.dataset.span : li.dataset.spanM),
  }));
  const { placements } = plan(frames, cols, colW, gap, ROW_UNIT);
  for (const { index, c, top, span, rows } of placements) {
    order[index].style.gridColumn = `${c + 1} / span ${span}`;
    order[index].style.gridRow = `${top + 1} / span ${rows}`;
  }
  const visual = placements.slice().sort((a, b) => a.top - b.top || a.c - b.c).map((pl) => order[pl.index]);
  if (visual.some((li, i) => sheet.children[i] !== li)) {
    const focused = sheet.contains(document.activeElement) ? document.activeElement : null;
    sheet.append(...visual);
    focused?.focus({ preventScroll: true });
  }
}

export function renderGallery(sheet, projects) {
  // round-robin: every project's lead frame first, then the featured projects' B and C frames
  const tiles = [];
  const rounds = Math.max(...projects.map((p) => p.tiles));
  for (let r = 0; r < rounds; r++) for (const p of projects) if (r < p.tiles) tiles.push([p, r]);

  const order = tiles.map(([p, ci]) => {
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
    return li;
  });
  sheet.replaceChildren(...order);
  layout(sheet, order); // before first paint of the frames: no layout shift

  let queued = false;
  let width = sheet.clientWidth;
  new ResizeObserver(() => {
    if (queued || sheet.clientWidth === width) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; width = sheet.clientWidth; layout(sheet, order); });
  }).observe(sheet);

  for (const tile of sheet.querySelectorAll('.tile')) activate(tile);
}
