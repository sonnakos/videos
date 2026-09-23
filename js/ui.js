// Page chrome: header hairline, the REEL mask check, copy-link, band clip, draft badge.
import { $, reducedMotion } from './util.js';
import { register } from './playback.js';
import { activate, tileEl } from './gallery.js';

// the header's hairline appears only once the page has left the top
export function initHeader() {
  const header = $('#site-header');
  const sentinel = document.createElement('div');
  sentinel.setAttribute('aria-hidden', 'true');
  sentinel.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:1px;pointer-events:none';
  document.body.prepend(sentinel);
  new IntersectionObserver(([e]) => header.classList.toggle('is-scrolled', !e.isIntersecting)).observe(sentinel);
}

// REEL: video behind a paper sheet with the letters cut out. If SVG masking is
// unavailable, fall back to solid terracotta type rather than a bare rectangle of video.
export function initHero() {
  const reel = $('#hero-reel');
  const video = $('video', reel);
  const masked = typeof SVGMaskElement === 'function' && getComputedStyle($('.hero-reel__cut', reel)).display !== 'none';
  if (!masked) {
    reel.classList.add('hero-reel--fallback');
    return;
  }
  register(video, 'page');
  matchGrain(reel);
  drift(reel, video);
}

// the sheet is drawn in viewBox units (1000 wide); size its grain tile so it lands
// at the same 256 CSS px as the page's paper grain, whatever the screen width
function matchGrain(reel) {
  const pattern = $('#reel-grain');
  const image = $('image', pattern);
  const fit = () => {
    const size = String((256 * 1000) / (reel.clientWidth || 1000));
    for (const el of [pattern, image]) { el.setAttribute('width', size); el.setAttribute('height', size); }
  };
  fit();
  new ResizeObserver(fit).observe(reel);
}

// Pointer drift: the footage slides a little behind the letters, as if REEL were a
// window. Transform only, eased in rAF, idle when the pointer rests; mouse/trackpad only.
function drift(reel, video) {
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  if (!fine.matches || reducedMotion.matches) return;
  reel.classList.add('hero-reel--drift');
  const RANGE = 1.8; // % of the frame; the 1.06 overscan leaves 3% to spare
  let tx = 0, ty = 0, x = 0, y = 0, raf = 0;
  const step = () => {
    x += (tx - x) * 0.08;
    y += (ty - y) * 0.08;
    video.style.transform = `translate3d(${(x * RANGE).toFixed(3)}%, ${(y * RANGE).toFixed(3)}%, 0) scale(1.06)`;
    raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.002 ? requestAnimationFrame(step) : 0;
  };
  const aim = (nx, ny) => { tx = nx; ty = ny; if (!raf) raf = requestAnimationFrame(step); };
  reel.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || reducedMotion.matches) return;
    const r = reel.getBoundingClientRect();
    aim(-((e.clientX - r.left) / r.width - 0.5) * 2, -((e.clientY - r.top) / r.height - 0.5) * 2);
  });
  reel.addEventListener('pointerleave', () => aim(0, 0));
  reducedMotion.addEventListener('change', () => {
    if (!reducedMotion.matches) return;
    cancelAnimationFrame(raf);
    raf = 0;
    reel.classList.remove('hero-reel--drift');
    video.style.transform = '';
  });
}

export function initCopyLink() {
  const btn = $('#copy-link');
  if (!btn) return;
  const label = btn.textContent;
  let timer;
  btn.setAttribute('aria-live', 'polite');
  btn.addEventListener('click', async () => {
    const url = location.href.split('#')[0];
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      const ta = Object.assign(document.createElement('textarea'), { value: url });
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.append(ta);
      ta.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
    }
    btn.textContent = ok ? 'Copied ✓' : url;
    clearTimeout(timer);
    timer = setTimeout(() => { btn.textContent = label; }, 2000);
  });
}

// the clip that slides half into the red block before the contact section
export function renderBand(projects, data) {
  const host = $('#band-clip');
  if (!host || !projects.length) return;
  let p, ci;
  const [slug, idx] = String(data.bandClip || '').split(':');
  if (slug) { p = projects.find((q) => q.slug === slug); ci = Number(idx) || 0; }
  if (!p) {
    p = projects.find((q) => q.featured) || projects[0];
    ci = p.clips.length - 1;
  }
  ci = Math.min(ci, p.clips.length - 1);
  const tile = tileEl(p, ci);
  host.replaceChildren(tile);
  activate(tile);
}

export function showDraftBadge(projects, data) {
  const draft = projects.some((p) => p.placeholder) || data.hero?.placeholder;
  $('#draft-badge').hidden = !draft;
}
