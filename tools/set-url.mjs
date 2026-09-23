#!/usr/bin/env node
// Points the page at its final address:
//   node tools/set-url.mjs https://your-domain.com/
// - rewrites canonical, og:url, og:image and twitter:image in index.html
// - regenerates assets/qr.svg for that address (needs: python3 -m pip install segno)
// Run it again after every domain change (e.g. Vercel -> Cloudflare Pages),
// and only print the QR code once the address is final.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let url = process.argv[2];
if (!url || !/^https:\/\/[^/\s]+/.test(url)) {
  console.error('usage: node tools/set-url.mjs https://your-domain.com/');
  process.exit(1);
}
if (!url.endsWith('/')) url += '/';

const file = join(ROOT, 'index.html');
let html = readFileSync(file, 'utf8');
const swaps = [
  [/(<link rel="canonical" href=")[^"]*(")/, `$1${url}$2`],
  [/(<meta property="og:url" content=")[^"]*(")/, `$1${url}$2`],
  [/(<meta property="og:image" content=")[^"]*(")/, `$1${url}assets/og-image.jpg$2`],
  [/(<meta name="twitter:image" content=")[^"]*(")/, `$1${url}assets/og-image.jpg$2`],
];
for (const [re, to] of swaps) {
  if (!re.test(html)) throw new Error(`index.html: pattern not found ${re}`);
  html = html.replace(re, to);
}
writeFileSync(file, html);
console.log(`index.html -> ${url}`);

const py = `import segno; segno.make(${JSON.stringify(url)}, error='m').save(${JSON.stringify(join(ROOT, 'assets/qr.svg'))}, scale=8, dark='#1A1A18', light=None)`;
const r = spawnSync('python3', ['-c', py], { encoding: 'utf8' });
if (r.status !== 0) {
  console.error(r.stderr || r.error);
  console.error('QR not written — install segno: python3 -m pip install segno');
  process.exit(1);
}
console.log(`assets/qr.svg -> ${url}`);
