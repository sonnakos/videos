// Playback pool — the one place that decides which loops run.
//  - a loop only plays while it is within 200px of the viewport
//  - never more than 6 at once: the ones nearest the viewport centre win
//  - everything stops while the tab is hidden or reduced motion is on
//  - groups ('page', 'world') can be suspended, e.g. the gallery while a project is open
import { reducedMotion } from './util.js';

const MAX_PLAYING = 6;
const entries = new Map(); // video -> { group, near, io }
const suspended = new Set();
let queued = false;
let lastScroll = 0;
let trailing = 0;

function onIntersect(list) {
  for (const e of list) {
    const entry = entries.get(e.target);
    if (entry) entry.near = e.isIntersecting;
  }
  schedule();
}
// one observer for the page; one per scroll container (the project world scrolls on its own,
// and a root margin only reaches past the viewport when the container itself is the root)
const pageIO = new IntersectionObserver(onIntersect, { rootMargin: '200px' });
const containerIO = new Map();
function observerFor(root) {
  if (!root) return pageIO;
  if (!containerIO.has(root)) containerIO.set(root, new IntersectionObserver(onIntersect, { root, rootMargin: '200px 0px' }));
  return containerIO.get(root);
}

function schedule() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    update();
  });
}

function start(v) {
  if (!v.paused) return;
  const p = v.play();
  if (p) p.catch(() => {}); // interrupted by a pause() or blocked by the browser: stay on the poster
}

function update() {
  const stopAll = document.hidden || reducedMotion.matches;
  const mid = innerHeight / 2;
  const wanted = [];
  for (const [v, e] of entries) {
    if (stopAll || !e.near || suspended.has(e.group) || !v.isConnected) continue;
    const r = v.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    wanted.push({ v, d: Math.abs((r.top + r.bottom) / 2 - mid) });
  }
  wanted.sort((a, b) => a.d - b.d);
  const keep = new Set(wanted.slice(0, MAX_PLAYING).map((w) => w.v));
  // pause first, so the count never goes above the limit even for a frame
  for (const v of entries.keys()) if (!keep.has(v) && !v.paused) v.pause();
  for (const v of keep) start(v);
}

export function register(video, group = 'page', root = null) {
  video.muted = true;       // property as well as attribute: Safari only autoplays when both say muted
  video.playsInline = true;
  const io = observerFor(root);
  entries.set(video, { group, near: false, io });
  io.observe(video);
}

export function unregister(video) {
  entries.get(video)?.io.unobserve(video);
  entries.delete(video);
  if (!video.paused) video.pause();
}

export function suspend(group) { suspended.add(group); update(); }
export function resume(group) { suspended.delete(group); schedule(); }
export const playingCount = () => [...entries.keys()].filter((v) => !v.paused).length;

// Reduced motion switched on mid-visit: stop and go back to the poster frame.
reducedMotion.addEventListener('change', () => {
  if (reducedMotion.matches) {
    for (const v of entries.keys()) {
      v.pause();
      if (v.poster && v.readyState > 0) v.load();
    }
  }
  schedule();
});
document.addEventListener('visibilitychange', update);
addEventListener('resize', schedule, { passive: true });
// distances to the centre change while scrolling even when nothing crosses the 200px line:
// re-rank at most every 150 ms while scrolling, and once more after it stops
// (the trailing call covers browsers without the scrollend event)
function onScroll() {
  const now = performance.now();
  if (now - lastScroll > 150) {
    lastScroll = now;
    schedule();
  }
  clearTimeout(trailing);
  trailing = setTimeout(schedule, 160);
}
addEventListener('scroll', onScroll, { passive: true, capture: true }); // capture also sees the project world's scroller
addEventListener('scrollend', schedule, { passive: true, capture: true });
