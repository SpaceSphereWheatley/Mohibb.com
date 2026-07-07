"use strict";
/* ============================================================
   Minimal, dependency-free PNG encoder + software rasterizer.
   Exists so the Race Report API can ship its race-history chart
   as a raster <img> instead of inline <svg> — most email clients
   (Gmail included) strip <svg> outright, so a chart that only
   exists as SVG never survives being forwarded as an email body
   (see functions/_lib/report.js's header comment). Uses only Web
   APIs available in both Node and the Cloudflare Workers runtime
   (CompressionStream for zlib DEFLATE, btoa for base64) — no npm
   dependency, consistent with this repo staying dependency-free.
   ============================================================ */

function hexToRgb(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return [140, 132, 117]; // fallback: --ink-4-ish grey
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

class Raster {
  constructor(width, height, bgHex) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height * 3);
    this.fillRect(0, 0, width, height, bgHex, 1);
  }
  setPixel(x, y, [r, g, b], alpha = 1) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    const i = (y * this.width + x) * 3;
    if (alpha >= 1) { this.data[i] = r; this.data[i + 1] = g; this.data[i + 2] = b; return; }
    this.data[i] = Math.round(this.data[i] * (1 - alpha) + r * alpha);
    this.data[i + 1] = Math.round(this.data[i + 1] * (1 - alpha) + g * alpha);
    this.data[i + 2] = Math.round(this.data[i + 2] * (1 - alpha) + b * alpha);
  }
  fillRect(x0, y0, w, h, colourHex, alpha = 1) {
    const colour = hexToRgb(colourHex);
    const xs = Math.max(0, Math.round(x0)), ys = Math.max(0, Math.round(y0));
    const xe = Math.min(this.width, Math.round(x0 + w)), ye = Math.min(this.height, Math.round(y0 + h));
    for (let y = ys; y < ye; y++) for (let x = xs; x < xe; x++) this.setPixel(x, y, colour, alpha);
  }
  // Bresenham, thickened by stamping a (thickness x thickness) square at each step.
  drawLine(x0, y0, x1, y1, colourHex, thickness = 1) {
    const colour = hexToRgb(colourHex);
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy, x = x0, y = y0;
    const half = Math.floor(thickness / 2);
    for (;;) {
      for (let ox = -half; ox <= half; ox++) for (let oy = -half; oy <= half; oy++) this.setPixel(x + ox, y + oy, colour);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x += sx; }
      if (e2 <= dx) { err += dx; y += sy; }
    }
  }
  drawDot(cx, cy, r, strokeHex, fillHex) {
    const stroke = hexToRgb(strokeHex), fill = hexToRgb(fillHex);
    cx = Math.round(cx); cy = Math.round(cy);
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      const d = Math.sqrt(x * x + y * y);
      if (d <= r - 1) this.setPixel(cx + x, cy + y, fill);
      else if (d <= r + 0.5) this.setPixel(cx + x, cy + y, stroke);
    }
  }
}

// Box-filter downsample by an integer factor — draw at N× resolution, then
// average each NxN block down to one pixel. Cheap way to get anti-aliased
// lines out of a plain Bresenham rasterizer (no per-pixel coverage math
// needed) so the race-history chart doesn't look jagged/blocky at 1x.
function downsample(src, factor) {
  if (factor === 1) return src;
  const w = Math.floor(src.width / factor), h = Math.floor(src.height / factor);
  const out = new Raster(w, h, '#000000');
  const area = factor * factor;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let oy = 0; oy < factor; oy++) {
        for (let ox = 0; ox < factor; ox++) {
          const i = ((y * factor + oy) * src.width + (x * factor + ox)) * 3;
          r += src.data[i]; g += src.data[i + 1]; b += src.data[i + 2];
        }
      }
      const oi = (y * w + x) * 3;
      out.data[oi] = Math.round(r / area);
      out.data[oi + 1] = Math.round(g / area);
      out.data[oi + 2] = Math.round(b / area);
    }
  }
  return out;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const typeBytes = new TextEncoder().encode(type);
  const out = new Uint8Array(8 + data.length + 4);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  out.set(typeBytes, 4);
  out.set(data, 8);
  const crcInput = new Uint8Array(typeBytes.length + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, typeBytes.length);
  dv.setUint32(8 + data.length, crc32(crcInput));
  return out;
}

async function zlibDeflate(bytes) {
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  const chunks = [];
  let total = 0;
  const reader = cs.readable.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { out.set(c, offset); offset += c.length; }
  return out;
}

function concat(arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

// Sum of absolute values, treating each byte as a signed delta — the
// standard "minimum sum of absolute differences" heuristic PNG encoders use
// to pick a filter per scanline (libpng's default).
function msad(bytes) {
  let sum = 0;
  for (let i = 0; i < bytes.length; i++) { const v = bytes[i]; sum += v < 128 ? v : 256 - v; }
  return sum;
}

// Per-scanline adaptive filtering (PNG's None/Sub/Up/Average/Paeth), picking
// whichever compresses best by the MSAD heuristic. Filtering the raw pixel
// data before DEFLATE is what actually makes photographic/gradient-heavy
// content compress well — unfiltered data deflates far larger, which
// matters here because the PNG ships base64-inlined in the report's HTML.
function filterScanline(curr, prev, stride, bpp) {
  const sub = new Uint8Array(stride), up = new Uint8Array(stride), avg = new Uint8Array(stride), pae = new Uint8Array(stride);
  for (let x = 0; x < stride; x++) {
    const a = x >= bpp ? curr[x - bpp] : 0;
    const b = prev ? prev[x] : 0;
    const c = prev && x >= bpp ? prev[x - bpp] : 0;
    sub[x] = (curr[x] - a) & 0xff;
    up[x] = (curr[x] - b) & 0xff;
    avg[x] = (curr[x] - ((a + b) >> 1)) & 0xff;
    pae[x] = (curr[x] - paethPredictor(a, b, c)) & 0xff;
  }
  const candidates = [{ type: 0, bytes: curr }, { type: 1, bytes: sub }, { type: 2, bytes: up }, { type: 3, bytes: avg }, { type: 4, bytes: pae }];
  let best = candidates[0], bestScore = msad(candidates[0].bytes);
  for (let i = 1; i < candidates.length; i++) {
    const score = msad(candidates[i].bytes);
    if (score < bestScore) { bestScore = score; best = candidates[i]; }
  }
  return best;
}

function filterAndDeflate(pixelBytes, width, height, bpp) {
  const stride = width * bpp;
  const raw = new Uint8Array(height * (1 + stride));
  let o = 0;
  let prevRow = null;
  for (let y = 0; y < height; y++) {
    const curr = pixelBytes.subarray(y * stride, y * stride + stride);
    const { type, bytes } = filterScanline(curr, prevRow, stride, bpp);
    raw[o++] = type;
    raw.set(bytes, o);
    o += stride;
    prevRow = curr;
  }
  return zlibDeflate(raw);
}

function ihdrChunk(width, height, colourType) {
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colourType;
  // ihdr[10..12] = compression/filter/interlace = 0 (defaults)
  return pngChunk('IHDR', ihdr);
}

// Our chart has no anti-aliasing (see the note on SS in report.js), so it's
// drawn from a small, fixed set of exact colors — background, baseline,
// each driver's hex color, and the (fully opaque once alpha-blended) SC/VSC
// band tints. That means it almost always fits an 8-bit indexed palette,
// which is roughly 3x smaller pre-compression than truecolor RGB (1 byte
// per pixel instead of 3) and compresses even further on top of that.
function buildPalette(data, maxColors) {
  const map = new Map();
  const palette = []; // flat r,g,b,r,g,b,... — 3 entries per color
  let colourCount = 0;
  const pixelCount = data.length / 3;
  const indices = new Uint8Array(pixelCount);
  for (let p = 0; p < pixelCount; p++) {
    const r = data[p * 3], g = data[p * 3 + 1], b = data[p * 3 + 2];
    const key = (r << 16) | (g << 8) | b;
    let idx = map.get(key);
    if (idx === undefined) {
      if (colourCount >= maxColors) return null;
      idx = colourCount++;
      map.set(key, idx);
      palette.push(r, g, b);
    }
    indices[p] = idx;
  }
  return { palette: Uint8Array.from(palette), indices };
}

export async function encodePng(raster) {
  const { width, height, data } = raster;
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

  const indexed = buildPalette(data, 256);
  if (indexed) {
    const compressed = await filterAndDeflate(indexed.indices, width, height, 1);
    return concat([
      sig, ihdrChunk(width, height, 3 /* indexed */),
      pngChunk('PLTE', indexed.palette), pngChunk('IDAT', compressed), pngChunk('IEND', new Uint8Array(0)),
    ]);
  }

  // Fallback: more than 256 distinct colors (shouldn't happen given the
  // chart's fixed palette, but stay correct rather than lossy-quantize).
  const compressed = await filterAndDeflate(data, width, height, 3);
  return concat([sig, ihdrChunk(width, height, 2 /* truecolor RGB */), pngChunk('IDAT', compressed), pngChunk('IEND', new Uint8Array(0))]);
}

export function bytesToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  return btoa(binary);
}

export { Raster, hexToRgb, downsample };
