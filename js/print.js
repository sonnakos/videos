// The cover reel, printed. The footage is screened into two inks on the paper
// (terracotta dots at 15°, black at 45°, a hair out of register like a riso print), and a
// loupe shows the real footage, a little magnified, wherever the pointer goes. Click or
// tap opens the full-colour reel from that spot; again, and it goes back to print.
//   - on load the colour collapses into the loupe, so the first thing seen is still the reel
//   - touch: the loupe wanders on its own, a horizontal drag moves it, a tap opens it
//   - reduced motion: the print is the poster, the loupe stays where it is put
//   - no WebGL, or only a software renderer: nothing happens, the plain video stays
import { INK, PAPER, reducedMotion } from './util.js';

const PRINT_VERT = 'attribute vec2 a; void main() { gl_Position = vec4(a, 0.0, 1.0); }';
const PRINT_FRAG = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D u_tex;
uniform vec2 u_res;     // canvas, device px
uniform vec2 u_cover;   // share of the texture the frame shows (object-fit: cover)
uniform float u_cell;   // halftone cell, device px
uniform vec4 u_loupe;   // centre x, y (device px from the top left), radius, magnification
uniform float u_px;     // device px per CSS px
uniform vec3 u_paper;
uniform vec3 u_ink;
uniform vec3 u_terra;

vec3 tex(vec2 p) {
  return texture2D(u_tex, (p / u_res - 0.5) * u_cover + 0.5).rgb;
}
vec2 turn(vec2 v, float a) {
  float c = cos(a), s = sin(a);
  return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
}
float darkness(vec3 c) {
  return clamp((0.96 - dot(c, vec3(0.2126, 0.7152, 0.0722))) * 1.08, 0.0, 1.0);
}
// ink cover of one screen at p: the dot of p's cell, sized by the tone at the cell centre
float screen(vec2 p, float angle, bool key) {
  vec2 q = turn(p, -angle) / u_cell;
  vec2 cell = floor(q) + 0.5;
  float d = darkness(tex(turn(cell * u_cell, angle)));
  float tone = key ? smoothstep(0.5, 1.0, d) : d * 0.92;
  float r = 0.7071 * u_cell * sqrt(tone);
  return clamp(r - length(q - cell) * u_cell + 0.5, 0.0, 1.0);
}
void main() {
  vec2 p = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y);
  vec3 col = u_paper;
  col *= mix(vec3(1.0), u_terra / u_paper, screen(p + vec2(1.3, -0.9) * u_px, 0.2618, false));
  col *= mix(vec3(1.0), u_ink / u_paper, screen(p, 0.7854, true));

  vec2 v = p - u_loupe.xy;
  float d = length(v), R = u_loupe.z;
  vec3 real = tex(u_loupe.xy + v / u_loupe.w);
  real *= 1.0 - 0.16 * smoothstep(0.72 * R, R, d);
  col = mix(col, real, clamp(R - d + 0.5, 0.0, 1.0));
  // the rim: a hairline of ink, and a sliver of clean paper between it and the dots
  float w = 1.5 * u_px, gap = 2.5 * u_px;
  col = mix(col, u_paper, clamp(gap * 0.5 - abs(d - R - w - gap * 0.5) + 0.5, 0.0, 1.0));
  col = mix(col, u_ink, clamp(w * 0.5 - abs(d - R - w * 0.5) + 0.5, 0.0, 1.0));
  gl_FragColor = vec4(col, 1.0);
}`;

const HINT = {
  fine: ['Look through the loupe · click for full color', 'Click to go back to print'],
  coarse: ['Tap for full color', 'Tap to go back to print'],
};

export function initPrint(frame, video, hint) {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', {
    alpha: false, antialias: false, depth: false, stencil: false,
    failIfMajorPerformanceCaveat: true, powerPreference: 'low-power',
  });
  if (!gl) return;
  const prog = link(gl);
  if (!prog) return;

  const u = {};
  for (const n of ['u_res', 'u_cover', 'u_cell', 'u_loupe', 'u_px', 'u_paper', 'u_ink', 'u_terra']) u[n] = gl.getUniformLocation(prog, n);
  const rgb = (hex) => hex.slice(1).match(/../g).map((h) => parseInt(h, 16) / 255);
  gl.useProgram(prog);
  gl.uniform3fv(u.u_paper, rgb(PAPER));
  gl.uniform3fv(u.u_ink, rgb(INK));
  gl.uniform3fv(u.u_terra, rgb('#C4563A'));
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  for (const [k, v] of [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR]]) {
    gl.texParameteri(gl.TEXTURE_2D, k, v);
  }

  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const look = document.createElement('button');
  look.type = 'button';
  look.className = 'cover__look';
  look.setAttribute('aria-pressed', 'false');
  look.innerHTML = '<span class="sr-only">Show the reel in full color</span>';
  canvas.className = 'cover__print';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.visibility = 'hidden';
  frame.append(canvas, look);
  frame.classList.add('is-print', 'is-open');

  let w = 0, h = 0, px = 1, cssW = 0, cssH = 0;
  let srcW = 0, srcH = 0, fromVideo = false, fresh = false, ready = false;
  let inView = true, raf = 0, last = 0, t0 = performance.now(), shownNow = false;
  // loupe centre (L) and where it is heading (T), as fractions of the frame
  const L = { x: 0.62, y: 0.46 }, T = { x: 0.62, y: 0.46 };
  let follow = false, releaseAt = 0, moved = false;
  // 1 = full colour, 0 = print with a loupe; eased between from → to
  let open = 1, from = 1, to = 1, since = 0;
  const OPEN_MS = 820;
  const still = () => reducedMotion.matches;
  const roam = (now) => {
    const t = now - t0;
    T.x = 0.5 + 0.31 * Math.sin(t * 0.00031 + 0.4);
    T.y = 0.5 + 0.27 * Math.sin(t * 0.00047 + 1.3);
  };
  if (!still()) { roam(t0); L.x = T.x; L.y = T.y; }

  const upload = (src, sw, sh) => {
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, src);
    } catch { teardown(); return false; }
    srcW = sw; srcH = sh;
    return true;
  };
  const hasFrame = () => video.readyState >= 2 && video.videoWidth > 0 && (!video.paused || video.currentTime > 0);

  const draw = () => {
    if (fresh && hasFrame()) {
      fresh = false;
      if (!upload(video, video.videoWidth, video.videoHeight)) return;
      fromVideo = true;
    }
    if (!w || !h || !srcW) return;
    const fa = w / h, sa = srcW / srcH;
    const e = ease(open);
    const r0 = Math.max(44, Math.min(150, cssW * 0.09, cssH * 0.24)) * px;
    const cx = L.x * w, cy = L.y * h;
    const far = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy)) + 4 * px;
    gl.viewport(0, 0, w, h);
    gl.uniform2f(u.u_res, w, h);
    gl.uniform2f(u.u_cover, sa > fa ? fa / sa : 1, sa > fa ? 1 : sa / fa);
    gl.uniform1f(u.u_cell, Math.max(4.5, Math.min(8, cssW / 160)) * px);
    gl.uniform1f(u.u_px, px);
    gl.uniform4f(u.u_loupe, cx, cy, r0 + (far - r0) * e, 1.35 + (1 - 1.35) * e);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const tick = (now) => {
    raf = 0;
    const dt = Math.min(64, last ? now - last : 16.7);
    last = now;
    if (follow && releaseAt && now > releaseAt) { follow = false; releaseAt = 0; }
    if (!follow && !still()) roam(now);
    const k = still() ? 1 : 1 - Math.pow(follow ? 0.6 : 0.94, dt / 16.7);
    L.x += (T.x - L.x) * k;
    L.y += (T.y - L.y) * k;
    if (open !== to) {
      open = still() ? to : Math.max(0, Math.min(1, from + (to - from) * ((now - since) / OPEN_MS)));
      if ((to - from) * (to - open) <= 0) open = to;
    }
    const shown = open < 1;
    if (shown !== shownNow) { shownNow = shown; canvas.style.visibility = shown ? 'visible' : 'hidden'; }
    if (shown) draw();
    const busy = open !== to || (shown && (!still() || Math.abs(T.x - L.x) + Math.abs(T.y - L.y) > 0.0005 || !video.paused));
    if (busy) kick();
  };
  function kick() {
    if (!raf && inView && !document.hidden && ready) raf = requestAnimationFrame(tick);
  }

  const setOpen = (next) => {
    if (next === to) return;
    from = open; to = next; since = performance.now();
    frame.classList.toggle('is-open', next === 1);
    look.setAttribute('aria-pressed', String(next === 1));
    if (hint) hint.textContent = HINT[fine.matches ? 'fine' : 'coarse'][next];
    kick();
  };

  // the texture starts as the poster and switches to the video's own frames once it plays
  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) {
    const onFrame = () => { fresh = true; if (open < 1 || to < 1) kick(); video.requestVideoFrameCallback(onFrame); };
    video.requestVideoFrameCallback(onFrame);
  } else {
    video.addEventListener('timeupdate', () => { fresh = true; kick(); });
  }
  video.addEventListener('play', () => { fresh = true; kick(); });
  const poster = new Image();
  poster.decoding = 'async';
  poster.src = video.poster;
  const start = () => {
    if (ready) return;
    ready = true;
    if (hint) { hint.hidden = false; hint.textContent = HINT[fine.matches ? 'fine' : 'coarse'][0]; }
    // the colour collapses into the loupe once the reader has seen the reel
    setTimeout(() => setOpen(0), still() ? 0 : 450);
  };
  poster.decode().then(
    () => { if (fromVideo || upload(poster, poster.naturalWidth, poster.naturalHeight)) start(); },
    () => { fresh = true; start(); },  // no poster: the print waits for the first video frame
  );

  new ResizeObserver(([entry]) => {
    const box = entry.contentRect;
    px = Math.min(devicePixelRatio || 1, 2);
    cssW = box.width; cssH = box.height;
    w = Math.round(cssW * px); h = Math.round(cssH * px);
    canvas.width = w; canvas.height = h;
    if (open < 1) draw();
  }).observe(frame);
  new IntersectionObserver(([e]) => { inView = e.isIntersecting; kick(); }).observe(frame);
  document.addEventListener('visibilitychange', kick);
  reducedMotion.addEventListener('change', kick);

  // pointer: a mouse steers the loupe; a finger moves it with a sideways drag (vertical
  // drags stay page scrolls), and a tap opens from the spot it touched
  const aim = (e) => {
    const r = frame.getBoundingClientRect();
    T.x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    T.y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height));
    follow = true; releaseAt = 0;
    kick();
  };
  const release = () => { releaseAt = performance.now() + (still() ? Infinity : 1400); };
  let down = null;
  look.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'mouse' || down) aim(e);
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) moved = true;
  });
  look.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') release(); });
  look.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    down = { x: e.clientX, y: e.clientY };
    moved = false;
    aim(e);
  });
  const lift = () => { if (down) { down = null; release(); } };
  look.addEventListener('pointerup', lift);
  look.addEventListener('pointercancel', lift);
  look.addEventListener('click', (e) => {
    if (e.detail > 0) {  // a pointer, not the keyboard: open or close at that very spot
      if (moved) { moved = false; return; }
      aim(e);
      L.x = T.x; L.y = T.y;
      if (!fine.matches) release();
    }
    setOpen(to === 1 ? 0 : 1);
  });

  canvas.addEventListener('webglcontextlost', teardown);
  function teardown() {
    cancelAnimationFrame(raf);
    ready = false;
    canvas.remove();
    look.remove();
    frame.classList.remove('is-print', 'is-open');
    if (hint) hint.hidden = true;
  }

  // QA hook: where the loupe is, in CSS px from the frame's top left
  Object.defineProperty(canvas, 'loupe', { get: () => ({ x: L.x * cssW, y: L.y * cssH, open: to === 1 }) });
}

function link(gl) {
  const shader = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };
  const vs = shader(gl.VERTEX_SHADER, PRINT_VERT), fs = shader(gl.FRAGMENT_SHADER, PRINT_FRAG);
  if (!vs || !fs) return null;
  const p = gl.createProgram();
  gl.attachShader(p, vs);
  gl.attachShader(p, fs);
  gl.bindAttribLocation(p, 0, 'a');
  gl.linkProgram(p);
  return gl.getProgramParameter(p, gl.LINK_STATUS) ? p : null;
}

// the project world's curve, cubic-bezier(0.83, 0, 0.17, 1), close enough for a radius
function ease(t) {
  return t < 0.5 ? 16 * t ** 5 : 1 - (-2 * t + 2) ** 5 / 2;
}
