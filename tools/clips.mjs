#!/usr/bin/env node
// Cuts the gallery loop clips, posters and featured full videos out of the source
// footage listed in content/projects.json, then writes the measured sizes back
// into each project's "media" block (the site reads only that block).
//
//   node tools/clips.mjs              encode whatever is missing or out of date
//   node tools/clips.mjs --force      re-encode everything
//   node tools/clips.mjs --only a,b   only these project slugs (or "hero")
//   node tools/clips.mjs --dry-run    print the ffmpeg commands, touch nothing
//
// Needs ffmpeg + ffprobe on PATH (macOS: brew install ffmpeg). No npm packages.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(ROOT, 'content', 'projects.json');
const args = process.argv.slice(2);
const FORCE = args.includes('--force');
const DRY = args.includes('--dry-run');
const onlyArg = args.find((a, i) => args[i - 1] === '--only' || a.startsWith('--only='));
const ONLY = onlyArg ? onlyArg.replace('--only=', '').split(',').map((s) => s.trim()) : null;

const LOOP_MAX = 1280, LOOP_SMALL = 720, FULL_MAX = 1920;
const CRF_LOOP = 26, CRF_LOOP_HEAVY = 28, CRF_SMALL = 28, CRF_FULL = 23;
const HEAVY_BYTES = 1.5 * 1024 * 1024;
const LETTERS = 'abcdefgh';

// ---------------------------------------------------------------- helpers
const rel = (p) => p.replace(ROOT + '/', '');

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
  if (parts.some((n) => Number.isNaN(n))) throw new Error(`Bad time "${t}"`);
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

function parseRange(r) {
  // "47-52", "1:03-1:08", "12-" (to the end), or {in, out}
  if (typeof r === 'object' && r) return { start: parseTime(r.in ?? 0) ?? 0, end: r.out == null ? null : parseTime(r.out) };
  const m = /^\s*([\d:.]*)\s*-\s*([\d:.]*)\s*$/.exec(String(r));
  if (!m) throw new Error(`Bad range "${r}" — use "47-52" or "1:03-1:08"`);
  return { start: parseTime(m[1]) ?? 0, end: parseTime(m[2]) };
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

// scale so the longer side is at most `max`, keep aspect, force even dimensions (H.264 + yuv420p needs them)
const scale = (max) => `scale=w=${max}:h=${max}:force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos`;

function encodeLoop(src, range, out, max, crf) {
  const a = ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(range.start), '-i', src];
  if (range.end != null) a.push('-t', String(range.end - range.start));
  a.push('-an', '-vf', scale(max), '-c:v', 'libx264', '-crf', String(crf), '-preset', 'slow',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out);
  run('ffmpeg', a);
}

function encodeFull(src, range, out) {
  const a = ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(range.start), '-i', src];
  if (range.end != null) a.push('-t', String(range.end - range.start));
  a.push('-vf', scale(FULL_MAX), '-c:v', 'libx264', '-crf', String(CRF_FULL), '-preset', 'slow',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out);
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
  // clamp to a usable accent: saturated, mid lightness
  const mx = Math.max(R, G, B), mn = Math.min(R, G, B), l = (mx + mn) / 2;
  const target = Math.min(0.55, Math.max(0.38, l));
  const k = l ? target / l : 1;
  [R, G, B] = [R, G, B].map((c) => Math.min(1, c * k));
  return '#' + [R, G, B].map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
}

// ---------------------------------------------------------------- main
const data = JSON.parse(readFileSync(DATA, 'utf8'));
for (const d of ['clips', 'posters', 'full']) mkdirSync(join(ROOT, 'assets', d), { recursive: true });

const report = [];
const warn = (m) => console.warn('  ! ' + m);

function makeLoopSet(slug, src, srcName, ranges, prevClips = []) {
  const clips = [];
  ranges.forEach((r, i) => {
    const range = parseRange(r);
    const len = range.end == null ? null : range.end - range.start;
    if (len != null && (len < 4 || len > 6)) warn(`${slug} clip ${r}: ${len}s — loops should be 4–6 s`);
    const id = `${slug}-${LETTERS[i]}`;
    const big = join(ROOT, 'assets/clips', `${id}.mp4`);
    const small = join(ROOT, 'assets/clips', `${id}-720.mp4`);
    const pBig = join(ROOT, 'assets/posters', `${id}.webp`);
    const pSmall = join(ROOT, 'assets/posters', `${id}-720.webp`);
    const key = `${srcName}|${r}`; // as written in projects.json, so no local paths get published
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
    if (DRY) return;
    const { w, h } = probe(big);
    const bytes = statSync(big).size;
    if (bytes > HEAVY_BYTES) warn(`${id}.mp4 is still ${(bytes / 1048576).toFixed(2)} MB at CRF ${crf}`);
    clips.push({
      src: rel(big), src720: rel(small), poster: rel(pBig), poster720: rel(pSmall),
      w, h, bytes, bytes720: statSync(small).size, crf, key,
    });
    report.push([id, `${w}×${h}`, (bytes / 1024).toFixed(0) + ' kB', (statSync(small).size / 1024).toFixed(0) + ' kB']);
  });
  return clips;
}

// hero (landscape clip behind the REEL letters)
if (data.hero?.source && (!ONLY || ONLY.includes('hero'))) {
  const src = resolveSource(data.hero.source, data.sourceDir);
  if (!existsSync(src)) warn(`hero source not found: ${src}`);
  else {
    console.log('hero');
    const { w, h } = probe(src);
    if (h > w) warn('hero clip is portrait — the REEL mask is a wide band, use a landscape clip');
    const [clip] = makeLoopSet('hero', src, data.hero.source, [data.hero.range], data.hero.media ? [data.hero.media] : []);
    if (clip) data.hero.media = clip;
  }
}

for (const p of data.projects) {
  if (ONLY && !ONLY.includes(p.slug)) continue;
  if (p.cleared === false) {
    warn(`${p.slug}: "cleared": false — skipped (no permission to publish yet)`);
    continue;
  }
  const src = resolveSource(p.source, data.sourceDir);
  if (!src || !existsSync(src)) { warn(`${p.slug}: source not found (${src})`); continue; }
  if (!Array.isArray(p.clips) || p.clips.length < 1) { warn(`${p.slug}: no clip ranges`); continue; }
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
      media.full = { src: rel(out), poster: rel(pst), w, h, duration: Math.round(duration), bytes: statSync(out).size, key };
      report.push([`${p.slug} (full)`, `${w}×${h}`, (statSync(out).size / 1048576).toFixed(1) + ' MB', `${Math.round(duration)} s`]);
    }
  } else delete media.full;

  if (!DRY && media.clips.length) {
    media.accent = !p.accent || p.accent === 'auto' ? autoAccent(join(ROOT, media.clips[0].poster)) : p.accent;
  }
  p.media = media;
}

if (!DRY) {
  writeFileSync(DATA, JSON.stringify(data, null, 2) + '\n');
  console.log('\nupdated ' + rel(DATA));
  if (report.length) {
    console.log('\nfile                     size        1280       720');
    for (const r of report) console.log(r[0].padEnd(24), r[1].padEnd(11), r[2].padStart(9), r[3].padStart(9));
  }
}
