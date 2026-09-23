// Loads content/site.json — the public file tools/clips.mjs generates from content/projects.json.
// It holds only cleared, encoded projects; the checks below are a second line of defence.
import { pad2 } from './util.js';

export async function loadProjects() {
  const res = await fetch('content/site.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error(`content/site.json: HTTP ${res.status}`);
  const data = await res.json();
  const projects = (data.projects || [])
    .filter((p) => p.cleared !== false && p.media?.clips?.length)
    .map((p, i) => ({
      ...p,
      index: i,
      num: pad2(i + 1),
      accent: /^#[0-9a-f]{6}$/i.test(p.media.accent || '') ? p.media.accent : '#C4563A',
      clips: p.media.clips,
      full: p.media.full || null,
      tiles: Math.max(1, Math.min(p.tiles || (p.featured ? 3 : 1), p.media.clips.length)),
    }));
  return { data, projects };
}
