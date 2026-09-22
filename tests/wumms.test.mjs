// Logik-Tests für WUMMS! — die Datei public/wumms/app.js braucht das DOM
// und lässt sich nicht direkt importieren. Rastergröße und Formen-Tabelle
// (inkl. Rotations-Erzeugung) werden darum aus dem echten Quelltext
// geschnitten und in node:vm ausgeführt; die Brett-Logik unten ist eine
// Nachbildung (im Spiel hängt sie am globalen Zustand).
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import vm from "node:vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = fs.readFileSync(path.join(__dirname, "..", "public", "wumms", "app.js"), "utf8");
const from = src.indexOf("// ---------- Block-Formen"), to = src.indexOf("// ---------- Spielzustand");
const nLine = (src.match(/^const N = \d+;/m) || [""])[0];
if (from < 0 || to < from || !nLine) { console.log("FAIL Abschnitts-Marker in wumms/app.js nicht gefunden"); process.exit(1); }
const W = vm.runInContext(nLine + "\n" + src.slice(from, to) + ";({ N, BASE_SHAPES, SHAPES, keyOf })",
  vm.createContext({ Math, Set }), { filename: "wumms/app.js" });
const { N, BASE_SHAPES, SHAPES, keyOf } = W;
let ok = true;
const t = (name, cond) => { console.log((cond ? "OK   " : "FAIL ") + name); if (!cond) ok = false; };

t("Rastergröße aus dem Spiel (>= 6)", Number.isInteger(N) && N >= 6);
t("Formen erzeugt (mehr als Grundformen, >= 25 einzigartige)", SHAPES.length > BASE_SHAPES.length && SHAPES.length >= 25);
t("jede Form passt aufs Brett", SHAPES.every(s => s.every(([r, c]) => r < N && c < N)));
t("alle Formen normalisiert (min 0/0)", SHAPES.every(s => Math.min(...s.map(c => c[0])) === 0 && Math.min(...s.map(c => c[1])) === 0));
t("keine doppelten Formen", new Set(SHAPES.map(keyOf)).size === SHAPES.length);

// ---- Brett-Logik ----
const empty = () => Array.from({ length: N }, () => Array(N).fill(null));
const canPlaceAt = (grid, piece, r0, c0) => piece.every(([r, c]) => {
  const rr = r0 + r, cc = c0 + c; return rr >= 0 && rr < N && cc >= 0 && cc < N && !grid[rr][cc];
});

let g = empty();
t("leeres Feld: 1×1 passt in Ecke", canPlaceAt(g, [[0,0]], N - 1, N - 1));
t("außerhalb passt nicht", !canPlaceAt(g, [[0,0]], N, 0));
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
t("volle Reihe wird erkannt", res.lines === 1 && res.cells === N);
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
t("Kreuz räumt 2N-1 Felder (Reihe + Spalte, Schnittpunkt einmal)", res.cells === 2 * N - 1);

// ---- Bösewicht-Schub ----
function shove(grid, chosenCols) {
  if (grid[0].some(Boolean)) return { over: true };
  for (let r = 0; r < N - 1; r++) grid[r] = grid[r + 1];
  grid[N - 1] = Array.from({ length: N }, (_, c) => chosenCols.has(c) ? { villain: true } : null);
  return { over: false };
}
g = empty();
g[N - 1][0] = { sp: 0 };
let r1 = shove(g, new Set([1, 2, 3]));
t("Schub schiebt Inhalt nach oben", g[N - 2][0] && g[N - 2][0].sp === 0);
t("neue Bösewicht-Reihe unten", g[N - 1][1] && g[N - 1][1].villain === true && g[N - 1][0] === null);
t("Schub ohne Overflow ist ok", r1.over === false);
g = empty();
g[0][4] = { sp: 0 };   // oberste Reihe belegt → Overflow
t("belegte oberste Reihe → Game Over beim Schub", shove(g, new Set([0])).over === true);

console.log("\n" + (ok ? "WUMMS-LOGIK OK" : "WUMMS-LOGIK FEHLGESCHLAGEN"));
process.exit(ok ? 0 : 1);
