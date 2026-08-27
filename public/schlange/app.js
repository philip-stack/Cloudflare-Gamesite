// ====================================================================
// NEON-SCHLANGE — Slither-Arena
//
// Große Welt mit Kamera & Minimap, KI-Gegner-Schlangen (abschneiden →
// sie zerfallen in Orbs), Power-ups (Magnet/Schild/×2/Geist). ZIEHEN
// lenkt, HALTEN/⚡ boostet. Score = gefressene Orbs.
// ====================================================================

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const stage = document.getElementById("stage");
const $ = sel => document.querySelector(sel);
const GS = window.GS;
const LOW = () => document.documentElement.hasAttribute("data-lowpower");

let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = stage.clientWidth; H = stage.clientHeight;
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
}
window.addEventListener("resize", resize);
resize();

// ---------- Tuning ----------
const WORLD = 2600;           // quadratische Weltgröße (px)
const SPEED = 205, BOOST_SPEED = 355;
const TURN = 4.6;
const SEG_GAP = 6;            // Render-Abtastung
const COLL_STEP = 12;         // Kollisions-Abtastung (gröber = schneller)
const BASE_LEN = 150, GROW = 24, BODY_W = 15, HEAD_R = 11;
const ORB_R = 7, EAT_R = HEAD_R + ORB_R + 3;
const HIT = BODY_W * 0.5 + 5; // Trefferradius Kopf-gegen-Körper
const BOOST_DRAIN = 90, BOOST_REGEN = 45;
const BOT_COUNT = 6, NORMAL_ORBS = 90, MAGNET_R = 130;
const rnd = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------- Skins ----------
GS.skins.define("schlange", [
  { id: "neon",    name: "Neongrün",     req: 0, swatch: ["#c6ffdf", "#28e07a", "#0b6"], colors: { a: "#c6ffdf", b: "#28e07a", glow: "40,224,122" } },
  { id: "cyan",    name: "Cyanpuls",     req: 3, swatch: ["#d6fbff", "#3ad8ff", "#0a9"], colors: { a: "#d6fbff", b: "#3ad8ff", glow: "58,216,255" } },
  { id: "magenta", name: "Magentablitz", req: 5, swatch: ["#ffe0f7", "#ff5bd0", "#a07"], colors: { a: "#ffe0f7", b: "#ff5bd0", glow: "255,91,208" } },
  { id: "gold",    name: "Goldschlange", req: 7, swatch: ["#fff3c4", "#f0cd6e", "#c93"], colors: { a: "#fff3c4", b: "#f0cd6e", glow: "240,205,110" } },
]);
let SKIN = GS.skins.get("schlange");
const BOT_SKINS = [
  { a: "#ffd1a8", b: "#ff8a3d", glow: "255,138,61" },
  { a: "#d7c8ff", b: "#9a6bff", glow: "154,107,255" },
  { a: "#ffc8d6", b: "#ff5b7a", glow: "255,91,122" },
  { a: "#cffff0", b: "#2ee0c0", glow: "46,224,192" },
  { a: "#fff3b0", b: "#ffd23a", glow: "255,210,58" },
  { a: "#c8e6ff", b: "#4aa8ff", glow: "74,168,255" },
];

// ---------- Zustand ----------
let mode = "ready";           // ready | run | dead
let player, bots, food, particles, clock, timeSec, respawnQ, cam, scale;
let target = null, pointerActive = false, turnDir = 0;
const boostHold = { pointer: false, btn: false, key: false };
let best = Number(localStorage.getItem("schlange_best") || 0);

const SPECIALS = [
  { type: "magnet", glyph: "🧲", dur: 8,  col: "#7fd8ff" },
  { type: "shield", glyph: "🛡️", dur: 14, col: "#8affc0" },
  { type: "x2",     glyph: "✖️", dur: 10, col: "#ffd23a" },
  { type: "ghost",  glyph: "👻", dur: 5,  col: "#d7c8ff" },
];

function makeSnake(x, y, heading, isPlayer, skin) {
  return {
    x, y, heading, isPlayer, skin, alive: true,
    points: [{ x, y }], bodyLenPx: BASE_LEN, boostSpent: 0, orbs: 0,
    segsR: [], segsC: [], kills: 0,
    ai: { retarget: 0, tx: x, ty: y }, boosting: false,
    eff: { magnet: 0, x2: 0, ghost: 0 }, shield: false,
  };
}

function reset() {
  clock = 0; timeSec = 0; particles = []; food = []; respawnQ = [];
  player = makeSnake(WORLD / 2, WORLD / 2, -Math.PI / 2, true, SKIN);
  bots = [];
  for (let i = 0; i < BOT_COUNT; i++) spawnBot();
  for (let i = 0; i < NORMAL_ORBS; i++) spawnFood();
  for (let i = 0; i < 3; i++) spawnFood(true);
  cam = { x: player.x, y: player.y }; scale = 1;
  updateHud();
}

function spawnBot() {
  const m = 120;
  const b = makeSnake(rnd(m, WORLD - m), rnd(m, WORLD - m), rnd(0, 6.28), false, BOT_SKINS[Math.floor(Math.random() * BOT_SKINS.length)]);
  b.orbs = Math.floor(rnd(5, 40)); b.bodyLenPx = BASE_LEN + b.orbs * GROW;
  bots.push(b);
}

function spawnFood(special) {
  const m = 30;
  const f = { x: rnd(m, WORLD - m), y: rnd(m, WORLD - m), hue: rnd(0, 360), t: Math.random() * 6.28, val: 1, type: "" };
  if (special) { const s = SPECIALS[Math.floor(Math.random() * SPECIALS.length)]; f.type = s.type; f.glyph = s.glyph; f.col = s.col; }
  food.push(f);
}

function startRun() {
  resize(); reset(); mode = "run";
  $("#boost").classList.remove("hidden");
  $("#hint").classList.remove("hidden");
  setTimeout(() => $("#hint") && $("#hint").classList.add("hidden"), 2800);
}

// ---------- Geometrie ----------
function pathLen(points) { let a = 0; for (let i = 1; i < points.length; i++) a += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y); return a; }
function trim(points, maxDist) { let a = 0; for (let i = 1; i < points.length; i++) { a += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y); if (a > maxDist) { points.length = i + 1; return; } } }
// Ein Durchlauf: Körperpunkte alle `step` px bis `maxLen` (Kopf zuerst).
function buildSegs(points, maxLen, step) {
  const out = [{ x: points[0].x, y: points[0].y }];
  let need = step, acc = 0;
  for (let i = 1; i < points.length && acc <= maxLen; i++) {
    const A = points[i - 1], B = points[i];
    const seg = Math.hypot(B.x - A.x, B.y - A.y) || 0.0001;
    while (acc + seg >= need && need <= maxLen) { const t = (need - acc) / seg; out.push({ x: A.x + (B.x - A.x) * t, y: A.y + (B.y - A.y) * t }); need += step; }
    acc += seg;
  }
  return out;
}
function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= 6.283185; while (d < -Math.PI) d += 6.283185; return d; }

// ---------- Bewegung ----------
function moveSnake(sn, dt, spd) {
  sn.x += Math.cos(sn.heading) * spd * dt;
  sn.y += Math.sin(sn.heading) * spd * dt;
  sn.points.unshift({ x: sn.x, y: sn.y });
  trim(sn.points, sn.bodyLenPx + SEG_GAP * 3);
}
function refreshSegs(sn) {
  const L = Math.min(sn.bodyLenPx, pathLen(sn.points));
  sn.segsR = buildSegs(sn.points, L, SEG_GAP);
  sn.segsC = buildSegs(sn.points, L, COLL_STEP);
}
// Kopf h {x,y} gegen Körper-Segmente; skip = wie viele vordere Segmente ignorieren.
function headHitsSegs(h, segs, skip, r2) {
  for (let i = skip; i < segs.length; i++) { const p = segs[i]; const dx = h.x - p.x, dy = h.y - p.y; if (dx * dx + dy * dy < r2) return true; }
  return false;
}

// ---------- KI ----------
function nearBody(x, y, segs, skip, r) { const r2 = r * r; for (let i = skip; i < segs.length; i++) { const dx = x - segs[i].x, dy = y - segs[i].y; if (dx * dx + dy * dy < r2) return true; } return false; }

function botThink(b, dt, allS) {
  // --- Ziel wählen: Orb bevorzugt VOR der Schlange (keine Kehrtwenden) ---
  b.ai.retarget -= dt;
  if (b.ai.retarget <= 0) {
    b.ai.retarget = rnd(0.9, 1.9);
    let pick = null, bs = -1e9;
    for (const f of food) {
      const dx = f.x - b.x, dy = f.y - b.y, d2 = dx * dx + dy * dy;
      if (d2 > 540 * 540) continue;
      const fwd = Math.cos(angDiff(b.heading, Math.atan2(dy, dx)));  // 1 = genau voraus
      const s = fwd * 1.6 - Math.sqrt(d2) / 540 + (f.type ? 0.5 : 0);
      if (s > bs) { bs = s; pick = f; }
    }
    if (pick) { b.ai.tx = pick.x; b.ai.ty = pick.y; }
    else { b.ai.tx = clamp(b.x + Math.cos(b.heading) * 320 + rnd(-160, 160), 120, WORLD - 120); b.ai.ty = clamp(b.y + Math.sin(b.heading) * 320 + rnd(-160, 160), 120, WORLD - 120); }
  }
  let desired = Math.atan2(b.ai.ty - b.y, b.ai.tx - b.x);

  // --- Ausweichen: Fühler nach vorn; blockiert → freie Richtung suchen ---
  const look = 78, wallPad = 46, selfSkip = 6, dr = HIT + 9;
  const blocked = ang => {
    const fx = b.x + Math.cos(ang) * look, fy = b.y + Math.sin(ang) * look;
    if (fx < wallPad || fx > WORLD - wallPad || fy < wallPad || fy > WORLD - wallPad) return true;
    if (nearBody(fx, fy, b.segsC, selfSkip, dr)) return true;            // eigener Körper
    for (const o of allS) { if (o === b) continue; if (nearBody(fx, fy, o.segsC, 0, dr)) return true; }
    return false;
  };
  if (blocked(desired)) {
    let found = false;
    for (const off of [0.35, -0.35, 0.7, -0.7, 1.05, -1.05, 1.5, -1.5, 2.0, -2.0, 2.6, -2.6]) {
      if (!blocked(b.heading + off)) { desired = b.heading + off; found = true; break; }
    }
    if (!found) desired = b.heading + 2.4;   // Panik-Wende
  }

  b.heading += clamp(angDiff(b.heading, desired), -TURN * 0.72 * dt, TURN * 0.72 * dt);
  b.boosting = false;
}

// ---------- Update ----------
function update(dt) {
  clock += dt; timeSec = clock;

  // --- Spieler lenken ---
  if (pointerActive && target) {
    const d = angDiff(player.heading, Math.atan2(target.y - player.y, target.x - player.x));
    player.heading += clamp(d, -TURN * dt, TURN * dt);
  } else if (turnDir) player.heading += turnDir * TURN * dt;

  const wantBoost = (boostHold.pointer || boostHold.btn || boostHold.key);
  player.boosting = wantBoost && player.bodyLenPx > BASE_LEN * 0.9;
  if (player.boosting) { player.boostSpent = Math.min(player.boostSpent + BOOST_DRAIN * dt, (BASE_LEN + player.orbs * GROW) * 0.4); if (!LOW()) burst(player.x, player.y, 1, SKIN.glow); }
  else player.boostSpent = Math.max(0, player.boostSpent - BOOST_REGEN * dt);
  player.bodyLenPx = Math.max(BASE_LEN * 0.9, BASE_LEN + player.orbs * GROW - player.boostSpent);
  moveSnake(player, dt, player.boosting ? BOOST_SPEED : SPEED);

  // --- Bots --- (Ausweichen nutzt die Segmente vom letzten Frame)
  const allS = [player, ...bots];
  for (const b of bots) { botThink(b, dt, allS); b.bodyLenPx = BASE_LEN + b.orbs * GROW; moveSnake(b, dt, SPEED); }

  // --- Segmente aller lebenden Schlangen ---
  refreshSegs(player);
  for (const b of bots) refreshSegs(b);

  // --- Effekte-Timer ---
  const eff = player.eff;
  const magnet = eff.magnet > clock, x2 = eff.x2 > clock, ghost = eff.ghost > clock;

  // --- Magnet: Orbs anziehen ---
  if (magnet) for (const f of food) { const dx = player.x - f.x, dy = player.y - f.y, d = Math.hypot(dx, dy); if (d < MAGNET_R && d > 1) { f.x += (dx / d) * 260 * dt; f.y += (dy / d) * 260 * dt; } }

  // --- Fressen: Spieler ---
  for (let i = food.length - 1; i >= 0; i--) {
    const f = food[i];
    if (Math.hypot(player.x - f.x, player.y - f.y) < EAT_R) {
      food.splice(i, 1);
      if (f.type) { activate(f.type); GS.sound.great(); burst(f.x, f.y, LOW() ? 6 : 16, "255,255,255"); }
      else { player.orbs += x2 ? 2 : 1; GS.sound.good(); burst(f.x, f.y, LOW() ? 4 : 10, SKIN.glow); GS.haptic(8); }
      updateHud();
    }
  }
  // --- Fressen: Bots (nur normale Orbs) ---
  for (const b of bots) for (let i = food.length - 1; i >= 0; i--) { const f = food[i]; if (!f.type && Math.hypot(b.x - f.x, b.y - f.y) < EAT_R) { food.splice(i, 1); b.orbs++; } }

  // Orb-Nachschub
  let normals = 0; for (const f of food) if (!f.type) normals++;
  while (normals < NORMAL_ORBS) { spawnFood(); normals++; }
  let specials = food.length - normals;
  if (specials < 3 && Math.random() < dt / 6) spawnFood(true);

  // --- Kollisionen ---
  const r2 = HIT * HIT;
  const selfSkip = sn => Math.ceil((HEAD_R * 2.4) / COLL_STEP) + 2;
  // Spieler
  const ph = { x: player.x, y: player.y };
  let playerDead = (player.x < HEAD_R || player.x > WORLD - HEAD_R || player.y < HEAD_R || player.y > WORLD - HEAD_R);
  if (!playerDead && !ghost) {
    if (headHitsSegs(ph, player.segsC, selfSkip(player), r2)) playerDead = true;
    if (!playerDead) for (const b of bots) if (headHitsSegs(ph, b.segsC, 0, r2)) { playerDead = true; break; }
  }
  if (playerDead) {
    if (player.shield) { player.shield = false; player.eff.shieldFlash = clock + 0.4; }
    else return die();
  }
  // Bots
  for (const b of bots) {
    if (!b.alive) continue;
    const bh = { x: b.x, y: b.y };
    let dead = (b.x < HEAD_R || b.x > WORLD - HEAD_R || b.y < HEAD_R || b.y > WORLD - HEAD_R);
    if (!dead && headHitsSegs(bh, b.segsC, selfSkip(b), r2)) dead = true;
    if (!dead && headHitsSegs(bh, player.segsC, 0, r2)) { dead = true; player.kills++; }  // Bot rennt in Spieler → Kill
    if (!dead) for (const o of bots) { if (o === b || !o.alive) continue; if (headHitsSegs(bh, o.segsC, 0, r2)) { dead = true; break; } }
    if (dead) killBot(b);
  }
  bots = bots.filter(b => b.alive);
  // Respawn nach kurzer Zeit
  for (let i = respawnQ.length - 1; i >= 0; i--) { respawnQ[i] -= dt; if (respawnQ[i] <= 0) { respawnQ.splice(i, 1); spawnBot(); } }
  while (bots.length + respawnQ.length < BOT_COUNT) respawnQ.push(rnd(2, 5));

  // Partikel
  for (let i = particles.length - 1; i >= 0; i--) { const p = particles[i]; p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; p.vx *= 0.92; p.vy *= 0.92; if (p.life <= 0) particles.splice(i, 1); }
  for (const f of food) f.t += dt * 3;

  // Kamera & Zoom
  cam.x += (player.x - cam.x) * Math.min(1, dt * 8);
  cam.y += (player.y - cam.y) * Math.min(1, dt * 8);
  const span = clamp(560 + player.orbs * 5, 560, 1100);
  scale = Math.min(W, H) / span;
}

function activate(type) {
  const s = SPECIALS.find(s => s.type === type);
  if (type === "shield") player.shield = true;
  else player.eff[type] = clock + (s ? s.dur : 8);
}

function killBot(b) {
  b.alive = false;
  burst(b.x, b.y, LOW() ? 12 : 26, b.skin.glow);
  // Körper zerfällt in Orbs
  const step = 22, drop = b.segsR;
  for (let i = 0; i < drop.length; i += Math.max(1, Math.round(step / SEG_GAP))) {
    if (food.filter(f => !f.type).length > NORMAL_ORBS + 200) break;
    food.push({ x: drop[i].x + rnd(-6, 6), y: drop[i].y + rnd(-6, 6), hue: rnd(90, 160), t: Math.random() * 6.28, val: 1, type: "" });
  }
}

function burst(x, y, n, glow) { for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, s = rnd(40, 220); particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(0.3, 0.7), max: 0.7, glow }); } }

function die() {
  if (mode !== "run") return;
  mode = "dead";
  burst(player.x, player.y, LOW() ? 16 : 46, SKIN.glow);
  GS.sound.lose(); GS.haptic(70);
  $("#boost").classList.add("hidden");
  setTimeout(gameOver, 520);
}

// ---------- Render ----------
function drawSnake(sn, isPlayer) {
  const segs = sn.segsR, sk = sn.skin;
  if (segs.length > 1) {
    const dp = () => { ctx.beginPath(); ctx.moveTo(segs[0].x, segs[0].y); for (let i = 1; i < segs.length; i++) ctx.lineTo(segs[i].x, segs[i].y); };
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    if (!LOW()) { ctx.save(); ctx.strokeStyle = `rgba(${sk.glow},0.42)`; ctx.lineWidth = BODY_W + 10; ctx.shadowBlur = 16; ctx.shadowColor = `rgba(${sk.glow},0.9)`; dp(); ctx.stroke(); ctx.restore(); }
    ctx.strokeStyle = sk.b; ctx.lineWidth = BODY_W; dp(); ctx.stroke();
    ctx.strokeStyle = sk.a; ctx.lineWidth = BODY_W * 0.42; ctx.globalAlpha = 0.75; dp(); ctx.stroke(); ctx.globalAlpha = 1;
  }
  // Kopf
  const shieldOn = isPlayer && player.shield;
  ctx.save();
  ctx.shadowBlur = LOW() ? 0 : 16; ctx.shadowColor = `rgba(${sk.glow},0.95)`;
  ctx.fillStyle = sk.a; ctx.beginPath(); ctx.arc(sn.x, sn.y, HEAD_R, 0, 6.2832); ctx.fill();
  ctx.restore();
  if (shieldOn) { ctx.strokeStyle = "rgba(140,255,200,0.9)"; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(sn.x, sn.y, HEAD_R + 5, 0, 6.2832); ctx.stroke(); }
  const nx = Math.cos(sn.heading), ny = Math.sin(sn.heading), px = -ny, py = nx;
  for (const s of [-1, 1]) { const ex = sn.x + nx * 4 + px * s * 5, ey = sn.y + ny * 4 + py * s * 5; ctx.fillStyle = "#05130b"; ctx.beginPath(); ctx.arc(ex, ey, 2.6, 0, 6.2832); ctx.fill(); }
}

function render() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(W / 2, H / 2); ctx.scale(scale, scale); ctx.translate(-cam.x, -cam.y);

  const vx0 = cam.x - (W / 2) / scale, vy0 = cam.y - (H / 2) / scale, vx1 = cam.x + (W / 2) / scale, vy1 = cam.y + (H / 2) / scale;

  // Gitter (nur sichtbarer Bereich)
  ctx.strokeStyle = "rgba(120,200,160,0.06)"; ctx.lineWidth = 1 / scale;
  const g = 80;
  for (let x = Math.floor(vx0 / g) * g; x < vx1; x += g) { if (x < 0 || x > WORLD) continue; ctx.beginPath(); ctx.moveTo(x, Math.max(0, vy0)); ctx.lineTo(x, Math.min(WORLD, vy1)); ctx.stroke(); }
  for (let y = Math.floor(vy0 / g) * g; y < vy1; y += g) { if (y < 0 || y > WORLD) continue; ctx.beginPath(); ctx.moveTo(Math.max(0, vx0), y); ctx.lineTo(Math.min(WORLD, vx1), y); ctx.stroke(); }

  // Weltrand
  ctx.strokeStyle = `rgba(${SKIN.glow},0.55)`; ctx.lineWidth = 4 / scale;
  ctx.save(); ctx.shadowBlur = LOW() ? 0 : 16; ctx.shadowColor = `rgba(${SKIN.glow},0.7)`; ctx.strokeRect(0, 0, WORLD, WORLD); ctx.restore();

  // Orbs (sichtbar)
  const pad = 30;
  for (const f of food) {
    if (f.x < vx0 - pad || f.x > vx1 + pad || f.y < vy0 - pad || f.y > vy1 + pad) continue;
    const pulse = 1 + Math.sin(f.t) * 0.18;
    if (f.type) {
      ctx.save(); ctx.shadowBlur = LOW() ? 0 : 16; ctx.shadowColor = f.col;
      ctx.fillStyle = f.col; ctx.beginPath(); ctx.arc(f.x, f.y, ORB_R * 1.6 * pulse, 0, 6.2832); ctx.fill(); ctx.restore();
      ctx.font = `${Math.round(ORB_R * 2)}px system-ui`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText(f.glyph, f.x, f.y + 1);
    } else {
      ctx.save(); ctx.shadowBlur = LOW() ? 0 : 12; ctx.shadowColor = `hsl(${f.hue},90%,60%)`;
      ctx.fillStyle = `hsl(${f.hue},90%,62%)`; ctx.beginPath(); ctx.arc(f.x, f.y, ORB_R * pulse, 0, 6.2832); ctx.fill(); ctx.restore();
    }
  }

  // Bots, dann Spieler oben
  if (mode !== "ready") { for (const b of bots) drawSnake(b, false); drawSnake(player, true); }

  // Partikel
  for (const p of particles) { ctx.globalAlpha = Math.max(0, p.life / p.max); ctx.fillStyle = `rgba(${p.glow},1)`; ctx.beginPath(); ctx.arc(p.x, p.y, 2.6, 0, 6.2832); ctx.fill(); }
  ctx.globalAlpha = 1;
  ctx.restore();

  drawMinimap();
  drawEffects();
}

function drawMinimap() {
  if (mode === "ready") return;
  const s = 92, m = 10, x0 = W - s - m, y0 = m, k = s / WORLD;
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = "rgba(6,14,10,0.72)"; ctx.strokeStyle = `rgba(${SKIN.glow},0.5)`; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x0, y0, s, s, 8) : ctx.rect(x0, y0, s, s); ctx.fill(); ctx.stroke();
  for (const b of bots) { ctx.fillStyle = `rgb(${b.skin.glow})`; ctx.beginPath(); ctx.arc(x0 + b.x * k, y0 + b.y * k, 1.8, 0, 6.2832); ctx.fill(); }
  ctx.fillStyle = "#eafff1"; ctx.beginPath(); ctx.arc(x0 + player.x * k, y0 + player.y * k, 2.8, 0, 6.2832); ctx.fill();
  ctx.restore();
}

function drawEffects() {
  if (mode === "ready") return;
  const items = [];
  if (player.shield) items.push(["🛡️", 1]);
  for (const t of ["magnet", "x2", "ghost"]) { const left = player.eff[t] - clock; if (left > 0) { const s = SPECIALS.find(s => s.type === t); items.push([s.glyph, left / s.dur]); } }
  ctx.save(); ctx.textAlign = "left"; ctx.textBaseline = "middle";
  let y = 14;
  for (const [g, frac] of items) {
    ctx.font = "16px system-ui"; ctx.fillText(g, 12, y + 8);
    ctx.fillStyle = "rgba(255,255,255,0.25)"; ctx.fillRect(34, y + 4, 40, 5);
    ctx.fillStyle = `rgba(${SKIN.glow},0.95)`; ctx.fillRect(34, y + 4, 40 * clamp(frac, 0, 1), 5);
    y += 22;
  }
  ctx.restore();
}

// ---------- Schleife ----------
let lastT = 0;
function frame(t) {
  const dt = lastT ? Math.min(0.033, (t - lastT) / 1000) : 0;
  lastT = t;
  if (mode === "run") update(dt);
  render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

function updateHud() {
  $("#hud-orbs").textContent = player ? player.orbs : 0;
  $("#hud-len").textContent = player ? 1 + player.orbs : 1;
  $("#hud-best").textContent = best;
}

// ---------- Steuerung ----------
function setTarget(e) {
  const r = canvas.getBoundingClientRect();
  const sx = e.clientX - r.left, sy = e.clientY - r.top;
  target = { x: cam.x + (sx - W / 2) / scale, y: cam.y + (sy - H / 2) / scale };
  pointerActive = true;
}
stage.addEventListener("pointermove", e => { if (mode === "run") setTarget(e); });
stage.addEventListener("pointerdown", e => { if (e.target && e.target.id === "boost") return; if (mode === "run") { setTarget(e); if (e.pointerType === "mouse") boostHold.pointer = true; } });
window.addEventListener("pointerup", () => { boostHold.pointer = false; });

const boostBtn = $("#boost");
const bOn = e => { e.preventDefault(); boostHold.btn = true; };
const bOff = () => { boostHold.btn = false; };
boostBtn.addEventListener("pointerdown", bOn);
boostBtn.addEventListener("pointerup", bOff);
boostBtn.addEventListener("pointercancel", bOff);
boostBtn.addEventListener("pointerleave", bOff);

window.addEventListener("keydown", e => {
  if (["ArrowLeft", "a", "A"].includes(e.key)) { turnDir = -1; pointerActive = false; }
  else if (["ArrowRight", "d", "D"].includes(e.key)) { turnDir = 1; pointerActive = false; }
  else if ([" ", "ArrowUp", "w", "W"].includes(e.key)) { boostHold.key = true; e.preventDefault(); }
});
window.addEventListener("keyup", e => {
  if (["ArrowLeft", "a", "A", "ArrowRight", "d", "D"].includes(e.key)) turnDir = 0;
  else if ([" ", "ArrowUp", "w", "W"].includes(e.key)) boostHold.key = false;
});
document.addEventListener("visibilitychange", () => { if (document.hidden) { boostHold.pointer = boostHold.btn = boostHold.key = false; lastT = 0; } });

// ---------- Game-Over ----------
async function gameOver() {
  const score = player.orbs, tSec = Math.round(timeSec), kills = player.kills;
  const newBadges = GS.badges.record("schlange", { orbs: score, time: tSec, len: 1 + score, kills });
  const isRecord = score > best && score > 0;
  if (isRecord) { best = score; try { localStorage.setItem("schlange_best", best); } catch (_) {} GS.sound.win(); }

  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="panel">
      <h2>${isRecord ? "Neuer Rekord!" : "Gebissen!"}</h2>
      <div class="go-score">${score}</div>
      ${isRecord ? `<div class="go-best-badge">👑 Persönliche Bestleistung</div>` : `<div class="sub">Rekord: ${best}</div>`}
      <div class="go-stats"><span>🟢 ${score} Orbs</span><span>📏 Länge ${1 + score}</span><span>⚔️ ${kills} Kills</span><span>⏱️ ${tSec}s</span></div>
      ${GS.badges.chipsHtml(newBadges)}
      <div class="go-rank" id="go-rank"></div>
      <div id="go-name-area"></div>
      <button class="btn-primary" id="go-again">🐍 Nochmal</button>
      <button class="btn-secondary" id="go-top">🏆 Bestenliste</button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#go-again").onclick = () => { overlay.remove(); startRun(); };
  overlay.querySelector("#go-top").onclick = () => showLeaderboard();
  const panel = overlay.querySelector(".panel");
  const addBtn = (label, fn) => { const b = document.createElement("button"); b.className = "btn-secondary"; b.style.marginTop = "10px"; b.textContent = label; b.onclick = fn; panel.appendChild(b); return b; };
  addBtn("🏅 Meilensteine", () => GS.badges.show("schlange", "Meilensteine — Neon-Schlange"));
  addBtn("🎨 Skins", () => GS.skins.picker("schlange", { title: "Schlangen-Skins", onChange: c => { SKIN = c; if (player) player.skin = c; } }));
  const sb = addBtn("📤 Teilen", async () => {
    const r = await GS.shareCard({ title: "Neon-Schlange", emoji: "🐍", accent: "#57e39b", big: score, subtitle: `${score} Orbs · ${kills} Gegner`, url: GS.duelLink("schlange", score), text: `Ich hab bei Neon-Schlange 🐍 ${score} Orbs gefressen und ${kills} Gegner erwischt — schlag mich!` });
    if (r === "copied" || r === "downloaded") sb.textContent = "✔ geteilt";
  });
  GS.scoreFlow(overlay.querySelector("#go-name-area"), overlay.querySelector("#go-rank"), { game: "schlange", score, meta: { orbs: score, time: tSec, len: 1 + score, kills } });
}

function showLeaderboard() { GS.showLeaderboard({ game: "schlange", sub: "Die 50 längsten Schlangen weltweit", tabs: true }); }

// ---------- Start ----------
function showStart() {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="panel">
      <h2><span class="foil">Neon-Schlange</span></h2>
      <p class="sub"><b>Ziehen</b> lenkt, <b>Halten/⚡</b> boostet.<br>
        Friss <b>Orbs</b> & wachse. Schneide <b>Gegner</b> ab (ihr Kopf in deinen Körper) — sie zerfallen in Orbs!<br>
        Sammle <b>Power-ups</b> 🧲🛡️✖️👻. Beiß dich nicht selbst.</p>
      <button class="btn-primary" id="st-go">🐍 Los!</button>
      ${GS.getName() ? "" : `<p class="sub" style="margin-top:8px">Tipp: Nach der ersten Runde fragen wir einmal nach deinem Namen für die Bestenliste.</p>`}
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#st-go").onclick = () => { overlay.remove(); startRun(); };
}

// ---------- UI ----------
$("#btn-top").onclick = () => showLeaderboard();
const soundBtn = $("#btn-sound");
soundBtn.textContent = GS.sound.on() ? "🔊" : "🔇";
soundBtn.onclick = () => { soundBtn.textContent = GS.sound.toggle() ? "🔊" : "🔇"; };

GS.markPlayed("schlange");
reset(); mode = "ready";
if (new URLSearchParams(location.search).has("auto")) startRun();
else {
  showStart();
  GS.onboard("schlange", {
    title: "Neon-Schlange — so geht's",
    steps: [
      { icon: "👆", text: "Ziehen mit Finger/Maus lenkt deine Schlange." },
      { icon: "⚡", text: "Halten bzw. der ⚡-Knopf gibt Boost." },
      { icon: "🟢", text: "Friss Orbs, um zu wachsen und Punkte zu sammeln." },
      { icon: "⚔️", text: "Schneide Gegner ab — laufen sie in dich, zerfallen sie in Orbs." },
      { icon: "🧲", text: "Power-ups: Magnet, Schild, ×2-Punkte, Geist." },
    ],
  });
}

// ---------- Meilensteine ----------
GS.badges.define("schlange", [
  { id: "o25",    icon: "🟢", name: "Häppchen",           desc: "25 Orbs in einer Runde",   test: s => s.orbs >= 25 },
  { id: "o60",    icon: "🐍", name: "Schlängler",         desc: "60 Orbs in einer Runde",   test: s => s.orbs >= 60 },
  { id: "o120",   icon: "🌟", name: "Riesenschlange",     desc: "120 Orbs in einer Runde",  test: s => s.orbs >= 120 },
  { id: "k1",     icon: "⚔️", name: "Erster Biss",        desc: "1 Gegner erwischt",        test: s => s.kills >= 1 },
  { id: "k5",     icon: "🗡️", name: "Jäger",              desc: "5 Gegner in einer Runde",  test: s => s.kills >= 5 },
  { id: "t120",   icon: "⏱️", name: "Ausdauernd",         desc: "120 s am Stück überlebt",  test: s => s.time >= 120 },
  { id: "sum500", icon: "🍽️", name: "Vielfraß",           desc: "500 Orbs insgesamt",       test: (s, t) => t.sum_orbs >= 500 },
  { id: "runs25", icon: "🎖️", name: "Stammgast",          desc: "25 Runden gespielt",       test: (s, t) => t.runs >= 25 },
]);
