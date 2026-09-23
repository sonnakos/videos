#!/usr/bin/env node
// Placeholder footage for the draft build — NOT Ákos's work, and labelled as such
// in every frame ("PLACEHOLDER FOOTAGE"). It exists so the layout, the REEL mask,
// the playback pool and the project overlay can be built and measured before the
// real clips are cut.
//
//   node tools/make-placeholders.mjs          synthetic sources + placeholder images
//   node tools/make-placeholders.mjs --seed   also (re)writes content/projects.json
//                                             with 10 placeholder projects
// Then: node tools/clips.mjs
//
// Sources go to .placeholder-src/ (git-ignored). Needs ffmpeg with libx264,
// libwebp and libfreetype (drawtext).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, '.placeholder-src');
const SEED = process.argv.includes('--seed');
const ANTON = join(ROOT, 'fonts/anton-latin.woff2');
const ARCHIVO = join(ROOT, 'fonts/archivo-latin.woff2');
mkdirSync(SRC, { recursive: true });
mkdirSync(join(ROOT, 'assets/img'), { recursive: true });

const INK = '#1A1A18', PAPER = '#F5F1EA', FLARE = '#F03C20', SEG = 5, FPS = 25;
const hex = (c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'pipe'] });
  if (r.status !== 0) throw new Error('ffmpeg failed:\n' + r.stderr?.toString());
}

// ---- one 5-second "look" per segment, all in the site palette ---------------
const looks = {
  bars: (w, h, c, seed) => {
    const bw = Math.round(w * 0.14);
    return `color=c=${INK}:s=${w}x${h}:r=${FPS}:d=${SEG},` +
      `drawbox=x='mod(t*${Math.round(w * 0.42)}+${seed * 37},iw+${bw})-${bw}':y=0:w=${bw}:h=ih:color=${c}:t=fill,` +
      `drawbox=x='mod(t*${Math.round(w * 0.27)}+${w / 2},iw+${bw})-${bw}':y=0:w=${Math.round(bw / 2)}:h=ih:color=${PAPER}:t=fill,` +
      `drawbox=x=0:y='mod(t*${Math.round(h * 0.3)},ih+${Math.round(h * 0.1)})-${Math.round(h * 0.1)}':w=iw:h=${Math.round(h * 0.05)}:color=${FLARE}:t=fill`;
  },
  life: (w, h, c, seed) => {
    const cw = Math.max(24, Math.round(w / 22)), ch = Math.max(24, Math.round(h / 22));
    return `life=s=${cw}x${ch}:mold=18:rate=${FPS}:ratio=0.18:seed=${seed}:death_color=${INK}:life_color=${PAPER}:mold_color=${c},` +
      `scale=${w}:${h}:flags=neighbor,trim=duration=${SEG},setpts=PTS-STARTPTS`;
  },
  cells: (w, h, c, seed) => {
    const [r, g, b] = hex(c);
    return `cellauto=rule=${[30, 90, 110, 150][seed % 4]}:s=${Math.round(w / 12)}x${Math.round(h / 12)}:rate=${FPS}:scroll=1:random_fill_ratio=0.5:seed=${seed},` +
      `scale=${w}:${h}:flags=neighbor,format=rgb24,` +
      `lutrgb=r='if(gt(val,128),${r},26)':g='if(gt(val,128),${g},26)':b='if(gt(val,128),${b},24)',trim=duration=${SEG},setpts=PTS-STARTPTS`;
  },
  count: (w, h, c) =>
    `color=c=${PAPER}:s=${w}x${h}:r=${FPS}:d=${SEG},` +
    `drawbox=x=0:y=ih/2:w=iw:h=2:color=${INK}:t=fill,drawbox=x=iw/2:y=0:w=2:h=ih:color=${INK}:t=fill,` +
    `drawtext=fontfile=${ANTON}:text='%{eif\\:${SEG}-floor(t)\\:d}':fontsize=h*0.5:fontcolor=${INK}:x=(w-text_w)/2:y=(h-text_h)/2,` +
    `drawbox=x=0:y='mod(t*ih*0.9,ih)':w=iw:h=ih*0.035:color=${c}:t=fill`,
  type: (w, h, c) =>
    `color=c=${c}:s=${w}x${h}:r=${FPS}:d=${SEG},` +
    `drawtext=fontfile=${ANTON}:text='PLACEHOLDER':fontsize=h*0.42:fontcolor=${INK}:x='w-mod(t*w*0.55,w+tw)':y=(h-text_h)/2`,
};

function label(w, h, tag) {
  const fs = Math.max(14, Math.round(Math.min(w, h) * 0.034));
  return `drawtext=fontfile=${ARCHIVO}:text='PLACEHOLDER FOOTAGE · ${tag}':fontsize=${fs}:fontcolor=${PAPER}:` +
    `box=1:boxcolor=${INK}:boxborderw=${Math.round(fs * 0.6)}:x=${Math.round(fs * 1.2)}:y=${Math.round(fs * 1.2)},` +
    `drawtext=fontfile=${ARCHIVO}:text='%{pts\\:hms}':fontsize=${fs}:fontcolor=${PAPER}:box=1:boxcolor=${INK}:` +
    `boxborderw=${Math.round(fs * 0.6)}:x=w-tw-${Math.round(fs * 1.2)}:y=h-th-${Math.round(fs * 1.2)}`;
}

function makeSource(file, { w, h, color, seq, tag, seed = 1, audio = false, seg = SEG }) {
  if (existsSync(file)) return;
  const parts = seq.map((look, i) => `${looks[look](w, h, color, seed + i)},${label(w, h, tag)},trim=duration=${seg},setpts=PTS-STARTPTS,fps=${FPS},setsar=1,format=yuv420p[s${i}]`);
  const concat = seq.map((_, i) => `[s${i}]`).join('') + `concat=n=${seq.length}:v=1:a=0[v]`;
  const args = ['-filter_complex', parts.join(';') + ';' + concat, '-map', '[v]'];
  if (audio) {
    // a quiet beep at each cut, so the featured full videos carry a real audio track
    args.unshift('-f', 'lavfi', '-i', `sine=frequency=880:sample_rate=48000:duration=${seq.length * seg}`);
    args.push('-map', '0:a', '-af', `volume='if(lt(mod(t,${seg}),0.08),0.15,0)':eval=frame`, '-c:a', 'aac', '-b:a', '96k');
  }
  args.push('-c:v', 'libx264', '-crf', '16', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', file);
  console.log('source', file.replace(ROOT + '/', ''));
  ffmpeg(args);
}

// ---- the 10 placeholder projects -----------------------------------------------
const P = [
  { n: 1, w: 1920, h: 1080, color: '#C4563A', seq: ['bars', 'life', 'cells', 'count'], featured: true, tiles: 3 },
  { n: 2, w: 720, h: 1280, color: '#7A8450', seq: ['life', 'count', 'bars'] },
  { n: 3, w: 864, h: 1080, color: '#D9A441', seq: ['cells', 'bars', 'type', 'life'], featured: true, tiles: 3 },
  { n: 4, w: 1080, h: 1080, color: '#4F6D8A', seq: ['count', 'cells', 'life'] },
  { n: 5, w: 886, h: 1920, color: '#C98B8B', seq: ['type', 'life', 'bars'] },
  { n: 6, w: 720, h: 1280, color: '#F03C20', seq: ['life', 'bars', 'cells', 'count'], featured: true, tiles: 3 },
  { n: 7, w: 1280, h: 720, color: '#D9A441', seq: ['cells', 'count', 'bars'] },
  { n: 8, w: 864, h: 1080, color: '#C4563A', seq: ['bars', 'life', 'type'] },
  { n: 9, w: 720, h: 1280, color: '#7A8450', seq: ['count', 'cells', 'life'] },
  { n: 10, w: 1280, h: 720, color: '#4F6D8A', seq: ['life', 'type', 'cells'] },
];
const pad = (n) => String(n).padStart(2, '0');

for (const p of P) {
  makeSource(join(SRC, `placeholder-${pad(p.n)}.mp4`), {
    w: p.w, h: p.h, color: p.color, seq: p.seq, tag: `P${pad(p.n)}`, seed: p.n * 7, audio: !!p.featured,
  });
}
// hero: landscape, fast cuts so the REEL letters show a moving montage
makeSource(join(SRC, 'placeholder-hero.mp4'), {
  w: 1280, h: 720, color: '#C4563A', seq: ['bars', 'life', 'cells', 'type'], tag: 'REEL', seed: 3, seg: 1.25,
});

// ---- placeholder stills (portrait 3:4 like cv picture.jpg, about photo 4:5) -------
function still(file, w, h, title, note) {
  if (existsSync(file)) return;
  const fs = Math.round(w * 0.028), m = Math.round(w * 0.06), tick = Math.round(w * 0.05);
  const marks = [[m, m], [w - m - tick, m], [m, h - m - 2], [w - m - tick, h - m - 2]]
    .map(([x, y]) => `drawbox=x=${x}:y=${y}:w=${tick}:h=2:color=${INK}:t=fill`).join(',') + ',' +
    [[m, m], [w - m - 2, m], [m, h - m - tick], [w - m - 2, h - m - tick]]
      .map(([x, y]) => `drawbox=x=${x}:y=${y}:w=2:h=${tick}:color=${INK}:t=fill`).join(',');
  ffmpeg(['-f', 'lavfi', '-i', `color=c=#E6DFD3:s=${w}x${h}:d=1`, '-frames:v', '1', '-vf',
    `${marks},drawtext=fontfile=${ANTON}:text='${title}':fontsize=${Math.round(w * 0.16)}:fontcolor=#55534D:x=(w-tw)/2:y=(h-th)/2-${fs * 2},` +
    `drawtext=fontfile=${ARCHIVO}:text='${note}':fontsize=${fs}:fontcolor=${INK}:x=(w-tw)/2:y=(h/2)+${fs * 3}`,
    '-c:v', 'libwebp', '-quality', '80', file]);
  console.log('still ', file.replace(ROOT + '/', ''));
}
still(join(SRC, 'portrait-placeholder.webp'), 1200, 1600, 'PORTRAIT', 'PLACEHOLDER · REPLACE WITH CV PICTURE.JPG');
still(join(SRC, 'about-placeholder.webp'), 1080, 1350, 'PHOTO', 'PLACEHOLDER · SECOND PHOTO, NOT THE PORTRAIT');

// ---- content/projects.json seed ----------------------------------------------------
if (SEED || !existsSync(join(ROOT, 'content/projects.json'))) {
  mkdirSync(join(ROOT, 'content'), { recursive: true });
  const projects = P.map((p) => ({
    slug: `placeholder-${pad(p.n)}`,
    name: `Placeholder ${pad(p.n)}`,
    category: 'Category TBC',
    client: 'Client TBC',
    featured: !!p.featured,
    tiles: p.tiles || 1,
    cleared: true,
    placeholder: true,
    accent: 'auto',
    whatIDid: 'TBC — Ákos fills this in (edit, colour, motion, shoot).',
    tools: 'TBC',
    turnaround: 'TBC',
    summary: 'Placeholder. One sentence on what this video solved for the client goes here.',
    source: `placeholder-${pad(p.n)}.mp4`,
    clips: p.seq.slice(0, p.featured ? 4 : 3).map((_, i) => `${i * SEG}-${(i + 1) * SEG}`),
    ...(p.featured ? { full: '0-' } : {}),
  }));
  const data = {
    sourceDir: '.placeholder-src',
    hero: { source: 'placeholder-hero.mp4', range: '0-5' },
    projects,
  };
  writeFileSync(join(ROOT, 'content/projects.json'), JSON.stringify(data, null, 2) + '\n');
  console.log('wrote content/projects.json (10 placeholder projects)');
}
