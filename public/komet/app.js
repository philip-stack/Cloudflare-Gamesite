// ====================================================================
// KOMET — One-Touch-Schwung-Arcade
//
// Du bist ein Komet. HALTEN wirft ein Lichtseil zum besten Stern in
// Reichweite und du schwingst wie ein Pendel. LOSLASSEN schleudert
// dich nach vorn. Sammle Funken (✦), stürze nicht ab — je weiter,
// desto schneller die Welt. Score = Meter + 5 × Funken.
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
const G = 1650;              // Gravitation px/s²
const ROPE_MAX = 380;        // maximale Seil-Reichweite
const ROPE_MIN = 70;
const PUMP = 1.0035;         // leichte Energiezufuhr beim Schwingen
const MAX_SPEED = 1500;
const CAM_X_FRAC = 0.34;     // Komet sitzt bei 34 % der Breite
const PX_PER_M = 40;         // Pixel pro "Meter"

// ---------- Zustand ----------
let mode = "ready";          // ready | run | dead
let pos, vel, holding, anchor, ropeLen;
let anchors = [], sparks = [], particles = [], trail = [];
let camX = 0;
let startX = 0;
let sparkCount = 0;
let shakeT = 0;
let genX = 0;                // bis hierhin ist Welt generiert
let best = Number(localStorage.getItem("km_best") || 0);
let submitted = false;
let deathAt = 0;

$("#hud-best").textContent = best;

function getName() { return (localStorage.getItem("bb_name") || "").trim(); }

// ---------- Weltgenerierung ----------
function difficulty() { return Math.min(1, meters() / 300); } // 0 → 1 über 300 m
function meters() { return Math.max(0, Math.round((pos.x - startX) / PX_PER_M)); }

function genWorld(untilX) {
  while (genX < untilX) {
    const d = difficulty();
    const gap = 190 + Math.random() * (130 + d * 130);
    genX += gap;
    const y = H * (0.10 + Math.random() * (0.38 + d * 0.14));
    anchors.push({ x: genX, y, tw: Math.random() * Math.PI * 2 });

    // Funken-Bogen zwischen den Sternen (~45 %)
    if (Math.random() < 0.45) {
      const n = 3 + Math.floor(Math.random() * 3);
      const baseY = H * (0.35 + Math.random() * 0.35);
      const amp = 30 + Math.random() * 50;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        sparks.push({
          x: genX - gap + gap * t,
          y: baseY - Math.sin(t * Math.PI) * amp,
          tw: Math.random() * Math.PI * 2,
          got: false,
        });
      }
    }
  }
  anchors = anchors.filter(a => a.x > camX - 200);
  sparks = sparks.filter(s => !s.got && s.x > camX - 200);
}

// ---------- Spielsteuerung ----------
function reset() {
  resize();
  pos = { x: 0, y: H * 0.32 };
  vel = { x: 320, y: -140 };
  holding = false;
  anchor = null;
  ropeLen = 0;
  anchors = [];
  sparks = [];
  particles = [];
  trail = [];
  camX = pos.x - W * CAM_X_FRAC;
  startX = pos.x;
  sparkCount = 0;
  submitted = false;
  // Sanfter Einstieg: die ersten Sterne garantiert in Reichweite
  anchors.push({ x: pos.x + 130, y: H * 0.16, tw: 0 });
  anchors.push({ x: pos.x + 330, y: H * 0.24, tw: 2 });
  anchors.push({ x: pos.x + 520, y: H * 0.18, tw: 4 });
  genX = pos.x + 520;
  genWorld(pos.x + W * 2);
  updateHud();
}

function startRun() {
  reset();
  mode = "run";
  $("#hint").classList.remove("hidden");
  setTimeout(() => $("#hint").classList.add("hidden"), 5000);
}

function attach() {
  // Bester Stern: nah UND möglichst vor uns
  let bestA = null, bestScore = Infinity;
  for (const a of anchors) {
    const dx = a.x - pos.x, dy = a.y - pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist > ROPE_MAX || dist < 24) continue;
    if (a.y > pos.y + 40) continue;           // nur Sterne über uns (pendelbar)
    const score = dist - Math.max(0, dx) * 0.55;
    if (score < bestScore) { bestScore = score; bestA = a; }
  }
  if (!bestA) return;
  anchor = bestA;
  ropeLen = Math.max(ROPE_MIN, Math.hypot(anchor.x - pos.x, anchor.y - pos.y));
  sound.attach();
  if (navigator.vibrate) navigator.vibrate(8);
}

function release() {
  if (anchor) sound.release();
  anchor = null;
}

// ---------- Physik ----------
function step(dt) {
  if (holding && !anchor) attach();
  if (!holding && anchor) release();

  vel.y += G * dt;

  if (anchor) {
    // Pendel: Position integrieren, dann auf Seillänge einschnüren,
    // Geschwindigkeit auf die Tangente projizieren (+ leichter Pump)
    pos.x += vel.x * dt;
    pos.y += vel.y * dt;
    let dx = pos.x - anchor.x, dy = pos.y - anchor.y;
    const dist = Math.hypot(dx, dy) || 1;
    if (dist > ropeLen) {
      dx /= dist; dy /= dist;
      pos.x = anchor.x + dx * ropeLen;
      pos.y = anchor.y + dy * ropeLen;
      const vn = vel.x * dx + vel.y * dy;
      vel.x -= vn * dx;
      vel.y -= vn * dy;
      vel.x *= PUMP;
      vel.y *= PUMP;
    }
  } else {
    pos.x += vel.x * dt;
    pos.y += vel.y * dt;
  }

  const sp = Math.hypot(vel.x, vel.y);
  if (sp > MAX_SPEED) { vel.x *= MAX_SPEED / sp; vel.y *= MAX_SPEED / sp; }

  // Decke: sanft abprallen statt verschwinden
  if (pos.y < -30) { pos.y = -30; if (vel.y < 0) vel.y *= -0.4; }

  // Kamera fährt nur vorwärts — wer zu weit zurückschwingt, fällt raus
  camX = Math.max(camX, pos.x - W * CAM_X_FRAC);
  genWorld(camX + W * 2.2);

  // Funken einsammeln
  for (const s of sparks) {
    if (!s.got && Math.hypot(s.x - pos.x, s.y - pos.y) < 26) {
      s.got = true;
      sparkCount++;
      sound.spark(Math.min(sparkCount % 8, 7));
      burst(s.x, s.y, "#7fe3ff", 10);
      if (navigator.vibrate) navigator.vibrate(6);
    }
  }

  // Trail
  trail.push({ x: pos.x, y: pos.y });
  if (trail.length > 26) trail.shift();

  // Tod: unten raus oder hinter die Kamera gefallen
  if (pos.y > H + 50 || pos.x < camX - 60) die();

  updateHud();
}

function die() {
  if (mode !== "run") return;
  mode = "dead";
  deathAt = performance.now();
  release();
  burst(pos.x, Math.min(pos.y, H - 10), "#e8c15a", 26);
  shakeT = 0.5;
  sound.dead();
  if (navigator.vibrate) navigator.vibrate([60, 40, 80]);
  setTimeout(gameOver, 700);
}

function updateHud() {
  $("#hud-m").textContent = meters();
  $("#hud-sparks").textContent = "✦ " + sparkCount;
  $("#hud-best").textContent = best;
}

// ---------- Partikel ----------
function burst(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = 60 + Math.random() * 240;
    particles.push({
      x, y,
      vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60,
      life: 0.5 + Math.random() * 0.5,
      t: 0, color,
    });
  }
}

// ---------- Rendering ----------
const starsFar = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.2 + 0.4 }));
const starsNear = Array.from({ length: 30 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.6 + 0.8 }));

function draw(now) {
  ctx.clearRect(0, 0, W, H);

  let ox = 0, oy = 0;
  if (shakeT > 0) {
    ox = (Math.random() - 0.5) * 12 * shakeT;
    oy = (Math.random() - 0.5) * 12 * shakeT;
  }
  ctx.save();
  ctx.translate(ox, oy);

  // Parallax-Sterne
  ctx.fillStyle = "rgba(244,239,226,0.35)";
  for (const s of starsFar) {
    const x = ((s.x * W * 3 - camX * 0.12) % (W + 20) + W + 20) % (W + 20) - 10;
    ctx.globalAlpha = 0.2 + 0.3 * Math.sin(now / 900 + s.x * 20) ** 2;
    ctx.fillRect(x, s.y * H, s.r, s.r);
  }
  ctx.globalAlpha = 0.5;
  for (const s of starsNear) {
    const x = ((s.x * W * 3 - camX * 0.3) % (W + 20) + W + 20) % (W + 20) - 10;
    ctx.fillRect(x, s.y * H, s.r, s.r);
  }
  ctx.globalAlpha = 1;

  if (mode !== "ready") {
    const toScreen = p => ({ x: p.x - camX, y: p.y });

    // Anker-Sterne
    for (const a of anchors) {
      const p = toScreen(a);
      if (p.x < -40 || p.x > W + 40) continue;
      const pulse = 0.75 + 0.25 * Math.sin(now / 300 + a.tw);
      const inRange = mode === "run" && !anchor &&
        Math.hypot(a.x - pos.x, a.y - pos.y) < ROPE_MAX && a.y <= pos.y + 40;
      drawStar(p.x, p.y, 7 * pulse, inRange ? "#fff3c4" : "#e8c15a");
      if (inRange) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 13 + 3 * Math.sin(now / 200), 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(232,193,90,0.5)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // Funken
    for (const s of sparks) {
      if (s.got) continue;
      const p = toScreen(s);
      if (p.x < -20 || p.x > W + 20) continue;
      const tw = 0.6 + 0.4 * Math.sin(now / 220 + s.tw);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(now / 800 + s.tw);
      ctx.fillStyle = `rgba(127,227,255,${tw})`;
      ctx.fillRect(-4, -4, 8, 8);
      ctx.restore();
    }

    // Seil
    if (anchor) {
      const a = toScreen(anchor), k = toScreen(pos);
      const grad = ctx.createLinearGradient(a.x, a.y, k.x, k.y);
      grad.addColorStop(0, "rgba(255,243,196,0.9)");
      grad.addColorStop(1, "rgba(232,193,90,0.55)");
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(k.x, k.y);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Trail
    for (let i = 1; i < trail.length; i++) {
      const t0 = toScreen(trail[i - 1]), t1 = toScreen(trail[i]);
      const f = i / trail.length;
      ctx.beginPath();
      ctx.moveTo(t0.x, t0.y);
      ctx.lineTo(t1.x, t1.y);
      ctx.strokeStyle = `rgba(232,193,90,${f * 0.5})`;
      ctx.lineWidth = f * 7;
      ctx.lineCap = "round";
      ctx.stroke();
    }

    // Komet
    if (mode === "run" || performance.now() - deathAt < 80) {
      const k = toScreen(pos);
      const glow = ctx.createRadialGradient(k.x, k.y, 0, k.x, k.y, 26);
      glow.addColorStop(0, "rgba(255,248,220,1)");
      glow.addColorStop(0.35, "rgba(240,205,110,0.9)");
      glow.addColorStop(1, "rgba(232,193,90,0)");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(k.x, k.y, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fffdf4";
      ctx.beginPath();
      ctx.arc(k.x, k.y, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Partikel
  for (const p of particles) {
    const f = 1 - p.t / p.life;
    ctx.globalAlpha = f;
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - camX - 2, p.y - 2, 4, 4);
  }
  ctx.globalAlpha = 1;

  ctx.restore();
}

function drawStar(x, y, r, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const rad = i % 2 === 0 ? r : r * 0.4;
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    ctx[i === 0 ? "moveTo" : "lineTo"](Math.cos(a) * rad, Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ---------- Loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.032, (now - last) / 1000);
  last = now;

  if (mode === "run") step(dt);
  if (shakeT > 0) shakeT = Math.max(0, shakeT - dt);
  for (const p of particles) {
    p.t += dt;
    p.vy += 500 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  particles = particles.filter(p => p.t < p.life);

  draw(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- Input ----------
stage.addEventListener("pointerdown", e => {
  e.preventDefault();
  if (mode === "run") holding = true;
});
window.addEventListener("pointerup", () => { holding = false; });
window.addEventListener("pointercancel", () => { holding = false; });
window.addEventListener("keydown", e => {
  if (e.code === "Space" && mode === "run") { e.preventDefault(); holding = true; }
});
window.addEventListener("keyup", e => {
  if (e.code === "Space") holding = false;
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && mode === "run") holding = false;
});

// ---------- Sound ----------
const sound = (() => {
  let ctxA = null;
  let muted = localStorage.getItem("km_muted") === "1";
  function ensure() {
    if (!ctxA) try { ctxA = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
    return ctxA;
  }
  function tone(freq, dur, type = "sine", gain = 0.1, when = 0) {
    if (muted || !ensure()) return;
    const t = ctxA.currentTime + when;
    const o = ctxA.createOscillator();
    const g = ctxA.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctxA.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  return {
    attach() { tone(660, 0.07, "triangle", 0.09); },
    release() { tone(440, 0.09, "triangle", 0.07); },
    spark(i) { tone(880 + i * 110, 0.1, "sine", 0.09); },
    dead() { tone(196, 0.35, "sawtooth", 0.07); tone(147, 0.45, "sawtooth", 0.07, 0.13); },
    fanfare() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, "sine", 0.12, i * 0.09)); },
    toggle() { muted = !muted; localStorage.setItem("km_muted", muted ? "1" : "0"); return muted; },
    get muted() { return muted; },
  };
})();

// ---------- Score / Bestenliste ----------
function finalScore() { return meters() + sparkCount * 5; }

function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}


async function gameOver() {
  const score = finalScore();
  const newBadges = GS.badges.record("komet", { meters: score - sparkCount * 5, sparks: sparkCount, score });
  const isRecord = score > best && score > 0;
  if (isRecord) { best = score; localStorage.setItem("km_best", best); sound.fanfare(); }

  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="panel">
      <h2>${isRecord ? "Neuer Rekord!" : "Verglüht!"}</h2>
      <div class="go-score">${score}</div>
      ${isRecord ? `<div class="go-best-badge">👑 Persönliche Bestleistung</div>` : `<div class="sub">Rekord: ${best}</div>`}
      <div class="go-stats">
        <span>📏 ${meters()} m</span>
        <span>✦ ${sparkCount} Funken</span>
      </div>
      ${GS.badges.chipsHtml(newBadges)}
      <div class="go-rank" id="go-rank"></div>
      <div id="go-name-area"></div>
      <button class="btn-primary" id="go-again">🚀 Nochmal fliegen</button>
      <button class="btn-secondary" id="go-top">🏆 Bestenliste</button>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector("#go-again").onclick = () => { overlay.remove(); startRun(); };
  overlay.querySelector("#go-top").onclick = () => showLeaderboard();
  const gb = document.createElement("button");
  gb.className = "btn-secondary";
  gb.style.marginTop = "10px";
  gb.textContent = "🏅 Meilensteine";
  gb.onclick = () => GS.badges.show("komet", "Meilensteine — Komet");
  overlay.querySelector(".panel").appendChild(gb);

  GS.scoreFlow(overlay.querySelector("#go-name-area"), overlay.querySelector("#go-rank"), {
    game: "komet", score,
    meta: { meters: score - sparkCount * 5, sparks: sparkCount },
  });
}

function showLeaderboard() {
  GS.showLeaderboard({ game: "komet", sub: "Die 50 weitesten Flüge weltweit" });
}
// ---------- Start-Overlay ----------
function showStart() {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="panel">
      <h2><span class="foil">Komet</span></h2>
      <p class="sub">Du bist ein Komet in der Nacht.<br>
        <b>Halten</b> = Lichtseil zum nächsten Stern, du schwingst.<br>
        <b>Loslassen</b> = du fliegst.<br>
        Sammle <b>✦ Funken</b>, stürze nicht ab — wie weit kommst du?</p>
      <button class="btn-primary" id="st-go">🚀 Abflug!</button>
      ${getName() ? "" : `<p class="sub" style="margin-top:8px">Tipp: Nach dem ersten Flug fragen wir einmal nach deinem Namen für die Bestenliste.</p>`}
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#st-go").onclick = () => { overlay.remove(); startRun(); };
}

// ---------- UI ----------
$("#btn-top").onclick = () => showLeaderboard();
const soundBtn = $("#btn-sound");
soundBtn.textContent = sound.muted ? "🔇" : "🔊";
soundBtn.onclick = () => { soundBtn.textContent = sound.toggle() ? "🔇" : "🔊"; };

reset();
if (new URLSearchParams(location.search).has("auto")) startRun();
else showStart();

// ---------- Meilensteine ----------
GS.badges.define("komet", [
  { id: "m100",   icon: "🌠", name: "Abgehoben",      desc: "100 m in einem Flug",      test: s => s.meters >= 100 },
  { id: "m300",   icon: "☄️", name: "Sternenreiter", desc: "300 m in einem Flug",      test: s => s.meters >= 300 },
  { id: "m700",   icon: "🌌", name: "Weltraumkurier", desc: "700 m in einem Flug",      test: s => s.meters >= 700 },
  { id: "s50",    icon: "✨", name: "Funkenfänger",  desc: "50 Funken in einem Flug",  test: s => s.sparks >= 50 },
  { id: "sum5k",  icon: "🛰️", name: "Vielflieger", desc: "5.000 m insgesamt",     test: (s, t) => t.sum_meters >= 5000 },
  { id: "sums1k", icon: "💫", name: "Funkensammler",  desc: "1.000 Funken insgesamt",   test: (s, t) => t.sum_sparks >= 1000 },
  { id: "runs25", icon: "🎖️", name: "Stammgast", desc: "25 Flüge absolviert", test: (s, t) => t.runs >= 25 },
]);
