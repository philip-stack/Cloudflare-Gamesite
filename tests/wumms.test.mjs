// Logik-Tests für WUMMS! — repliziert die reine Spiel-Logik aus
// public/wumms/app.js (die Datei selbst braucht das DOM und lässt sich
// nicht direkt importieren).
const N = 8;
let ok = true;
const t = (name, cond) => { console.log((cond ? "OK   " : "FAIL ") + name); if (!cond) ok = false; };

// ---- Formen erzeugen (wie im Spiel) ----
const normalize = cells => {
  const mr = Math.min(...cells.map(c => c[0])), mc = Math.min(...cells.map(c => c[1]));
  return cells.map(([r, c]) => [r - mr, c - mc]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
};
const rotate = cells => normalize(cells.map(([r, c]) => [c, -r]));
const keyOf = cells => cells.map(c => c.join(",")).join(";");
const BASE = [
  [[0,0]], [[0,0],[0,1]], [[0,0],[0,1],[0,2]], [[0,0],[0,1],[0,2],[0,3]], [[0,0],[0,1],[0,2],[0,3],[0,4]],
  [[0,0],[0,1],[1,0],[1,1]], [[0,0],[0,1],[0,2],[1,0],[1,1],[1,2]],
  [[0,0],[0,1],[0,2],[1,0],[1,1],[1,2],[2,0],[2,1],[2,2]],
  [[0,0],[1,0],[1,1]], [[0,0],[1,0],[2,0],[2,1]], [[0,0],[0,1],[0,2],[1,1]],
  [[0,1],[0,2],[1,0],[1,1]], [[0,0],[0,1],[1,1],[1,2]], [[0,0],[1,0],[2,0],[2,1],[2,2]],
];
const SHAPES = (() => {
  const seen = new Set(), out = [];
  for (const s of BASE) { let cur = normalize(s); for (let r = 0; r < 4; r++) { const k = keyOf(cur); if (!seen.has(k)) { seen.add(k); out.push(cur); } cur = rotate(cur); } }
  return out;
})();

t("Formen erzeugt (>= 25 einzigartige)", SHAPES.length >= 25);
t("alle Formen normalisiert (min 0/0)", SHAPES.every(s => Math.min(...s.map(c => c[0])) === 0 && Math.min(...s.map(c => c[1])) === 0));
t("keine doppelten Formen", new Set(SHAPES.map(keyOf)).size === SHAPES.length);

// ---- Brett-Logik ----
const empty = () => Array.from({ length: N }, () => Array(N).fill(null));
const canPlaceAt = (grid, piece, r0, c0) => piece.every(([r, c]) => {
  const rr = r0 + r, cc = c0 + c; return rr >= 0 && rr < N && cc >= 0 && cc < N && !grid[rr][cc];
});

let g = empty();
t("leeres Feld: 1×1 passt in Ecke", canPlaceAt(g, [[0,0]], 7, 7));
t("außerhalb passt nicht", !canPlaceAt(g, [[0,0]], 8, 0));
g[3][3] = { sp: 0 };
t("belegtes Feld blockiert", !canPlaceAt(g, [[0,0]], 3, 3));

// ---- Line-Clear ----
function clearLines(grid) {
  const rows = [], cols = [];
  for (let r = 0; r < N; r++) if (grid[r].every(Boolean)) rows.push(r);
  for (let c = 0; c < N; c++) { let f = true; for (let r = 0; r < N; r++) if (!grid[r][c]) { f = false; break; } if (f) cols.push(c); }
  let speciesLines = 0;
  const isSp = arr => { const s = arr[0] && !arr[0].villain ? arr[0].sp : null; return s !== null && arr.every(x => x && !x.villain && x.sp === s); };
  for (const r of rows) if (isSp(grid[r])) speciesLines++;
  for (const c of cols) { const col = []; for (let r = 0; r < N; r++) col.push(grid[r][c]); if (isSp(col)) speciesLines++; }
  const marked = new Set();
  for (const r of rows) for (let c = 0; c < N; c++) marked.add(r * N + c);
  for (const c of cols) for (let r = 0; r < N; r++) marked.add(r * N + c);
  for (const k of marked) grid[Math.floor(k / N)][k % N] = null;
  return { lines: rows.length + cols.length, cells: marked.size, speciesLines };
}

g = empty();
for (let c = 0; c < N; c++) g[0][c] = { sp: 1 };     // volle, einfarbige Reihe
let res = clearLines(g);
t("volle Reihe wird erkannt", res.lines === 1 && res.cells === 8);
t("einfarbige Reihe zählt als Arten-Linie", res.speciesLines === 1);
t("Reihe ist nach Clear leer", g[0].every(x => x === null));

g = empty();
for (let c = 0; c < N; c++) g[0][c] = { sp: c % 2 };  // volle, gemischte Reihe
res = clearLines(g);
t("gemischte Reihe: kein Arten-Bonus", res.lines === 1 && res.speciesLines === 0);

g = empty();
for (let i = 0; i < N; i++) { g[2][i] = { sp: 0 }; g[i][5] = { sp: 0 }; }  // Reihe + Spalte (Kreuz)
res = clearLines(g);
t("Reihe + Spalte gleichzeitig = 2 Linien", res.lines === 2);
t("Kreuz räumt 15 Felder (8+8-1)", res.cells === 15);

// ---- Bösewicht-Schub ----
function shove(grid, chosenCols) {
  if (grid[0].some(Boolean)) return { over: true };
  for (let r = 0; r < N - 1; r++) grid[r] = grid[r + 1];
  grid[N - 1] = Array.from({ length: N }, (_, c) => chosenCols.has(c) ? { villain: true } : null);
  return { over: false };
}
g = empty();
g[7][0] = { sp: 0 };
let r1 = shove(g, new Set([1, 2, 3]));
t("Schub schiebt Inhalt nach oben", g[6][0] && g[6][0].sp === 0);
t("neue Bösewicht-Reihe unten", g[7][1] && g[7][1].villain === true && g[7][0] === null);
t("Schub ohne Overflow ist ok", r1.over === false);
g = empty();
g[0][4] = { sp: 0 };   // oberste Reihe belegt → Overflow
t("belegte oberste Reihe → Game Over beim Schub", shove(g, new Set([0])).over === true);

console.log("\n" + (ok ? "WUMMS-LOGIK OK" : "WUMMS-LOGIK FEHLGESCHLAGEN"));
process.exit(ok ? 0 : 1);
