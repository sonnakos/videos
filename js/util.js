// Small shared helpers: media queries, colour contrast, escaping.
export const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
export const mobile = matchMedia('(max-width: 767px)');

export const INK = '#1A1A18';
export const PAPER = '#F5F1EA';

export const pad2 = (n) => String(n).padStart(2, '0');
export const $ = (sel, root = document) => root.querySelector(sel);

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

// ---- WCAG 2.x relative luminance / contrast --------------------------------
const rgb = (hex) => hex.replace('#', '').match(/../g).map((h) => parseInt(h, 16));
const toHex = (c) => '#' + c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');

function luminance(hex) {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// The tile number is micro text, so a project accent behind it must reach 4.5:1
// with ink or paper. Mid-tones that reach neither are nudged darker or lighter
// until one of them passes — the hue stays, only the value moves.
export function chipColors(accent) {
  let bg = /^#[0-9a-f]{6}$/i.test(accent || '') ? accent : '#C4563A';
  for (let i = 0; i < 24; i++) {
    const onInk = contrast(bg, INK);
    const onPaper = contrast(bg, PAPER);
    if (Math.max(onInk, onPaper) >= 4.6) return { bg, fg: onInk >= onPaper ? INK : PAPER };
    const toward = onInk >= onPaper ? 255 : 0;
    bg = toHex(rgb(bg).map((v) => v + (toward - v) * 0.08));
  }
  return { bg: INK, fg: PAPER };
}
