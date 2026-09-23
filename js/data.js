// Loads content/projects.json and keeps only what may be shown:
// projects with clearance and at least one encoded clip (tools/clips.mjs writes "media").
import { pad2 } from './util.js';

export async function loadProjects() {
  const res = await fetch('content/projects.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`content/projects.json: HTTP ${res.status}`);
  const data = await res.json();
  const projects = (data.projects || [])
    .filter((p) => p.cleared !== false && p.media?.clips?.length)
    .map((p, i) => ({
      ...p,
      index: i,
      num: pad2(i + 1),
      accent: p.media.accent || (/^#[0-9a-f]{6}$/i.test(p.accent || '') ? p.accent : '#C4563A'),
      clips: p.media.clips,
      full: p.media.full || null,
      tiles: Math.max(1, Math.min(p.tiles || (p.featured ? 3 : 1), p.media.clips.length)),
    }));
  return { data, projects };
}
