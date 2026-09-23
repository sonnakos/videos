// Minimal static server for local preview.
//   node dev-server.mjs            -> http://localhost:4174
//   PORT=5000 node dev-server.mjs  -> another port
// Supports HTTP Range requests (206), which <video> needs to play and loop.
// Listens on localhost only (HOST=0.0.0.0 to reach it from a phone on the same network).
import { createServer } from 'node:http';
import { pipeline } from 'node:stream';
import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const PORT = Number(process.env.PORT) || 4174;
const HOST = process.env.HOST || '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(body);
}

async function resolvePath(urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  if (rel.split('/').some((part) => part.startsWith('.'))) return null; // no .git, .placeholder-src, …
  if (rel.endsWith('/')) rel += 'index.html';
  const abs = normalize(join(ROOT, rel));
  if (abs !== ROOT && !abs.startsWith(ROOT + sep)) return null; // path traversal
  try {
    const info = await stat(abs);
    if (info.isDirectory()) return resolvePath(rel + '/');
    return { abs, info };
  } catch {
    return null;
  }
}

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return send(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
  }
  let found;
  try {
    found = await resolvePath(new URL(req.url, 'http://x').pathname);
  } catch {
    return send(res, 400, 'Bad Request');
  }
  if (!found) {
    console.log(`404 ${req.url}`);
    return send(res, 404, 'Not Found');
  }

  const { abs, info } = found;
  const size = info.size;
  const headers = {
    'Content-Type': TYPES[extname(abs).toLowerCase()] || 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-cache',
    'Last-Modified': info.mtime.toUTCString(),
  };

  const pipe = (stream) => pipeline(stream, res, () => {}); // closes the file if the client goes away
  const range = req.headers.range;
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (m) { // one byte range; anything else (multi-range, other units) gets the whole file, as RFC 9110 allows
    let start = m[1] !== '' ? Number(m[1]) : NaN;
    let end = m[2] !== '' ? Number(m[2]) : NaN;
    if (m[1] === '' && m[2] !== '') { // suffix range: last N bytes
      start = Math.max(0, size - Number(m[2]));
      end = size - 1;
    }
    if (Number.isNaN(end) || end >= size) end = size - 1;
    if (Number.isNaN(start) || start > end || start >= size) {
      return send(res, 416, 'Range Not Satisfiable', { 'Content-Range': `bytes */${size}` });
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return pipe(createReadStream(abs, { start, end }));
  }

  res.writeHead(200, { ...headers, 'Content-Length': size });
  if (req.method === 'HEAD') return res.end();
  pipe(createReadStream(abs));
});

server.listen(PORT, HOST, () => {
  console.log(`Serving ${ROOT}\n→ http://localhost:${PORT}/`);
});

