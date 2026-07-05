// ====================================================================
// STERNENSTURM — Roguelite-Space-Shooter
//
// Ziehen = fliegen (Autofeuer). Wellen überstehen, Sternenstaub
// sammeln → NOVA räumt den Bildschirm. Nach Bossen und Schlüssel-
// wellen: 1 von 3 Upgrades wählen. Jeder Run ist anders.
// ====================================================================

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const stage = document.getElementById("stage");
const $ = sel => document.querySelector(sel);

let W = 0, H = 0;
function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  W = stage.clientWidth;
  H = stage.clientHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resize);
resize();

const GOLD = "#e8c15a", CYAN = "#56d5e8", MAGENTA = "#e86aa8",
      RED = "#ff6b5e", GREEN = "#69d98a", ORANGE = "#ffa14d", PURPLE = "#b678ff";

function getName() { return (localStorage.getItem("bb_name") || "").trim(); }
let best = Number(localStorage.getItem("ss_best") || 0);

// ---------- Zustand ----------
let mode = "menu";   // menu | run | choose | dead
let player, bullets, ebullets, enemies, drops, particles, rings, floaters;
let wave, spawnQueue, spawnT, waveBreak, score, dust, novaNeed, kills, bossAlive;
let shakeT = 0, hitStop = 0, submitted = false;

function newRun() {
  resize();
  player = {
    x: W / 2, y: H * 0.8, r: 14,
    hp: 3, maxHp: 3, inv: 0, fireCd: 0,
    dmg: 1, rate: 1, streams: 1, pierce: 0, magnet: 70, shield: 0, shieldCd: 0, hasShield: false,
  };
  bullets = []; ebullets = []; enemies = []; drops = []; particles = []; rings = []; floaters = [];
  wave = 0; spawnQueue = []; spawnT = 0; waveBreak = 1.2;
  score = 0; dust = 0; novaNeed = 25; kills = 0; bossAlive = false;
  submitted = false;
  updateHud();
  updateNova();
}

// ---------- Wellen ----------
function isBossWave(n) { return n % 5 === 0; }

function buildWave(n) {
  const q = [];
  if (isBossWave(n)) {
    q.push({ t: 1.2, type: "boss" });
    // Begleitschutz in späteren Boss-Wellen
    for (let i = 0; i < Math.min(4, Math.floor(n / 5)); i++) {
      q.push({ t: 4 + i * 3, type: "drone" });
    }
    return q;
  }
  const budget = 5 + n * 2;
  const pool = ["drone"];
  if (n >= 2) pool.push("weber");
  if (n >= 3) pool.push("splitter");
  if (n >= 4) pool.push("hunter");
  if (n >= 5) pool.push("tank");
  let t = 0.6;
  for (let i = 0; i < budget; i++) {
    const type = pool[Math.floor(Math.random() * pool.length)];
    q.push({ t, type });
    t += Math.max(0.25, 1.1 - n * 0.05) * (0.6 + Math.random() * 0.8);
  }
  return q;
}

function spawnEnemy(type) {
  const n = wave;
  const hpMul = 1 + n * 0.12;
  const x = 30 + Math.random() * (W - 60);
  if (type === "drone")
    enemies.push({ type, x, y: -20, r: 14, hp: 1 * hpMul, vy: 110 + n * 6, vx: 0, sc: 10, col: RED });
  if (type === "weber")
    enemies.push({ type, x, y: -20, r: 13, hp: 2 * hpMul, vy: 90 + n * 5, ph: Math.random() * 6, amp: 60 + Math.random() * 50, x0: x, sc: 15, col: PURPLE });
  if (type === "splitter")
    enemies.push({ type, x, y: -20, r: 16, hp: 2.5 * hpMul, vy: 80 + n * 4, sc: 20, col: ORANGE });
  if (type === "mini")
    enemies.push({ type, x, y: -20, r: 9, hp: 1, vy: 170 + n * 6, vx: (Math.random() - 0.5) * 120, sc: 5, col: ORANGE });
  if (type === "hunter")
    enemies.push({ type, x, y: -20, r: 13, hp: 1.5 * hpMul, vy: 120 + n * 6, vx: 0, sc: 25, col: CYAN });
  if (type === "tank")
    enemies.push({ type, x, y: -24, r: 20, hp: 8 * hpMul, vy: 42, shootT: 1.6, sc: 40, col: GREEN });
  if (type === "boss") {
    bossAlive = true;
    sound.alarm();
    enemies.push({
      type, x: W / 2, y: -60, r: 42,
      hp: 120 * (1 + (n / 5 - 1) * 0.7), maxHp: 120 * (1 + (n / 5 - 1) * 0.7),
      vy: 40, vx: 80, phase: 0, shootT: 1.4, burstT: 4, sc: 400 + n * 30, col: MAGENTA,
    });
  }
}

function stepWave(dt) {
  if (waveBreak > 0) {
    waveBreak -= dt;
    if (waveBreak <= 0) {
      wave++;
      spawnQueue = buildWave(wave);
      spawnT = 0;
      banner(isBossWave(wave) ? `⚠ BOSS — Welle ${wave}` : `Welle ${wave}`);
      updateHud();
    }
    return;
  }
  spawnT += dt;
  while (spawnQueue.length && spawnQueue[0].t <= spawnT) {
    spawnEnemy(spawnQueue.shift().type);
  }
  if (!spawnQueue.length && !enemies.length) {
    // Welle geschafft
    score += wave * 15;
    if (isBossWave(wave) || wave % 3 === 0) {
      setTimeout(() => { if (mode === "run") chooseUpgrade(); }, 500);
      waveBreak = 999; // wird nach Wahl gesetzt
    } else {
      waveBreak = 1.6;
    }
  }
}

function banner(text) {
  const el = $("#wave-banner");
  el.textContent = text;
  el.classList.remove("hidden");
  el.style.animation = "none";
  void el.offsetWidth;
  el.style.animation = "";
}

// ---------- Upgrades ----------
const UPGRADES = [
  { id: "streams", icon: "🔱", name: "Doppelschuss", desc: "Ein zusätzlicher Schussstrahl", max: 3,
    can: p => p.streams < 3, apply: p => p.streams++ , lvl: p => p.streams - 1 },
  { id: "rate", icon: "⚡", name: "Schnellfeuer", desc: "+30 % Feuerrate", max: 4,
    can: p => p.rate < 2.2, apply: p => p.rate *= 1.3, lvl: p => Math.round(Math.log(p.rate) / Math.log(1.3)) },
  { id: "dmg", icon: "💪", name: "Wucht", desc: "+1 Schaden pro Treffer", max: 4,
    can: p => p.dmg < 5, apply: p => p.dmg++, lvl: p => p.dmg - 1 },
  { id: "pierce", icon: "🎯", name: "Durchschlag", desc: "Schüsse durchdringen +1 Gegner", max: 2,
    can: p => p.pierce < 2, apply: p => p.pierce++, lvl: p => p.pierce },
  { id: "magnet", icon: "🧲", name: "Magnetkern", desc: "Sternenstaub fliegt dir weiter entgegen", max: 3,
    can: p => p.magnet < 220, apply: p => p.magnet += 50, lvl: p => Math.round((p.magnet - 70) / 50) },
  { id: "shield", icon: "🛡", name: "Schutzschild", desc: "Absorbiert 1 Treffer, lädt sich neu auf", max: 1,
    can: p => !p.hasShield, apply: p => { p.hasShield = true; p.shield = 1; }, lvl: p => (p.hasShield ? 1 : 0) },
  { id: "nova", icon: "💥", name: "Nova-Resonanz", desc: "NOVA braucht 20 % weniger Staub", max: 3,
    can: () => novaNeed > 14, apply: () => { novaNeed = Math.round(novaNeed * 0.8); updateNova(); }, lvl: () => Math.round((25 - novaNeed) / 4) },
  { id: "heart", icon: "❤️", name: "Reparatur", desc: "+1 Herz (auch über das Maximum)", max: 9,
    can: p => p.hp < 5, apply: p => { p.hp++; p.maxHp = Math.max(p.maxHp, p.hp); }, lvl: () => 0 },
];

function chooseUpgrade() {
  mode = "choose";
  const avail = UPGRADES.filter(u => u.can(player));
  const picks = [];
  while (picks.length < 3 && avail.length) {
    const i = Math.floor(Math.random() * avail.length);
    picks.push(avail.splice(i, 1)[0]);
  }
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="panel">
      <h2>Welle ${wave} überstanden!</h2>
      <p class="sub">Wähle <b>ein Upgrade</b> für diesen Flug:</p>
      <div class="upg-list">
        ${picks.map((u, i) => `
          <button class="upg" data-i="${i}">
            <span class="u-icon">${u.icon}</span>
            <span><span class="u-name">${u.name}</span><span class="u-desc" style="display:block">${u.desc}</span></span>
            <span class="u-lvl">${"●".repeat(Math.min(u.lvl(player), 4))}</span>
          </button>`).join("")}
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelectorAll(".upg").forEach(el => {
    el.onclick = () => {
      picks[Number(el.dataset.i)].apply(player);
      overlay.remove();
      updateHud();
      mode = "run";
      waveBreak = 1.4;
      sound.pickup();
    };
  });
}

// ---------- Input ----------
let dragging = false, dragOff = { x: 0, y: 0 };
stage.addEventListener("pointerdown", e => {
  if (mode !== "run") return;
  if (e.target.id === "nova-btn") return;
  e.preventDefault();
  const rect = stage.getBoundingClientRect();
  const px = e.clientX - rect.left, py = e.clientY - rect.top;
  dragging = true;
  dragOff.x = player.x - px;
  dragOff.y = player.y - py;
  // Wenn weit vom Schiff entfernt getippt: Schiff mit sanftem Standard-Offset greifen
  if (Math.hypot(px - player.x, py - player.y) > 90) {
    dragOff.x = 0;
    dragOff.y = -70;
  }
});
window.addEventListener("pointermove", e => {
  if (!dragging || mode !== "run") return;
  e.preventDefault();
  const rect = stage.getBoundingClientRect();
  player.x = Math.max(16, Math.min(W - 16, e.clientX - rect.left + dragOff.x));
  player.y = Math.max(40, Math.min(H - 30, e.clientY - rect.top + dragOff.y));
}, { passive: false });
window.addEventListener("pointerup", () => { dragging = false; });
window.addEventListener("pointercancel", () => { dragging = false; });

$("#nova-btn").addEventListener("click", fireNova);

// ---------- Nova ----------
function updateNova() {
  const f = Math.min(1, dust / novaNeed);
  $("#nova-fill").style.width = (f * 100) + "%";
  $("#nova-btn").classList.toggle("hidden", f < 1 || mode !== "run");
}
function fireNova() {
  if (dust < novaNeed || mode !== "run") return;
  dust = 0;
  updateNova();
  sound.nova();
  if (navigator.vibrate) navigator.vibrate([40, 30, 80]);
  shakeT = 0.6;
  hitStop = 0.12;
  rings.push({ x: player.x, y: player.y, r: 10, max: Math.max(W, H) * 1.2, w: 26, col: GOLD, v: 1400 });
  ebullets = [];
  for (const e of [...enemies]) {
    if (e.type === "boss") { damage(e, 30); }
    else { killEnemy(e, true); }
  }
}

// ---------- Kampf ----------
function firePlayer(dt) {
  player.fireCd -= dt;
  if (player.fireCd > 0) return;
  player.fireCd = 0.34 / player.rate;
  const n = player.streams;
  for (let i = 0; i < n; i++) {
    const off = (i - (n - 1) / 2) * 12;
    bullets.push({ x: player.x + off, y: player.y - 14, vy: -640, r: 4, dmg: player.dmg, pierce: player.pierce });
  }
  sound.pew();
}

function damage(e, dmg) {
  e.hp -= dmg;
  e.flash = 0.08;
  if (e.hp <= 0) killEnemy(e);
}

function killEnemy(e, silent = false) {
  const i = enemies.indexOf(e);
  if (i < 0) return;
  enemies.splice(i, 1);
  kills++;
  score += e.sc;
  burst(e.x, e.y, e.col, e.type === "boss" ? 60 : 14);
  if (!silent) sound.boom(e.type === "boss");
  if (e.type === "splitter") {
    for (const dx of [-14, 14]) {
      enemies.push({ type: "mini", x: e.x + dx, y: e.y, r: 9, hp: 1, vy: 150, vx: dx * 6, sc: 5, col: ORANGE });
    }
  }
  // Sternenstaub
  const nD = e.type === "boss" ? 12 : (e.type === "tank" ? 4 : e.type === "mini" ? 1 : 2);
  for (let k = 0; k < nD; k++) {
    drops.push({
      x: e.x + (Math.random() - 0.5) * 24,
      y: e.y + (Math.random() - 0.5) * 24,
      vx: (Math.random() - 0.5) * 90,
      vy: (Math.random() - 0.5) * 90,
      r: 5,
    });
  }
  if (e.type === "boss") {
    bossAlive = false;
    hitStop = 0.25;
    shakeT = 0.7;
    rings.push({ x: e.x, y: e.y, r: 10, max: 500, w: 18, col: MAGENTA, v: 900 });
    floatText(e.x, e.y, "+" + e.sc, true);
  } else {
    floatText(e.x, e.y, "+" + e.sc, false);
  }
  updateHud();
}

function hurtPlayer() {
  if (player.inv > 0) return;
  if (player.shield > 0) {
    player.shield = 0;
    player.shieldCd = 18;
    player.inv = 1.2;
    rings.push({ x: player.x, y: player.y, r: 8, max: 90, w: 8, col: CYAN, v: 400 });
    sound.shield();
    if (navigator.vibrate) navigator.vibrate(30);
    return;
  }
  player.hp--;
  player.inv = 1.6;
  shakeT = 0.45;
  sound.hit();
  if (navigator.vibrate) navigator.vibrate([50, 40, 70]);
  burst(player.x, player.y, GOLD, 20);
  updateHud();
  if (player.hp <= 0) {
    mode = "dead";
    hitStop = 0.3;
    rings.push({ x: player.x, y: player.y, r: 10, max: 400, w: 20, col: GOLD, v: 700 });
    burst(player.x, player.y, GOLD, 50);
    sound.dead();
    setTimeout(gameOver, 900);
  }
}

// ---------- Simulation ----------
function step(dt) {
  if (hitStop > 0) { hitStop -= dt; dt *= 0.25; }

  stepWave(dt);
  firePlayer(dt);

  player.inv = Math.max(0, player.inv - dt);
  if (player.hasShield && player.shield === 0) {
    player.shieldCd -= dt;
    if (player.shieldCd <= 0) { player.shield = 1; sound.pickup(); }
  }

  // Spieler-Schüsse
  for (const b of bullets) { b.y += b.vy * dt; }
  bullets = bullets.filter(b => b.y > -20 && !b.dead);

  // Gegner
  for (const e of [...enemies]) {
    if (e.flash) e.flash = Math.max(0, e.flash - dt);
    if (e.type === "weber") {
      e.ph += dt * 2.6;
      e.x = e.x0 + Math.sin(e.ph) * e.amp;
      e.y += e.vy * dt;
    } else if (e.type === "hunter") {
      e.vx += Math.sign(player.x - e.x) * 260 * dt;
      e.vx = Math.max(-200, Math.min(200, e.vx));
      e.x += e.vx * dt;
      e.y += e.vy * dt;
    } else if (e.type === "tank") {
      e.y += e.vy * dt;
      e.shootT -= dt;
      if (e.shootT <= 0 && e.y > 0) {
        e.shootT = 2.1;
        const a = Math.atan2(player.y - e.y, player.x - e.x);
        ebullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 190, vy: Math.sin(a) * 190, r: 6, col: GREEN });
        sound.epew();
      }
    } else if (e.type === "boss") {
      if (e.y < H * 0.18) e.y += e.vy * dt;
      else {
        e.x += e.vx * dt;
        if (e.x < 70 || e.x > W - 70) e.vx *= -1;
      }
      e.shootT -= dt;
      if (e.shootT <= 0 && e.y > 0) {
        e.shootT = Math.max(0.8, 1.5 - wave * 0.02);
        // Fächer
        const base = Math.atan2(player.y - e.y, player.x - e.x);
        for (let k = -2; k <= 2; k++) {
          const a = base + k * 0.22;
          ebullets.push({ x: e.x, y: e.y + 20, vx: Math.cos(a) * 210, vy: Math.sin(a) * 210, r: 6, col: MAGENTA });
        }
        sound.epew();
      }
      e.burstT -= dt;
      if (e.burstT <= 0) {
        e.burstT = 5.5;
        // Ring aus Kugeln
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2;
          ebullets.push({ x: e.x, y: e.y, vx: Math.cos(a) * 150, vy: Math.sin(a) * 150, r: 5, col: MAGENTA });
        }
      }
    } else {
      e.x += (e.vx || 0) * dt;
      e.y += e.vy * dt;
    }
    if (e.y > H + 40 || e.x < -60 || e.x > W + 60) {
      enemies.splice(enemies.indexOf(e), 1);
      continue;
    }
    // Kollision mit Spieler
    if (Math.hypot(e.x - player.x, e.y - player.y) < e.r + player.r - 4) {
      if (e.type !== "boss") killEnemy(e, true);
      hurtPlayer();
    }
  }

  // Treffer Spieler-Schüsse → Gegner
  for (const b of bullets) {
    for (const e of enemies) {
      if (Math.hypot(e.x - b.x, e.y - b.y) < e.r + b.r) {
        damage(e, b.dmg);
        if (b.pierce > 0) b.pierce--;
        else { b.dead = true; }
        break;
      }
    }
  }
  bullets = bullets.filter(b => !b.dead);

  // Gegner-Kugeln
  for (const b of ebullets) {
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    if (Math.hypot(b.x - player.x, b.y - player.y) < b.r + player.r - 4) {
      b.dead = true;
      hurtPlayer();
    }
  }
  ebullets = ebullets.filter(b => !b.dead && b.x > -20 && b.x < W + 20 && b.y > -20 && b.y < H + 20);

  // Sternenstaub
  for (const d of drops) {
    const dist = Math.hypot(d.x - player.x, d.y - player.y);
    if (dist < player.magnet) {
      const pull = 1 - dist / player.magnet;
      d.vx += (player.x - d.x) * pull * 26 * dt * 10;
      d.vy += (player.y - d.y) * pull * 26 * dt * 10;
    }
    d.vx *= 0.92; d.vy *= 0.92;
    d.x += d.vx * dt;
    d.y += d.vy * dt + 26 * dt;
    if (dist < 22) {
      d.dead = true;
      dust++;
      score += 2;
      sound.dust();
      updateNova();
      updateHud();
    }
  }
  drops = drops.filter(d => !d.dead && d.y < H + 30);

  // FX
  for (const p of particles) {
    p.t += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vx *= 0.98; p.vy *= 0.98;
  }
  particles = particles.filter(p => p.t < p.life);
  for (const r of rings) r.r += r.v * dt;
  rings = rings.filter(r => r.r < r.max);
  for (const f of floaters) f.t += dt;
  floaters = floaters.filter(f => f.t < 0.9);

  if (shakeT > 0) shakeT = Math.max(0, shakeT - dt);
}

// ---------- FX ----------
function burst(x, y, col, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = 60 + Math.random() * 300;
    particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: 0.4 + Math.random() * 0.5, col });
  }
}
function floatText(x, y, text, big) {
  floaters.push({ x, y, text, big, t: 0 });
}

// ---------- Rendering ----------
const starsL1 = Array.from({ length: 60 }, () => ({ x: Math.random(), y: Math.random(), r: 0.5 + Math.random() }));
const starsL2 = Array.from({ length: 25 }, () => ({ x: Math.random(), y: Math.random(), r: 1 + Math.random() * 1.4 }));
let scroll = 0;

function draw(now, dt) {
  ctx.clearRect(0, 0, W, H);
  scroll += dt * 40;

  let ox = 0, oy = 0;
  if (shakeT > 0) {
    ox = (Math.random() - 0.5) * 14 * shakeT;
    oy = (Math.random() - 0.5) * 14 * shakeT;
  }
  ctx.save();
  ctx.translate(ox, oy);

  // Nebel
  const neb = ctx.createRadialGradient(W * 0.7, H * 0.25 + Math.sin(now / 6000) * 30, 20, W * 0.7, H * 0.25, W * 0.8);
  neb.addColorStop(0, "rgba(120,80,200,0.10)");
  neb.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = neb;
  ctx.fillRect(0, 0, W, H);
  const neb2 = ctx.createRadialGradient(W * 0.2, H * 0.7, 20, W * 0.2, H * 0.7, W * 0.7);
  neb2.addColorStop(0, "rgba(60,140,180,0.08)");
  neb2.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = neb2;
  ctx.fillRect(0, 0, W, H);

  // Sterne (scrollen nach unten = Flug nach oben)
  ctx.fillStyle = "rgba(238,242,248,0.5)";
  for (const s of starsL1) {
    const y = (s.y * H + scroll * 0.4) % H;
    ctx.globalAlpha = 0.25 + 0.3 * Math.sin(now / 800 + s.x * 30) ** 2;
    ctx.fillRect(s.x * W, y, s.r, s.r);
  }
  ctx.globalAlpha = 0.7;
  for (const s of starsL2) {
    const y = (s.y * H + scroll) % H;
    ctx.fillRect(s.x * W, y, s.r, s.r * 2.4);
  }
  ctx.globalAlpha = 1;

  if (mode === "run" || mode === "choose" || mode === "dead") {
    // Sternenstaub
    for (const d of drops) {
      const tw = 0.6 + 0.4 * Math.sin(now / 180 + d.x);
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(now / 600);
      ctx.fillStyle = `rgba(232,193,90,${tw})`;
      ctx.fillRect(-3, -3, 6, 6);
      ctx.restore();
    }

    // Spieler-Schüsse
    for (const b of bullets) {
      ctx.fillStyle = GOLD;
      ctx.globalAlpha = 0.25;
      ctx.fillRect(b.x - 2.5, b.y - 14, 5, 20);
      ctx.globalAlpha = 1;
      ctx.fillRect(b.x - 1.5, b.y - 10, 3, 12);
    }

    // Gegner-Kugeln
    for (const b of ebullets) {
      ctx.fillStyle = b.col;
      ctx.globalAlpha = 0.3;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r + 4, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(b.x, b.y, b.r - 1.5, 0, Math.PI * 2); ctx.fill();
    }

    // Gegner
    for (const e of enemies) drawEnemy(e, now);

    // Spieler
    if (mode !== "dead") drawPlayer(now);
  }

  // Partikel
  for (const p of particles) {
    ctx.globalAlpha = 1 - p.t / p.life;
    ctx.fillStyle = p.col;
    ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
  }
  ctx.globalAlpha = 1;

  // Ringe
  for (const r of rings) {
    ctx.globalAlpha = Math.max(0, 1 - r.r / r.max);
    ctx.strokeStyle = r.col;
    ctx.lineWidth = r.w * (1 - r.r / r.max) + 2;
    ctx.beginPath(); ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Schwebende Punkte
  for (const f of floaters) {
    ctx.globalAlpha = 1 - f.t / 0.9;
    ctx.fillStyle = GOLD;
    ctx.font = `${f.big ? "800 22px" : "700 14px"} Outfit, sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(f.text, f.x, f.y - f.t * 46);
  }
  ctx.globalAlpha = 1;

  ctx.restore();
}

function drawPlayer(now) {
  const p = player;
  if (p.inv > 0 && Math.floor(now / 90) % 2 === 0) return; // Blinken

  // Triebwerk
  const fl = 10 + Math.random() * 8;
  const fg = ctx.createLinearGradient(p.x, p.y + 10, p.x, p.y + 10 + fl + 8);
  fg.addColorStop(0, "rgba(232,193,90,0.9)");
  fg.addColorStop(1, "rgba(232,120,60,0)");
  ctx.fillStyle = fg;
  ctx.beginPath();
  ctx.moveTo(p.x - 5, p.y + 10);
  ctx.lineTo(p.x + 5, p.y + 10);
  ctx.lineTo(p.x, p.y + 10 + fl + 8);
  ctx.closePath();
  ctx.fill();

  // Rumpf: goldener Pfeil
  const g = ctx.createLinearGradient(p.x, p.y - 16, p.x, p.y + 12);
  g.addColorStop(0, "#fff3c4");
  g.addColorStop(0.5, GOLD);
  g.addColorStop(1, "#8a6a1c");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y - 16);
  ctx.lineTo(p.x + 12, p.y + 10);
  ctx.lineTo(p.x + 4, p.y + 6);
  ctx.lineTo(p.x, p.y + 9);
  ctx.lineTo(p.x - 4, p.y + 6);
  ctx.lineTo(p.x - 12, p.y + 10);
  ctx.closePath();
  ctx.fill();
  // Cockpit
  ctx.fillStyle = "#0b1124";
  ctx.beginPath();
  ctx.arc(p.x, p.y - 3, 3.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = CYAN;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Schild
  if (p.shield > 0) {
    ctx.globalAlpha = 0.5 + 0.2 * Math.sin(now / 250);
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(p.x, p.y - 2, 22, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  }
}

function drawEnemy(e, now) {
  ctx.save();
  ctx.translate(e.x, e.y);
  const flash = e.flash > 0;
  const col = flash ? "#ffffff" : e.col;
  ctx.fillStyle = col;
  ctx.strokeStyle = col;

  if (e.type === "drone" || e.type === "mini") {
    const r = e.r;
    ctx.beginPath();
    ctx.moveTo(0, r);
    ctx.lineTo(r * 0.9, -r * 0.7);
    ctx.lineTo(0, -r * 0.3);
    ctx.lineTo(-r * 0.9, -r * 0.7);
    ctx.closePath();
    ctx.fill();
  } else if (e.type === "weber") {
    ctx.rotate(now / 400);
    ctx.beginPath();
    ctx.moveTo(0, -e.r); ctx.lineTo(e.r, 0); ctx.lineTo(0, e.r); ctx.lineTo(-e.r, 0);
    ctx.closePath();
    ctx.fill();
  } else if (e.type === "splitter") {
    ctx.rotate(now / 700);
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ctx[i ? "lineTo" : "moveTo"](Math.cos(a) * e.r, Math.sin(a) * e.r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#0b1124";
    ctx.beginPath(); ctx.arc(0, 0, e.r * 0.35, 0, Math.PI * 2); ctx.fill();
  } else if (e.type === "hunter") {
    ctx.beginPath();
    ctx.moveTo(0, e.r);
    ctx.lineTo(e.r, -e.r * 0.6);
    ctx.lineTo(0, 0);
    ctx.lineTo(-e.r, -e.r * 0.6);
    ctx.closePath();
    ctx.fill();
  } else if (e.type === "tank") {
    ctx.fillRect(-e.r * 0.85, -e.r * 0.7, e.r * 1.7, e.r * 1.4);
    ctx.fillStyle = "#0b1124";
    ctx.fillRect(-e.r * 0.4, -e.r * 0.25, e.r * 0.8, e.r * 0.5);
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(-e.r * 0.85, -e.r * 0.7, e.r * 1.7, e.r * 1.4);
  } else if (e.type === "boss") {
    ctx.rotate(Math.sin(now / 900) * 0.1);
    // Außenring
    ctx.globalAlpha = 0.35;
    ctx.beginPath(); ctx.arc(0, 0, e.r + 8 + Math.sin(now / 300) * 3, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + now / 1600;
      const rr = i % 2 ? e.r : e.r * 0.75;
      ctx[i ? "lineTo" : "moveTo"](Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#0b1124";
    ctx.beginPath(); ctx.arc(0, 0, e.r * 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = flash ? "#fff" : MAGENTA;
    ctx.beginPath(); ctx.arc(0, 0, e.r * 0.2 + Math.sin(now / 200) * 2, 0, Math.PI * 2); ctx.fill();
    // HP-Balken
    ctx.rotate(0);
    ctx.restore();
    ctx.save();
    const bw = 120;
    ctx.fillStyle = "rgba(238,242,248,0.15)";
    ctx.fillRect(e.x - bw / 2, e.y - e.r - 20, bw, 5);
    ctx.fillStyle = MAGENTA;
    ctx.fillRect(e.x - bw / 2, e.y - e.r - 20, bw * Math.max(0, e.hp / e.maxHp), 5);
  }
  ctx.restore();
}

// ---------- HUD ----------
function updateHud() {
  $("#hud-score").textContent = score;
  $("#hud-wave").textContent = wave || "–";
  const hearts = "♥".repeat(Math.max(0, player ? player.hp : 3));
  $("#hud-hearts").textContent = (player && player.shield > 0 ? "🛡" : "") + hearts;
  if (score > best) { best = score; localStorage.setItem("ss_best", best); }
}

// ---------- Loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  if (mode === "run") step(dt);
  draw(now, mode === "run" ? dt : dt * 0.3);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- Sound ----------
const sound = (() => {
  let ctxA = null, noiseBuf = null;
  let muted = localStorage.getItem("ss_muted") === "1";
  function ensure() {
    if (!ctxA) {
      try {
        ctxA = new (window.AudioContext || window.webkitAudioContext)();
        noiseBuf = ctxA.createBuffer(1, ctxA.sampleRate * 0.5, ctxA.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      } catch {}
    }
    return ctxA;
  }
  function tone(f0, f1, dur, type = "square", gain = 0.06, when = 0) {
    if (muted || !ensure()) return;
    const t = ctxA.currentTime + when;
    const o = ctxA.createOscillator();
    const g = ctxA.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(30, f1), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctxA.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  function noise(dur, gain = 0.12, freq = 800) {
    if (muted || !ensure()) return;
    const t = ctxA.currentTime;
    const src = ctxA.createBufferSource();
    src.buffer = noiseBuf;
    const filt = ctxA.createBiquadFilter();
    filt.type = "lowpass";
    filt.frequency.value = freq;
    const g = ctxA.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filt).connect(g).connect(ctxA.destination);
    src.start(t);
    src.stop(t + dur);
  }
  return {
    pew() { tone(880, 220, 0.09, "square", 0.025); },
    epew() { tone(330, 140, 0.12, "sawtooth", 0.03); },
    boom(big) { noise(big ? 0.7 : 0.25, big ? 0.22 : 0.12, big ? 500 : 900); if (big) tone(120, 40, 0.6, "sine", 0.15); },
    dust() { tone(1320, 1760, 0.06, "sine", 0.04); },
    pickup() { tone(660, 1320, 0.15, "triangle", 0.08); },
    shield() { tone(440, 880, 0.2, "sine", 0.08); },
    hit() { noise(0.3, 0.18, 600); tone(220, 60, 0.3, "sawtooth", 0.08); },
    nova() { noise(0.8, 0.25, 400); tone(80, 900, 0.5, "sine", 0.12); },
    alarm() { tone(520, 380, 0.3, "square", 0.05); tone(520, 380, 0.3, "square", 0.05, 0.4); },
    dead() { noise(0.9, 0.2, 400); tone(200, 40, 0.9, "sawtooth", 0.1); },
    fanfare() { [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.22, "sine", 0.1, i * 0.09)); },
    toggle() { muted = !muted; localStorage.setItem("ss_muted", muted ? "1" : "0"); return muted; },
    get muted() { return muted; },
  };
})();

// ---------- Screens ----------
function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function showMenu() {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="panel">
      <h2><span class="foil">Sternensturm</span></h2>
      <p class="sub">
        <b>Ziehen</b> = fliegen, gefeuert wird automatisch.<br>
        Sammle <b>Sternenstaub</b> — volle Leiste = <b>💥 NOVA</b> räumt alles.<br>
        Nach Bossen &amp; Schlüsselwellen wählst du <b>1 von 3 Upgrades</b>.<br>
        Wie viele Wellen überstehst du?
      </p>
      <button class="btn-primary" id="m-go">🚀 Starten</button>
      <button class="btn-secondary" id="m-top">🏆 Bestenliste</button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#m-go").onclick = () => {
    overlay.remove();
    newRun();
    mode = "run";
    updateNova();
  };
  overlay.querySelector("#m-top").onclick = () => showLeaderboard();
}

async function submitScore() {
  const name = getName();
  if (!name || score <= 0 || submitted) return null;
  submitted = true;
  try {
    const res = await fetch("/api/sternensturm/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, score }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error();
    return data;
  } catch {
    submitted = false;
    return null;
  }
}

async function gameOver() {
  $("#nova-btn").classList.add("hidden");
  const isRecord = score >= best && score > 0;
  if (isRecord) sound.fanfare();

  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="panel">
      <h2>${isRecord ? "Neuer Rekord!" : "Zerschellt!"}</h2>
      <div class="go-score">${score}</div>
      ${isRecord ? `<div class="go-best-badge">👑 Persönliche Bestleistung</div>` : `<div class="sub">Rekord: ${best}</div>`}
      <div class="go-stats">
        <span>🌊 Welle ${wave}</span>
        <span>💥 ${kills} Abschüsse</span>
      </div>
      <div class="go-rank" id="go-rank"></div>
      <div id="go-name-area"></div>
      <button class="btn-primary" id="go-again">🚀 Nochmal fliegen</button>
      <button class="btn-secondary" id="go-top">🏆 Bestenliste</button>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector("#go-again").onclick = () => {
    overlay.remove();
    newRun();
    mode = "run";
  };
  overlay.querySelector("#go-top").onclick = () => showLeaderboard();

  const rankEl = overlay.querySelector("#go-rank");
  const nameArea = overlay.querySelector("#go-name-area");

  if (!getName() && score > 0) {
    nameArea.innerHTML = `
      <p class="sub">Wie sollen wir dich in der Bestenliste nennen?</p>
      <input type="text" id="go-name" maxlength="16" placeholder="Dein Name" autocomplete="off">
      <button class="btn-secondary" id="go-save" style="margin-bottom:10px">Score eintragen</button>`;
    nameArea.querySelector("#go-save").onclick = async () => {
      const v = nameArea.querySelector("#go-name").value.trim().slice(0, 16);
      if (!v) return;
      localStorage.setItem("bb_name", v);
      nameArea.innerHTML = "";
      rankEl.textContent = "Übertrage …";
      const resp = await submitScore();
      rankEl.innerHTML = resp ? `Weltweit <b>Platz ${resp.rank}</b> als ${escHtml(v)}` : "Konnte nicht übertragen werden";
    };
  } else if (score > 0) {
    rankEl.textContent = "Übertrage …";
    const resp = await submitScore();
    rankEl.innerHTML = resp
      ? `Weltweit <b>Platz ${resp.rank}</b> als ${escHtml(getName())}${resp.best > score ? ` · dein Rekord: ${resp.best}` : ""}`
      : "Score konnte nicht übertragen werden";
  }
}

async function showLeaderboard() {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="panel">
      <h2><span class="foil">Bestenliste</span></h2>
      <p class="sub">Die 50 besten Piloten weltweit</p>
      <div id="lb-content"><p class="lb-empty">Lade …</p></div>
      <button class="btn-secondary" id="lb-close">Schließen</button>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) close(); };
  overlay.querySelector("#lb-close").onclick = close;

  try {
    const res = await fetch("/api/sternensturm/scores");
    const data = await res.json();
    const me = getName().toLowerCase();
    const medals = ["🥇", "🥈", "🥉"];
    const content = overlay.querySelector("#lb-content");
    if (!data.top?.length) {
      content.innerHTML = `<p class="lb-empty">Noch keine Einträge — sei die/der Erste!</p>`;
      return;
    }
    content.innerHTML = `<ol class="lb-list">${data.top.map((row, i) => `
      <li class="${row.name.toLowerCase() === me ? "me" : ""}">
        <span class="lb-rank">${medals[i] || i + 1}</span>
        <span class="lb-name">${escHtml(row.name)}</span>
        <span class="lb-score">${row.score}</span>
      </li>`).join("")}</ol>`;
  } catch {
    overlay.querySelector("#lb-content").innerHTML = `<p class="lb-empty">Bestenliste nicht erreichbar</p>`;
  }
}

// ---------- UI ----------
$("#btn-top").onclick = () => showLeaderboard();
const soundBtn = $("#btn-sound");
soundBtn.textContent = sound.muted ? "🔇" : "🔊";
soundBtn.onclick = () => { soundBtn.textContent = sound.toggle() ? "🔇" : "🔊"; };

// ---------- Start ----------
newRun();
if (new URLSearchParams(location.search).has("auto")) {
  mode = "run";
} else {
  showMenu();
}
