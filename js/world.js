// The project world: a full-screen <dialog> that grows out of the clicked frame.
// Lights go down (paper -> stage, 450 ms) while the frame becomes the lead clip (540 ms).
// Close with ✕, Esc, a click on the dark background, or the browser's Back button.
import { $, mobile, reducedMotion } from './util.js';
import { register, resume, suspend, unregister } from './playback.js';

const EASE = 'cubic-bezier(0.83, 0, 0.17, 1)';
const dlg = $('#pw');
const scroller = $('.pw__scroll', dlg);
const bg = $('.pw__bg', dlg);
const clipsEl = $('#pw-clips');
const fullFig = $('#pw-full');
const fullVideo = $('video', fullFig);
const closeBtn = $('#pw-close');
const title = $('#pw-title');

let projects = [];
let current = null;  // { p, origin, trigger }
let savedY = 0;
let openWidth = 0;
let pushed = false;  // does this opening own a history entry (so closing = going back)?
let closing = false; // a history.back() is on its way; ignore further close requests

// some embedding frames refuse history changes; the world must still open and close without them
function hist(method, state, url) {
  try { history[method](state, '', url); return true; } catch { return false; }
}
const baseUrl = () => location.pathname + location.search;
const hashSlug = () => {
  const m = /^#p\/(.+)$/.exec(location.hash);
  return m ? decodeURIComponent(m[1]) : null;
};

const lead = () => $('.pw__clip video', clipsEl);
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
const vt = () => typeof document.startViewTransition === 'function' && !reducedMotion.matches;

function clipFigure(p, ci, k, knownPoster) {
  const c = p.clips[ci];
  const ar = c.w / c.h;
  let desk, mob;
  if (k === 0) { desk = ar >= 1.25 ? 8 : ar >= 0.9 ? 6 : 5; mob = 4; }
  else { desk = ar >= 1.25 ? 6 : ar >= 0.7 ? 4 : 3; mob = ar >= 1.25 ? 4 : 2; }
  const fig = document.createElement('figure');
  fig.className = 'pw__clip';
  fig.style.setProperty('--span', desk);
  fig.style.setProperty('--span-m', mob);
  fig.style.setProperty('--ar', `${c.w} / ${c.h}`);
  if (k % 2 === 1) fig.style.setProperty('--shift', 'clamp(0px, 7vw, 112px)');
  const v = document.createElement('video');
  v.muted = true;
  v.loop = true;
  v.playsInline = true;
  v.preload = 'none';
  v.width = c.w;
  v.height = c.h;
  v.setAttribute('aria-label', `Clip ${k + 1} from ${p.name}`);
  // the lead reuses the poster the frame already shows, so the morph never lands on an empty box
  const big = k === 0 && !mobile.matches;
  v.poster = knownPoster || (big ? c.poster : c.poster720 || c.poster);
  v.innerHTML = `<source media="(max-width: 767px)" src="${c.src720 || c.src}" type="video/mp4"><source src="${c.src}" type="video/mp4">`;
  fig.append(v);
  return fig;
}

function clearMedia() {
  for (const v of clipsEl.querySelectorAll('video')) unregister(v);
  clipsEl.replaceChildren();
  fullVideo.pause();
  fullVideo.removeAttribute('src');
  fullVideo.removeAttribute('poster');
  fullVideo.load();
  resume('world'); // load() swallows the 'pause' event, so un-suspend the loops explicitly
}

function fill(p, ci, knownPoster) {
  clearMedia();
  $('#pw-num').textContent = p.num;
  $('#pw-cat').textContent = [p.category, p.client].filter(Boolean).join(' · ');
  title.textContent = p.name;
  $('#pw-did').textContent = p.whatIDid || '—';
  $('#pw-tools').textContent = p.tools || '—';
  $('#pw-turn').textContent = p.turnaround || '—';
  $('#pw-summary').textContent = p.summary || '';
  const order = [ci, ...p.clips.map((_, i) => i).filter((i) => i !== ci)].slice(0, 5);
  clipsEl.append(...order.map((i, k) => clipFigure(p, i, k, k === 0 ? knownPoster : null)));
  for (const v of clipsEl.querySelectorAll('video')) register(v, 'world', scroller);
  if (p.full) {
    fullFig.hidden = false;
    fullVideo.style.setProperty('--ar', `${p.full.w} / ${p.full.h}`);
    fullVideo.poster = p.full.poster;
    fullVideo.src = p.full.src; // preload="none": nothing downloads until Play
    fullVideo.setAttribute('aria-label', `${p.name}, full film`);
    $('#pw-full-cap').textContent = `Full film · ${fmt(p.full.duration || 0)}`;
  } else {
    fullFig.hidden = true;
  }
}

// ---- fallback animation when the View Transitions API is missing ------------------
function fadeTargets() {
  return [...dlg.querySelectorAll('.pw__head, .pw__clip:not(:first-child), .pw__full, .pw__facts, .pw__summary, .pw__foot, .pw__close')];
}
function flip(fromRect, toEl, reverse) {
  const to = toEl.getBoundingClientRect();
  const s = fromRect.width / to.width;
  const moved = `translate(${fromRect.left - to.left}px, ${fromRect.top - to.top}px) scale(${s})`;
  const frames = [{ transform: moved, transformOrigin: '0 0' }, { transform: 'none', transformOrigin: '0 0' }];
  const anims = [
    toEl.animate(reverse ? frames.reverse() : frames, { duration: 540, easing: EASE, fill: 'both' }),
    bg.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 450, easing: 'ease-in-out', direction: reverse ? 'reverse' : 'normal', fill: 'both' }),
    ...fadeTargets().map((el) => el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 540, easing: EASE, direction: reverse ? 'reverse' : 'normal', fill: 'both' })),
  ];
  return Promise.all(anims.map((a) => a.finished)).then(() => anims.forEach((a) => a.cancel()));
}

// ---- open / close ----------------------------------------------------------------------
function showNow(p, ci, knownPoster) {
  fill(p, ci, knownPoster);
  suspend('page');
  document.body.style.overflow = 'hidden';
  dlg.showModal();
  scroller.scrollTop = 0;
  // focus inside the scroller, so arrow keys / Page Down / Space scroll the project
  title.focus({ preventScroll: true });
}

// history: 'push' = a tile was clicked; 'deep' = the page loaded on #p/<slug>;
// 'none' = the browser already moved to an entry for this project (Back/Forward, hash edit)
export function openProject(p, ci = 0, origin = null, trigger = null, { history: mode = 'push' } = {}) {
  if (dlg.open || !p) return;
  current = { p, origin, trigger };
  savedY = scrollY;
  openWidth = innerWidth;
  closing = false;
  if (mode === 'push') pushed = hist('pushState', { pw: p.slug }, `#p/${p.slug}`);
  else if (mode === 'deep') pushed = hist('replaceState', null, baseUrl()) && hist('pushState', { pw: p.slug }, `#p/${p.slug}`);
  else pushed = true;

  const knownPoster = origin?.poster || null;
  const canAnimate = origin && !reducedMotion.matches && origin.getBoundingClientRect().width > 0;
  if (canAnimate && vt()) {
    origin.style.viewTransitionName = 'pw-media';
    const t = document.startViewTransition(() => {
      origin.style.viewTransitionName = '';
      showNow(p, ci, knownPoster);
      lead().style.viewTransitionName = 'pw-media';
    });
    t.finished.finally(() => { const l = lead(); if (l) l.style.viewTransitionName = ''; });
  } else if (canAnimate) {
    const from = origin.getBoundingClientRect();
    showNow(p, ci, knownPoster);
    flip(from, lead().parentElement, false);
  } else {
    showNow(p, ci, knownPoster);
  }
}

function finishClose() {
  clearMedia();
  dlg.close();
  document.body.style.overflow = '';
  scrollTo({ top: savedY, left: 0, behavior: 'instant' });
  // the sheet re-packs when the width changes (rotation, resize): bring the frame back into view
  const t = current?.trigger;
  if (innerWidth !== openWidth && t?.isConnected) t.scrollIntoView({ block: 'center', behavior: 'instant' });
  resume('page');
  closing = false;
}

function closeProject() {
  if (!dlg.open) return;
  const { origin, trigger } = current;
  pushed = false;
  if (location.hash.startsWith('#p/')) hist('replaceState', null, baseUrl());
  const refocus = () => trigger?.isConnected && trigger.focus({ preventScroll: true });
  const canAnimate = origin?.isConnected && !reducedMotion.matches && innerWidth === openWidth;

  if (canAnimate && vt()) {
    const l = lead();
    if (l) l.style.viewTransitionName = 'pw-media';
    const t = document.startViewTransition(() => {
      if (l) l.style.viewTransitionName = '';
      finishClose();
      origin.style.viewTransitionName = 'pw-media';
    });
    t.finished.finally(() => { origin.style.viewTransitionName = ''; refocus(); });
  } else if (canAnimate) {
    const l = lead();
    const to = origin.getBoundingClientRect(); // body scroll is locked, so this is where it will be
    flip({ left: to.left, top: to.top, width: to.width }, l.parentElement, true).then(() => { finishClose(); refocus(); });
  } else {
    finishClose();
    refocus();
  }
}

// with a history entry, closing is a step back, so ✕ and the Back button behave the same
function requestClose() {
  if (!dlg.open || closing) return;
  if (pushed && location.hash.startsWith('#p/')) {
    closing = true;
    history.back();
  } else {
    closeProject();
  }
}

function swapTo(p) {
  if (!p || p === current.p) return;
  current = { ...current, p, origin: null };
  fill(p, 0);
  scroller.scrollTop = 0;
  hist('replaceState', { pw: p.slug }, `#p/${p.slug}`);
  title.focus({ preventScroll: true });
}

export function initWorld(list) {
  projects = list;
  const find = (slug) => projects.find((p) => p.slug === slug);

  closeBtn.addEventListener('click', requestClose);
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); requestClose(); });
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg || e.target.hasAttribute?.('data-close-area')) requestClose();
  });
  const next = $('#pw-next');
  next.parentElement.hidden = projects.length < 2;
  next.addEventListener('click', () => {
    const i = projects.indexOf(current.p);
    swapTo(projects[(i + 1) % projects.length]);
  });
  fullVideo.addEventListener('play', () => suspend('world'));
  fullVideo.addEventListener('pause', () => resume('world'));
  fullVideo.addEventListener('ended', () => resume('world'));
  // the film has sound; it stops when the tab is hidden, like the loops (no auto-resume)
  document.addEventListener('visibilitychange', () => { if (document.hidden && !fullVideo.paused) fullVideo.pause(); });

  // Back / Forward, or a #p/<slug> typed or pasted into the address bar
  addEventListener('popstate', (e) => {
    const slug = e.state?.pw ?? hashSlug();
    const p = slug && find(slug);
    if (dlg.open && !p) closeProject();
    else if (dlg.open && p && p !== current.p) swapTo(p);
    else if (!dlg.open && p) openProject(p, 0, null, null, { history: 'none' });
  });

  document.addEventListener('click', (e) => {
    const tile = e.target.closest?.('.tile');
    if (!tile || dlg.contains(tile)) return;
    openProject(find(tile.dataset.slug), Number(tile.dataset.clip) || 0, tile.querySelector('video'), tile);
  });

  // shared link straight to a project: #p/<slug>
  const deep = find(hashSlug());
  if (deep) openProject(deep, 0, null, null, { history: 'deep' });
}
