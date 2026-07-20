// ====================================================================
// WUMMS! — Comic-Block-Puzzle mit Tier-Helden.
//  - 8×8-Raster, 3 Block-Teile ziehen, volle Reihen/Spalten lösen sich.
//  - Line-Clears laden den POW-Meter → Helden-Ultimate (Bombe/Laser/Nuke).
//  - Combo-Ketten (×2, ×3 …) als Punkte-Multiplikator.
//  - Bösewicht schiebt regelmäßig eine Reihe von unten hoch (sanfter Druck).
//  - Tages-Challenge über ?daily=1 (fester Seed).
// ====================================================================
"use strict";
const N = 8;                       // Rastergröße
const POW_MAX = 100;               // POW-Meter voll
let THREAT_MAX = 7;                // Züge bis der Bösewicht schiebt

// ---------- Tier-Arten (Block-Farben) ----------
const SPECIES = [
  { id: "fox",   base: "#ff8a3d", dark: "#c85f14", ear: "tri",   name: "Fuchs" },
  { id: "frog",  base: "#57e39b", dark: "#1f9d5c", ear: "top",   name: "Frosch" },
  { id: "bunny", base: "#9b7bff", dark: "#5f3fd0", ear: "long",  name: "Hase" },
  { id: "cat",   base: "#ffd23f", dark: "#c99b14", ear: "point", name: "Katze" },
  { id: "bird",  base: "#38b6ff", dark: "#1877c0", ear: "beak",  name: "Vogel" },
];
const VILLAIN = { base: "#7b8194", dark: "#464b5c" };

// ---------- Seed-RNG (für Tages-Challenge deterministisch) ----------
const DAILY = new URLSearchParams(location.search).get("daily") === "1";
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
let seededRand = mulberry32((Math.floor(Date.now() / 86400000)) ^ 0x5eed);
const rnd = () => DAILY ? seededRand() : Math.random();
const ri = n => Math.floor(rnd() * n);

// ---------- Block-Formen (mit Rotationen erzeugt) ----------
function normalize(cells) {
  const mr = Math.min(...cells.map(c => c[0])), mc = Math.min(...cells.map(c => c[1]));
  return cells.map(([r, c]) => [r - mr, c - mc]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}
function rotate(cells) { return normalize(cells.map(([r, c]) => [c, -r])); }
function keyOf(cells) { return cells.map(c => c.join(",")).join(";"); }

const BASE_SHAPES = [
  [[0,0]],
  [[0,0],[0,1]],
  [[0,0],[0,1],[0,2]],
  [[0,0],[0,1],[0,2],[0,3]],
  [[0,0],[0,1],[0,2],[0,3],[0,4]],
  [[0,0],[0,1],[1,0],[1,1]],                       // 2×2
  [[0,0],[0,1],[0,2],[1,0],[1,1],[1,2]],           // 2×3
  [[0,0],[0,1],[0,2],[1,0],[1,1],[1,2],[2,0],[2,1],[2,2]], // 3×3
  [[0,0],[1,0],[1,1]],                             // Ecke 3
  [[0,0],[1,0],[2,0],[2,1]],                       // L
  [[0,0],[0,1],[0,2],[1,1]],                       // T
  [[0,1],[0,2],[1,0],[1,1]],                       // S
  [[0,0],[0,1],[1,1],[1,2]],                       // Z
  [[0,0],[1,0],[2,0],[2,1],[2,2]],                 // große Ecke 5
];
const SHAPES = (() => {
  const seen = new Set(), out = [];
  for (const s of BASE_SHAPES) {
    let cur = normalize(s);
    for (let r = 0; r < 4; r++) {
      const k = keyOf(cur);
      if (!seen.has(k)) { seen.add(k); out.push(cur); }
      cur = rotate(cur);
    }
  }
  return out;
})();

// ---------- Spielzustand ----------
let grid, tray, score, best, combo, pow, threat, shoves, armed, over, running;
let stats;   // { lines, maxCombo, shoves, ultimates }

function reset() {
  if (DAILY) seededRand = mulberry32((Math.floor(Date.now() / 86400000)) ^ 0x5eed);
  grid = Array.from({ length: N }, () => Array(N).fill(null));
  tray = [null, null, null];
  score = 0; combo = 0; threat = 0; shoves = 0;
  const perk = currentPerk();
  THREAT_MAX = perk === "calm" ? 9 : 7;         // Katze: seltenere Schübe
  pow = perk === "charged" ? POW_MAX / 2 : 0;   // Frosch: halb voller Start-POW
  heroCheer = 0; villainPush = 0; speeches = [];
  over = false; running = true;
  stats = { lines: 0, maxCombo: 0, shoves: 0, ultimates: 0 };
  best = Number(localStorage.getItem("wumms_best") || 0);
  clearArmUI();
  dealTray();
  updateHUD();
}

function randomPiece() {
  const cells = SHAPES[ri(SHAPES.length)];
  return { cells, sp: ri(SPECIES.length) };
}
function dealTray() {
  // Fair: möglichst ein Tray ziehen, in dem mindestens ein Teil passt.
  // Nur wenn das Brett wirklich zu voll ist, bleibt es beim letzten Versuch
  // (dann folgt ein ehrliches Game Over).
  for (let attempt = 0; attempt < 12; attempt++) {
    tray = [randomPiece(), randomPiece(), randomPiece()];
    if (anyMoveLeft()) return;
  }
}

// ---------- Platzierbarkeit ----------
function canPlaceAt(piece, r0, c0) {
  for (const [r, c] of piece.cells) {
    const rr = r0 + r, cc = c0 + c;
    if (rr < 0 || rr >= N || cc < 0 || cc >= N || grid[rr][cc]) return false;
  }
  return true;
}
function fitsAnywhere(piece) {
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (canPlaceAt(piece, r, c)) return true;
  return false;
}
function anyMoveLeft() { return tray.some(p => p && fitsAnywhere(p)); }

// ---------- Platzieren + Auswerten ----------
function placePiece(slot, r0, c0) {
  const piece = tray[slot];
  for (const [r, c] of piece.cells) grid[r0 + r][c0 + c] = { sp: piece.sp };
  score += piece.cells.length;
  tray[slot] = null;
  GS.sound.click(); GS.haptic(8);

  const res = clearLines();

  // Combo
  if (res.lines > 0) combo++; else combo = 0;
  stats.maxCombo = Math.max(stats.maxCombo, combo);
  const mult = Math.max(1, combo);

  if (res.lines > 0) {
    stats.lines += res.lines;
    const perk = currentPerk();
    const sBonus = res.speciesLines * 20;
    const comboBoost = perk === "combo" ? 1.25 : 1;          // Fuchs: mehr Punkte
    const powRate = perk === "pow" ? 1.25 : 1;               // Waschbär: schneller laden
    const gain = Math.round((res.cells * 5 + res.lines * res.lines * 10 + sBonus) * mult * comboBoost);
    score += gain;
    pow = Math.min(POW_MAX, pow + Math.round((res.cells * 3 + res.lines * 5 + res.speciesLines * 8) * powRate));
    threat = Math.max(0, threat - res.lines);   // Clears drängen den Bösewicht zurück
    burst(res.lines >= 3 ? "WUMMS!" : res.lines >= 2 ? "BÄM!" : "PLOPP!", "#ffd23f");
    floater(`+${gain}`, "#57e39b");
    if (mult >= 2) showCombo(mult);
    if (res.lines >= 2) { GS.sound.great(); GS.haptic([10, 40, 10]); } else GS.sound.good();
    shake(res.lines * 3 + 2);
    heroCheer = 0.85;
    say("hero", mult >= 3 ? "COMBO!" : ["JUHU!", "STARK!", "YEAH!", "PENG!"][ri(4)]);
  }

  // Bösewicht-Druck
  threat += 1;
  if (threat >= THREAT_MAX) { threat = 0; villainShove(); }

  // Neue Teile nachlegen, dann EINE klare Game-Over-Prüfung: nur wenn wirklich
  // kein Teil mehr passt.
  if (tray.every(p => !p)) dealTray();
  if (!anyMoveLeft()) return gameOver();

  if (score > best) { best = score; localStorage.setItem("wumms_best", String(best)); }
  updateHUD();
}

function clearLines() {
  const fullRows = [], fullCols = [];
  for (let r = 0; r < N; r++) if (grid[r].every(Boolean)) fullRows.push(r);
  for (let c = 0; c < N; c++) { let ok = true; for (let r = 0; r < N; r++) if (!grid[r][c]) { ok = false; break; } if (ok) fullCols.push(c); }

  const marked = new Set();
  let speciesLines = 0;
  const lineIsSpecies = cells => {
    const first = cells[0] && !cells[0].villain ? cells[0].sp : null;
    return first !== null && cells.every(x => x && !x.villain && x.sp === first);
  };
  for (const r of fullRows) { if (lineIsSpecies(grid[r])) speciesLines++; for (let c = 0; c < N; c++) marked.add(r * N + c); }
  for (const c of fullCols) { const col = []; for (let r = 0; r < N; r++) col.push(grid[r][c]); if (lineIsSpecies(col)) speciesLines++; for (let r = 0; r < N; r++) marked.add(r * N + c); }

  for (const k of marked) {
    const r = Math.floor(k / N), c = k % N;
    spawnParticles(r, c, grid[r][c]);
    grid[r][c] = null;
  }
  return { lines: fullRows.length + fullCols.length, cells: marked.size, speciesLines };
}

function villainShove() {
  // Kein Platz oben? Dann ist der Bösewicht blockiert — er schiebt nicht und
  // niemand stirbt. Das Spiel endet ausschließlich, wenn kein Teil mehr passt.
  if (grid[0].some(Boolean)) return;
  shoves++; stats.shoves = shoves;
  const perk = currentPerk();
  // Schwierigkeit zieht langsam an: kürzeres Intervall, dichtere Reihe.
  // Katze (calm) hält den Bösewicht ruhiger.
  const floorMax = perk === "calm" ? 6 : 4, baseMax = perk === "calm" ? 9 : 7;
  THREAT_MAX = Math.max(floorMax, baseMax - Math.floor(shoves / 3));
  for (let r = 0; r < N - 1; r++) grid[r] = grid[r + 1];
  let fill = Math.min(7, 4 + Math.floor(shoves / 2));
  if (perk === "gap") fill = Math.max(3, fill - 1);   // Igel: mehr Lücken
  const cols = [...Array(N).keys()];
  for (let i = cols.length - 1; i > 0; i--) { const j = ri(i + 1); [cols[i], cols[j]] = [cols[j], cols[i]]; }
  const chosen = new Set(cols.slice(0, fill));
  grid[N - 1] = Array.from({ length: N }, (_, c) => chosen.has(c) ? { villain: true } : null);
  burst("GRRR!", "#ff4d6d"); shake(7);
  villainPush = 0.6; say("villain", ["GRR!", "HA!", "MEHR!", "HOCH!"][ri(4)]);
  GS.sound.tone(150, 0.25, { type: "sawtooth", gain: 0.09, slideTo: 70 }); GS.haptic([20, 30, 20]);
  // Kein Game-Over-Check hier: das Tray kann gerade leer sein (letztes Teil
  // eben gelegt). placePiece legt danach neue Teile nach und prüft dort.
}

// ---------- Helden-Ultimates ----------
function openUltimate() {
  if (pow < POW_MAX || armed || over) return;
  const ov = mkOverlay(`
    <h2><span class="foil">Helden-Power!</span></h2>
    <p class="sub">Wähle deinen Comic-Angriff und tippe dann das Ziel an.</p>
    <div class="ult-grid">
      <button class="ult-opt" data-u="bomb"><span class="ult-ic">💥</span><span><b>KAWUMM</b><span>Sprengt ein 3×3-Feld</span></span></button>
      <button class="ult-opt" data-u="laser"><span class="ult-ic">⚡</span><span><b>ZZZAP</b><span>Ganze Reihe + Spalte</span></span></button>
      <button class="ult-opt" data-u="nuke"><span class="ult-ic">🎨</span><span><b>PLOPP</b><span>Alle Tiere einer Art weg</span></span></button>
    </div>
    <button class="btn-secondary" data-close="1">Zurück</button>`);
  ov.querySelectorAll(".ult-opt").forEach(b => b.onclick = () => { ov.remove(); armUltimate(b.dataset.u); });
  ov.querySelector("[data-close]").onclick = () => ov.remove();
}
function armUltimate(type) {
  armed = type;
  const label = { bomb: "💥 KAWUMM — Feld antippen", laser: "⚡ ZZZAP — Feld antippen", nuke: "🎨 PLOPP — ein Tier antippen" }[type];
  document.getElementById("arm-text").textContent = label;
  document.getElementById("arm-banner").hidden = false;
  document.getElementById("pow-btn").hidden = true;
}
function clearArmUI() {
  armed = null;
  const ab = document.getElementById("arm-banner");
  if (ab) ab.hidden = true;
}
function cancelArm() {
  clearArmUI();
  updateHUD();
}
function execUltimate(r, c) {
  const type = armed; armed = null;
  document.getElementById("arm-banner").hidden = true;
  let removed = 0;
  const rm = (rr, cc) => { if (rr >= 0 && rr < N && cc >= 0 && cc < N && grid[rr][cc]) { spawnParticles(rr, cc, grid[rr][cc]); grid[rr][cc] = null; removed++; } };

  if (type === "bomb") { for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) rm(r + dr, c + dc); burst("KAWUMM!", "#ff8a3d"); }
  else if (type === "laser") { for (let i = 0; i < N; i++) { rm(r, i); rm(i, c); } burst("ZZZAP!", "#38b6ff"); }
  else { const t = grid[r][c]; const want = t.villain ? "V" : t.sp;
    for (let rr = 0; rr < N; rr++) for (let cc = 0; cc < N; cc++) { const g = grid[rr][cc]; if (g && ((want === "V" && g.villain) || (!g.villain && g.sp === want))) rm(rr, cc); }
    burst("PLOPP!", "#9b7bff"); }

  score += removed * 3;
  pow = 0; stats.ultimates++;
  combo = 0;
  GS.sound.win(); GS.haptic([15, 30, 15]); shake(6);
  if (score > best) { best = score; localStorage.setItem("wumms_best", String(best)); }
  if (!anyMoveLeft() && tray.some(Boolean)) { updateHUD(); return gameOver(); }
  updateHUD();
}

// ====================================================================
// Rendering (Canvas)
// ====================================================================
const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
let cell = 40, boardX = 0, boardY = 0, cssW = 0, cssH = 0, trayY = 0, traySlotH = 0;
let traySlots = [];   // { r:{x,y,w,h}, tcell, cols, rows, idx }

function layout() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  canvas.style.width = "100%";
  const wrap = canvas.parentElement;
  const availW = (wrap && wrap.clientWidth) || canvas.clientWidth || 340;
  const availH = (wrap && wrap.clientHeight) || 520;
  const PAD = 6;
  // Höhen-Budget: Strip(1.5) + Brett(N) + Tray(2.3) + Abstände(~0.65) in Zellen
  const UNITS = 1.5 + N + 2.3 + 0.65;
  const cellW = (availW - PAD * 2) / N;
  const cellH = (availH - PAD * 2) / UNITS;
  cell = Math.max(22, Math.floor(Math.min(cellW, cellH)));
  const boardSize = cell * N;
  cssW = availW;
  boardX = Math.round((availW - boardSize) / 2);
  stripH = Math.round(cell * 1.5);
  stripY = PAD;
  boardY = stripY + stripH + Math.round(cell * 0.2);
  const trayGap = Math.round(cell * 0.45);
  traySlotH = Math.round(cell * 2.3);
  trayY = boardY + boardSize + trayGap;
  cssH = trayY + traySlotH + PAD;
  canvas.style.height = cssH + "px";
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawTile(x, y, s, data, scale) {
  const pad = s * 0.06;
  const size = (s - pad * 2) * (scale || 1);
  const off = (s - size) / 2;
  const X = x + off, Y = y + off;
  const col = data.villain ? VILLAIN : SPECIES[data.sp];
  const r = size * 0.24;
  const lw = Math.max(2, size * 0.08);

  // Ohren/Details hinter dem Körper
  ctx.save();
  ctx.lineWidth = lw; ctx.strokeStyle = "#17122a"; ctx.lineJoin = "round";
  if (!data.villain) drawEars(X, Y, size, col);

  // Körper
  const g = ctx.createLinearGradient(X, Y, X, Y + size);
  g.addColorStop(0, col.base); g.addColorStop(1, col.dark);
  roundRect(X, Y, size, size, r); ctx.fillStyle = g; ctx.fill(); ctx.stroke();

  // Glanz oben links
  ctx.save(); roundRect(X, Y, size, size, r); ctx.clip();
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  roundRect(X + size * 0.14, Y + size * 0.12, size * 0.34, size * 0.2, size * 0.1); ctx.fill();
  ctx.restore();

  // Gesicht
  const ey = Y + size * 0.46, ex = size * 0.24, er = size * 0.14;
  if (data.villain) {
    ctx.strokeStyle = "#17122a"; ctx.lineWidth = Math.max(1.5, size * 0.055); ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(X + size * 0.24, Y + size * 0.34); ctx.lineTo(X + size * 0.42, Y + size * 0.44);
    ctx.moveTo(X + size * 0.76, Y + size * 0.34); ctx.lineTo(X + size * 0.58, Y + size * 0.44); ctx.stroke();
    dot(X + size * 0.36, ey, er * 0.7); dot(X + size * 0.64, ey, er * 0.7);
    ctx.beginPath(); ctx.arc(X + size / 2, Y + size * 0.74, size * 0.14, Math.PI, 0); ctx.stroke();
  } else {
    eye(X + size * 0.5 - ex, ey, er); eye(X + size * 0.5 + ex, ey, er);
    ctx.strokeStyle = "#17122a"; ctx.lineWidth = Math.max(1.5, size * 0.05); ctx.lineCap = "round";
    ctx.beginPath(); ctx.arc(X + size / 2, Y + size * 0.6, size * 0.12, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  }
  ctx.restore();

  function eye(cx, cy, rr) {
    ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 7); ctx.fill();
    ctx.lineWidth = Math.max(1, size * 0.03); ctx.strokeStyle = "#17122a"; ctx.stroke();
    ctx.fillStyle = "#17122a"; ctx.beginPath(); ctx.arc(cx + rr * 0.15, cy + rr * 0.1, rr * 0.5, 0, 7); ctx.fill();
  }
  function dot(cx, cy, rr) { ctx.fillStyle = "#17122a"; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 7); ctx.fill(); }
}

function drawEars(X, Y, size, col) {
  ctx.fillStyle = col.base;
  const drawEar = (cx) => {
    if (col.ear === "long") { roundRect(cx - size * 0.07, Y - size * 0.26, size * 0.14, size * 0.34, size * 0.07); ctx.fill(); ctx.stroke(); }
    else if (col.ear === "tri" || col.ear === "point") {
      ctx.beginPath(); ctx.moveTo(cx - size * 0.12, Y + size * 0.14); ctx.lineTo(cx, Y - size * 0.14); ctx.lineTo(cx + size * 0.12, Y + size * 0.14); ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (col.ear === "top") { ctx.beginPath(); ctx.arc(cx, Y + size * 0.02, size * 0.11, 0, 7); ctx.fill(); ctx.stroke(); }
  };
  if (col.ear === "beak") { return; }
  drawEar(X + size * 0.26); drawEar(X + size * 0.74);
}

// Placement-Preview beim Ziehen
let drag = null;   // { slot, piece, px, py }
function previewCells() {
  if (!drag) return null;
  const bb = bbox(drag.piece.cells);
  const topX = drag.px - (bb.cols * cell) / 2;
  const topY = drag.py - cell * 1.4 - bb.rows * cell;
  const col0 = Math.round((topX - boardX) / cell);
  const row0 = Math.round((topY - boardY) / cell);
  return { row0, col0, ok: canPlaceAt(drag.piece, row0, col0) };
}
function bbox(cells) {
  const rows = Math.max(...cells.map(c => c[0])) + 1, cols = Math.max(...cells.map(c => c[1])) + 1;
  return { rows, cols };
}

// Tray-Geometrie (auch für Trefferprüfung)
function computeTray() {
  traySlots = [];
  const slotW = cssW / 3;
  for (let i = 0; i < 3; i++) {
    const p = tray[i];
    const sx = slotW * i, sy = trayY;
    if (!p) { traySlots.push({ idx: i, empty: true, x: sx, y: sy, w: slotW, h: traySlotH }); continue; }
    const bb = bbox(p.cells);
    const tc = Math.floor(Math.min((slotW * 0.8) / bb.cols, (traySlotH * 0.8) / bb.rows, cell * 0.72));
    const pw = bb.cols * tc, ph = bb.rows * tc;
    const ox = sx + (slotW - pw) / 2, oy = sy + (traySlotH - ph) / 2;
    traySlots.push({ idx: i, piece: p, tcell: tc, cols: bb.cols, rows: bb.rows, ox, oy, pw, ph, x: sx, y: sy, w: slotW, h: traySlotH });
  }
}

// ---------- Effekte & Figuren ----------
let particles = [], bursts = [], floaters = [], shakeAmt = 0;
let heroCheer = 0, villainPush = 0, speeches = [], powWasReady = false, animT = 0;
let stripY = 0, stripH = 0;
function say(who, text) { speeches = speeches.filter(s => s.who !== who); speeches.push({ who, text, t: 0, life: 1.2 }); }
function spawnParticles(r, c, data) {
  const col = data && data.villain ? VILLAIN.base : (data ? SPECIES[data.sp].base : "#fff");
  const x = boardX + c * cell + cell / 2, y = boardY + r * cell + cell / 2;
  for (let i = 0; i < 5; i++) particles.push({ x, y, vx: (rnd() - 0.5) * 5, vy: (rnd() - 0.5) * 5 - 1, life: 1, size: cell * (0.14 + rnd() * 0.14), col, rot: rnd() * 7, vr: (rnd() - 0.5) * 0.4 });
}
function burst(text, col) { bursts.push({ text, col, x: boardX + cell * N / 2, y: boardY + cell * N * 0.42, t: 0, life: 0.9 }); }
function floater(text, col) { floaters.push({ text, col, x: boardX + cell * N / 2, y: boardY + cell * N * 0.6, t: 0, life: 1 }); }
function shake(a) { shakeAmt = Math.max(shakeAmt, a); }

let lastT = 0;
function frame(t) {
  const dt = Math.min(0.05, (t - lastT) / 1000 || 0); lastT = t;
  // Effekte updaten
  animT += dt;
  particles = particles.filter(p => (p.life -= dt * 1.6) > 0);
  particles.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += 0.35; p.rot += p.vr; });
  bursts = bursts.filter(b => (b.t += dt) < b.life);
  floaters = floaters.filter(f => (f.t += dt) < f.life);
  speeches = speeches.filter(s => (s.t += dt) < s.life);
  if (heroCheer > 0) heroCheer = Math.max(0, heroCheer - dt);
  if (villainPush > 0) villainPush = Math.max(0, villainPush - dt);
  if (shakeAmt > 0) shakeAmt = Math.max(0, shakeAmt - dt * 40);
  // POW gerade voll geworden? Held jubelt einmal.
  const ready = pow >= POW_MAX && !over && running;
  if (ready && !powWasReady) { say("hero", "POWER!"); heroCheer = 0.85; }
  powWasReady = ready;
  draw();
  requestAnimationFrame(frame);
}

function draw() {
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.save();
  if (shakeAmt > 0) ctx.translate((rnd() - 0.5) * shakeAmt, (rnd() - 0.5) * shakeAmt);

  drawStage();

  // Brett-Panel
  const bs = cell * N;
  roundRect(boardX - 5, boardY - 5, bs + 10, bs + 10, 16);
  ctx.fillStyle = getVar("--card-hi") || "rgba(255,255,255,0.08)";
  ctx.fill(); ctx.lineWidth = 3.5; ctx.strokeStyle = "#17122a"; ctx.stroke();

  // Leere Zellen
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) {
    if (grid[r][c]) continue;
    roundRect(boardX + c * cell + cell * 0.09, boardY + r * cell + cell * 0.09, cell * 0.82, cell * 0.82, cell * 0.16);
    ctx.fillStyle = "rgba(0,0,0,0.16)"; ctx.fill();
  }
  // Gefüllte Zellen
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (grid[r][c]) drawTile(boardX + c * cell, boardY + r * cell, cell, grid[r][c], 1);

  // Preview
  const pv = previewCells();
  if (pv && drag) {
    for (const [r, c] of drag.piece.cells) {
      const rr = pv.row0 + r, cc = pv.col0 + c;
      if (rr < 0 || rr >= N || cc < 0 || cc >= N) continue;
      roundRect(boardX + cc * cell + cell * 0.09, boardY + rr * cell + cell * 0.09, cell * 0.82, cell * 0.82, cell * 0.16);
      ctx.fillStyle = pv.ok ? "rgba(87,227,155,0.4)" : "rgba(255,77,109,0.35)"; ctx.fill();
    }
  }

  // Tray
  computeTray();
  for (const s of traySlots) {
    if (s.empty) continue;
    if (drag && drag.slot === s.idx) continue;
    for (const [r, c] of s.piece.cells) drawTile(s.ox + c * s.tcell, s.oy + r * s.tcell, s.tcell, { sp: s.piece.sp }, 1);
  }

  // Gezogenes Teil
  if (drag) {
    const bb = bbox(drag.piece.cells);
    const topX = drag.px - (bb.cols * cell) / 2, topY = drag.py - cell * 1.4 - bb.rows * cell;
    for (const [r, c] of drag.piece.cells) drawTile(topX + c * cell, topY + r * cell, cell, { sp: drag.piece.sp }, 0.96);
  }

  // Partikel
  for (const p of particles) {
    ctx.save(); ctx.globalAlpha = Math.max(0, p.life); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
    ctx.fillStyle = p.col; ctx.strokeStyle = "#17122a"; ctx.lineWidth = 1.5;
    roundRect(-p.size / 2, -p.size / 2, p.size, p.size, p.size * 0.25); ctx.fill(); ctx.stroke();
    ctx.restore();
  }
  // Floater
  for (const f of floaters) {
    ctx.save(); const k = f.t / f.life; ctx.globalAlpha = 1 - k;
    ctx.font = `800 ${cell * 0.6}px ${getVar("--font-ui") || "Outfit"}, sans-serif`;
    ctx.textAlign = "center"; ctx.lineWidth = 4; ctx.strokeStyle = "#17122a"; ctx.fillStyle = f.col;
    ctx.strokeText(f.text, f.x, f.y - k * cell * 1.5); ctx.fillText(f.text, f.x, f.y - k * cell * 1.5);
    ctx.restore();
  }
  // Bursts (Onomatopoesie)
  for (const b of bursts) {
    const k = b.t / b.life; const sc = k < 0.3 ? (k / 0.3) * 1.15 : 1.15 - (k - 0.3) * 0.2;
    ctx.save(); ctx.globalAlpha = Math.max(0, 1 - k); ctx.translate(b.x, b.y); ctx.rotate(-0.08); ctx.scale(sc, sc);
    ctx.font = `900 italic ${cell * 1.3}px ${getVar("--font-ui") || "Outfit"}, sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineWidth = 8; ctx.strokeStyle = "#17122a"; ctx.strokeText(b.text, 0, 0);
    ctx.fillStyle = b.col; ctx.fillText(b.text, 0, 0);
    ctx.restore();
  }
  // Sprechblasen an Held/Bösewicht
  for (const s of speeches) {
    const heroSide = s.who === "hero";
    const cx = heroSide ? boardX + stripH * 0.5 : boardX + cell * N - stripH * 0.5;
    drawBubble(cx, stripY + stripH * 0.18, s.text, heroSide, s.t / s.life);
  }
  ctx.restore();
}

// ---------- Bühne: Held (links) vs. Bösewicht (rechts) ----------
function drawStage() {
  const s = stripH;
  drawHero(boardX, stripY, s, heroId(), animT, heroCheer);
  drawVillain(boardX + cell * N - s, stripY, s, animT, Math.min(1, threat / THREAT_MAX), villainPush);
}

function headEyes(cx, cy, rr, s, happy, look) {
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(cx, cy, rr, 0, 7); ctx.fill();
  ctx.lineWidth = Math.max(1, s * 0.012); ctx.strokeStyle = "#17122a"; ctx.stroke();
  ctx.fillStyle = "#17122a"; ctx.beginPath();
  ctx.arc(cx + (look || 0) * rr * 0.4, cy + (happy ? -rr * 0.15 : rr * 0.15), rr * 0.55, 0, 7); ctx.fill();
}

function drawHero(x, y, s, id, t, cheer) {
  const L = HERO_LOOK[id] || HERO_LOOK.raccoon;
  const hop = cheer > 0 ? Math.sin((1 - cheer / 0.85) * Math.PI) * s * 0.16 : 0;
  const bob = Math.sin(t * 3) * s * 0.02;
  ctx.save();
  ctx.translate(x + s * 0.5, y + s * 0.55 - hop - bob);
  const R = s * 0.32, lw = Math.max(2, s * 0.06);
  ctx.lineWidth = lw; ctx.strokeStyle = "#17122a"; ctx.lineJoin = "round"; ctx.lineCap = "round";

  // Arme beim Jubeln
  if (cheer > 0) {
    ctx.save(); ctx.strokeStyle = "#17122a"; ctx.lineWidth = lw * 1.3;
    ctx.beginPath(); ctx.moveTo(-R * 0.8, R * 0.2); ctx.lineTo(-R * 1.15, -R * 0.5);
    ctx.moveTo(R * 0.8, R * 0.2); ctx.lineTo(R * 1.15, -R * 0.5); ctx.stroke();
    ctx.restore();
  }
  // Ohren
  ctx.fillStyle = L.fur;
  const ear = (ex) => {
    if (L.ear === "round") { ctx.beginPath(); ctx.arc(ex, -R * 0.72, R * 0.3, 0, 7); ctx.fillStyle = L.fur; ctx.fill(); ctx.stroke(); ctx.beginPath(); ctx.arc(ex, -R * 0.72, R * 0.15, 0, 7); ctx.fillStyle = L.dark; ctx.fill(); }
    else if (L.ear === "tri") { ctx.beginPath(); ctx.moveTo(ex - R * 0.28, -R * 0.5); ctx.lineTo(ex, -R * 1.15); ctx.lineTo(ex + R * 0.28, -R * 0.5); ctx.closePath(); ctx.fillStyle = L.fur; ctx.fill(); ctx.stroke(); }
    else if (L.ear === "spike") { for (let k = -2; k <= 2; k++) { ctx.beginPath(); ctx.moveTo(ex + k * R * 0.34 - R * 0.14, -R * 0.55); ctx.lineTo(ex + k * R * 0.34, -R * 1.05); ctx.lineTo(ex + k * R * 0.34 + R * 0.14, -R * 0.55); ctx.closePath(); ctx.fillStyle = L.dark; ctx.fill(); ctx.stroke(); } }
    else if (L.ear === "bump") { ctx.beginPath(); ctx.arc(ex, -R * 0.62, R * 0.32, 0, 7); ctx.fillStyle = L.fur; ctx.fill(); ctx.stroke(); }
  };
  if (L.ear === "spike") ear(0); else { ear(-R * 0.62); ear(R * 0.62); }

  // Kopf
  const g = ctx.createLinearGradient(0, -R, 0, R);
  g.addColorStop(0, L.fur); g.addColorStop(1, L.dark);
  ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.fillStyle = g; ctx.fill(); ctx.stroke();
  // Schnauze
  ctx.beginPath(); ctx.ellipse(0, R * 0.3, R * 0.6, R * 0.48, 0, 0, 7); ctx.fillStyle = L.face; ctx.fill(); ctx.stroke();
  // Waschbär-Maske
  if (L.mask) { ctx.fillStyle = L.dark; roundRect(-R * 0.82, -R * 0.18, R * 1.64, R * 0.52, R * 0.22); ctx.fill(); ctx.stroke(); }
  // Frosch: Augen auf den Bumps
  const eo = R * 0.4, ey = L.ear === "bump" ? -R * 0.55 : -R * 0.02, er = R * 0.2;
  headEyes(-eo, L.ear === "bump" ? -R * 0.62 : ey, er, s, cheer > 0, 0);
  headEyes(eo, L.ear === "bump" ? -R * 0.62 : ey, er, s, cheer > 0, 0);
  // Nase
  ctx.fillStyle = "#17122a"; ctx.beginPath(); ctx.arc(0, R * 0.2, R * 0.11, 0, 7); ctx.fill();
  // Schnurrhaare (Katze)
  if (L.whisk) { ctx.lineWidth = Math.max(1, s * 0.02); ctx.beginPath(); ctx.moveTo(R * 0.2, R * 0.28); ctx.lineTo(R * 0.7, R * 0.2); ctx.moveTo(R * 0.2, R * 0.34); ctx.lineTo(R * 0.7, R * 0.36); ctx.moveTo(-R * 0.2, R * 0.28); ctx.lineTo(-R * 0.7, R * 0.2); ctx.moveTo(-R * 0.2, R * 0.34); ctx.lineTo(-R * 0.7, R * 0.36); ctx.stroke(); ctx.lineWidth = lw; }
  // Mund
  ctx.beginPath();
  if (cheer > 0) { ctx.arc(0, R * 0.34, R * 0.26, 0.05 * Math.PI, 0.95 * Math.PI); ctx.fillStyle = "#17122a"; ctx.fill(); }
  else { ctx.arc(0, R * 0.3, R * 0.16, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke(); }
  ctx.restore();
}

function drawVillain(x, y, s, t, threatRatio, push) {
  const L = VILLAIN_LOOK;
  const lunge = push > 0 ? Math.sin((1 - push / 0.6) * Math.PI) * s * 0.16 : 0;
  const bob = Math.sin(t * 2.4 + 1) * s * 0.02;
  const anger = 0.4 + threatRatio * 0.6;
  ctx.save();
  ctx.translate(x + s * 0.5 - lunge, y + s * 0.55 - bob);
  const R = s * 0.32, lw = Math.max(2, s * 0.06);
  ctx.lineWidth = lw; ctx.strokeStyle = "#17122a"; ctx.lineJoin = "round"; ctx.lineCap = "round";

  // Hörner/spitze Ohren
  ctx.fillStyle = L.dark;
  for (const ex of [-R * 0.6, R * 0.6]) { ctx.beginPath(); ctx.moveTo(ex - R * 0.24, -R * 0.5); ctx.lineTo(ex + R * 0.05, -R * 1.2); ctx.lineTo(ex + R * 0.28, -R * 0.5); ctx.closePath(); ctx.fill(); ctx.stroke(); }
  // Kopf
  const g = ctx.createLinearGradient(0, -R, 0, R);
  g.addColorStop(0, L.fur); g.addColorStop(1, L.dark);
  ctx.beginPath(); ctx.arc(0, 0, R, 0, 7); ctx.fillStyle = g; ctx.fill(); ctx.stroke();
  // wütende Brauen
  ctx.strokeStyle = "#17122a"; ctx.lineWidth = Math.max(2, s * 0.06);
  ctx.beginPath();
  ctx.moveTo(-R * 0.72, -R * 0.5); ctx.lineTo(-R * 0.16, -R * 0.5 + anger * R * 0.5);
  ctx.moveTo(R * 0.72, -R * 0.5); ctx.lineTo(R * 0.16, -R * 0.5 + anger * R * 0.5);
  ctx.stroke();
  // Augen (verengt)
  ctx.fillStyle = "#ffe14d";
  for (const ex of [-R * 0.38, R * 0.38]) { ctx.beginPath(); ctx.ellipse(ex, -R * 0.08, R * 0.17, R * 0.13, 0, 0, 7); ctx.fill(); ctx.lineWidth = Math.max(1, s * 0.02); ctx.strokeStyle = "#17122a"; ctx.stroke(); ctx.fillStyle = "#17122a"; ctx.beginPath(); ctx.arc(ex, -R * 0.08, R * 0.06, 0, 7); ctx.fill(); ctx.fillStyle = "#ffe14d"; }
  // fieses Grinsen mit Zahn
  ctx.strokeStyle = "#17122a"; ctx.lineWidth = lw; ctx.fillStyle = "#2a1c40";
  ctx.beginPath(); ctx.moveTo(-R * 0.4, R * 0.3); ctx.quadraticCurveTo(0, R * 0.28 + anger * R * 0.35, R * 0.4, R * 0.3); ctx.quadraticCurveTo(0, R * 0.62, -R * 0.4, R * 0.3); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.moveTo(-R * 0.16, R * 0.32); ctx.lineTo(-R * 0.02, R * 0.32); ctx.lineTo(-R * 0.09, R * 0.46); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}

function drawBubble(cx, cy, text, tailLeft, k) {
  ctx.save();
  const a = k < 0.15 ? k / 0.15 : (k > 0.8 ? (1 - k) / 0.2 : 1);
  ctx.globalAlpha = Math.max(0, Math.min(1, a));
  ctx.font = `800 ${Math.max(12, stripH * 0.26)}px ${getVar("--font-ui") || "Outfit"}, sans-serif`;
  const w = ctx.measureText(text).width + stripH * 0.34;
  const h = stripH * 0.5;
  let bx = cx - w / 2;
  bx = Math.max(2, Math.min(cssW - w - 2, bx));
  const by = cy - h;
  roundRect(bx, by, w, h, h * 0.34); ctx.fillStyle = "#fff8ec"; ctx.fill();
  ctx.lineWidth = Math.max(2, stripH * 0.05); ctx.strokeStyle = "#17122a"; ctx.stroke();
  // Zipfel
  ctx.beginPath();
  const tx = Math.max(bx + h * 0.4, Math.min(bx + w - h * 0.4, cx));
  ctx.moveTo(tx - h * 0.16, by + h - 1); ctx.lineTo(tailLeft ? tx - h * 0.4 : tx + h * 0.4, by + h + h * 0.34); ctx.lineTo(tx + h * 0.16, by + h - 1); ctx.closePath();
  ctx.fillStyle = "#fff8ec"; ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#241a3a"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, bx + w / 2, by + h / 2);
  ctx.restore();
}

function getVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

// ====================================================================
// Eingabe (Pointer)
// ====================================================================
function canvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}
canvas.addEventListener("pointerdown", e => {
  if (over) return;
  const { x, y } = canvasPos(e);
  // Ultimate scharf → Ziel wählen
  if (armed) {
    const c = Math.floor((x - boardX) / cell), r = Math.floor((y - boardY) / cell);
    if (r >= 0 && r < N && c >= 0 && c < N) {
      if (armed === "nuke" && !grid[r][c]) return;   // Nuke braucht ein Tier
      execUltimate(r, c);
    }
    return;
  }
  // Tray-Teil aufnehmen
  computeTray();
  for (const s of traySlots) {
    if (s.empty) continue;
    if (x >= s.ox - 6 && x <= s.ox + s.pw + 6 && y >= s.oy - 6 && y <= s.oy + s.ph + 6) {
      drag = { slot: s.idx, piece: s.piece, px: x, py: y };
      canvas.setPointerCapture(e.pointerId);
      GS.haptic(5);
      return;
    }
  }
});
canvas.addEventListener("pointermove", e => {
  if (!drag) return;
  const { x, y } = canvasPos(e); drag.px = x; drag.py = y;
});
function endDrag(e) {
  if (!drag) return;
  const pv = previewCells();
  const d = drag; drag = null;
  if (pv && pv.ok) placePiece(d.slot, pv.row0, pv.col0);
}
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", () => { drag = null; });

// ====================================================================
// HUD / UI
// ====================================================================
function updateHUD() {
  document.getElementById("score").textContent = score;
  document.getElementById("pow-fill").style.width = (pow / POW_MAX * 100) + "%";
  document.getElementById("threat-fill").style.width = Math.min(100, threat / THREAT_MAX * 100) + "%";
  document.getElementById("threat-wrap").classList.toggle("danger", threat >= THREAT_MAX - 1);
  document.getElementById("pow-wrap").classList.toggle("ready", pow >= POW_MAX);
  const powBtn = document.getElementById("pow-btn");
  powBtn.hidden = !(pow >= POW_MAX) || !!armed || over;
  const hero = GS.skins.get("wumms");
  document.getElementById("hero").textContent = (hero && hero.avatar) || "🦝";
  const hp = document.getElementById("hero-perk");
  if (hp) hp.textContent = `${HERO_NAME[heroId()] || "Held"} · ${PERK_TEXT[currentPerk()] || ""}`;
  document.getElementById("btn-sound").textContent = GS.sound.on() ? "🔊" : "🔇";
}
function showCombo(mult) {
  const el = document.getElementById("combo");
  el.textContent = "COMBO ×" + mult;
  el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
  setTimeout(() => el.classList.remove("show"), 1400);
}

function mkOverlay(html) {
  const ov = document.createElement("div");
  ov.className = "overlay";
  ov.innerHTML = `<div class="panel">${html}</div>`;
  ov.onclick = e => { if (e.target === ov && ov.dataset.dismiss !== "0") ov.remove(); };
  document.body.appendChild(ov);
  return ov;
}

// ---------- Startmenü ----------
function startMenu() {
  running = false;
  clearArmUI();
  document.getElementById("pow-btn").hidden = true;
  const ov = mkOverlay(`
    <h2><span class="foil">WUMMS!</span></h2>
    <p class="sub">Block-Puzzle mit Tier-Helden. Reihen abräumen, Power laden, den Bösewicht zurückschlagen.</p>
    <button class="btn-primary" id="m-play">▶ Spielen</button>
    <div class="menu-grid">
      <button class="btn-secondary" id="m-daily">🗓️ Tages-Challenge</button>
      <button class="btn-secondary" id="m-skins">🦊 Helden</button>
      <button class="btn-secondary" id="m-badges">🏅 Meilensteine</button>
      <button class="btn-secondary" id="m-board">🏆 Bestenliste</button>
      <button class="btn-secondary full" id="m-how">❓ Anleitung</button>
    </div>`);
  ov.dataset.dismiss = "0";
  ov.querySelector("#m-play").onclick = () => { ov.remove(); startGame(); };
  ov.querySelector("#m-daily").onclick = () => { location.href = "?daily=1"; };
  ov.querySelector("#m-skins").onclick = () => GS.skins.picker("wumms", { title: "Helden", onChange: updateHUD });
  ov.querySelector("#m-badges").onclick = () => GS.badges.show("wumms", "Meilensteine");
  ov.querySelector("#m-board").onclick = () => GS.showLeaderboard({ game: "wumms", title: "Bestenliste", sub: "Die 50 besten Helden weltweit" });
  ov.querySelector("#m-how").onclick = () => howTo(true);
}
function howTo(force) {
  GS.onboard("wumms", {
    force: !!force,
    title: "So geht WUMMS!",
    steps: [
      { icon: "🧩", text: "Ziehe die 3 Block-Teile aufs Feld. Volle Reihen & Spalten lösen sich auf." },
      { icon: "⚡", text: "Abräumen lädt die POW-Leiste — voll? Zünde eine Helden-Ultimate!" },
      { icon: "🔥", text: "Räum mehrmals in Folge ab für dicke COMBO-Multiplikatoren." },
      { icon: "😈", text: "Der Bösewicht schiebt Reihen von unten hoch. Räum ab, sonst quillt's oben über!" },
    ],
  });
}

function startGame() {
  reset();
  howTo(false);
}

// ---------- Game Over ----------
function gameOver() {
  over = true; running = false; drag = null; armed = null;
  document.getElementById("arm-banner").hidden = true;
  document.getElementById("pow-btn").hidden = true;
  GS.sound.lose(); GS.haptic([30, 40, 30, 40, 60]);
  const newly = GS.badges.record("wumms", { score, lines: stats.lines, maxCombo: stats.maxCombo, shoves: stats.shoves, ultimates: stats.ultimates });

  const ov = mkOverlay(`
    <h2><span class="foil">${DAILY ? "Tages-Challenge" : "Aus & vorbei!"}</span></h2>
    <p class="sub">Kein Platz mehr für den Helden.</p>
    <div class="big-score">${score}</div>
    <p class="sub" style="margin-top:0">🏅 Rekord: ${best} · 🔥 Combo ×${stats.maxCombo} · 😈 ${stats.shoves} Angriffe</p>
    ${GS.badges.chipsHtml(newly)}
    <div class="gs-rank"></div>
    <p class="rank-line" id="rank-line"></p>
    <button class="btn-primary" id="go-again">▶ Nochmal</button>
    <div class="menu-grid">
      <button class="btn-secondary" id="go-share">📤 Teilen</button>
      <button class="btn-secondary" id="go-board">🏆 Bestenliste</button>
      <button class="btn-secondary full" id="go-menu">☰ Menü</button>
    </div>`);
  ov.dataset.dismiss = "0";
  GS.scoreFlow(ov.querySelector(".gs-rank"), ov.querySelector("#rank-line"), {
    game: "wumms", score, daily: DAILY,
    meta: { lines: stats.lines, shoves: stats.shoves, combo: stats.maxCombo },
  });
  ov.querySelector("#go-again").onclick = () => { ov.remove(); startGame(); };
  ov.querySelector("#go-menu").onclick = () => { ov.remove(); startMenu(); };
  ov.querySelector("#go-board").onclick = () => GS.showLeaderboard({ game: "wumms", title: "Bestenliste", sub: "Die 50 besten Helden weltweit", daily: DAILY });
  ov.querySelector("#go-share").onclick = async () => {
    const r = await GS.share({ title: "WUMMS!", text: `Ich hab ${score} Punkte bei WUMMS! geschafft 🦝💥 Schaffst du mehr?`, url: location.origin + "/wumms/" });
    if (r === "copied") toast("Link kopiert");
  };
}

function toast(msg) {
  const t = document.createElement("div");
  t.textContent = msg;
  t.style.cssText = "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:200;background:#17122a;color:#fff;padding:10px 18px;border-radius:999px;font-weight:700;box-shadow:0 0 0 2px #fff inset";
  document.body.appendChild(t); setTimeout(() => t.remove(), 1800);
}

// ====================================================================
// Skins & Meilensteine
// ====================================================================
GS.skins.define("wumms", [
  { id: "raccoon",  name: "Waschbär · POW+",  req: 0, swatch: ["#9aa3b2", "#5b6273"], colors: { avatar: "🦝", accent: "#9aa3b2", perk: "pow" } },
  { id: "fox",      name: "Fuchs · Punkte+",  req: 1, swatch: ["#ff8a3d", "#c85f14"], colors: { avatar: "🦊", accent: "#ff8a3d", perk: "combo" } },
  { id: "cat",      name: "Katze · ruhiger",  req: 3, swatch: ["#ffd23f", "#c99b14"], colors: { avatar: "🐱", accent: "#ffd23f", perk: "calm" } },
  { id: "hedgehog", name: "Igel · Lücken+",   req: 5, swatch: ["#b98a5e", "#6f4f2f"], colors: { avatar: "🦔", accent: "#b98a5e", perk: "gap" } },
  { id: "frog",     name: "Frosch · Startpow", req: 7, swatch: ["#57e39b", "#1f9d5c"], colors: { avatar: "🐸", accent: "#57e39b", perk: "charged" } },
]);

// Aussehen der Comic-Figuren (Kopf-Paletten). raccoon: Maske übers Gesicht.
const HERO_LOOK = {
  raccoon:  { fur: "#9aa3b2", dark: "#5b6273", face: "#eef1f6", ear: "round", mask: true },
  fox:      { fur: "#ff8a3d", dark: "#c85f14", face: "#ffe6d2", ear: "tri" },
  cat:      { fur: "#ffd23f", dark: "#c99b14", face: "#fff3c9", ear: "tri", whisk: true },
  hedgehog: { fur: "#b98a5e", dark: "#6f4f2f", face: "#efdcc6", ear: "spike" },
  frog:     { fur: "#57e39b", dark: "#1f9d5c", face: "#bff6da", ear: "bump" },
};
const VILLAIN_LOOK = { fur: "#8a5cff", dark: "#4a2f9e", face: "#d8c8ff" };
const PERK_TEXT = {
  pow: "POW lädt schneller", combo: "mehr Punkte bei Clears",
  calm: "Bösewicht schiebt seltener", gap: "Bösewicht-Reihen mit mehr Lücken",
  charged: "startet mit halbem POW",
};
const HERO_NAME = { raccoon: "Waschbär", fox: "Fuchs", cat: "Katze", hedgehog: "Igel", frog: "Frosch" };
function heroId() { return GS.skins.currentId("wumms") || "raccoon"; }
function currentPerk() { return (GS.skins.get("wumms") || {}).perk || "pow"; }
GS.badges.define("wumms", [
  { id: "clean30",  icon: "🧹", name: "Aufräumer",        desc: "30 Reihen in einem Lauf abräumen", test: s => s.lines >= 30 },
  { id: "combo5",   icon: "🔥", name: "Combo-König",       desc: "Combo ×5 erreichen",             test: s => s.maxCombo >= 5 },
  { id: "ult5",     icon: "⚡", name: "Held im Einsatz",   desc: "5 Ultimates in einem Lauf",       test: s => s.ultimates >= 5 },
  { id: "villain10",icon: "😈", name: "Bösewicht-Schreck", desc: "10 Angriffe überstehen",         test: s => s.shoves >= 10 },
  { id: "score5k",  icon: "⭐", name: "Punktejäger",       desc: "5.000 Punkte erreichen",          test: s => s.score >= 5000 },
  { id: "score20k", icon: "👑", name: "Comic-Legende",     desc: "20.000 Punkte erreichen",         test: s => s.score >= 20000 },
]);

// ====================================================================
// Verdrahtung
// ====================================================================
document.getElementById("pow-btn").onclick = openUltimate;
document.getElementById("arm-cancel").onclick = cancelArm;
document.getElementById("hero").onclick = () => GS.skins.picker("wumms", { title: "Helden", onChange: updateHUD });
document.getElementById("btn-menu").onclick = () => { if (!over) { if (!confirm("Zurück zum Menü? Der aktuelle Lauf geht verloren.")) return; } startMenu(); };
document.getElementById("btn-board").onclick = () => GS.showLeaderboard({ game: "wumms", title: "Bestenliste", sub: "Die 50 besten Helden weltweit", daily: DAILY });
document.getElementById("btn-sound").onclick = () => { GS.sound.toggle(); GS.sound.click(); updateHUD(); };

let resizeTimer = null;
window.addEventListener("resize", () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(layout, 120); });
window.addEventListener("orientationchange", () => setTimeout(layout, 250));

GS.markPlayed("wumms");
layout();
reset();
requestAnimationFrame(frame);
if (DAILY) { document.getElementById("title").innerHTML = 'WUMMS<span class="bang">!</span>'; startGame(); }
else startMenu();
