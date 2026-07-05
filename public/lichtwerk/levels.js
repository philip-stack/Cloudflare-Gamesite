// ====================================================================
// LICHTWERK — Leveldaten & Strahlen-Simulation (pur, ohne DOM)
//
// Items (x/y auf Gitter w×h):
//   em: Emitter  { dir: R|L|U|D, c: 1=Gold 2=Cyan }  – fest
//   mi: Spiegel  { o: 0='/' 1='\', sol: Lösung }     – antippbar
//   sp: Teiler   – Strahl endet, geht links+rechts (bzw. oben+unten) weiter
//   wa: Wand     – blockiert
//   cr: Kristall { need: 1=Gold 2=Cyan 3=Weiß (beide) } – absorbiert
//
// Ein Kristall ist erfüllt, wenn GENAU die geforderten Farben ankommen.
// ====================================================================

const LW_DIRS = { R: [1, 0], L: [-1, 0], U: [0, -1], D: [0, 1] };
const LW_MIRROR = {
  0: { R: "U", U: "R", L: "D", D: "L" },   // '/'
  1: { R: "D", D: "R", L: "U", U: "L" },   // '\'
};

function lwSimulate(level, orient) {
  const cellMap = {};
  level.items.forEach((it, idx) => { cellMap[it.x + "," + it.y] = { it, idx }; });

  const hits = {};
  const segs = [];
  const seen = new Set();
  const rays = [];
  level.items.forEach(it => {
    if (it.t === "em") rays.push({ x: it.x, y: it.y, dir: it.dir, c: it.c });
  });

  let guard = 0;
  while (rays.length && guard++ < 500) {
    const r = rays.pop();
    let x = r.x, y = r.y;
    const [dx, dy] = LW_DIRS[r.dir];
    const sx = x, sy = y;
    for (;;) {
      x += dx; y += dy;
      if (x < 0 || y < 0 || x >= level.w || y >= level.h) {
        segs.push({ x1: sx, y1: sy, x2: x, y2: y, c: r.c });
        break;
      }
      const hit = cellMap[x + "," + y];
      if (!hit) continue;
      const { it, idx } = hit;
      segs.push({ x1: sx, y1: sy, x2: x, y2: y, c: r.c });
      if (it.t === "wa" || it.t === "em") break;
      if (it.t === "cr") { hits[idx] = (hits[idx] || 0) | r.c; break; }
      if (it.t === "mi") {
        const nd = LW_MIRROR[orient[idx]][r.dir];
        const key = x + "," + y + nd + r.c;
        if (!seen.has(key)) { seen.add(key); rays.push({ x, y, dir: nd, c: r.c }); }
        break;
      }
      if (it.t === "sp") {
        const outs = (r.dir === "R" || r.dir === "L") ? ["U", "D"] : ["L", "R"];
        for (const nd of outs) {
          const key = x + "," + y + nd + r.c;
          if (!seen.has(key)) { seen.add(key); rays.push({ x, y, dir: nd, c: r.c }); }
        }
        break;
      }
    }
  }

  const win = level.items.every((it, idx) => it.t !== "cr" || (hits[idx] || 0) === it.need);
  return { segs, hits, win };
}

// ---------- 16 Level (jedes per Simulation gegen `sol` verifiziert) ----------
const LW_LEVELS = [
  { // 1 – Der erste Spiegel
    name: "Erstes Licht", w: 7, h: 8, par: 1,
    items: [
      { t: "em", x: 0, y: 3, dir: "R", c: 1 },
      { t: "mi", x: 4, y: 3, o: 1, sol: 0 },
      { t: "cr", x: 4, y: 0, need: 1 },
    ],
  },
  { // 2 – Zwei Spiegel
    name: "Umweg", w: 7, h: 8, par: 2,
    items: [
      { t: "em", x: 0, y: 6, dir: "R", c: 1 },
      { t: "mi", x: 3, y: 6, o: 1, sol: 0 },
      { t: "mi", x: 3, y: 1, o: 0, sol: 1 },
      { t: "cr", x: 0, y: 1, need: 1 },
    ],
  },
  { // 3 – Von unten
    name: "Aufstieg", w: 7, h: 8, par: 1,
    items: [
      { t: "em", x: 3, y: 7, dir: "U", c: 1 },
      { t: "mi", x: 3, y: 2, o: 1, sol: 0 },
      { t: "cr", x: 6, y: 2, need: 1 },
      { t: "wa", x: 1, y: 1 },
      { t: "wa", x: 5, y: 5 },
    ],
  },
  { // 4 – Um die Wand
    name: "Mauerblick", w: 7, h: 8, par: 2,
    items: [
      { t: "em", x: 0, y: 1, dir: "R", c: 1 },
      { t: "mi", x: 2, y: 1, o: 0, sol: 1 },
      { t: "mi", x: 2, y: 5, o: 1, sol: 0 },
      { t: "cr", x: 0, y: 5, need: 1 },
      { t: "wa", x: 4, y: 1 },
      { t: "wa", x: 4, y: 3 },
    ],
  },
  { // 5 – Dreisprung
    name: "Dreisprung", w: 7, h: 8, par: 3,
    items: [
      { t: "em", x: 0, y: 4, dir: "R", c: 1 },
      { t: "mi", x: 5, y: 4, o: 1, sol: 0 },
      { t: "mi", x: 5, y: 1, o: 0, sol: 1 },
      { t: "mi", x: 1, y: 1, o: 1, sol: 0 },
      { t: "cr", x: 1, y: 6, need: 1 },
    ],
  },
  { // 6 – Der Teiler
    name: "Zweiteilung", w: 7, h: 8, par: 1,
    items: [
      { t: "em", x: 3, y: 7, dir: "U", c: 1 },
      { t: "sp", x: 3, y: 4 },
      { t: "cr", x: 0, y: 4, need: 1 },
      { t: "mi", x: 5, y: 4, o: 1, sol: 0 },
      { t: "cr", x: 5, y: 0, need: 1 },
    ],
  },
  { // 7 – Zwei Farben
    name: "Gold & Cyan", w: 7, h: 8, par: 2,
    items: [
      { t: "em", x: 0, y: 2, dir: "R", c: 1 },
      { t: "em", x: 0, y: 5, dir: "R", c: 2 },
      { t: "mi", x: 4, y: 2, o: 0, sol: 1 },
      { t: "cr", x: 4, y: 7, need: 1 },
      { t: "mi", x: 6, y: 5, o: 1, sol: 0 },
      { t: "cr", x: 6, y: 1, need: 2 },
    ],
  },
  { // 8 – Kreuzung
    name: "Kreuzung", w: 7, h: 8, par: 2,
    items: [
      { t: "em", x: 0, y: 1, dir: "R", c: 1 },
      { t: "em", x: 2, y: 7, dir: "U", c: 2 },
      { t: "mi", x: 2, y: 3, o: 1, sol: 0 },
      { t: "cr", x: 6, y: 3, need: 2 },
      { t: "mi", x: 5, y: 1, o: 0, sol: 1 },
      { t: "cr", x: 5, y: 7, need: 1 },
    ],
  },
  { // 9 – Weißes Licht
    name: "Weißes Licht", w: 7, h: 8, par: 2,
    items: [
      { t: "em", x: 0, y: 2, dir: "R", c: 1 },
      { t: "em", x: 0, y: 5, dir: "R", c: 2 },
      { t: "mi", x: 5, y: 2, o: 0, sol: 1 },
      { t: "mi", x: 5, y: 5, o: 1, sol: 0 },
      { t: "cr", x: 5, y: 3, need: 3 },
    ],
  },
  { // 10 – Drei Ziele
    name: "Drei Ziele", w: 7, h: 8, par: 3,
    items: [
      { t: "em", x: 3, y: 7, dir: "U", c: 1 },
      { t: "sp", x: 3, y: 4 },
      { t: "mi", x: 1, y: 4, o: 1, sol: 0 },
      { t: "cr", x: 1, y: 7, need: 1 },
      { t: "mi", x: 5, y: 4, o: 0, sol: 1 },
      { t: "cr", x: 5, y: 7, need: 1 },
      { t: "em", x: 0, y: 0, dir: "R", c: 2 },
      { t: "mi", x: 6, y: 0, o: 0, sol: 1 },
      { t: "cr", x: 6, y: 6, need: 2 },
    ],
  },
  { // 11 – Geteiltes Weiß
    name: "Geteiltes Weiß", w: 7, h: 8, par: 2,
    items: [
      { t: "em", x: 3, y: 7, dir: "U", c: 1 },
      { t: "sp", x: 3, y: 3 },
      { t: "mi", x: 0, y: 3, o: 1, sol: 0 },
      { t: "cr", x: 0, y: 6, need: 3 },
      { t: "em", x: 6, y: 6, dir: "L", c: 2 },
      { t: "mi", x: 6, y: 3, o: 0, sol: 1 },
      { t: "cr", x: 6, y: 5, need: 1 },
    ],
  },
  { // 12 – Ein Spiegel, zwei Strahlen
    name: "Doppelgänger", w: 7, h: 8, par: 1,
    items: [
      { t: "em", x: 0, y: 3, dir: "R", c: 1 },
      { t: "em", x: 3, y: 0, dir: "D", c: 2 },
      { t: "mi", x: 3, y: 3, o: 0, sol: 1 },
      { t: "cr", x: 3, y: 7, need: 1 },
      { t: "cr", x: 6, y: 3, need: 2 },
      { t: "wa", x: 1, y: 6 },
      { t: "wa", x: 5, y: 1 },
    ],
  },
  { // 13 – Begegnung
    name: "Begegnung", w: 7, h: 8, par: 2,
    items: [
      { t: "em", x: 0, y: 1, dir: "R", c: 1 },
      { t: "em", x: 0, y: 6, dir: "R", c: 2 },
      { t: "mi", x: 3, y: 1, o: 0, sol: 1 },
      { t: "mi", x: 3, y: 6, o: 1, sol: 0 },
      { t: "cr", x: 3, y: 4, need: 3 },
      { t: "wa", x: 5, y: 3 },
    ],
  },
  { // 14 – Doppelweiß
    name: "Doppelweiß", w: 7, h: 8, par: 2,
    items: [
      { t: "em", x: 3, y: 7, dir: "U", c: 1 },
      { t: "em", x: 3, y: 0, dir: "D", c: 2 },
      { t: "sp", x: 3, y: 4 },
      { t: "mi", x: 1, y: 4, o: 1, sol: 0 },
      { t: "cr", x: 1, y: 7, need: 3 },
      { t: "mi", x: 5, y: 4, o: 0, sol: 1 },
      { t: "cr", x: 5, y: 7, need: 3 },
    ],
  },
  { // 15 – Die lange Reise
    name: "Lange Reise", w: 7, h: 8, par: 4,
    items: [
      { t: "em", x: 0, y: 0, dir: "R", c: 1 },
      { t: "mi", x: 4, y: 0, o: 0, sol: 1 },
      { t: "mi", x: 4, y: 5, o: 1, sol: 0 },
      { t: "mi", x: 1, y: 5, o: 0, sol: 0 },
      { t: "cr", x: 1, y: 7, need: 1 },
      { t: "em", x: 6, y: 7, dir: "L", c: 2 },
      { t: "mi", x: 2, y: 7, o: 0, sol: 1 },
      { t: "cr", x: 2, y: 3, need: 2 },
      { t: "wa", x: 6, y: 2 },
    ],
  },
  { // 16 – Finale
    name: "Finale", w: 7, h: 8, par: 5,
    items: [
      { t: "em", x: 0, y: 7, dir: "R", c: 1 },
      { t: "em", x: 0, y: 0, dir: "R", c: 2 },
      { t: "mi", x: 3, y: 7, o: 1, sol: 0 },
      { t: "mi", x: 3, y: 1, o: 0, sol: 1 },
      { t: "cr", x: 1, y: 1, need: 3 },
      { t: "mi", x: 6, y: 0, o: 0, sol: 1 },
      { t: "mi", x: 6, y: 4, o: 1, sol: 0 },
      { t: "mi", x: 1, y: 4, o: 0, sol: 1 },
      { t: "wa", x: 4, y: 6 },
    ],
  },
];

// Für Node-Tests (im Browser ignoriert)
if (typeof module !== "undefined") module.exports = { LW_LEVELS, lwSimulate };
