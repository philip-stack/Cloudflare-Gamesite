// ====================================================================
// Eigenständiger QR-Code-Encoder (kein externes Skript, CSP-konform).
// Byte-Modus, Fehlerkorrektur-Level M, Versionen 1–10.
// window.QR.matrix(text) -> boolean[size][size] (true = dunkles Modul)
// window.QR.toCanvas(text, canvas, opts) rendert direkt.
// Folgt ISO/IEC 18004.
// ====================================================================
(function () {
  // ---- GF(256), primitiv 0x11d ----
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function () {
    let x = 1;
    for (let i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11d; }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  const mul = (a, b) => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];

  // Generatorpolynom für n EC-Codewörter
  function genPoly(n) {
    let g = [1];
    for (let i = 0; i < n; i++) {
      const ng = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) {
        ng[j] ^= g[j];
        ng[j + 1] ^= mul(g[j], EXP[i]);
      }
      g = ng;
    }
    return g;
  }
  function ecCodewords(data, n) {
    const g = genPoly(n);
    const res = new Array(n).fill(0);
    for (const d of data) {
      const factor = d ^ res[0];
      res.shift(); res.push(0);
      for (let j = 0; j < n; j++) res[j] ^= mul(g[j], factor);
    }
    return res;
  }

  // ---- Tabellen (EC-Level M) ----
  // [ecPerBlock, [ [blocks, dataPerBlock], ... ] ]
  const EC_M = {
    1: [10, [[1, 16]]],
    2: [16, [[1, 28]]],
    3: [26, [[1, 44]]],
    4: [18, [[2, 32]]],
    5: [24, [[2, 43]]],
    6: [16, [[4, 27]]],
    7: [18, [[4, 31]]],
    8: [22, [[2, 38], [2, 39]]],
    9: [22, [[3, 36], [2, 37]]],
    10: [26, [[4, 43], [1, 44]]],
  };
  const CAP_BYTES_M = { 1: 14, 2: 26, 3: 42, 4: 62, 5: 84, 6: 106, 7: 122, 8: 152, 9: 180, 10: 213 };
  const ALIGN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
  };
  const REMAINDER = { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7, 7: 0, 8: 0, 9: 0, 10: 0 };

  function utf8(str) {
    const out = [];
    for (const ch of str) {
      const cp = ch.codePointAt(0);
      if (cp < 0x80) out.push(cp);
      else if (cp < 0x800) out.push(0xc0 | cp >> 6, 0x80 | cp & 63);
      else if (cp < 0x10000) out.push(0xe0 | cp >> 12, 0x80 | cp >> 6 & 63, 0x80 | cp & 63);
      else out.push(0xf0 | cp >> 18, 0x80 | cp >> 12 & 63, 0x80 | cp >> 6 & 63, 0x80 | cp & 63);
    }
    return out;
  }

  function pickVersion(len) {
    for (let v = 1; v <= 10; v++) if (CAP_BYTES_M[v] >= len) return v;
    throw new Error("Text zu lang für QR (max " + CAP_BYTES_M[10] + " Bytes)");
  }

  // Bit-Schreiber
  function bitStream() {
    const bytes = []; let cur = 0, nb = 0;
    return {
      put(val, len) {
        for (let i = len - 1; i >= 0; i--) {
          cur = (cur << 1) | ((val >> i) & 1); nb++;
          if (nb === 8) { bytes.push(cur); cur = 0; nb = 0; }
        }
      },
      flush() { if (nb > 0) { bytes.push(cur << (8 - nb)); cur = 0; nb = 0; } return bytes; },
      get bitLen() { return bytes.length * 8 + nb; },
    };
  }

  function encodeData(text) {
    const data = utf8(text);
    const version = pickVersion(data.length);
    const [ecPer, groups] = EC_M[version];
    const totalDataCw = groups.reduce((s, [b, d]) => s + b * d, 0);

    const bs = bitStream();
    bs.put(0b0100, 4);                 // Byte-Modus
    bs.put(data.length, 8);            // Zeichenzähler (Version 1–9 → 8 Bit; ≤10 & <256 ok)
    for (const b of data) bs.put(b, 8);
    // Terminator
    const capBits = totalDataCw * 8;
    const rem = capBits - bs.bitLen;
    bs.put(0, Math.min(4, Math.max(0, rem)));
    const cw = bs.flush();
    // Auf Datenkapazität mit 0xEC/0x11 auffüllen
    let pad = 0xEC;
    while (cw.length < totalDataCw) { cw.push(pad); pad = pad === 0xEC ? 0x11 : 0xEC; }

    // In Blöcke aufteilen
    const dataBlocks = [], ecBlocks = [];
    let idx = 0;
    for (const [blocks, dper] of groups) {
      for (let b = 0; b < blocks; b++) {
        const block = cw.slice(idx, idx + dper); idx += dper;
        dataBlocks.push(block);
        ecBlocks.push(ecCodewords(block, ecPer));
      }
    }
    // Interleaven
    const out = [];
    const maxData = Math.max(...dataBlocks.map(b => b.length));
    for (let i = 0; i < maxData; i++) for (const b of dataBlocks) if (i < b.length) out.push(b[i]);
    for (let i = 0; i < ecPer; i++) for (const b of ecBlocks) out.push(b[i]);

    // In Bitfolge (+ Remainder-Bits)
    const bits = [];
    for (const byte of out) for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
    for (let i = 0; i < REMAINDER[version]; i++) bits.push(0);
    return { version, bits };
  }

  // ---- Matrix aufbauen ----
  function buildMatrix(version, bits) {
    const size = version * 4 + 17;
    const m = Array.from({ length: size }, () => new Array(size).fill(null)); // null = frei
    const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

    const setF = (r, c, v) => { m[r][c] = v; reserved[r][c] = true; };

    // Finder + Separatoren
    function finder(r, c) {
      for (let dr = -1; dr <= 7; dr++) for (let dc = -1; dc <= 7; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        const inRing = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        let dark = false;
        if (inRing) {
          dark = dr === 0 || dr === 6 || dc === 0 || dc === 6 ||
                 (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4);
        }
        setF(rr, cc, dark);
      }
    }
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);

    // Timing
    for (let i = 8; i < size - 8; i++) {
      if (!reserved[6][i]) setF(6, i, i % 2 === 0);
      if (!reserved[i][6]) setF(i, 6, i % 2 === 0);
    }

    // Alignment
    const ap = ALIGN[version];
    for (const r of ap) for (const c of ap) {
      if (reserved[r][c]) continue; // überschneidet Finder
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
        const dark = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
        setF(r + dr, c + dc, dark);
      }
    }

    // Dunkles Modul
    setF(size - 8, 8, true);

    // Formatinfo-Bereiche reservieren (Werte später)
    for (let i = 0; i <= 8; i++) {
      if (!reserved[8][i]) { reserved[8][i] = true; m[8][i] = 0; }
      if (!reserved[i][8]) { reserved[i][8] = true; m[i][8] = 0; }
    }
    for (let i = 0; i < 8; i++) {
      if (!reserved[8][size - 1 - i]) { reserved[8][size - 1 - i] = true; m[8][size - 1 - i] = 0; }
      if (!reserved[size - 1 - i][8]) { reserved[size - 1 - i][8] = true; m[size - 1 - i][8] = 0; }
    }
    // Versionsinfo-Bereiche (V≥7)
    if (version >= 7) {
      for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) {
        reserved[i][size - 11 + j] = true; m[i][size - 11 + j] = 0;
        reserved[size - 11 + j][i] = true; m[size - 11 + j][i] = 0;
      }
    }

    // Datenbits im Zickzack platzieren
    let bi = 0, up = true;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col = 5; // Timing-Spalte überspringen
      for (let k = 0; k < size; k++) {
        const row = up ? size - 1 - k : k;
        for (let c = 0; c < 2; c++) {
          const cc = col - c;
          if (reserved[row][cc]) continue;
          m[row][cc] = bi < bits.length ? bits[bi] : 0; bi++;
        }
      }
      up = !up;
    }
    return { m, reserved, size };
  }

  const MASKS = [
    (r, c) => (r + c) % 2 === 0,
    (r, c) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => (r * c) % 2 + (r * c) % 3 === 0,
    (r, c) => ((r * c) % 2 + (r * c) % 3) % 2 === 0,
    (r, c) => ((r + c) % 2 + (r * c) % 3) % 2 === 0,
  ];

  function applyMask(base, reserved, size, mask) {
    const m = base.map(row => row.slice());
    const fn = MASKS[mask];
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
      if (reserved[r][c]) continue;
      if (fn(r, c)) m[r][c] ^= 1;
    }
    return m;
  }

  // Formatinfo (15 Bit BCH), EC-Level M = 0b00
  function formatBits(mask) {
    const data = (0b00 << 3) | mask;   // 5 Bit
    let v = data << 10;
    const g = 0b10100110111;
    for (let i = 14; i >= 10; i--) if ((v >> i) & 1) v ^= g << (i - 10);
    return ((data << 10) | v) ^ 0b101010000010010;
  }
  function placeFormat(m, size, mask) {
    const bits = formatBits(mask); // 15 Bit, MSB = Bit14
    const get = i => (bits >> i) & 1;
    // um linkes oberes Finder
    for (let i = 0; i <= 5; i++) m[8][i] = get(i);
    m[8][7] = get(6); m[8][8] = get(7); m[7][8] = get(8);
    for (let i = 9; i <= 14; i++) m[14 - i][8] = get(i);
    // Kopie an den anderen Finders
    for (let i = 0; i <= 7; i++) m[size - 1 - i][8] = get(i);
    for (let i = 8; i <= 14; i++) m[8][size - 15 + i] = get(i);
    m[size - 8][8] = 1; // dunkles Modul bleibt gesetzt
  }

  function versionBits(version) {
    let v = version << 12;
    const g = 0b1111100100101;
    for (let i = 17; i >= 12; i--) if ((v >> i) & 1) v ^= g << (i - 12);
    return (version << 12) | v;
  }
  function placeVersion(m, size, version) {
    if (version < 7) return;
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const b = (bits >> i) & 1;
      const r = Math.floor(i / 3), c = i % 3;
      m[r][size - 11 + c] = b;
      m[size - 11 + c][r] = b;
    }
  }

  // Strafpunkte für Maskenauswahl
  function penalty(m, size) {
    let p = 0;
    // Regel 1: gleiche Farbe in Reihen/Spalten
    for (let r = 0; r < size; r++) {
      let runC = 1, runR = 1;
      for (let c = 1; c < size; c++) {
        if (m[r][c] === m[r][c - 1]) { runC++; if (runC === 5) p += 3; else if (runC > 5) p++; } else runC = 1;
        if (m[c][r] === m[c - 1][r]) { runR++; if (runR === 5) p += 3; else if (runR > 5) p++; } else runR = 1;
      }
    }
    // Regel 2: 2x2-Blöcke
    for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
      const v = m[r][c];
      if (v === m[r][c + 1] && v === m[r + 1][c] && v === m[r + 1][c + 1]) p += 3;
    }
    // Regel 3: Finder-ähnliche Muster
    const pat1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];
    const pat2 = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
    for (let r = 0; r < size; r++) for (let c = 0; c <= size - 11; c++) {
      let a = true, b = true;
      for (let k = 0; k < 11; k++) { if (m[r][c + k] !== pat1[k]) a = false; if (m[r][c + k] !== pat2[k]) b = false; }
      if (a || b) p += 40;
      let a2 = true, b2 = true;
      for (let k = 0; k < 11; k++) { if (m[c + k][r] !== pat1[k]) a2 = false; if (m[c + k][r] !== pat2[k]) b2 = false; }
      if (a2 || b2) p += 40;
    }
    // Regel 4: Balance dunkler Module
    let dark = 0;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (m[r][c]) dark++;
    const ratio = dark / (size * size) * 100;
    p += Math.floor(Math.abs(ratio - 50) / 5) * 10;
    return p;
  }

  function matrix(text) {
    const { version, bits } = encodeData(text);
    const { m, reserved, size } = buildMatrix(version, bits);
    // int-Matrix (0/1) mit reservierten Formatfeldern auf 0
    const base = m.map(row => row.map(v => v ? 1 : 0));
    let best = null, bestP = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const cand = applyMask(base, reserved, size, mask);
      placeFormat(cand, size, mask);
      placeVersion(cand, size, version);
      const p = penalty(cand, size);
      if (p < bestP) { bestP = p; best = cand; }
    }
    return best.map(row => row.map(v => !!v));
  }

  function toCanvas(text, canvas, { scale = 6, margin = 4, dark = "#000", light = "#fff" } = {}) {
    const mat = matrix(text);
    const n = mat.length;
    const px = (n + margin * 2) * scale;
    canvas.width = px; canvas.height = px;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = light; ctx.fillRect(0, 0, px, px);
    ctx.fillStyle = dark;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
      if (mat[r][c]) ctx.fillRect((c + margin) * scale, (r + margin) * scale, scale, scale);
    }
    return canvas;
  }

  const QR = { matrix, toCanvas, _formatBits: formatBits, _versionBits: versionBits, _encodeData: encodeData };
  if (typeof window !== "undefined") window.QR = QR;
  if (typeof module !== "undefined" && module.exports) module.exports = QR;
})();
