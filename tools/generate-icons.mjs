// Genera icons/icon-192.png e icons/icon-512.png (e icon.svg) senza dipendenze.
// Uso: node tools/generate-icons.mjs
// Disegno su griglia 0..100: sfondo indaco a tutta area (compatibile maskable),
// calendario bianco con spunta, glifo entro ~60% centrale. Supersampling 4x4.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
const BG = [0x4f, 0x46, 0xe5];
const BG2 = [0x7c, 0x3a, 0xed];
const WHITE = [255, 255, 255];
const HEAD = [0xc7, 0xd2, 0xfe];
const INK = [0x4f, 0x46, 0xe5];

// ---- geometria ----
function inRRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));

// Colore nel punto (x,y) su griglia 0..100
function sample(x, y) {
  let c = mix(BG, BG2, (x + y) / 200);
  if (inRRect(x, y, 26, 30, 74, 76, 6)) c = WHITE;
  if (inRRect(x, y, 26, 30, 74, 43, 6) && y < 43) c = HEAD;
  if (inRRect(x, y, 26, 36, 74, 43, 0)) c = HEAD;
  if (inRRect(x, y, 36, 23, 42, 37, 3) || inRRect(x, y, 58, 23, 64, 37, 3)) c = WHITE;
  if (distSeg(x, y, 37, 60, 46, 68) <= 3 || distSeg(x, y, 46, 68, 63, 51) <= 3) c = INK;
  return c;
}

function render(size) {
  const px = Buffer.alloc(size * size * 4);
  const S = 4;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < S; sy++) {
        for (let sx = 0; sx < S; sx++) {
          const c = sample(((i + (sx + 0.5) / S) / size) * 100, ((j + (sy + 0.5) / S) / size) * 100);
          r += c[0]; g += c[1]; b += c[2];
        }
      }
      const o = (j * size + i) * 4;
      px[o] = Math.round(r / (S * S)); px[o + 1] = Math.round(g / (S * S)); px[o + 2] = Math.round(b / (S * S)); px[o + 3] = 255;
    }
  }
  return px;
}

// ---- PNG ----
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="512" height="512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4f46e5"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs>
  <rect width="100" height="100" fill="url(#g)"/>
  <rect x="26" y="30" width="48" height="46" rx="6" fill="#fff"/>
  <path d="M26 36a6 6 0 0 1 6-6h36a6 6 0 0 1 6 6v7H26z" fill="#c7d2fe"/>
  <rect x="36" y="23" width="6" height="14" rx="3" fill="#fff"/>
  <rect x="58" y="23" width="6" height="14" rx="3" fill="#fff"/>
  <path d="M37 60l9 8 17-17" fill="none" stroke="#4f46e5" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
</svg>
`;

mkdirSync(OUT, { recursive: true });
for (const size of [192, 512]) {
  const buf = png(size, render(size));
  writeFileSync(join(OUT, `icon-${size}.png`), buf);
  console.log(`icon-${size}.png (${buf.length} bytes)`);
}
writeFileSync(join(OUT, 'icon.svg'), SVG);
console.log('icon.svg');
