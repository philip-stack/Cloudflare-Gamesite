// Erzeugt die App-Icons (Sprit-Tropfen auf grünem Grund) ohne externe Tools —
// reiner PNG-Encoder (RGBA) via node:zlib. Aufruf: node mkicon.mjs
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

function px(size) {
  const buf = Buffer.alloc(size * size * 4);
  const rad = size * 0.22;                       // Eck-Radius Hintergrund
  const inRound = (x, y) => {
    const dx = Math.min(x, size - 1 - x), dy = Math.min(y, size - 1 - y);
    if (dx >= rad || dy >= rad) return true;
    return (rad - dx) ** 2 + (rad - dy) ** 2 <= rad * rad;
  };
  // Zapfsäule (weiße Silhouette auf grünem Grund), Koordinaten normiert 0..1.
  const R = (x, y, x0, y0, x1, y1) => { const u = x / size, v = y / size; return u >= x0 && u <= x1 && v >= y0 && v <= y1; };
  const inPump = (x, y) => {
    if (R(x, y, 0.34, 0.30, 0.52, 0.45)) return false;   // Display-Ausschnitt (grün)
    if (R(x, y, 0.29, 0.22, 0.57, 0.84)) return true;    // Säulen-Körper
    if (R(x, y, 0.25, 0.84, 0.61, 0.90)) return true;    // Sockel
    if (R(x, y, 0.57, 0.25, 0.63, 0.54)) return true;    // Steigrohr rechts
    if (R(x, y, 0.57, 0.25, 0.74, 0.32)) return true;    // Bogen oben
    if (R(x, y, 0.68, 0.32, 0.74, 0.52)) return true;    // Zapfpistole
    return false;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = (y * size + x) * 4;
      if (!inRound(x, y)) { buf[o + 3] = 0; continue; }
      let r8, g8, b8;
      if (inPump(x, y)) { r8 = 255; g8 = 255; b8 = 255; }            // weiße Zapfsäule
      else {                                                          // grüner Verlauf
        const t = y / size;
        r8 = Math.round(0x2f + (0x1f - 0x2f) * t);
        g8 = Math.round(0xd4 + (0x9d - 0xd4) * t);
        b8 = Math.round(0x8a + (0x5c - 0x8a) * t);
      }
      buf[o] = r8; buf[o + 1] = g8; buf[o + 2] = b8; buf[o + 3] = 255;
    }
  }
  return buf;
}
function png(size) {
  const raw = px(size);
  const stride = size * 4;
  const img = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) { img[y * (stride + 1)] = 0; raw.copy(img, y * (stride + 1) + 1, y * stride, y * stride + stride); }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0, 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(img)), chunk("IEND", Buffer.alloc(0)),
  ]);
}
const CRC = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf) { let c = 0xffffffff; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return c ^ 0xffffffff; }

for (const s of [32, 180, 192, 512]) writeFileSync(new URL(`./icon-${s}.png`, import.meta.url), png(s));
console.log("icons written");
