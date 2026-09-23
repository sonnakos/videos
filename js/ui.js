// Page chrome: header hairline, the cover, copy-link, band clip, draft badge.
import { $ } from './util.js';
import { register } from './playback.js';
import { activate, tileEl } from './gallery.js';
import { initPrint } from './print.js';

// the header's hairline appears only once the page has left the top
export function initHeader() {
  const header = $('#site-header');
  const sentinel = document.createElement('div');
  sentinel.setAttribute('aria-hidden', 'true');
  sentinel.style.cssText = 'position:absolute;top:0;left:0;width:1px;height:1px;pointer-events:none';
  document.body.prepend(sentinel);
  new IntersectionObserver(([e]) => header.classList.toggle('is-scrolled', !e.isIntersecting)).observe(sentinel);
}

// The cover: the reel plays as the cover picture (through the playback pool), printed in
// halftone with a loupe over it (js/print.js), and a SMPTE timecode under it counts the frames.
export function initCover() {
  const figure = $('#cover-reel');
  const video = $('video', figure);
  register(video, 'page');
  initPrint($('.cover__frame', figure), video, $('#cover-hint'));
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
