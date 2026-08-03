// ====================================================================
// NEON-SCHLANGE — Slither-Arcade
//
// Du bist eine leuchtende Neon-Schlange. ZIEHEN (Maus/Finger) lenkt dich,
// HALTEN bzw. der ⚡-Knopf gibt Boost. Friss Orbs, wachse, beiß dich nicht
// selbst und knall nicht in die Wand. Score = gefressene Orbs.
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
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
window.addEventListener("resize", resize);
resize();

// ---------- Tuning ----------
const SPEED = 200;            // Grundtempo px/s
const BOOST_SPEED = 350;
const TURN = 4.6;             // max. Drehrate rad/s
const SEG_GAP = 6;            // Abstand der Körper-Abtastpunkte (px)
const BASE_LEN = 150;         // Startlänge in px
const GROW = 24;              // Längenzuwachs pro Orb (px)
const BODY_W = 15;            // Körperbreite (px)
const HEAD_R = 11;
const ORB_R = 7;
const EAT_R = HEAD_R + ORB_R + 3;
const COLL_R = BODY_W * 0.55; // Selbstkollisions-Radius
const FOOD_TARGET = 8;        // so viele Orbs liegen etwa im Feld
const BOOST_DRAIN = 90;       // px/s Länge (nur optisch), regeneriert
const BOOST_REGEN = 45;

// ---------- Skins (über Meilensteine freispielbar) ----------
GS.skins.define("schlange", [
  { id: "neon",    name: "Neongrün",     req: 0, swatch: ["#c6ffdf", "#28e07a", "#0b6"], colors: { a: "#c6ffdf", b: "#28e07a", glow: "40,224,122" } },
  { id: "cyan",    name: "Cyanpuls",     req: 3, swatch: ["#d6fbff", "#3ad8ff", "#0a9"], colors: { a: "#d6fbff", b: "#3ad8ff", glow: "58,216,255" } },
  { id: "magenta", name: "Magentablitz", req: 5, swatch: ["#ffe0f7", "#ff5bd0", "#a07"], colors: { a: "#ffe0f7", b: "#ff5bd0", glow: "255,91,208" } },
  { id: "gold",    name: "Goldschlange", req: 7, swatch: ["#fff3c4", "#f0cd6e", "#c93"], colors: { a: "#fff3c4", b: "#f0cd6e", glow: "240,205,110" } },
]);
let SKIN = GS.skins.get("schlange");

// ---------- Zustand ----------
let mode = "ready";           // ready | run | dead
let head, heading, points, bodyLenPx, boostSpent, orbs, food, particles, timeSec, submitted;
let target = null, pointerActive = false, turnDir = 0;
const boostHold = { pointer: false, btn: false, key: false };
const boosting = () => (boostHold.pointer || boostHold.btn || boostHold.key) && bodyLenPx > BASE_LEN * 0.9;
let best = Number(localStorage.getItem("schlange_best") || 0);

const rnd = (a, b) => a + Math.random() * (b - a);

function reset() {
  head = { x: W / 2, y: H / 2 };
  heading = -Math.PI / 2;
  points = [{ x: head.x, y: head.y }];
  bodyLenPx = BASE_LEN; boostSpent = 0; orbs = 0; timeSec = 0;
  food = []; particles = []; submitted = false;
  for (let i = 0; i < FOOD_TARGET; i++) spawnFood();
  updateHud();
}

function spawnFood() {
  const pad = 24;
  food.push({ x: rnd(pad, W - pad), y: rnd(pad, H - pad), hue: rnd(0, 360), t: Math.random() * 6.28 });
}

function startRun() {
  resize(); reset();
  mode = "run";
  $("#boost").classList.remove("hidden");
  $("#hint").classList.remove("hidden");
  setTimeout(() => $("#hint") && $("#hint").classList.add("hidden"), 2600);
}

// ---------- Geometrie-Helfer ----------
function sampleAt(dist) {
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (acc + seg >= dist) { const t = (dist - acc) / (seg || 1); return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }; }
    acc += seg;
  }
  return points[points.length - 1] || head;
}
function trimPoints(maxDist) {
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    acc += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    if (acc > maxDist) { points.length = i + 1; return; }
  }
}
function pathLength() {
  let acc = 0;
  for (let i = 1; i < points.length; i++) acc += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return acc;
}
function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }

// ---------- Update ----------
function update(dt) {
  timeSec += dt;

  // Lenken
  if (pointerActive && target) {
    const desired = Math.atan2(target.y - head.y, target.x - head.x);
    const d = angDiff(heading, desired);
    heading += Math.max(-TURN * dt, Math.min(TURN * dt, d));
  } else if (turnDir) {
    heading += turnDir * TURN * dt;
  }

  // Boost / Länge
  const spd = boosting() ? BOOST_SPEED : SPEED;
  if (boosting()) { boostSpent = Math.min(boostSpent + BOOST_DRAIN * dt, (BASE_LEN + orbs * GROW) * 0.4); if (!LOW()) burst(head.x, head.y, 1, SKIN.glow); }
  else boostSpent = Math.max(0, boostSpent - BOOST_REGEN * dt);
  bodyLenPx = Math.max(BASE_LEN * 0.9, BASE_LEN + orbs * GROW - boostSpent);

  // Bewegen
  head.x += Math.cos(heading) * spd * dt;
  head.y += Math.sin(heading) * spd * dt;
  points.unshift({ x: head.x, y: head.y });
  trimPoints(bodyLenPx + SEG_GAP * 3);

  // Wand
  if (head.x < HEAD_R || head.x > W - HEAD_R || head.y < HEAD_R || head.y > H - HEAD_R) return die();

  // Fressen
  for (let i = food.length - 1; i >= 0; i--) {
    const f = food[i];
    if (Math.hypot(head.x - f.x, head.y - f.y) < EAT_R) {
      food.splice(i, 1); orbs++;
      burst(f.x, f.y, LOW() ? 5 : 12, SKIN.glow);
      GS.sound.good(); GS.haptic(10);
      updateHud();
      while (food.length < FOOD_TARGET) spawnFood();
    }
  }

  // Selbstkollision (Hals überspringen; NUR echten, schon vorhandenen Körper
  // prüfen — sonst „kollidiert" die kurze Startschlange mit ihrem Startpunkt).
  const neck = Math.ceil((HEAD_R * 2.4) / SEG_GAP) + 3;
  const segCount = Math.min(Math.floor(bodyLenPx / SEG_GAP), Math.floor(pathLength() / SEG_GAP));
  for (let i = neck; i <= segCount; i++) {
    const p = sampleAt(i * SEG_GAP);
    if (Math.hypot(head.x - p.x, head.y - p.y) < COLL_R) return die();
  }

  // Partikel altern
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx * dt; p.y += p.vy * dt; p.life -= dt; p.vx *= 0.92; p.vy *= 0.92;
    if (p.life <= 0) particles.splice(i, 1);
  }
  for (const f of food) f.t += dt * 3;
}

function burst(x, y, n, glow) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * 6.28, s = rnd(40, 220);
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rnd(0.3, 0.7), max: 0.7, glow });
  }
}

function die() {
  if (mode !== "run") return;
  mode = "dead";
  burst(head.x, head.y, LOW() ? 14 : 40, SKIN.glow);
  GS.sound.lose(); GS.haptic(70);
  $("#boost").classList.add("hidden");
  setTimeout(gameOver, 480);
}

// ---------- Render ----------
function render() {
  ctx.clearRect(0, 0, W, H);

  // Gitter
  ctx.save();
  ctx.strokeStyle = "rgba(120,200,160,0.06)"; ctx.lineWidth = 1;
  const grid = 34;
  for (let x = grid; x < W; x += grid) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = grid; y < H; y += grid) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
  ctx.restore();

  // Rand-Glühen
  ctx.save();
  ctx.strokeStyle = `rgba(${SKIN.glow},0.5)`; ctx.lineWidth = 3;
  ctx.shadowBlur = LOW() ? 0 : 14; ctx.shadowColor = `rgba(${SKIN.glow},0.7)`;
  ctx.strokeRect(2, 2, W - 4, H - 4);
  ctx.restore();

  // Orbs
  for (const f of food) {
    const pulse = 1 + Math.sin(f.t) * 0.18;
    ctx.save();
    ctx.shadowBlur = LOW() ? 0 : 14; ctx.shadowColor = `hsl(${f.hue},90%,60%)`;
    ctx.fillStyle = `hsl(${f.hue},90%,62%)`;
    ctx.beginPath(); ctx.arc(f.x, f.y, ORB_R * pulse, 0, 6.2832); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath(); ctx.arc(f.x - 2, f.y - 2, ORB_R * 0.4, 0, 6.2832); ctx.fill();
    ctx.restore();
  }

  // Körper als glühender Pfad (nur bis zur tatsächlichen Pfadlänge) + Kopf
  if (mode !== "ready") {
    const segCount = Math.min(Math.floor(bodyLenPx / SEG_GAP), Math.floor(pathLength() / SEG_GAP));
    const pts = [];
    for (let i = 0; i <= segCount; i++) pts.push(sampleAt(i * SEG_GAP));
    if (pts.length > 1) {
      const drawPath = () => { ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y); };
      ctx.lineJoin = "round"; ctx.lineCap = "round";
      if (!LOW()) { // Glühen
        ctx.save(); ctx.strokeStyle = `rgba(${SKIN.glow},0.45)`; ctx.lineWidth = BODY_W + 10;
        ctx.shadowBlur = 18; ctx.shadowColor = `rgba(${SKIN.glow},0.9)`; drawPath(); ctx.stroke(); ctx.restore();
      }
      ctx.strokeStyle = SKIN.b; ctx.lineWidth = BODY_W; drawPath(); ctx.stroke();
      ctx.strokeStyle = SKIN.a; ctx.lineWidth = BODY_W * 0.42; ctx.globalAlpha = 0.75; drawPath(); ctx.stroke(); ctx.globalAlpha = 1;
    }

    // Kopf immer zeichnen
    const hx = head.x, hy = head.y;
    ctx.save();
    ctx.shadowBlur = LOW() ? 0 : 16; ctx.shadowColor = `rgba(${SKIN.glow},0.95)`;
    ctx.fillStyle = SKIN.a; ctx.beginPath(); ctx.arc(hx, hy, HEAD_R, 0, 6.2832); ctx.fill();
    ctx.restore();
    const nx = Math.cos(heading), ny = Math.sin(heading), px = -ny, py = nx;
    for (const s of [-1, 1]) {
      const ex = hx + nx * 4 + px * s * 5, ey = hy + ny * 4 + py * s * 5;
      ctx.fillStyle = "#05130b"; ctx.beginPath(); ctx.arc(ex, ey, 2.6, 0, 6.2832); ctx.fill();
    }
  }

  // Partikel
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.max);
    ctx.fillStyle = `rgba(${p.glow},1)`;
    ctx.beginPath(); ctx.arc(p.x, p.y, 2.6, 0, 6.2832); ctx.fill();
  }
  ctx.globalAlpha = 1;
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
  $("#hud-orbs").textContent = orbs;
  $("#hud-len").textContent = 1 + orbs;
  $("#hud-best").textContent = best;
}

// ---------- Steuerung ----------
function setTarget(e) {
  const r = canvas.getBoundingClientRect();
  target = { x: (e.clientX - r.left), y: (e.clientY - r.top) };
  pointerActive = true;
}
stage.addEventListener("pointermove", e => { if (mode === "run") setTarget(e); });
stage.addEventListener("pointerdown", e => {
  if (e.target && e.target.id === "boost") return;
  if (mode === "run") { setTarget(e); if (e.pointerType === "mouse") boostHold.pointer = true; }
});
window.addEventListener("pointerup", () => { boostHold.pointer = false; });

const boostBtn = $("#boost");
const boostOn = e => { e.preventDefault(); boostHold.btn = true; };
const boostOff = () => { boostHold.btn = false; };
boostBtn.addEventListener("pointerdown", boostOn);
boostBtn.addEventListener("pointerup", boostOff);
boostBtn.addEventListener("pointercancel", boostOff);
boostBtn.addEventListener("pointerleave", boostOff);

window.addEventListener("keydown", e => {
  if (["ArrowLeft", "a", "A"].includes(e.key)) { turnDir = -1; pointerActive = false; }
  else if (["ArrowRight", "d", "D"].includes(e.key)) { turnDir = 1; pointerActive = false; }
  else if ([" ", "ArrowUp", "w", "W"].includes(e.key)) { boostHold.key = true; e.preventDefault(); }
});
window.addEventListener("keyup", e => {
  if (["ArrowLeft", "a", "A", "ArrowRight", "d", "D"].includes(e.key)) turnDir = 0;
  else if ([" ", "ArrowUp", "w", "W"].includes(e.key)) boostHold.key = false;
});

// Pause bei verstecktem Tab: kein Tod, während man weg ist.
document.addEventListener("visibilitychange", () => { if (document.hidden) { boostHold.pointer = boostHold.btn = boostHold.key = false; lastT = 0; } });

// ---------- Game-Over ----------
async function gameOver() {
  const score = orbs;
  const tSec = Math.round(timeSec);
  const newBadges = GS.badges.record("schlange", { orbs, time: tSec, len: 1 + orbs });
  const isRecord = score > best && score > 0;
  if (isRecord) { best = score; try { localStorage.setItem("schlange_best", best); } catch (_) {} GS.sound.win(); }

  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="panel">
      <h2>${isRecord ? "Neuer Rekord!" : "Gebissen!"}</h2>
      <div class="go-score">${score}</div>
      ${isRecord ? `<div class="go-best-badge">👑 Persönliche Bestleistung</div>` : `<div class="sub">Rekord: ${best}</div>`}
      <div class="go-stats"><span>🟢 ${score} Orbs</span><span>📏 Länge ${1 + score}</span><span>⏱️ ${tSec}s</span></div>
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
  addBtn("🎨 Skins", () => GS.skins.picker("schlange", { title: "Schlangen-Skins", onChange: c => { SKIN = c; } }));
  const sb = addBtn("📤 Teilen", async () => {
    const r = await GS.share({ title: "Neon-Schlange", text: `Ich hab bei Neon-Schlange 🐍 ${score} Orbs gefressen — schaffst du mehr?`, url: location.origin + "/schlange/" });
    if (r === "copied") sb.textContent = "✔ Link kopiert";
  });

  GS.scoreFlow(overlay.querySelector("#go-name-area"), overlay.querySelector("#go-rank"), {
    game: "schlange", score, meta: { orbs: score, time: tSec, len: 1 + score },
  });
}

function showLeaderboard() { GS.showLeaderboard({ game: "schlange", sub: "Die 50 längsten Schlangen weltweit" }); }

// ---------- Start-Overlay ----------
function showStart() {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="panel">
      <h2><span class="foil">Neon-Schlange</span></h2>
      <p class="sub">Lenke deine leuchtende Schlange mit <b>Ziehen</b> (Finger/Maus).<br>
        <b>Halten</b> bzw. der <b>⚡-Knopf</b> gibt Boost.<br>
        Friss <b>Orbs</b>, wachse — beiß dich nicht selbst und meide die Wand!</p>
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
reset();
if (new URLSearchParams(location.search).has("auto")) startRun();
else {
  showStart();
  GS.onboard("schlange", {
    title: "Neon-Schlange — so geht's",
    steps: [
      { icon: "👆", text: "Ziehen mit Finger/Maus lenkt deine Schlange." },
      { icon: "⚡", text: "Halten bzw. der ⚡-Knopf gibt kurzzeitig Boost." },
      { icon: "🟢", text: "Friss Orbs, um zu wachsen und Punkte zu sammeln." },
      { icon: "🚫", text: "Beiß dich nicht selbst und knall nicht in die Wand." },
    ],
  });
}

// ---------- Meilensteine ----------
GS.badges.define("schlange", [
  { id: "o25",   icon: "🟢", name: "Häppchen",         desc: "25 Orbs in einer Runde",  test: s => s.orbs >= 25 },
  { id: "o60",   icon: "🐍", name: "Schlängler",       desc: "60 Orbs in einer Runde",  test: s => s.orbs >= 60 },
  { id: "o120",  icon: "🌟", name: "Riesenschlange",   desc: "120 Orbs in einer Runde", test: s => s.orbs >= 120 },
  { id: "t60",   icon: "⏱️", name: "Überlebenskünstler", desc: "60 s am Stück überlebt", test: s => s.time >= 60 },
  { id: "t150",  icon: "🧭", name: "Ausdauernd",       desc: "150 s am Stück überlebt",  test: s => s.time >= 150 },
  { id: "sum500", icon: "🍽️", name: "Vielfraß",        desc: "500 Orbs insgesamt",       test: (s, t) => t.sum_orbs >= 500 },
  { id: "runs25", icon: "🎖️", name: "Stammgast",       desc: "25 Runden gespielt",       test: (s, t) => t.runs >= 25 },
]);
