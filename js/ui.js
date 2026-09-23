// Page chrome: header hairline, the REEL mask check, copy-link, band clip, draft badge.
import { $ } from './util.js';
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

// the clip that slides half into the red block before the services
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
