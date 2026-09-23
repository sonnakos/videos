#!/usr/bin/env node
// Cuts the gallery loop clips, posters and featured full videos out of the source
// footage listed in content/projects.json, then writes
//   - content/projects.json  back, with a "media" block per project (build-side record)
//   - content/site.json      the ONLY file the page reads: cleared projects, display
//                            fields and media paths — no source paths, no ranges
//
//   node tools/clips.mjs              encode whatever is missing or out of date
//   node tools/clips.mjs --force      re-encode everything
//   node tools/clips.mjs --only a,b   only these project slugs (or "hero")
//   node tools/clips.mjs --dry-run    print the ffmpeg commands, touch nothing
//
// A project with "cleared": false is unpublished: its encoded files are deleted and it
// is left out of site.json. Needs ffmpeg + ffprobe on PATH (macOS: brew install ffmpeg).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'content', 'projects.json');
const SITE = join(ROOT, 'content', 'site.json');
const HTML = join(ROOT, 'index.html');

const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const DRY = args.includes('--dry-run');
let ONLY = null;
{
  const i = args.findIndex((a) => a === '--only' || a.startsWith('--only='));
  if (i >= 0) {
    const value = args[i].startsWith('--only=') ? args[i].slice(7) : args[i + 1];
    if (!value || value.startsWith('--')) {
      console.error('--only needs a comma-separated list of slugs, e.g. --only hero,oom-brand-film');
      process.exit(1);
    }
    ONLY = value.split(',').map((s) => s.trim()).filter(Boolean);
  }
}

const LOOP_MAX = 1280, LOOP_SMALL = 720, FULL_MAX = 1920;
const CRF_LOOP = 26, CRF_LOOP_HEAVY = 28, CRF_SMALL = 28, CRF_FULL = 23;
const HEAVY_BYTES = 1.5 * 1024 * 1024;
const FULL_WARN_BYTES = 25 * 1024 * 1024; // Cloudflare Pages refuses files over 25 MiB
const LETTERS = 'abcdefgh';

// ---------------------------------------------------------------- helpers
const rel = (p) => p.replace(ROOT + '/', '');
const warn = (m) => console.warn('  ! ' + m);

function run(bin, argv, { capture = false } = {}) {
  if (DRY && bin === 'ffmpeg') {
    console.log('  $ ffmpeg ' + argv.map((a) => (/[\s"'()]/.test(a) ? JSON.stringify(a) : a)).join(' '));
    return '';
  }
  const r = spawnSync(bin, argv, { encoding: capture ? 'utf8' : undefined, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`${bin} not found — install it first (macOS: brew install ffmpeg)`);
  if (r.status !== 0) {
    const err = r.stderr ? r.stderr.toString().split('\n').slice(-12).join('\n') : '';
    throw new Error(`${bin} failed (${r.status}):\n${err}`);
  }
  return r.stdout;
}

function parseTime(t) {
  const s = String(t).trim();
  if (s === '') return null;
  const parts = s.split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n))) throw new Error(`bad time "${t}"`);
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function parseRange(r) {
  // "47-52", "1:03-1:08" (hyphen, en or em dash), "12-" (to the end), or {in, out}
  if (typeof r === 'object' && r) return { start: parseTime(r.in ?? 0) ?? 0, end: r.out == null ? null : parseTime(r.out) };
  const m = /^\s*([\d:.]*)\s*[-–—]\s*([\d:.]*)\s*$/.exec(String(r));
  if (!m) throw new Error(`bad range "${r}" — use "47-52" or "1:03-1:08"`);
  const range = { start: parseTime(m[1]) ?? 0, end: parseTime(m[2]) };
  if (range.end != null && range.end <= range.start) throw new Error(`range "${r}" ends before it starts`);
  return range;
}

function resolveSource(src, sourceDir) {
  if (!src) return null;
  let p = src.replace(/^~(?=\/|$)/, homedir());
  if (!isAbsolute(p)) {
    const base = (sourceDir || '').replace(/^~(?=\/|$)/, homedir());
    p = isAbsolute(base) ? join(base, p) : join(ROOT, base, p);
  }
  return p;
}

function probe(file) {
  const out = run('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries',
    'stream=width,height:stream_side_data=rotation:format=duration', '-of', 'json', file], { capture: true });
  const j = JSON.parse(out);
  const s = j.streams[0];
  let { width: w, height: h } = s;
  const rot = Math.abs(Number(s.side_data_list?.find((d) => 'rotation' in d)?.rotation || 0));
  if (rot === 90 || rot === 270) [w, h] = [h, w]; // phone footage stored sideways
  return { w, h, duration: Number(j.format.duration) };
}

const fresh = (out, src, key, prev) =>
  !FORCE && existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs && prev?.key === key;

// longer side at most `max` (never upscaled), aspect kept, even dimensions for H.264 + yuv420p
const scale = (max) =>
  `scale=w='min(${max},iw)':h='min(${max},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos`;

function encodeLoop(src, range, out, max, crf) {
  const a = ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(range.start), '-i', src,
    '-t', String(range.end - range.start),
    '-an', '-vf', scale(max), '-c:v', 'libx264', '-crf', String(crf), '-preset', 'slow',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out];
  run('ffmpeg', a);
}

function encodeFull(src, range, out) {
  const a = ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(range.start), '-i', src];
  if (range.end != null) a.push('-t', String(range.end - range.start));
  // CRF with a ceiling: 3 Mbit/s keeps a 60–90 s 1080p film around 25 MiB
  a.push('-vf', scale(FULL_MAX), '-c:v', 'libx264', '-crf', String(CRF_FULL), '-maxrate', '3M', '-bufsize', '6M',
    '-preset', 'slow', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out);
  run('ffmpeg', a);
}

function poster(clip, out, max) {
  // first frame of the encoded clip, so poster -> video swap is seamless
  run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', clip, '-frames:v', '1',
    '-vf', scale(max), '-c:v', 'libwebp', '-quality', '80', out]);
}

// ------------------------------------------------ accent colour from a poster
function autoAccent(posterFile) {
  if (DRY) return '#C4563A';
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', posterFile, '-vf', 'scale=48:48', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  const px = r.stdout;
  const bins = Array.from({ length: 24 }, () => ({ w: 0, r: 0, g: 0, b: 0 }));
  for (let i = 0; i + 2 < px.length; i += 3) {
    const [R, G, B] = [px[i] / 255, px[i + 1] / 255, px[i + 2] / 255];
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B), l = (mx + mn) / 2, d = mx - mn;
    if (d < 0.08) continue; // greys carry no accent
    const s = d / (1 - Math.abs(2 * l - 1));
    let h = mx === R ? ((G - B) / d) % 6 : mx === G ? (B - R) / d + 2 : (R - G) / d + 4;
    h = (h * 60 + 360) % 360;
    const w = s * (1 - Math.abs(l - 0.5) * 1.6);
    const bin = bins[Math.floor(h / 15)];
    bin.w += w; bin.r += R * w; bin.g += G * w; bin.b += B * w;
  }
  const best = bins.reduce((a, b) => (b.w > a.w ? b : a));
  if (best.w === 0) return '#C4563A'; // monochrome footage -> house terracotta
  let [R, G, B] = [best.r / best.w, best.g / best.w, best.b / best.w];
  const mx = Math.max(R, G, B), mn = Math.min(R, G, B), l = (mx + mn) / 2;
  const target = Math.min(0.55, Math.max(0.38, l));
  const k = l ? target / l : 1;
  [R, G, B] = [R, G, B].map((c) => Math.min(1, c * k));
  return '#' + [R, G, B].map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

// ---------------------------------------------------------------- check the file first
const data = JSON.parse(readFileSync(DATA, 'utf8'));
data.projects ??= [];
const problems = [];
const slugs = new Set();
for (const p of data.projects) {
  const at = p.slug || '(project without slug)';
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug || '')) problems.push(`${at}: slug must be lowercase letters, digits and dashes`);
  if (slugs.has(p.slug)) problems.push(`${at}: slug used twice`);
  slugs.add(p.slug);
  if (p.slug === 'hero') problems.push('"hero" is reserved for the cover reel');
  if (p.cleared === false) continue;
  if (!p.name) problems.push(`${at}: "name" is missing`);
  if (!Array.isArray(p.clips) || !p.clips.length) problems.push(`${at}: "clips" needs at least one range`);
  for (const r of p.clips || []) {
    try {
      const { start, end } = parseRange(r);
      if (end == null) problems.push(`${at}: loop "${r}" has no end — loops must be 4–6 s ("47-52")`);
      else if (end - start < 4 || end - start > 6) warn(`${at}: loop "${r}" is ${+(end - start).toFixed(2)} s — the brief asks for 4–6 s`);
    } catch (e) { problems.push(`${at}: ${e.message}`); }
  }
  if (p.full) { try { parseRange(p.full === true ? '0-' : p.full); } catch (e) { problems.push(`${at}: full ${e.message}`); } }
  if (p.accent && p.accent !== 'auto' && !/^#[0-9a-f]{6}$/i.test(p.accent)) problems.push(`${at}: accent must be "auto" or a hex colour like "#C4563A"`);
  if (p.clips?.length > LETTERS.length) problems.push(`${at}: at most ${LETTERS.length} clips`);
}
if (data.hero?.range) {
  try { const { end } = parseRange(data.hero.range); if (end == null) problems.push('hero: range needs an end'); } catch (e) { problems.push(`hero: ${e.message}`); }
}
if (ONLY) for (const s of ONLY) if (s !== 'hero' && !slugs.has(s)) problems.push(`--only: no project with slug "${s}"`);
if (problems.length) {
  console.error('content/projects.json has problems — nothing was encoded:\n' + problems.map((m) => '  - ' + m).join('\n'));
  process.exit(1);
}

// ---------------------------------------------------------------- encode
for (const d of ['clips', 'posters', 'full']) mkdirSync(join(ROOT, 'assets', d), { recursive: true });
const report = [];
const failures = [];

function makeLoopSet(slug, src, srcName, ranges, prevClips = []) {
  return ranges.map((r, i) => {
    const range = parseRange(r);
    const id = `${slug}-${LETTERS[i]}`;
    const big = join(ROOT, 'assets/clips', `${id}.mp4`);
    const small = join(ROOT, 'assets/clips', `${id}-720.mp4`);
    const pBig = join(ROOT, 'assets/posters', `${id}.webp`);
    const pSmall = join(ROOT, 'assets/posters', `${id}-720.webp`);
    const key = `${srcName}|${r}`;
    const prev = prevClips[i];
    let crf = prev?.crf ?? CRF_LOOP;
    if (!fresh(big, src, key, prev)) {
      console.log(`  clip ${id}  (${r})`);
      crf = CRF_LOOP;
      encodeLoop(src, range, big, LOOP_MAX, crf);
      if (!DRY && statSync(big).size > HEAVY_BYTES) {
        crf = CRF_LOOP_HEAVY;
        console.log(`    > 1.5 MB, re-encoding at CRF ${crf}`);
        encodeLoop(src, range, big, LOOP_MAX, crf);
      }
      encodeLoop(src, range, small, LOOP_SMALL, CRF_SMALL);
      poster(big, pBig, LOOP_MAX);
      poster(big, pSmall, LOOP_SMALL);
    }
    if (DRY) return null;
    const { w, h } = probe(big);
    const bytes = statSync(big).size;
    if (bytes > HEAVY_BYTES) warn(`${id}.mp4 is still ${(bytes / 1048576).toFixed(2)} MB at CRF ${crf}`);
    report.push([id, `${w}×${h}`, (bytes / 1024).toFixed(0) + ' kB', (statSync(small).size / 1024).toFixed(0) + ' kB']);
    return { src: rel(big), src720: rel(small), poster: rel(pBig), poster720: rel(pSmall), w, h, bytes, bytes720: statSync(small).size, crf, key };
  }).filter(Boolean);
}

// every file the encoder ever made for this slug
function unpublish(slug) {
  const removed = [];
  for (const dir of ['clips', 'posters', 'full']) {
    for (const f of readdirSync(join(ROOT, 'assets', dir))) {
      if (f === `${slug}.mp4` || f.startsWith(`${slug}-`)) {
        if (!DRY) unlinkSync(join(ROOT, 'assets', dir, f));
        removed.push(`assets/${dir}/${f}`);
      }
    }
  }
  return removed;
}

try {
  // hero (the landscape reel on the cover)
  if (data.hero?.source && (!ONLY || ONLY.includes('hero'))) {
    try {
      const src = resolveSource(data.hero.source, data.sourceDir);
      if (!existsSync(src)) throw new Error(`source not found: ${src}`);
      console.log('hero');
      const { w, h } = probe(src);
      if (h > w) warn('hero clip is portrait — the cover frame is landscape, use a landscape clip');
      const [clip] = makeLoopSet('hero', src, data.hero.source, [data.hero.range], data.hero.media ? [data.hero.media] : []);
      if (clip) data.hero.media = clip;
    } catch (e) { failures.push(`hero: ${e.message}`); }
  }

  for (const p of data.projects) {
    if (ONLY && !ONLY.includes(p.slug)) continue;
    if (p.cleared === false) {
      const gone = unpublish(p.slug);
      delete p.media;
      warn(`${p.slug}: "cleared": false — unpublished${gone.length ? ` (${gone.length} files ${DRY ? 'would be ' : ''}deleted)` : ''}`);
      continue;
    }
    try {
      const src = resolveSource(p.source, data.sourceDir);
      if (!src || !existsSync(src)) throw new Error(`source not found (${src})`);
      console.log(p.slug);
      const media = { ...(p.media || {}) };
      media.clips = makeLoopSet(p.slug, src, p.source, p.clips, p.media?.clips || []);
      if (p.full) {
        const range = parseRange(p.full === true ? '0-' : p.full);
        const out = join(ROOT, 'assets/full', `${p.slug}.mp4`);
        const pst = join(ROOT, 'assets/posters', `${p.slug}-full.webp`);
        const key = `${p.source}|${JSON.stringify(p.full)}`;
        if (!fresh(out, src, key, p.media?.full)) {
          console.log(`  full ${p.slug}`);
          encodeFull(src, range, out);
          poster(out, pst, LOOP_MAX);
        }
        if (!DRY) {
          const { w, h, duration } = probe(out);
          const bytes = statSync(out).size;
          if (bytes > FULL_WARN_BYTES) warn(`${p.slug}.mp4 is ${(bytes / 1048576).toFixed(1)} MB — Cloudflare Pages takes at most 25 MiB per file; shorten it or host the film elsewhere`);
          media.full = { src: rel(out), poster: rel(pst), w, h, duration: Math.round(duration), bytes, key };
          report.push([`${p.slug} (full)`, `${w}×${h}`, (bytes / 1048576).toFixed(1) + ' MB', `${Math.round(duration)} s`]);
        }
      } else {
        delete media.full;
      }
      if (!DRY && media.clips.length) {
        media.accent = !p.accent || p.accent === 'auto' ? autoAccent(join(ROOT, media.clips[0].poster)) : p.accent.toUpperCase();
      }
      if (!DRY) p.media = media;
    } catch (e) {
      failures.push(`${p.slug}: ${e.message}`);
    }
  }
} finally {
  if (!DRY) writeOutputs();
}

function writeOutputs() {
  writeFileSync(DATA, JSON.stringify(data, null, 2) + '\n');

  // public data: cleared projects with media, display fields only
  const PUBLIC = ['slug', 'name', 'category', 'client', 'featured', 'tiles', 'placeholder', 'whatIDid', 'tools', 'turnaround', 'summary'];
  const pubClip = ({ src, src720, poster, poster720, w, h }) => ({ src, src720, poster, poster720, w, h });
  const projects = data.projects
    .filter((p) => p.cleared !== false && p.media?.clips?.length)
    .map((p) => ({
      ...Object.fromEntries(PUBLIC.filter((k) => p[k] !== undefined).map((k) => [k, p[k]])),
      media: {
        clips: p.media.clips.map(pubClip),
        ...(p.media.full ? { full: (({ src, poster, w, h, duration }) => ({ src, poster, w, h, duration }))(p.media.full) } : {}),
        accent: p.media.accent,
      },
    }));
  const site = {
    note: 'Generated by tools/clips.mjs from content/projects.json — edit that file, not this one.',
    ...(data.hero?.placeholder ? { hero: { placeholder: true } } : {}),
    ...(data.bandClip ? { bandClip: data.bandClip } : {}),
    projects,
  };
  writeFileSync(SITE, JSON.stringify(site, null, 2) + '\n');

  // keep index.html's reserved boxes in step with the real clips, so nothing jumps on load:
  // the cover reel's width/height, and the band clip's aspect ratio
  if (existsSync(HTML)) {
    const html = readFileSync(HTML, 'utf8');
    let next = html;
    const hero = data.hero?.media;
    if (hero) {
      next = next.replace(/(<video class="cover__video"[^>]*?)\swidth="\d+"\sheight="\d+"/, `$1 width="${hero.w}" height="${hero.h}"`);
    }
    const band = pickBand(projects, data.bandClip);
    if (band) {
      next = next.replace(/<div class="band__clip" id="band-clip"[^>]*>/, `<div class="band__clip" id="band-clip" style="--ar: ${band.w} / ${band.h}">`);
    }
    if (next !== html) writeFileSync(HTML, next);
  }

  console.log(`\nupdated ${rel(DATA)} and ${rel(SITE)} (${projects.length} published projects)`);
  if (report.length) {
    console.log('\nfile                     size        1280       720');
    for (const r of report) console.log(r[0].padEnd(24), r[1].padEnd(11), r[2].padStart(9), r[3].padStart(9));
  }
  if (failures.length) {
    console.error('\nFailed — everything else was saved:\n' + failures.map((m) => '  - ' + m).join('\n'));
    process.exitCode = 1;
  }
}

// same rule as js/ui.js renderBand: "slug:index", else the first featured project's last clip
function pickBand(projects, spec) {
  if (!projects.length) return null;
  const [slug, idx] = String(spec || '').split(':');
  let p = slug && projects.find((q) => q.slug === slug);
  let ci = Number(idx) || 0;
  if (!p) { p = projects.find((q) => q.featured) || projects[0]; ci = p.media.clips.length - 1; }
  return p.media.clips[Math.min(ci, p.media.clips.length - 1)];
}
