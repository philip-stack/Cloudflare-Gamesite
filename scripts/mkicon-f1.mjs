// Erzeugt die App-Icons des Renntickers (drei rote Tempo-Streifen auf
// Carbon-Schwarz, Zielflaggen-Band unten) ohne externe Tools — reiner
// PNG-Encoder (RGBA) via node:zlib, wie scripts/mkicon-tanken.mjs.
// Aufruf: node scripts/mkicon-f1.mjs
// Motiv liegt innerhalb der inneren 80 % → auch als „maskable“ sauber.
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const SS = 4;   // Supersampling für glatte Kanten

function px(size, round) {
  const buf = Buffer.alloc(size * size * 4);
  const rad = round ? size * 0.22 : 0;
  const inRound = (x, y) => {
    if (!rad) return true;
    const dx = Math.min(x, size - x), dy = Math.min(y, size - y);
    if (dx >= rad || dy >= rad) return true;
    return (rad - dx) ** 2 + (rad - dy) ** 2 <= rad * rad;
  };
  // Farbe an Punkt (u, v) in 0..1
  const col = (u, v) => {
    // Zielflaggen-Band
    if (v >= 0.70 && v < 0.78) {
      const cu = Math.floor(u / 0.04), cv = Math.floor((v - 0.70) / 0.04);
      return (cu + cv) % 2 ? [17, 17, 22] : [245, 245, 248];
    }
    // drei schräge Streifen (Neigung wie im Seitenkopf), abnehmende Deckkraft
    const skew = 0.42;                       // ≈ skewX(-24°)
    const x = u + (v - 0.5) * skew;
    const bars = [[0.24, 0.36, 1], [0.42, 0.54, 0.72], [0.60, 0.72, 0.45]];
    if (v >= 0.22 && v <= 0.62) {
      for (const [a, b, o] of bars) if (x >= a && x <= b) {
        const bg = bgAt(v);
        return bg.map((c, i) => Math.round(c + ([225, 6, 0][i] - c) * o));
      }
    }
    return bgAt(v);
  };
  const bgAt = v => [Math.round(0x1c - 0x0c * v), Math.round(0x1c - 0x0c * v), Math.round(0x26 - 0x10 * v)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const fx = x + (sx + 0.5) / SS, fy = y + (sy + 0.5) / SS;
        if (!inRound(fx, fy)) continue;
        const c = col(fx / size, fy / size);
        r += c[0]; g += c[1]; b += c[2]; a++;
      }
      const o = (y * size + x) * 4;
      if (!a) { buf[o + 3] = 0; continue; }
      buf[o] = r / a; buf[o + 1] = g / a; buf[o + 2] = b / a; buf[o + 3] = Math.round(255 * a / (SS * SS));
    }
  }
  return buf;
}
function png(size, round) {
  const raw = px(size, round);
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

mkdirSync(new URL("../public/f1/icons/", import.meta.url), { recursive: true });
// Browser-Tab & iOS: abgerundet; Android-Maske: vollflächig (das System rundet selbst)
for (const s of [32, 180, 192]) writeFileSync(new URL(`../public/f1/icons/icon-${s}.png`, import.meta.url), png(s, true));
writeFileSync(new URL("../public/f1/icons/icon-512.png", import.meta.url), png(512, false));
console.log("icons written");
