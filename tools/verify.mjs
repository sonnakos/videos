#!/usr/bin/env node
// The verification gates from the brief (§12), run in a real browser.
//
//   node tools/verify.mjs            starts dev-server.mjs on :4174 and runs every gate
//   BASE=https://… node tools/verify.mjs   runs against a deployed copy instead
//
// Needs Playwright (npm i -g playwright, or npx). The site itself has no npm dependency.
// Playwright's bundled Chromium cannot decode H.264, so when the browser reports no
// H.264 support the script answers each .mp4 request with a VP9 copy of the same clip
// (made once with ffmpeg into .qa-cache/). The shipped files are not touched.
// Writes screenshots and report.json to qa-report/.
import { execSync, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'qa-report');
const CACHE = join(ROOT, '.qa-cache');
mkdirSync(OUT, { recursive: true });

async function loadPlaywright() {
  try { return await import('playwright'); } catch {}
  const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
  return import(pathToFileURL(join(globalRoot, 'playwright', 'index.mjs')).href);
}
const { chromium, devices } = await loadPlaywright();

const results = [];
const gate = (id, name, pass, detail) => {
  results.push({ id, name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${String(id).padEnd(4)} ${name}${detail ? ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
};

// ------------------------------------------------------------ 1 syntax
{
  const files = ['main.js', ...readdirSync(join(ROOT, 'js')).filter((f) => f.endsWith('.js')).map((f) => `js/${f}`)];
  const bad = [];
  for (const f of files) {
    // `node --check file.js` silently passes ES-module syntax errors on Node 22, so parse as a module explicitly
    const r = spawnSync(process.execPath, ['--input-type=module', '--check'], { input: readFileSync(join(ROOT, f)), encoding: 'utf8' });
    if (r.status !== 0) bad.push(`${f}: ${r.stderr.split('\n').find((l) => /Error/.test(l))}`);
  }
  gate(1, `JS syntax (${files.length} modules)`, bad.length === 0, bad.join('; '));
}

// ------------------------------------------------------------ 2 server
let server;
let BASE = process.env.BASE;
if (!BASE) {
  // a port nobody else is using, so we never test some other server by accident
  const port = await new Promise((res) => {
    const probe = createServer().listen(0, '127.0.0.1', () => { const p = probe.address().port; probe.close(() => res(p)); });
  });
  server = spawn(process.execPath, [join(ROOT, 'dev-server.mjs')], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
  let exited = false;
  server.on('exit', () => { exited = true; });
  BASE = `http://localhost:${port}/`;
  let up = false;
  for (let i = 0; i < 50 && !exited && !up; i++) {
    try { up = (await fetch(BASE, { method: 'HEAD' })).ok; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  if (!up) { console.error('dev-server.mjs did not start'); process.exit(1); }
}
try {
  const r = await fetch(BASE);
  const rr = await fetch(new URL('assets/clips/hero-a.mp4', BASE), { headers: { Range: 'bytes=0-99' } });
  gate(2, 'server answers index.html with 200, video with 206', r.status === 200 && rr.status === 206, `index ${r.status}, range ${rr.status}`);
} catch (e) {
  gate(2, 'server reachable', false, e.message);
}

// ------------------------------------------------------------ browser
// WebGL through SwiftShader, chosen explicitly: the cover print refuses a browser's silent
// software fallback (failIfMajorPerformanceCaveat), so without this it would not run here
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const probe = await browser.newPage();
const h264 = await probe.evaluate(() => document.createElement('video').canPlayType('video/mp4; codecs="avc1.640028"'));
await probe.close();
const useShim = !h264;
if (useShim) {
  mkdirSync(CACHE, { recursive: true });
  const mp4s = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : p.endsWith('.mp4') && mp4s.push(p); } };
  walk(join(ROOT, 'assets'));
  for (const f of mp4s) {
    const out = join(CACHE, f.replace(ROOT + '/', '').replace(/\//g, '__') + '.webm');
    if (existsSync(out) && statSync(out).mtimeMs >= statSync(f).mtimeMs) continue;
    spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', f, '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-b:v', '0', '-crf', '40', '-row-mt', '1', '-c:a', 'libopus', out]);
  }
  console.log(`note  this Chromium has no H.264 decoder — serving VP9 stand-ins for ${mp4s.length} .mp4 files (QA only)`);
}

const problems = { http: [], console: [] };
const requested = new Set();
async function newPage(name, opts = {}) {
  const ctx = await browser.newContext(opts);
  if (useShim) {
    await ctx.route('**/*.mp4', async (route) => {
      // ask the real server first: a missing or refused file must still fail the 404 gate
      const real = await route.fetch({ headers: { ...route.request().headers(), range: 'bytes=0-0' } });
      if (real.status() >= 400) return route.fulfill({ response: real });
      const rel = decodeURIComponent(new URL(route.request().url()).pathname).replace(/^\//, '');
      const file = join(CACHE, rel.replace(/\//g, '__') + '.webm');
      if (!existsSync(file)) return route.fulfill({ response: real });
      const buf = readFileSync(file);
      const range = route.request().headers().range;
      const headers = { 'content-type': 'video/webm', 'accept-ranges': 'bytes' };
      if (!range) return route.fulfill({ status: 200, headers, body: buf });
      const m = /bytes=(\d*)-(\d*)/.exec(range);
      const start = m[1] ? +m[1] : 0;
      const end = Math.min(m[2] ? +m[2] : buf.length - 1, buf.length - 1);
      return route.fulfill({ status: 206, headers: { ...headers, 'content-range': `bytes ${start}-${end}/${buf.length}` }, body: buf.subarray(start, end + 1) });
    });
  }
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') problems.console.push(`${name}: [${m.type()}] ${m.text()}`); });
  page.on('pageerror', (e) => problems.console.push(`${name}: [pageerror] ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400) problems.http.push(`${name}: ${r.status()} ${r.url()}`); });
  page.on('request', (r) => requested.add(r.url()));
  return { ctx, page };
}

// wait for the project world to settle open/closed (a view transition needs a couple of rendered frames)
const worldSettles = (page, open) => page.waitForFunction((o) => document.querySelector('#pw').open === o && !document.documentElement.matches(':active-view-transition'), open, { timeout: 5000 }).catch(() => {}).then(() => page.waitForTimeout(250));
let holesOf;
const playing = (page) => page.evaluate(() => [...document.querySelectorAll('video')].filter((v) => !v.paused).length);
async function scrollThrough(page, sample) {
  const H = await page.evaluate(() => document.documentElement.scrollHeight);
  let max = 0;
  for (let y = 0; y <= H; y += 300) {
    await page.evaluate((y) => scrollTo({ top: y, behavior: 'instant' }), y);
    await page.waitForTimeout(140);
    if (sample) max = Math.max(max, await playing(page));
  }
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(300);
  return max;
}
const scrollToSel = (page, sel, dy = 0) => page.evaluate(([s, dy]) => {
  const el = document.querySelector(s);
  scrollTo({ top: el.getBoundingClientRect().top + scrollY - 56 + dy, behavior: 'instant' });
}, [sel, dy]);

// in-page contrast audit (§3.1 + WCAG 2.x)
function contrastAudit() {
  const parse = (c) => { const m = c.match(/[\d.]+/g).map(Number); return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 }; };
  const lum = ({ r, g, b }) => [r, g, b].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase();
  function background(el) {
    const layers = [];
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
      if (n instanceof SVGElement && n.tagName !== 'svg') continue; // svg children: the svg itself declares what is behind them
      if (n.matches?.('svg[data-bg]')) { const h = n.dataset.bg; layers.push({ r: parseInt(h.slice(1, 3), 16), g: parseInt(h.slice(3, 5), 16), b: parseInt(h.slice(5, 7), 16), a: 1 }); break; }
      const cs = getComputedStyle(n);
      const bg = parse(cs.backgroundColor);
      if (bg.a > 0) { layers.push(bg); if (bg.a === 1) break; }
      // an absolutely positioned layer painting behind this subtree (e.g. the dialog's stage)
      const behind = n.querySelector?.(':scope > .pw__bg');
      if (behind) { layers.push(parse(getComputedStyle(behind).backgroundColor)); break; }
    }
    let c = { r: 245, g: 241, b: 234, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) c = over(layers[i], c);
    return c;
  }
  const out = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (!t.textContent.trim()) continue;
    const el = t.parentElement;
    if (seen.has(el) || el.closest('.sr-only, noscript, script, style, [hidden], .defs')) continue;
    seen.add(el);
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (el.closest('dialog:not([open])')) continue;
    const modal = document.querySelector('dialog[open]');
    if (modal && !modal.contains(el)) continue; // covered by the open project world
    let opacity = 1;
    for (let n = el; n && n.nodeType === 1; n = n.parentElement) opacity *= Number(getComputedStyle(n).opacity);
    if (opacity < 0.99) continue; // entering or deliberately dimmed while another tile is hovered
    const isSvg = el instanceof SVGElement;
    const fg = parse(isSvg ? (cs.fill.startsWith('rgb') ? cs.fill : cs.color) : cs.color);
    const bg = background(el);
    const m = isSvg ? el.getScreenCTM() : null;
    const size = parseFloat(cs.fontSize) * (m ? Math.hypot(m.a, m.b) : 1);
    const weight = Number(cs.fontWeight);
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const need = large ? 3 : 4.5;
    const got = ratio(over(fg, bg), bg);
    const col = hex(fg);
    // house rules from §3.1 on top of WCAG
    let rule = '';
    if (col === '#C4563A' && !(size >= 24 || (size >= 19 && weight >= 600))) rule = 'terra below 24px';
    if (col === '#F03C20' && !(size >= 24 && weight >= 600) && el.closest('.display-xl, .display-l') === null) rule = 'flare text';
    if (got < need || rule) out.push({ text: t.textContent.trim().slice(0, 40), sel: el.className?.baseVal ?? el.className, fg: col, bg: hex(bg), size: Math.round(size), ratio: +got.toFixed(2), need, rule });
  }
  return { checked: seen.size, failures: out };
}

// ------------------------------------------------------------ desktop
const desk = await newPage('desktop', { viewport: { width: 1440, height: 900 } });
{
  const { page } = desk;
  await page.addInitScript(() => {
    window.__cls = 0; window.__lcp = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((l) => { const e = l.getEntries().at(-1); if (e) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
  });
  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  // first load = everything requested before the visitor scrolls (upper bound: whole files)
  const firstLoad = [...requested].filter((u) => u.startsWith(BASE));
  const bytes = firstLoad.reduce((s, u) => {
    const p = join(ROOT, decodeURIComponent(new URL(u).pathname).replace(/^\//, '') || 'index.html');
    return s + (existsSync(p) && statSync(p).isFile() ? statSync(p).size : existsSync(join(p, 'index.html')) ? statSync(join(p, 'index.html')).size : 0);
  }, 0);
  const perf = await page.evaluate(() => ({ lcp: Math.round(window.__lcp), cls: +window.__cls.toFixed(4) }));
  await page.screenshot({ path: join(OUT, 'desktop-hero.png') });
  gate('5a', 'desktop screenshot 1440×900 (hero)', true, 'qa-report/desktop-hero.png');

  const heroMoves = await page.evaluate(async () => {
    const v = document.querySelector('.cover__video');
    const tc = document.querySelector('#cover-tc').textContent;
    const a = v.currentTime; await new Promise((r) => setTimeout(r, 600));
    return { playing: !v.paused, advanced: +(v.currentTime - a).toFixed(2), timecode: [tc, document.querySelector('#cover-tc').textContent] };
  });
  gate('5b', 'cover: the reel plays and the timecode runs', heroMoves.playing && heroMoves.advanced > 0.2 && heroMoves.timecode[0] !== heroMoves.timecode[1], heroMoves);
  const fr = await page.evaluate(() => { const r = document.querySelector('.cover__frame').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
  const at = { x: Math.round(fr.w * 0.3), y: Math.round(fr.h * 0.4) };
  const lookState = () => page.evaluate(() => {
    const c = document.querySelector('.cover__print');
    return c ? { ...c.loupe, shown: c.style.visibility, pressed: document.querySelector('.cover__look').getAttribute('aria-pressed') } : null;
  });
  await page.mouse.move(fr.x + at.x, fr.y + at.y, { steps: 6 });
  await page.waitForTimeout(900);
  const loupe = await lookState();
  await page.mouse.click(fr.x + at.x, fr.y + at.y);
  await page.waitForTimeout(1200);
  const lookOpen = await lookState();
  await page.mouse.click(fr.x + at.x, fr.y + at.y);
  await page.waitForTimeout(1200);
  const lookClosed = await lookState();
  gate('H1', 'cover: the reel is printed in halftone, the loupe follows the mouse, a click opens full colour and closes it',
    !!loupe && loupe.shown === 'visible' && Math.hypot(loupe.x - at.x, loupe.y - at.y) < 6 && lookOpen.pressed === 'true' && lookOpen.shown === 'hidden' && lookClosed.pressed === 'false' && lookClosed.shown === 'visible',
    { at, loupe, open: lookOpen, closed: lookClosed });
  await page.mouse.move(720, 20);
  await page.focus('.cover__look');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  const keyOpen = await lookState();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  const keyClosed = await lookState();
  await page.evaluate(() => document.activeElement.blur());
  gate('H2', 'cover: the keyboard reaches the loupe and toggles full colour', keyOpen?.pressed === 'true' && keyOpen.shown === 'hidden' && keyClosed?.pressed === 'false' && keyClosed.shown === 'visible', { keyOpen, keyClosed });

  const maxPlaying = await scrollThrough(page, true);
  await scrollToSel(page, '#sheet', 200);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(OUT, 'desktop-gallery.png') });
  gate('5c', 'desktop screenshot (gallery)', true, 'qa-report/desktop-gallery.png');
  gate('9a', 'first load ≤ 3 MB (whole-file upper bound)', bytes <= 3 * 1024 * 1024, `${(bytes / 1048576).toFixed(2)} MB in ${firstLoad.length} requests`);
  gate('9b', 'never more than 6 videos playing (sampled while scrolling)', maxPlaying <= 6 && maxPlaying > 0, `max ${maxPlaying}`);
  gate('9c', 'LCP < 2.5 s, CLS < 0.1 (local)', perf.lcp < 2500 && perf.cls < 0.1, perf);

  holesOf = (pg) => pg.evaluate(() => {
    const sheet = document.querySelector('#sheet');
    const box = sheet.getBoundingClientRect();
    const cs = getComputedStyle(sheet);
    const cols = cs.gridTemplateColumns.split(' ').length;
    const gap = parseFloat(cs.columnGap);
    const colW = (box.width - gap * (cols - 1)) / cols;
    const rects = [...sheet.querySelectorAll('.tile')].map((t) => t.getBoundingClientRect());
    let interior = 0;
    let tail = 0;
    for (let c = 0; c < cols; c++) {
      const x = box.left + c * (colW + gap) + colW / 2;
      const spans = rects.filter((r) => r.left <= x && r.right >= x).map((r) => [r.top, r.bottom]).sort((a, b) => a[0] - b[0]);
      let y = box.top;
      for (const [t, b] of spans) { interior = Math.max(interior, t - y - gap); y = Math.max(y, b); }
      tail = Math.max(tail, (box.bottom - y) / box.height);
    }
    return { interiorPx: Math.round(interior), tailShare: +tail.toFixed(3) };
  });
  const sheetHoles = await holesOf(page);
  gate('G4', 'contact sheet: no interior hole taller than one gap (24px), bottom edge within 25% of the sheet', sheetHoles.interiorPx <= 24 && sheetHoles.tailShare <= 0.25, sheetHoles);
  const tiles = await page.evaluate(() => document.querySelectorAll('.sheet .tile').length);
  gate('G1', 'contact sheet has 15–20 frames', tiles >= 15 && tiles <= 20, `${tiles} frames`);
  const overflowD = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  gate('7a', 'desktop: no horizontal overflow', overflowD <= 0, `scrollWidth - innerWidth = ${overflowD}`);

  // hover: lift + dim the rest
  await scrollToSel(page, '#sheet', 100);
  await page.waitForTimeout(600);
  const tile = page.locator('.sheet .tile').nth(2);
  await tile.hover();
  await page.waitForTimeout(450);
  const hover = await page.evaluate(() => {
    const all = [...document.querySelectorAll('.sheet .tile')];
    const h = all.find((t) => t.matches(':hover'));
    const mark = h.querySelector('.tile__mark');
    const use = mark.querySelector('use');
    return {
      scale: getComputedStyle(h).transform,
      others: [...new Set(all.filter((t) => t !== h).map((t) => getComputedStyle(t).opacity))],
      cap: getComputedStyle(h.querySelector('.tile__cap')).transform,
      mark: getComputedStyle(mark).opacity,
      loop: !!document.querySelector(use.getAttribute('href')) && use.getBoundingClientRect().width > 0,
    };
  });
  gate('G2', 'hover: frame scales 1.035, the rest dim to 0.35, caption slides up', /1\.035/.test(hover.scale) && hover.others.join() === '0.35' && hover.cap === 'none', hover);
  gate('G3', 'hover: grease-pencil loop drawn round the frame', hover.mark === '1' && hover.loop, { mark: hover.mark, loop: hover.loop });
  await page.screenshot({ path: join(OUT, 'desktop-hover.png') });

  // open / close the project world three ways
  const openVia = async () => {
    const y = await page.evaluate(() => scrollY);
    await page.evaluate(() => document.querySelectorAll('.sheet .tile')[2].click());
    await worldSettles(page, true);
    return y;
  };
  const state = () => page.evaluate(() => ({
    open: document.querySelector('#pw').open,
    hash: location.hash,
    y: scrollY,
    pagePlaying: [...document.querySelectorAll('video')].filter((v) => !v.paused && !v.closest('#pw')).length,
    worldPlaying: [...document.querySelectorAll('#pw video')].filter((v) => !v.paused).length,
    worldClips: document.querySelectorAll('#pw .pw__clip').length,
  }));
  let y0 = await openVia();
  const opened = await state();
  await page.screenshot({ path: join(OUT, 'desktop-world.png') });
  gate('W1', 'tile opens the project world; gallery pauses, world clips play', opened.open && opened.pagePlaying === 0 && opened.worldPlaying > 0 && opened.hash.startsWith('#p/'), opened);
  await page.keyboard.press('Escape');
  await worldSettles(page, false);
  let closed = await state();
  gate('W2', 'Esc closes and returns to the same scroll position', !closed.open && Math.abs(closed.y - y0) <= 1 && closed.hash === '', { y0, ...closed });
  await page.waitForTimeout(400);
  gate('W3', 'gallery loops resume after closing', (await playing(page)) > 0);

  y0 = await openVia();
  await page.click('#pw-close');
  await worldSettles(page, false);
  closed = await state();
  gate('W4', '✕ closes and restores scroll', !closed.open && Math.abs(closed.y - y0) <= 1, { y0, ...closed });

  y0 = await openVia();
  const spot = await page.evaluate(() => {   // any point where the bare stage shows
    for (let y = 120; y < innerHeight; y += 20) for (let x = innerWidth - 20; x > 0; x -= 20) {
      const el = document.elementFromPoint(x, y);
      if (el?.hasAttribute('data-close-area')) return { x, y };
    }
    return null;
  });
  if (spot) await page.mouse.click(spot.x, spot.y);
  await worldSettles(page, false);
  closed = await state();
  gate('W5', 'click on the dark background closes', !!spot && !closed.open && Math.abs(closed.y - y0) <= 1, { spot, y0, ...closed });

  y0 = await openVia();
  await page.goBack();
  await worldSettles(page, false);
  closed = await state();
  gate('W6', 'browser Back closes the project instead of leaving the page', !closed.open && page.url().startsWith(BASE), { url: page.url(), ...closed });

  // featured project: full film has controls, sound on, nothing autoplays
  const featured = await page.evaluate(async () => {
    const res = await fetch('content/site.json'); const d = await res.json();
    return d.projects.find((p) => p.featured && p.media?.full)?.slug;
  });
  if (featured) {
    await page.evaluate((slug) => document.querySelector(`.sheet .tile[data-slug="${slug}"]`).click(), featured);
    await worldSettles(page, true);
    const full = await page.evaluate(() => { const v = document.querySelector('#pw-full video'); return { visible: !document.querySelector('#pw-full').hidden, controls: v.controls, muted: v.muted, paused: v.paused, preload: v.preload }; });
    await page.evaluate(() => document.querySelector('.pw__scroll').scrollTo(0, 99999));
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT, 'desktop-world-full.png') });
    const loopsMuted = await page.evaluate(() => [...document.querySelectorAll('video')].filter((v) => !v.controls).every((v) => v.muted));
    gate('W7', 'featured: full film with controls and sound, not autoplaying; every loop muted', full.visible && full.controls && !full.muted && full.paused && full.preload === 'none' && loopsMuted, { ...full, loopsMuted });
    await page.keyboard.press('Escape');
    await worldSettles(page, false);
  }

  // keyboard: Tab reaches a tile, Enter opens it
  await page.evaluate(() => scrollTo(0, 0));
  let reached = null;
  for (let i = 0; i < 12 && !reached; i++) {
    await page.keyboard.press('Tab');
    reached = await page.evaluate(() => (document.activeElement?.classList.contains('tile') ? document.activeElement.getAttribute('aria-label') : null));
  }
  const ring = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineOffset}`; });
  await page.keyboard.press('Enter');
  await worldSettles(page, true);
  const kbOpen = await page.evaluate(() => document.querySelector('#pw').open);
  gate('A1', 'keyboard: Tab reaches a frame (2px ring, 3px offset), Enter opens it', !!reached && kbOpen && ring === 'solid 2px 3px', { reached, ring, kbOpen });
  await page.keyboard.press('Escape');
  await worldSettles(page, false);

  // copy link
  await desk.ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(BASE).origin });
  await scrollToSel(page, '#contact');
  await page.click('#copy-link');
  await page.waitForFunction(() => document.querySelector('#copy-link').textContent !== 'Copy link', null, { timeout: 1500 }).catch(() => {});
  const copied = await page.evaluate(async () => ({ label: document.querySelector('#copy-link').textContent, clip: await navigator.clipboard.readText().catch(() => '?') }));
  await page.waitForTimeout(2200);
  const after = await page.evaluate(() => document.querySelector('#copy-link').textContent);
  gate('Q1', 'COPY LINK copies the page URL, shows COPIED ✓ for 2 s', copied.label === 'Copied ✓' && copied.clip === BASE && after === 'Copy link', { ...copied, after });
  const qrSize = await page.evaluate(() => { const r = document.querySelector('.qr__code').getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; });
  gate('Q2', 'QR code displayed at ≥ 160×160 px', qrSize[0] >= 160 && qrSize[1] >= 160, qrSize.join('×'));

  // contrast, page + open world
  const auditPage = await page.evaluate(contrastAudit);
  await page.evaluate(() => document.querySelectorAll('.sheet .tile')[0].click());
  await worldSettles(page, true);
  const auditWorld = await page.evaluate(contrastAudit);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(700);
  // hover state: tile number on its accent chip, caption on paper
  await scrollToSel(page, '#sheet', 100);
  await page.waitForTimeout(500);
  const chipFails = [];
  const n = await page.evaluate(() => document.querySelectorAll('.sheet .tile').length);
  for (let i = 0; i < n; i++) {
    await page.evaluate((i) => document.querySelectorAll('.sheet .tile')[i].scrollIntoView({ block: 'center' }), i);
    await page.locator('.sheet .tile').nth(i).hover();
    await page.waitForTimeout(300);
    const a = await page.evaluate(contrastAudit);
    chipFails.push(...a.failures.filter((f) => /tile__/.test(f.sel)));
  }
  const fails = [...auditPage.failures, ...auditWorld.failures, ...chipFails];
  gate(8, `contrast ≥ 4.5:1 (large ≥ 3:1) + §3.1 terracotta/red rules — ${auditPage.checked + auditWorld.checked} text elements + ${n} hovered frames`, fails.length === 0, fails.length ? fails.slice(0, 8) : '');
}

// ------------------------------------------------------------ mobile
{
  const { page } = await newPage('mobile', { ...devices['iPhone 13'] });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1800);
  const vw = await page.evaluate(() => innerWidth);
  await page.screenshot({ path: join(OUT, 'mobile-hero.png') });
  gate('6a', 'mobile screenshot (iPhone 13 emulation, 390 px)', vw === 390, `innerWidth ${vw}; qa-report/mobile-hero.png`);
  const maxPlaying = await scrollThrough(page, true);
  await scrollToSel(page, '#sheet', 100);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(OUT, 'mobile-gallery.png') });
  const ov = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth }));
  // a mobile browser widens the layout viewport to fit overflowing content, so innerWidth alone can hide an overflow
  gate(7, 'mobile: scrollWidth === innerWidth === device width (390)', ov.scrollWidth === ov.innerWidth && ov.innerWidth === 390, ov);
  gate('9d', 'mobile: never more than 6 videos playing', maxPlaying <= 6, `max ${maxPlaying}`);
  const mobileHoles = await holesOf(page);
  gate('G4m', 'mobile contact sheet: no interior hole taller than one gap (16px), bottom edge within 25%', mobileHoles.interiorPx <= 16 && mobileHoles.tailShare <= 0.25, mobileHoles);
  const small = await page.evaluate(() => [...document.querySelectorAll('.sheet video')].slice(0, 4).map((v) => v.currentSrc.split('/').pop()));
  gate('6b', 'mobile gets the 720 px clips', small.every((s) => s.includes('-720')), small);
  await page.evaluate(() => document.querySelectorAll('.sheet .tile')[0].click());
  await worldSettles(page, true);
  await page.screenshot({ path: join(OUT, 'mobile-world.png') });
  const ovW = await page.evaluate(() => document.querySelector('.pw__scroll').scrollWidth - document.querySelector('.pw__scroll').clientWidth);
  gate('6c', 'mobile project world fits the screen', ovW <= 0, `overflow ${ovW}px`);
}

// ------------------------------------------------------------ tablet first load, #contact landing
{
  requested.clear();
  const { page } = await newPage('tablet', { viewport: { width: 820, height: 1180 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(2500);
  const bytes = [...requested].filter((u) => u.startsWith(BASE)).reduce((s, u) => {
    const p = join(ROOT, decodeURIComponent(new URL(u).pathname).replace(/^\//, '') || 'index.html');
    return s + (existsSync(p) && statSync(p).isFile() ? statSync(p).size : 0);
  }, 0);
  gate('9e', 'tablet 820×1180 @2x: first load ≤ 3 MB (whole-file upper bound)', bytes <= 3 * 1024 * 1024, `${(bytes / 1048576).toFixed(2)} MB`);
}
{
  const { page } = await newPage('contact-landing', { viewport: { width: 1440, height: 900 } });
  await page.addInitScript(() => {
    window.__cls = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto(BASE + '#contact', { waitUntil: 'load' });
  await page.waitForTimeout(2000);
  const cls = await page.evaluate(() => +window.__cls.toFixed(4));
  gate('9f', 'landing on #contact: CLS < 0.1', cls < 0.1, { cls });
}

// ------------------------------------------------------------ 10 reduced motion
{
  const { page } = await newPage('reduced', { viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const max = await scrollThrough(page, true);
  await scrollToSel(page, '#sheet', 100);
  await page.waitForTimeout(1200);
  const posters = await page.evaluate(() => {
    const vis = [...document.querySelectorAll('.sheet video')].filter((v) => { const r = v.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; });
    return { inView: vis.length, withPoster: vis.filter((v) => v.poster).length, tilesVisible: [...document.querySelectorAll('.sheet .tile__in')].every((t) => getComputedStyle(t).opacity === '1') };
  });
  await page.evaluate(() => scrollTo(0, 0));
  await page.mouse.move(150, 200);
  await page.waitForTimeout(500);
  const loupeAt = () => page.evaluate(() => { const l = document.querySelector('.cover__print')?.loupe; return l ? `${l.x.toFixed(1)},${l.y.toFixed(1)}` : 'no print'; });
  const l1 = await loupeAt();
  await page.waitForTimeout(800);
  const l2 = await loupeAt();
  const anim = await page.evaluate(() => ({
    stamp: getComputedStyle(document.querySelector('.stamp svg')).animationName,
    marquee: getComputedStyle(document.querySelector('.marquee__track')).animationName,
  }));
  anim.loupe = l1 !== 'no print' && l1 === l2 ? 'still' : `${l1} → ${l2}`;
  await scrollToSel(page, '#sheet', 100);
  await page.screenshot({ path: join(OUT, 'reduced-motion-gallery.png') });
  gate(10, 'reduced motion: no video plays, posters show, frames visible, stamp + marquee still, the loupe does not wander', max === 0 && posters.withPoster === posters.inView && posters.inView > 0 && posters.tilesVisible && anim.stamp === 'none' && anim.marquee === 'none' && anim.loupe === 'still', { maxPlaying: max, ...posters, ...anim });
}

// ------------------------------------------------------------ 3 + 4
gate(3, 'no 404 / 4xx / 5xx on any request', problems.http.length === 0, problems.http.slice(0, 10).join('; '));
gate(4, 'console clean: 0 errors, 0 warnings', problems.console.length === 0, problems.console.slice(0, 10).join('; '));

await browser.close();
server?.kill();

const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const site = JSON.parse(readFileSync(join(ROOT, 'content/site.json'), 'utf8'));
const left = [];
if (/example\.com/.test(html)) left.push('contact e-mail + START A PROJECT mailto (hello@example.com)');
if (/@handle|linkedin\.com\/in\/…|href="https:\/\/www\.(instagram|linkedin)\.com\/"/.test(html)) left.push('Instagram / LinkedIn links');
if (/\.example\//.test(html)) left.push('SITE_URL (canonical, og:*, QR) — run tools/set-url.mjs');
const ph = site.projects.filter((p) => p.placeholder).length;
if (ph) left.push(`${ph} placeholder projects in content/projects.json`);
if (site.hero?.placeholder) left.push('placeholder cover reel');
for (const l of left) console.log(`note  still a placeholder: ${l}`);
writeFileSync(join(OUT, 'report.json'), JSON.stringify({ base: BASE, h264Shim: useShim, results }, null, 2));
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} gates passed${failed.length ? ' — failing: ' + failed.map((f) => f.id).join(', ') : ''}`);
process.exit(failed.length ? 1 : 0);
