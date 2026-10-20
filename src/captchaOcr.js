'use strict';
const { wf, af, mv } = require('./fsx');
/**
 * Local, deterministic OCR for the Carrefour portal (Liferay) image CAPTCHA. No AI/LLM, no network:
 * classic image processing (red-line removal, dark threshold, morphological opening) + Tesseract OCR (tesseract.js,
 * WASM, pinned) with the eng traineddata bundled via the pinned npm package @tesseract.js-data/eng.
 * Returns { text, ok, conf, votes } — ok only when several preprocessing variants agree on exactly 4 digits.
 */
const path = require('path');
const fs = require('fs');
const { PNG } = require('pngjs');

const LANG_DIR = path.join(path.dirname(require.resolve('@tesseract.js-data/eng/package.json')), '4.0.0_best_int');

function toMask(png, thr) {
  const { width: w, height: h, data } = png; const m = new Uint8Array(w * h); const red = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    if (r > 140 && g < 110 && b < 110) { red[i] = 1; continue; } // red strike line: decided below
    if ((r + g + b) / 3 < thr) m[i] = 1;
  }
  // red line crosses the digits: a red pixel becomes ink when the first non-red pixels above and below are ink
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * w + x; if (!red[i]) continue;
    let u = y - 1; while (u >= 0 && red[u * w + x]) u--; let d = y + 1; while (d < h && red[d * w + x]) d++;
    if (u >= 0 && d < h && d - u <= 6 && m[u * w + x] && m[d * w + x]) m[i] = 1; }
  // 1px frame of the image is a black border: drop it
  for (let x = 0; x < w; x++) { m[x] = 0; m[(h - 1) * w + x] = 0; } for (let y = 0; y < h; y++) { m[y * w] = 0; m[y * w + w - 1] = 0; }
  return { w, h, m };
}
function morph({ w, h, m }, r, erode) {
  const o = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = erode ? 1 : 0;
    for (let dy = -r; dy <= r && (erode ? v : !v); dy++) for (let dx = -r; dx <= r; dx++) {
      const yy = y + dy, xx = x + dx; const p = (yy < 0 || xx < 0 || yy >= h || xx >= w) ? 0 : m[yy * w + xx];
      if (erode && !p) { v = 0; break; } if (!erode && p) { v = 1; break; }
    }
    o[y * w + x] = v;
  }
  return { w, h, m: o };
}
const open = (b, r) => morph(morph(b, r, true), r, false);
// rectangular opening: erode+dilate with a kx*ky box (kx=1,ky=4 removes horizontal lines <=3px tall; kx=4,ky=1 vertical ones)
function rectOpen({ w, h, m }, kx, ky) {
  const pass = (src, erode) => { const o = new Uint8Array(w * h); const ox = erode ? 0 : -(kx - 1), oy = erode ? 0 : -(ky - 1);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let all = 1, any = 0;
      for (let dy = 0; dy < ky; dy++) for (let dx = 0; dx < kx; dx++) { const xx = x + dx + ox, yy = y + dy + oy; const p = (xx < 0 || yy < 0 || xx >= w || yy >= h) ? 0 : src[yy * w + xx]; all &= p; any |= p; }
      o[y * w + x] = erode ? all : any; }
    return o; };
  return { w, h, m: pass(pass(m, true), false) };
}
// remove connected components smaller than minArea (dots, grid remnants)
function despeckle({ w, h, m }, minArea) {
  const o = Uint8Array.from(m); const seen = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!o[i] || seen[i]) continue; const st = [i], comp = []; seen[i] = 1;
    while (st.length) { const k = st.pop(); comp.push(k); const x = k % w, y = (k / w) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue; const j = yy * w + xx; if (o[j] && !seen[j]) { seen[j] = 1; st.push(j); } } }
    if (comp.length < minArea) for (const k of comp) o[k] = 0;
  }
  return { w, h, m: o };
}
function toPng({ w, h, m }, scale = 3, pad = 12) {
  const W = w * scale + 2 * pad, H = h * scale + 2 * pad; const png = new PNG({ width: W, height: H });
  png.data.fill(255);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (m[y * w + x])
    for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) { const i = ((y * scale + sy + pad) * W + x * scale + sx + pad) * 4; png.data[i] = png.data[i + 1] = png.data[i + 2] = 0; }
  return PNG.sync.write(png);
}

const VARIANTS = [
  { thr: 60, rect: [[1, 4], [4, 1]], speck: 40 }, { thr: 40, rect: [[1, 4], [4, 1]], speck: 40 }, { thr: 90, rect: [[1, 4], [4, 1]], speck: 60 },
  { thr: 60, rect: [[1, 5], [5, 1]], speck: 40 }, { thr: 60, open: 1, speck: 40 }, { thr: 40, open: 1, speck: 40 },
];
let workerP = null;
async function worker() {
  if (!workerP) workerP = (async () => {
    const { createWorker, OEM, PSM } = require('tesseract.js');
    const cache = path.join(require('os').tmpdir(), 'kit-tesseract-cache'); fs.mkdirSync(cache, { recursive: true });
    const wk = await createWorker('eng', OEM.LSTM_ONLY, { langPath: LANG_DIR, gzip: true, cachePath: cache, cacheMethod: 'none', logger: () => {}, errorHandler: () => {} });
    await wk.setParameters({ tessedit_char_whitelist: '0123456789', tessedit_pageseg_mode: PSM.SINGLE_LINE });
    return wk;
  })();
  return workerP;
}
async function terminate() { if (workerP) { const w = await workerP; workerP = null; await w.terminate(); } }

/** buf = PNG of the captcha element. opts.debugDir saves preprocessed variants. */
async function solve(buf, { debugDir = null, minVotes = 4, voteConf = 45, conflictConf = 70 } = {}) {
  const src = PNG.sync.read(buf); const wk = await worker(); const res = [];
  for (const [vi, v] of VARIANTS.entries()) {
    let b = toMask(src, v.thr); if (v.open) b = open(b, v.open); for (const [kx, ky] of v.rect || []) b = rectOpen(b, kx, ky); b = despeckle(b, v.speck);
    const img = toPng(b); if (debugDir) wf(path.join(debugDir, `v${vi}.png`), img);
    const { data } = await wk.recognize(img);
    res.push({ v: vi, text: (data.text || '').replace(/\D/g, ''), conf: Math.round(data.confidence) });
  }
  const votes = {};
  for (const r of res) if (/^\d{4}$/.test(r.text) && r.conf >= voteConf) votes[r.text] = (votes[r.text] || 0) + 1;
  const best = Object.entries(votes).sort((a, b) => b[1] - a[1])[0] || null;
  const text = best ? best[0] : null;
  // reject when another 4-digit reading is also confident (ambiguous glyphs such as 3/5/6/8)
  const conflict = !!text && res.some(r => /^\d{4}$/.test(r.text) && r.text !== text && r.conf >= conflictConf);
  const ok = !!best && best[1] >= minVotes && !conflict;
  return { text, ok, votes: best ? best[1] : 0, conflict, variants: res };
}
module.exports = { solve, terminate, LANG_DIR };
