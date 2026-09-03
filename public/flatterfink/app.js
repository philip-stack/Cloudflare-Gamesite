// ====================================================================
// FLATTERFINK — One-Touch-Flatter-Arcade (flappy-artig)
//
// Du bist ein Stieglitz. TIPPEN = einmal flattern (Auftrieb), sonst
// zieht dich die Schwerkraft nach unten. Flieg durch die Lücken in den
// Hecken, sammle Körndl (🌾), stoß nirgends an. Je weiter, desto enger
// und schneller. Score = Tore × 10 + Körndl × 5.
// ====================================================================

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const stage = document.getElementById("stage");
const $ = sel => document.querySelector(sel);

let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = stage.clientWidth;
  H = stage.clientHeight;
  canvas.width = Math.round(W * DPR);
  canvas.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener("resize", resize);
resize();

// ---------- Tuning ----------
const GRAV = 1500;           // Schwerkraft px/s²
const FLAP = -430;           // Auftrieb pro Tipp
const MAX_FALL = 720;        // maximale Fallgeschwindigkeit
const OBST_W = 62;           // Heckenbreite
const SPACING = 215;         // Abstand der Hecken (px)
const BIRD_R = 15;           // Trefferradius des Finken

// ---------- Zustand ----------
let mode = "ready";          // ready | run | dead
let birdY, birdVY, birdX, wingT, tilt;
let obst = [], parts = [], clouds = [];
let scrollT = 0;             // Weltbewegung (für Boden/Parallaxe)
let tore = 0, korn = 0;
let groundH = 0;
let shakeT = 0, deathAt = 0;
let deadSpin = 0, deadSpinV = 0;   // Eigendrehung beim Abtaumeln
let deadLanded = false;            // am Boden zerplatzt → keine Physik/Zeichnung mehr
let overTimer = null, overShown = false;
let paused = false;                // Pause bei App-Wechsel (visibilitychange)
let hintTimer = null;
let best = Number(localStorage.getItem("ff_best") || 0);
let submitted = false;

// ---------- Skins (über Meilensteine freispielbar) ----------
// Färbt Körper, Bauch und Flügel des Finken.
GS.skins.define("flatterfink", [
  { id: "stieglitz", name: "Stieglitz", req: 0, swatch: ["#ffd23f", "#ff7a4d", "#3a3a44"],
    colors: { body: "#ffd23f", belly: "#fff3c4", wing: "#3a3a44", beak: "#ff9f45", face: "#ff5b4d" } },
  { id: "blaumeise", name: "Blaumeise", req: 3, swatch: ["#5bb8ff", "#fff3c4", "#2a5fb0"],
    colors: { body: "#5bb8ff", belly: "#fff8e0", wing: "#2a5fb0", beak: "#3a3a44", face: "#1a3a6a" } },
  { id: "rotkehlchen", name: "Rotkehlchen", req: 5, swatch: ["#ff8a4d", "#c68a5a", "#7a4a2a"],
    colors: { body: "#c68a5a", belly: "#ffd0a0", wing: "#7a4a2a", beak: "#3a3a44", face: "#ff6a3a" } },
  { id: "gimpel", name: "Gimpel", req: 7, swatch: ["#ff5b6a", "#5a5a66", "#2a2a30"],
    colors: { body: "#5a5a66", belly: "#ff5b6a", wing: "#2a2a30", beak: "#3a3a44", face: "#3a3a44" } },
]);
let SKIN = GS.skins.get("flatterfink");

$("#hud-best").textContent = best;

// ---------- Welt ----------
function speed() { return 175 + Math.min(tore, 42) * 3.3; }          // 175 → ~314 px/s
function gapH() { return H * (0.37 - Math.min(tore, 42) / 42 * 0.13); } // 0.37 H → 0.24 H

function spawnObstacle(x) {
  const g = gapH();
  const margin = 24;
  const lo = g / 2 + margin;
  const hi = H - groundH - g / 2 - margin;
  const gapY = lo + Math.random() * Math.max(10, hi - lo);
  // ~45 % der Lücken tragen ein Körndl in der Mitte
  const korndl = Math.random() < 0.45 ? { x: x + OBST_W / 2, y: gapY, got: false, ph: Math.random() * Math.PI * 2 } : null;
  // Lückenhöhe HIER einfrieren: Hecken entstehen weit rechts außerhalb des
  // Bildes, darum bleibt die Schwierigkeits-Steigerung für Spieler:innen
  // unsichtbar. Eine bereits sichtbare Hecke ändert sich nie mehr.
  obst.push({ x, gapY, gap: g, passed: false, korndl });
}

function topUpObstacles() {
  let rightmost = -Infinity;
  for (const o of obst) rightmost = Math.max(rightmost, o.x);
  if (obst.length === 0) rightmost = W + 40;
  while (rightmost < W + SPACING) { rightmost += SPACING; spawnObstacle(rightmost); }
}

// ---------- Spielsteuerung ----------
function reset() {
  resize();
  groundH = Math.max(28, H * 0.07);
  birdX = W * 0.28;
  birdY = H * 0.42;
  birdVY = 0;
  wingT = 0; tilt = 0;
  deadSpin = 0; deadSpinV = 0; deadLanded = false; paused = false;
  clearTimeout(overTimer); overShown = false;
  obst = []; parts = [];
  tore = 0; korn = 0;
  scrollT = 0;
  submitted = false;
  clouds = Array.from({ length: 5 }, () => ({
    x: Math.random() * W, y: Math.random() * H * 0.5, r: 26 + Math.random() * 34, s: 0.12 + Math.random() * 0.18,
  }));
  topUpObstacles();
  updateHud();
}

function startRun() {
  reset();
  mode = "run";
  birdVY = FLAP * 0.6;
  showHint("TIPPEN = flattern", 3500);
}

// Einblend-Text unten; Start-Tipp und Pause-Hinweis teilen sich das Element.
// ms = 0 → bleibt stehen, bis aktiv versteckt.
function showHint(text, ms) {
  const h = $("#hint"); if (!h) return;
  clearTimeout(hintTimer);
  h.textContent = text;
  h.classList.remove("hidden");
  if (ms) hintTimer = setTimeout(() => h.classList.add("hidden"), ms);
}
function hideHint() {
  clearTimeout(hintTimer);
  const h = $("#hint"); if (h) h.classList.add("hidden");
}

// ---------- Pause bei App-Wechsel ----------
// Wechselt man mitten im Lauf die App (Anruf o. Ä.), landet man bei der
// Rückkehr sonst ohne Vorwarnung mitten im Flug. Darum anhalten und erst
// auf Tippen weiterspielen.
function pauseGame() {
  if (mode !== "run" || paused) return;
  paused = true;
  showHint("PAUSE — tippen zum Weiterspielen", 0);
}
function resumeGame() {
  if (!paused) return;
  paused = false;
  hideHint();
  last = performance.now();   // verhindert ein Riesen-dt nach der Pause
}
document.addEventListener("visibilitychange", () => { if (document.hidden) pauseGame(); });

function flap() {
  if (mode !== "run" || paused) return;
  birdVY = FLAP;
  wingT = 1;
  sound.flap();
  burst(birdX - 6, birdY + 6, "rgba(255,255,255,0.7)", 4, 90);
  if (navigator.vibrate) navigator.vibrate(7);
}

// ---------- Physik ----------
function circleHitsRect(cx, cy, r, rx, ry, rw, rh) {
  const nx = Math.max(rx, Math.min(cx, rx + rw));
  const ny = Math.max(ry, Math.min(cy, ry + rh));
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

function step(dt) {
  scrollT += speed() * dt;

  birdVY += GRAV * dt;
  if (birdVY > MAX_FALL) birdVY = MAX_FALL;
  birdY += birdVY * dt;
  tilt = Math.max(-0.5, Math.min(1.1, birdVY / 620));
  wingT = Math.max(0, wingT - dt * 6);

  // Decke: sanft abprallen
  if (birdY < BIRD_R) { birdY = BIRD_R; if (birdVY < 0) birdVY *= -0.3; }

  // Hecken bewegen, Tore & Körndl werten, Kollision
  const dx = speed() * dt;
  for (const o of obst) {
    o.x -= dx;
    if (o.korndl) o.korndl.x -= dx;

    // Tor passiert?
    if (!o.passed && o.x + OBST_W < birdX) {
      o.passed = true;
      tore++;
      sound.gate(Math.min(tore, 12));
      burst(birdX + 10, birdY, "rgba(255,210,63,0.9)", 6, 120);
    }
    // Körndl einsammeln
    if (o.korndl && !o.korndl.got && Math.hypot(o.korndl.x - birdX, o.korndl.y - birdY) < BIRD_R + 12) {
      o.korndl.got = true;
      korn++;
      sound.korn(Math.min(korn % 8, 7));
      burst(o.korndl.x, o.korndl.y, "#ffe08a", 9, 150);
      if (navigator.vibrate) navigator.vibrate(5);
    }
    // Kollision mit oberer/unterer Hecke — feste Lücke DIESER Hecke
    const g = o.gap;
    if (mode === "run" &&
      (circleHitsRect(birdX, birdY, BIRD_R, o.x, 0, OBST_W, o.gapY - g / 2) ||
        circleHitsRect(birdX, birdY, BIRD_R, o.x, o.gapY + g / 2, OBST_W, H))) {
      die();
      return;
    }
  }
  obst = obst.filter(o => o.x > -OBST_W - 4);
  topUpObstacles();

  // Wolken
  for (const c of clouds) {
    c.x -= speed() * c.s * dt;
    if (c.x < -c.r * 3) { c.x = W + c.r * 2; c.y = Math.random() * H * 0.5; }
  }

  // Boden berührt = Aus
  if (birdY > H - groundH - BIRD_R) { birdY = H - groundH - BIRD_R; die(); return; }

  updateHud();
}

function die() {
  if (mode !== "run") return;
  mode = "dead";
  deathAt = performance.now();
  hideHint();
  // Abtaumeln: kurzer Aufwärts-Hüpfer, dann Sturz mit Eigendrehung —
  // am Boden zerplatzt er dann in Federn (siehe splat()).
  birdVY = -250;
  deadSpin = tilt;
  deadSpinV = (6.5 + Math.random() * 3) * (Math.random() < 0.5 ? -1 : 1);
  burst(birdX, birdY, "#ffd23f", 26, 260);
  shakeT = 0.5;
  sound.dead();
  if (navigator.vibrate) navigator.vibrate([60, 40, 80]);
  deadLanded = false;
  clearTimeout(overTimer);
  overTimer = setTimeout(gameOver, 1400);   // Notbremse, falls der Sturz lang dauert
}

// Todes-Physik: der Fink fällt weiter und dreht sich, die Welt steht still.
function stepDead(dt) {
  if (deadLanded) return;                  // schon zerplatzt → nichts mehr rechnen
  birdVY = Math.min(MAX_FALL, birdVY + GRAV * dt);
  birdY += birdVY * dt;
  deadSpin += deadSpinV * dt;
  const floor = H - groundH - BIRD_R;
  if (birdY >= floor) {                    // Boden erreicht → zerplatzen, NICHT hüpfen
    birdY = floor;
    splat();
    clearTimeout(overTimer);
    overTimer = setTimeout(gameOver, 430); // kurz die Federn sehen lassen
  }
}

// Aufprall am Boden: der Fink zerplatzt in Federn seines Federkleids plus
// eine flache Staubwolke. Bewusst KEIN Abprallen — das wirkte wie ein Gummiball.
function splat() {
  deadLanded = true;
  const gy = H - groundH;
  const cols = [SKIN.body, SKIN.belly, SKIN.wing];
  for (let i = 0; i < 26; i++) {                       // Federn nach oben/außen
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.3;
    const v = 90 + Math.random() * 260;
    parts.push({ x: birdX, y: gy - 6, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      life: 0.6 + Math.random() * 0.6, t: 0, color: cols[i % cols.length] });
  }
  for (let i = 0; i < 14; i++) {                       // Staub flach am Boden
    const dir = Math.random() < 0.5 ? -1 : 1;
    parts.push({ x: birdX, y: gy - 3, vx: dir * (60 + Math.random() * 190), vy: -20 - Math.random() * 50,
      life: 0.4 + Math.random() * 0.4, t: 0, color: "rgba(214,204,172,0.9)" });
  }
  shakeT = 0.55;
  sound.splat();
  if (navigator.vibrate) navigator.vibrate([40, 30, 90]);
}

function updateHud() {
  $("#hud-tore").textContent = tore;
  $("#hud-korn").textContent = "🌾 " + korn;
  $("#hud-best").textContent = best;
}

// ---------- Partikel ----------
function burst(x, y, color, n, spread) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = 40 + Math.random() * (spread || 200);
    parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, life: 0.4 + Math.random() * 0.5, t: 0, color });
  }
}

// ---------- Rendering ----------
function draw(now) {
  ctx.clearRect(0, 0, W, H);
  let ox = 0, oy = 0;
  if (shakeT > 0) { ox = (Math.random() - 0.5) * 12 * shakeT; oy = (Math.random() - 0.5) * 12 * shakeT; }
  ctx.save();
  ctx.translate(ox, oy);

  // Himmel (Farbverlauf ist im CSS am #stage; hier nur Sonne + Wolken + Hügel)
  const sunX = W * 0.8, sunY = H * 0.18;
  const sun = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, 90);
  sun.addColorStop(0, "rgba(255,240,190,0.9)");
  sun.addColorStop(1, "rgba(255,240,190,0)");
  ctx.fillStyle = sun;
  ctx.fillRect(sunX - 100, sunY - 100, 200, 200);

  // Wolken
  for (const c of clouds) {
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.beginPath();
    ctx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
    ctx.arc(c.x + c.r * 0.9, c.y + 5, c.r * 0.7, 0, Math.PI * 2);
    ctx.arc(c.x - c.r * 0.9, c.y + 6, c.r * 0.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // Ferne Hügel (Parallaxe)
  const hillOff = (scrollT * 0.25) % (W * 0.6);
  ctx.fillStyle = "rgba(70,140,90,0.35)";
  for (let i = -1; i < 4; i++) {
    const bx = i * W * 0.6 - hillOff;
    ctx.beginPath();
    ctx.moveTo(bx, H - groundH);
    ctx.quadraticCurveTo(bx + W * 0.3, H - groundH - H * 0.18, bx + W * 0.6, H - groundH);
    ctx.fill();
  }

  // Hecken (Röhren) — jede zeichnet ihre eigene, fest eingefrorene Lücke
  for (const o of obst) {
    if (o.x > W + 4 || o.x < -OBST_W - 4) continue;
    const g = o.gap;
    drawHedge(o.x, 0, OBST_W, o.gapY - g / 2, true);
    drawHedge(o.x, o.gapY + g / 2, OBST_W, H - (o.gapY + g / 2), false);
    // Körndl (gezeichnet statt Emoji → auf allen Geräten klar sichtbar)
    if (o.korndl && !o.korndl.got) {
      const s = o.korndl;
      drawKorndl(s.x, s.y + Math.sin(now / 300 + s.ph) * 3);
    }
  }

  // Boden
  ctx.fillStyle = "#6a9a4a";
  ctx.fillRect(0, H - groundH, W, groundH);
  ctx.fillStyle = "rgba(0,0,0,0.14)";
  ctx.fillRect(0, H - groundH, W, 4);
  // Grasstreifen (scrollt)
  ctx.fillStyle = "rgba(255,255,255,0.10)";
  const go = scrollT % 26;
  for (let x = -go; x < W; x += 26) ctx.fillRect(x, H - groundH + 6, 12, 3);

  // Fink
  if (mode !== "ready" && !deadLanded) drawBird(now);   // beim Taumeln sichtbar, nach dem Zerplatzen weg

  // Partikel
  for (const p of parts) {
    const f = 1 - p.t / p.life;
    ctx.globalAlpha = f;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function drawKorndl(x, y) {
  ctx.save();
  ctx.translate(x, y);
  // Warmes Glühen — hebt das Korn deutlich vom Himmel ab
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, 22);
  glow.addColorStop(0, "rgba(255,190,40,0.6)");
  glow.addColorStop(1, "rgba(255,190,40,0)");
  ctx.fillStyle = glow;
  ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fill();
  // Korn: goldener Samen mit dunkler Kontur (leicht gekippt)
  ctx.rotate(-0.5);
  const g = ctx.createLinearGradient(-8, -10, 8, 10);
  g.addColorStop(0, "#fff0b0");
  g.addColorStop(0.5, "#ffc233");
  g.addColorStop(1, "#e0870f");
  ctx.fillStyle = g;
  ctx.strokeStyle = "#6b3d10";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(0, 0, 7.5, 11.5, 0, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  // Mittelrille (Samen-Detail)
  ctx.strokeStyle = "rgba(107,61,16,0.65)";
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(0, -8.5); ctx.lineTo(0, 8.5); ctx.stroke();
  // Glanzpunkt
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.beginPath(); ctx.ellipse(-2.6, -4.5, 1.7, 2.8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawHedge(x, y, w, h, top) {
  if (h <= 0) return;
  const r = 10;
  ctx.save();
  // Heckenform: nur die zur Lücke zeigende Kante ist abgerundet.
  ctx.beginPath();
  if (top) {
    ctx.moveTo(x, y);
    ctx.lineTo(x + w, y);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  } else {
    ctx.moveTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h);
    ctx.lineTo(x, y + h);
  }
  ctx.closePath();
  // WICHTIG: alles Folgende auf die Heckenform beschneiden. Sonst ragt die
  // Kappe (ein Rechteck über die volle Breite) in die abgerundeten Ecken und
  // stand dort als graues Halbtransparent allein auf dem Himmel.
  ctx.clip();

  const grad = ctx.createLinearGradient(x, 0, x + w, 0);
  grad.addColorStop(0, "#4f8f3a");
  grad.addColorStop(0.5, "#63ab48");
  grad.addColorStop(1, "#3f7a2e");
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);

  // Blätter-Textur (dezente Tupfen)
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  for (let ty = y + 8; ty < y + h - 6; ty += 16) {
    ctx.beginPath();
    ctx.arc(x + w * 0.32, ty, 3, 0, Math.PI * 2);
    ctx.arc(x + w * 0.68, ty + 8, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  // Kappe am Lücken-Rand — folgt jetzt der Rundung, weil beschnitten.
  ctx.fillStyle = "rgba(0,0,0,0.12)";
  if (top) ctx.fillRect(x, y + h - 6, w, 6);
  else ctx.fillRect(x, y, w, 6);

  ctx.restore();
}

function drawBird(now) {
  const c = SKIN;
  ctx.save();
  ctx.translate(birdX, birdY);
  ctx.rotate(mode === "dead" ? deadSpin : tilt);

  // Schatten/Glow
  ctx.fillStyle = "rgba(255,210,63,0.18)";
  ctx.beginPath(); ctx.arc(0, 0, BIRD_R + 7, 0, Math.PI * 2); ctx.fill();

  // Körper
  ctx.fillStyle = c.body;
  ctx.beginPath(); ctx.ellipse(0, 0, BIRD_R + 2, BIRD_R, 0, 0, Math.PI * 2); ctx.fill();
  // Bauch
  ctx.fillStyle = c.belly;
  ctx.beginPath(); ctx.ellipse(-2, 4, BIRD_R * 0.7, BIRD_R * 0.66, 0, 0, Math.PI * 2); ctx.fill();
  // Gesichtsfleck (Stieglitz-Rot)
  ctx.fillStyle = c.face;
  ctx.beginPath(); ctx.arc(BIRD_R * 0.55, -2, 4.5, 0, Math.PI * 2); ctx.fill();

  // Flügel (flattert: wingT 1→0)
  const flap = Math.sin(wingT * Math.PI) * 0.9 + (mode === "run" ? Math.sin(now / 90) * 0.12 : 0);
  ctx.save();
  ctx.rotate(-0.3 - flap);
  ctx.fillStyle = c.wing;
  ctx.beginPath();
  ctx.ellipse(-4, 2, BIRD_R * 0.9, BIRD_R * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Schnabel
  ctx.fillStyle = c.beak;
  ctx.beginPath();
  ctx.moveTo(BIRD_R + 1, -2);
  ctx.lineTo(BIRD_R + 10, 1);
  ctx.lineTo(BIRD_R + 1, 4);
  ctx.closePath();
  ctx.fill();
  // Auge
  ctx.fillStyle = "#1a1a1f";
  ctx.beginPath(); ctx.arc(BIRD_R * 0.5, -3, 2.4, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.arc(BIRD_R * 0.5 + 0.8, -3.8, 0.8, 0, Math.PI * 2); ctx.fill();

  ctx.restore();
}

// ---------- Loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.032, (now - last) / 1000);
  last = now;
  if (mode === "run" && !paused) step(dt);
  else if (mode === "dead") stepDead(dt);
  if (shakeT > 0) shakeT = Math.max(0, shakeT - dt);
  for (const p of parts) { p.t += dt; p.vy += 520 * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
  parts = parts.filter(p => p.t < p.life);
  draw(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- Input ----------
stage.addEventListener("pointerdown", e => {
  e.preventDefault();
  if (paused) { resumeGame(); return; }   // erster Tipp beendet nur die Pause
  flap();
});
window.addEventListener("keydown", e => {
  if (e.code === "Space" || e.code === "ArrowUp") {
    e.preventDefault();
    if (paused) { resumeGame(); return; }
    flap();
  }
});

// ---------- Sound ----------
const sound = (() => {
  let ctxA = null;
  function ensure() { if (!ctxA) try { ctxA = new (window.AudioContext || window.webkitAudioContext)(); } catch {} return ctxA; }
  function tone(freq, dur, type = "sine", gain = 0.09, when = 0) {
    if (!GS.sound.on() || !ensure()) return;
    const t = ctxA.currentTime + when;
    const o = ctxA.createOscillator(), gg = ctxA.createGain();
    o.type = type; o.frequency.value = freq;
    gg.gain.setValueAtTime(gain, t);
    gg.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(gg).connect(ctxA.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }
  return {
    flap() { tone(520, 0.08, "triangle", 0.07); },
    gate(i) { tone(440 + i * 40, 0.09, "sine", 0.08); },
    korn(i) { tone(880 + i * 110, 0.09, "sine", 0.08); },
    dead() { tone(240, 0.3, "sawtooth", 0.07); tone(160, 0.4, "sawtooth", 0.07, 0.12); },
    splat() { tone(140, 0.16, "sawtooth", 0.1); tone(90, 0.24, "square", 0.07, 0.02); },
    fanfare() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, "sine", 0.11, i * 0.09)); },
    toggle() { return !GS.sound.toggle(); },
  };
})();

// ---------- Score / Bestenliste ----------
function finalScore() { return tore * 10 + korn * 5; }

async function gameOver() {
  if (overShown) return;      // Aufprall- und Notbremse-Timer dürfen sich überholen
  overShown = true;
  const score = finalScore();
  const newBadges = GS.badges.record("flatterfink", { tore, korn, score });
  const isRecord = score > best && score > 0;
  if (isRecord) { best = score; try { localStorage.setItem("ff_best", best); } catch (_) {} sound.fanfare(); }

  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="panel">
      <h2>${isRecord ? "Neuer Rekord!" : "Angeflogen!"}</h2>
      <div class="go-score">${score}</div>
      ${isRecord ? `<div class="go-best-badge">👑 Persönliche Bestleistung</div>` : `<div class="sub">Rekord: ${best}</div>`}
      <div class="go-stats">
        <span>🪧 ${tore} Tore</span>
        <span>🌾 ${korn} Körndl</span>
      </div>
      ${GS.badges.chipsHtml(newBadges)}
      <div class="go-rank" id="go-rank"></div>
      <div id="go-name-area"></div>
      <button class="btn-primary" id="go-again">🐦 Nochmal flattern</button>
      <button class="btn-secondary" id="go-top">🏆 Bestenliste</button>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector("#go-again").onclick = () => { overlay.remove(); startRun(); };
  overlay.querySelector("#go-top").onclick = () => showLeaderboard();
  const panel = overlay.querySelector(".panel");
  const addBtn = (label, fn) => {
    const b = document.createElement("button");
    b.className = "btn-secondary"; b.style.marginTop = "10px";
    b.textContent = label; b.onclick = fn; panel.appendChild(b);
    return b;
  };
  addBtn("🏅 Meilensteine", () => GS.badges.show("flatterfink", "Meilensteine — Flatterfink"));
  addBtn("🎨 Federkleid", () => GS.skins.picker("flatterfink", { title: "Finken-Federkleid", onChange: c => { SKIN = c; } }));
  const sb = addBtn("📤 Teilen / Herausfordern", async () => {
    const r = await GS.shareCard({
      title: "Flatterfink", emoji: "🐦", accent: "#ffd23f", big: score,
      subtitle: `${tore} Tore durchflattert`,
      url: GS.duelLink("flatterfink", score),
      text: `Ich hab bei Flatterfink 🐦 ${tore} Tore geschafft (${score} Punkte) — schlag mich!`,
    });
    if (r === "copied" || r === "downloaded") sb.textContent = "✔ geteilt";
  });

  GS.scoreFlow(overlay.querySelector("#go-name-area"), overlay.querySelector("#go-rank"), {
    game: "flatterfink", score,
    meta: { tore, koerndl: korn },
  });
}

function showLeaderboard() {
  GS.showLeaderboard({ game: "flatterfink", sub: "Die 50 besten Flüge weltweit", tabs: true });
}

// ---------- Start-Overlay ----------
function showStart() {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="panel">
      <h2><span class="foil">Flatterfink</span></h2>
      <p class="sub">Du bist ein kleiner Stieglitz.<br>
        <b>Tippen</b> = einmal flattern (Auftrieb).<br>
        Flieg durch die Lücken in den Hecken,<br>
        sammle <b>🌾 Körndl</b> — wie weit kommst du?</p>
      <button class="btn-primary" id="st-go">🐦 Losflattern!</button>
      ${GS.getName() ? "" : `<p class="sub" style="margin-top:8px">Tipp: Nach dem ersten Flug fragen wir einmal nach deinem Namen für die Bestenliste.</p>`}
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#st-go").onclick = () => { overlay.remove(); startRun(); };
}

// ---------- UI ----------
$("#btn-top").onclick = () => showLeaderboard();
const soundBtn = $("#btn-sound");
soundBtn.textContent = !GS.sound.on() ? "🔇" : "🔊";
soundBtn.onclick = () => { soundBtn.textContent = sound.toggle() ? "🔇" : "🔊"; };

GS.markPlayed("flatterfink");
reset();
if (new URLSearchParams(location.search).has("auto")) startRun();
else {
  showStart();
  GS.onboard("flatterfink", {
    title: "Flatterfink — so geht's",
    steps: [
      { icon: "👆", text: "Tippen lässt den Finken einmal flattern — er steigt kurz." },
      { icon: "🌿", text: "Flieg durch die Lücken in den Hecken, stoß nirgends an." },
      { icon: "🌾", text: "Sammle Körndl für Extrapunkte. Je weiter, desto enger." },
    ],
  });
}

// ---------- Meilensteine ----------
GS.badges.define("flatterfink", [
  { id: "t10", icon: "🐣", name: "Flügge", desc: "10 Tore in einem Flug", test: s => s.tore >= 10 },
  { id: "t30", icon: "🐦", name: "Kunstflieger", desc: "30 Tore in einem Flug", test: s => s.tore >= 30 },
  { id: "t60", icon: "🦅", name: "Lüfte-König", desc: "60 Tore in einem Flug", test: s => s.tore >= 60 },
  { id: "k20", icon: "🌾", name: "Körndl-Sammler", desc: "20 Körndl in einem Flug", test: s => s.korn >= 20 },
  { id: "sumt500", icon: "🪶", name: "Vielflieger", desc: "500 Tore insgesamt", test: (s, t) => t.sum_tore >= 500 },
  { id: "runs25", icon: "🎖️", name: "Stammgast", desc: "25 Flüge absolviert", test: (s, t) => t.runs >= 25 },
]);
