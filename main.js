// Entry point. Everything is split into small modules under js/:
//   util.js      media queries, contrast maths, escaping
//   playback.js  the loop pool: in-view only, max 6 playing, pauses in background tabs
//   data.js      reads content/projects.json (written by tools/clips.mjs)
//   gallery.js   the contact sheet
//   world.js     the full-screen project world
//   ui.js        header, REEL mask check, copy link, band clip, draft badge
import { $ } from './js/util.js';
import { loadProjects } from './js/data.js';
import { renderGallery } from './js/gallery.js';
import { initWorld } from './js/world.js';
import { initCopyLink, initHeader, initHero, renderBand, showDraftBadge } from './js/ui.js';

initHeader();
initHero();
initCopyLink();

try {
  const { data, projects } = await loadProjects();
  renderGallery($('#sheet'), projects);
  renderBand(projects, data);
  initWorld(projects);
  showDraftBadge(projects, data);
} catch (err) {
  $('#sheet').insertAdjacentHTML('afterend', '<p class="work__noscript">The clips could not be loaded. Please reload the page.</p>');
  console.error(err);
}
