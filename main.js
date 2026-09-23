// Entry point. Everything is split into small modules under js/:
//   util.js      media queries, contrast maths, escaping
//   playback.js  the loop pool: in-view only, max 6 playing, pauses in background tabs
//   data.js      reads content/projects.json (written by tools/clips.mjs)
//   gallery.js   the contact sheet
//   world.js     the full-screen project world
//   ui.js        header, cover (reel, drift, timecode), copy link, band clip, draft badge
import { $ } from './js/util.js';
import { loadProjects } from './js/data.js';
import { renderGallery } from './js/gallery.js';
import { initWorld } from './js/world.js';
import { initCopyLink, initCover, initHeader, renderBand, setCoverCount, showDraftBadge } from './js/ui.js';

initHeader();
initCover();
initCopyLink();

// The gallery arrives after a fetch, so the browser's own scroll restoration on reload
// lands too high and scroll anchoring then drifts it into the next section. Keep the
// position for this tab and put it back once the sheet exists.
const KEY = 'scroll:' + location.pathname;
const navType = performance.getEntriesByType('navigation')[0]?.type;
let restore = null;
try {
  restore = Number(sessionStorage.getItem(KEY));
  if (!Number.isFinite(restore)) restore = null;
  history.scrollRestoration = 'manual';
} catch {}
addEventListener('pagehide', () => {
  try { sessionStorage.setItem(KEY, String(Math.round(scrollY))); } catch {}
});

try {
  const { data, projects } = await loadProjects();
  setCoverCount(renderGallery($('#sheet'), projects));
  renderBand(projects, data);
  initWorld(projects);
  showDraftBadge(projects, data);
  if (restore && (navType === 'reload' || navType === 'back_forward') && !$('#pw').open) {
    scrollTo({ top: restore, left: 0, behavior: 'instant' });
  }
} catch (err) {
  $('#sheet').insertAdjacentHTML('afterend', '<p class="work__noscript">The clips could not be loaded. Please reload the page.</p>');
  console.error(err);
}
