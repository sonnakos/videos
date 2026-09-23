// Page chrome: header hairline, the cover, copy-link, band clip, draft badge.
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

// The cover: the reel plays as the cover picture (through the playback pool), drifts a
// little with the pointer, and a SMPTE timecode under it counts the frames.
export function initCover() {
  const figure = $('#cover-reel');
  const video = $('video', figure);
  register(video, 'page');
  drift($('.cover'), figure, video);
  timecode(video, $('#cover-tc'));
}

// HH:MM:SS:FF at 25 fps. Updated once per presented video frame
// where the browser offers requestVideoFrameCallback, otherwise on timeupdate.
function timecode(video, out) {
  const FPS = 25;
  const two = (n) => String(n).padStart(2, '0');
  const show = (t) => {
    const f = Math.floor(t * FPS);
    out.textContent = `${two(Math.floor(f / (3600 * FPS)))}:${two(Math.floor(f / (60 * FPS)) % 60)}:${two(Math.floor(f / FPS) % 60)}:${two(f % FPS)}`;
  };
  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
    const tick = (_, meta) => { show(meta.mediaTime); video.requestVideoFrameCallback(tick); };
    video.requestVideoFrameCallback(tick);
  } else {
    video.addEventListener('timeupdate', () => show(video.currentTime));
  }
}

// Pointer drift: the footage slides a little inside its frame toward the pointer.
// Transform only, eased in rAF, idle when the pointer rests; mouse/trackpad only.
function drift(area, figure, video) {
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  if (!fine.matches || reducedMotion.matches) return;
  figure.classList.add('cover__reel--drift');
  const RANGE = 1.8; // % of the frame; the 1.06 overscan leaves 3% to spare
  let tx = 0, ty = 0, x = 0, y = 0, raf = 0;
  const step = () => {
    x += (tx - x) * 0.08;
    y += (ty - y) * 0.08;
    video.style.transform = `translate3d(${(x * RANGE).toFixed(3)}%, ${(y * RANGE).toFixed(3)}%, 0) scale(1.06)`;
    raf = Math.abs(tx - x) + Math.abs(ty - y) > 0.002 ? requestAnimationFrame(step) : 0;
  };
  const aim = (nx, ny) => { tx = nx; ty = ny; if (!raf) raf = requestAnimationFrame(step); };
  area.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || reducedMotion.matches) return;
    const r = figure.getBoundingClientRect();
    const cx = Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width - 0.5) * 2));
    const cy = Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height - 0.5) * 2));
    aim(-cx, -cy);
  });
  area.addEventListener('pointerleave', () => aim(0, 0));
  reducedMotion.addEventListener('change', () => {
    if (!reducedMotion.matches) return;
    cancelAnimationFrame(raf);
    raf = 0;
    figure.classList.remove('cover__reel--drift');
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
    const url = location.origin + location.pathname; // the page itself: no tracking query, no #fragment
    let ok = false;
    try {
      await navigator.clipboard.writeText(url);
      ok = true;
    } catch {
      const prev = document.activeElement;
      const ta = Object.assign(document.createElement('textarea'), { value: url });
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
      document.body.append(ta);
      ta.select();
      try { ok = document.execCommand('copy'); } catch { ok = false; }
      ta.remove();
      prev?.focus({ preventScroll: true });
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

// the badge stays until every placeholder is gone: footage, the REEL clip and the contact links
export function showDraftBadge(projects, data) {
  const contact = [...document.querySelectorAll('.contact a')].some((a) =>
    /example\.com/.test(a.href) || /^https:\/\/www\.(instagram|linkedin)\.com\/$/.test(a.href) || a.textContent.includes('@handle'));
  const draft = projects.some((p) => p.placeholder) || data.hero?.placeholder || contact;
  $('#draft-badge').hidden = !draft;
}
