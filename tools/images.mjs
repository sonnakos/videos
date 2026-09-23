#!/usr/bin/env node
// Stills for the page: the hero portrait, the About photo and the 1200×630 share image.
//
//   node tools/images.mjs portrait "<photo>"        -> assets/img/portrait-{720,1400}.webp
//   node tools/images.mjs about    "<photo>"        -> assets/img/about-{720,1400}.webp
//   node tools/images.mjs og       "<photo|clip>" [seconds]  -> assets/og-image.jpg
//
// Portrait/About keep the photo's own aspect ratio (nothing is cropped) and the
// width/height attributes of the matching <img data-slot="…"> in index.html are
// updated, so the layout reserves the right box before the image loads (no CLS).
// The share image is centre-cropped to 1200×630, as Open Graph requires.
// Needs ffmpeg + ffprobe (macOS: brew install ffmpeg).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [kind, rawInput, at = '1'] = process.argv.slice(2);
const usage = 'usage: node tools/images.mjs <portrait|about|og> "<file>" [seconds]';
if (!['portrait', 'about', 'og'].includes(kind) || !rawInput) {
  console.error(usage);
  process.exit(1);
}
const input = resolve(rawInput.replace(/^~(?=\/|$)/, homedir()));
if (!existsSync(input)) {
  console.error(`not found: ${input}`);
  process.exit(1);
}

function ff(bin, args) {
  const r = spawnSync(bin, args, { encoding: 'utf8' });
  if (r.error) throw new Error(`${bin} not found — install ffmpeg first`);
  if (r.status !== 0) throw new Error(`${bin} failed:\n${r.stderr}`);
  return r.stdout;
}

if (kind === 'og') {
  const out = join(ROOT, 'assets/og-image.jpg');
  const tmp = out + '.tmp.jpg';
  const isVideo = /\.(mp4|mov|m4v|webm|mkv)$/i.test(input);
  if (existsSync(tmp)) unlinkSync(tmp);
  ff('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...(isVideo ? ['-ss', at] : []), '-i', input,
    '-frames:v', '1', '-vf', 'scale=1200:630:force_original_aspect_ratio=increase,crop=1200:630',
    '-q:v', '3', '-f', 'image2', tmp]);
  if (!existsSync(tmp)) {
    console.error(`no frame at ${at} s — the clip is shorter than that; pick an earlier second`);
    process.exit(1);
  }
  writeFileSync(out, readFileSync(tmp));
  unlinkSync(tmp);
  console.log('wrote assets/og-image.jpg (1200×630)');
  process.exit(0);
}

// portrait / about: two widths, aspect kept (ffmpeg applies EXIF rotation itself)
const dims = (file) => {
  const s = JSON.parse(ff('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'json', file])).streams[0];
  return { w: s.width, h: s.height };
};
for (const size of [720, 1400]) {
  const out = join(ROOT, `assets/img/${kind}-${size}.webp`);
  ff('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-frames:v', '1',
    '-vf', `scale=w='min(${size},iw)':h=-2:flags=lanczos`, '-c:v', 'libwebp', '-quality', '82', out]);
  console.log(`wrote assets/img/${kind}-${size}.webp`);
}
// measure what was written rather than the source, so rotated phone photos get the right box
const big = dims(join(ROOT, `assets/img/${kind}-1400.webp`));
const outW = big.w;
const outH = big.h;
const smallW = dims(join(ROOT, `assets/img/${kind}-720.webp`)).w;

// keep index.html's reserved box in step with the photo's real aspect ratio
const html = join(ROOT, 'index.html');
const src = readFileSync(html, 'utf8');
const re = new RegExp(`(<img[^>]*data-slot="${kind}"[^>]*>)`);
const m = re.exec(src);
if (m) {
  const tag = m[1]
    .replace(/\swidth="\d+"/, ` width="${outW}"`)
    .replace(/\sheight="\d+"/, ` height="${outH}"`)
    .replace(/\ssrcset="[^"]*"/, ` srcset="assets/img/${kind}-720.webp ${smallW}w, assets/img/${kind}-1400.webp ${outW}w"`);
  writeFileSync(html, src.replace(m[1], tag));
  console.log(`index.html: <img data-slot="${kind}"> now ${outW}×${outH}, srcset updated`);
} else {
  console.warn(`index.html has no <img data-slot="${kind}"> — width/height not updated`);
}
