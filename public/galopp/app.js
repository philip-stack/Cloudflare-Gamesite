// ====================================================================
// GALOPP — Endless-Runner (2026)
//
// Du hast den Zuckerkristall des Einhorns stibitzt — und jetzt ist es
// SAUER. Renn! Wischen = Spur wechseln, hoch = springen, runter =
// ducken. Sammle Taler, schnapp dir Power-ups und lass das Einhorn
// nicht aufholen. Pseudo-3D komplett auf Canvas gerendert.
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
window.addEventListener("resize", () => { resize(); buildVignette(); buildRidges(); });
resize();

const GOLD = "#e8c15a", PINK = "#ff7ac2", VIOLET = "#b678ff",
      MINT = "#6fe3c1", RED = "#ff5a7a", CREAM = "#fff3c4";
const RAINBOW = ["#ff6b6b", "#ffa14d", "#ffe066", "#69d98a", "#56d5e8", "#b678ff"];

// ==================== Projektion ====================
// Pseudo-3D: t = NEAR/z ∈ (0..1], t=1 ist die Unterkante der Bühne.
// Der Weg schlängelt sich sanft (sway), das gibt Kurven-Gefühl.
const NEAR = 1, SPAWN_Z = 24, PLAYER_T = 0.78;
const PLAYER_Z = NEAR / PLAYER_T;
// Größenfaktoren: Läufer:in, Hindernisse und Items füllen die Bühne
// wie bei Temple Run — Kamera tief, Weg breit.
const RS = 1.45, OBS = 1.45, ITEMS = 1.3;
let sway = 0;

function horizonY() { return H * 0.34; }
function tOf(z) { return NEAR / Math.max(z, 0.55); }
function groundY(t) { return horizonY() + (H * 1.08 - horizonY()) * t; }
function centerX(t) { const d = 1 - Math.min(t, 1); return W / 2 + sway * d * d; }
function laneW() { return W * 0.36; }
function laneX(lane, t) { return centerX(t) + (lane - 1) * laneW() * t; }
function roadHalf(t) { return W * 0.62 * t; }

// ==================== Sprite-Werkstatt ====================
// Wiederkehrende Objekte werden EINMAL hochauflösend vorgerendert
// (Verläufe, Glow) und im Spiel nur noch skaliert geblittet.
function makeSprite(w, h, fn) {
  const c = document.createElement("canvas");
  const s = 2;
  c.width = w * s; c.height = h * s;
  const g = c.getContext("2d");
  g.scale(s, s);
  g.translate(w / 2, h / 2);
  fn(g, w, h);
  return { c, w, h };
}
// Blit mit Fußpunkt-Anker: (x, y) ist die Mitte der Unterkante.
function blitFoot(sp, x, y, scale = 1, alpha = 1) {
  if (scale <= 0.01 || alpha <= 0.01) return;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(scale, scale);
  ctx.globalAlpha = alpha;
  ctx.drawImage(sp.c, -sp.w / 2, -sp.h, sp.w, sp.h);
  ctx.restore();
}

const SPR = {};

// --- Zuckerstangen-Hürde (springen!) ---
SPR.hurdle = makeSprite(120, 64, g => {
  g.translate(0, -32);
  const post = (x) => {
    const gr = g.createLinearGradient(x - 5, 0, x + 5, 0);
    gr.addColorStop(0, "#fff"); gr.addColorStop(0.5, "#ffd9ec"); gr.addColorStop(1, "#e58ab8");
    g.fillStyle = gr;
    g.beginPath(); g.roundRect(x - 5, -22, 10, 54, 4); g.fill();
    // Candy-Streifen
    g.save();
    g.beginPath(); g.roundRect(x - 5, -22, 10, 54, 4); g.clip();
    g.fillStyle = "rgba(255, 90, 140, 0.85)";
    for (let sY = -26; sY < 34; sY += 12) {
      g.beginPath();
      g.moveTo(x - 6, sY); g.lineTo(x + 6, sY + 6);
      g.lineTo(x + 6, sY + 11); g.lineTo(x - 6, sY + 5);
      g.closePath(); g.fill();
    }
    g.restore();
    // Kugel oben
    g.fillStyle = "#ffe6f3";
    g.beginPath(); g.arc(x, -24, 6, 0, Math.PI * 2); g.fill();
    g.fillStyle = "rgba(255,255,255,0.9)";
    g.beginPath(); g.arc(x - 2, -26, 2, 0, Math.PI * 2); g.fill();
  };
  const rail = (y) => {
    g.shadowColor = PINK; g.shadowBlur = 8;
    const gr = g.createLinearGradient(0, y - 4, 0, y + 4);
    gr.addColorStop(0, "#fff"); gr.addColorStop(0.55, "#ffb3d9"); gr.addColorStop(1, "#d9679f");
    g.fillStyle = gr;
    g.beginPath(); g.roundRect(-54, y - 4, 108, 8, 4); g.fill();
    g.shadowBlur = 0;
  };
  post(-46); post(46);
  rail(-14); rail(6);
});

// --- Rainbow-Girlande (ducken!) — hängt in Kopfhöhe ---
SPR.arch = makeSprite(130, 88, g => {
  g.translate(0, -88);
  // Seil
  g.strokeStyle = "#d9c9a0";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(-62, 4); g.quadraticCurveTo(0, 22, 62, 4);
  g.stroke();
  // Wimpel
  for (let i = 0; i < 6; i++) {
    const u = i / 5;
    const x = -52 + u * 104;
    const y = 6 + Math.sin(u * Math.PI) * 15;
    g.fillStyle = RAINBOW[i];
    g.shadowColor = RAINBOW[i]; g.shadowBlur = 7;
    g.beginPath();
    g.moveTo(x - 8, y); g.lineTo(x + 8, y); g.lineTo(x, y + 18);
    g.closePath(); g.fill();
    g.shadowBlur = 0;
  }
  // Laternen an den Enden
  for (const x of [-62, 62]) {
    g.fillStyle = CREAM;
    g.shadowColor = GOLD; g.shadowBlur = 10;
    g.beginPath(); g.arc(x, 4, 5.5, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
  }
});

// --- Kristallfels (nur ausweichen!) ---
SPR.rock = makeSprite(110, 110, g => {
  const shard = (x, w, h, hue) => {
    g.shadowColor = hue; g.shadowBlur = 16;
    const gr = g.createLinearGradient(x, -h, x, 0);
    gr.addColorStop(0, "#f0e0ff"); gr.addColorStop(0.35, hue); gr.addColorStop(1, "#3a1d5e");
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(x, -h);
    g.lineTo(x + w * 0.55, -h * 0.28);
    g.lineTo(x + w * 0.38, 0);
    g.lineTo(x - w * 0.38, 0);
    g.lineTo(x - w * 0.55, -h * 0.32);
    g.closePath(); g.fill();
    g.shadowBlur = 0;
    // Facetten-Linie
    g.strokeStyle = "rgba(255,255,255,0.35)";
    g.lineWidth = 1.4;
    g.beginPath(); g.moveTo(x, -h); g.lineTo(x - w * 0.1, 0); g.stroke();
  };
  shard(-28, 44, 62, VIOLET);
  shard(30, 40, 52, "#8f5aff");
  shard(0, 52, 96, "#c78aff");
  // Basis-Schutt
  g.fillStyle = "#2b1440";
  g.beginPath(); g.ellipse(0, -2, 50, 9, 0, 0, Math.PI * 2); g.fill();
});

// --- Sterntaler ---
SPR.coin = makeSprite(34, 34, g => {
  g.translate(0, -17);
  g.shadowColor = GOLD; g.shadowBlur = 12;
  const gr = g.createRadialGradient(-3, -4, 2, 0, 0, 15);
  gr.addColorStop(0, CREAM); gr.addColorStop(0.6, GOLD); gr.addColorStop(1, "#a37a1e");
  g.fillStyle = gr;
  g.beginPath(); g.arc(0, 0, 13, 0, Math.PI * 2); g.fill();
  g.shadowBlur = 0;
  g.strokeStyle = "rgba(255, 245, 200, 0.8)";
  g.lineWidth = 1.6;
  g.beginPath(); g.arc(0, 0, 10, 0, Math.PI * 2); g.stroke();
  // Stern
  g.fillStyle = "#8a6a1c";
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 3 : 7;
    const a = -Math.PI / 2 + i * Math.PI / 5;
    g[i ? "lineTo" : "moveTo"](Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath(); g.fill();
});

// --- Funkel-Juwel (5 Taler) ---
SPR.gem = makeSprite(36, 40, g => {
  g.translate(0, -20);
  g.shadowColor = PINK; g.shadowBlur = 14;
  const gr = g.createLinearGradient(0, -16, 0, 16);
  gr.addColorStop(0, "#ffe0f0"); gr.addColorStop(0.5, PINK); gr.addColorStop(1, "#b03a78");
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(0, -16); g.lineTo(13, -4); g.lineTo(0, 17); g.lineTo(-13, -4);
  g.closePath(); g.fill();
  g.shadowBlur = 0;
  g.strokeStyle = "rgba(255,255,255,0.45)";
  g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(-13, -4); g.lineTo(13, -4); g.moveTo(0, -16); g.lineTo(0, 17);
  g.stroke();
});

// --- Power-ups ---
function powSprite(emoji, color) {
  return makeSprite(46, 46, g => {
    g.translate(0, -23);
    g.shadowColor = color; g.shadowBlur = 16;
    const gr = g.createRadialGradient(-4, -6, 3, 0, 0, 21);
    gr.addColorStop(0, "rgba(255,255,255,0.95)");
    gr.addColorStop(0.45, color);
    gr.addColorStop(1, "rgba(20,10,34,0.9)");
    g.fillStyle = gr;
    g.beginPath(); g.arc(0, 0, 19, 0, Math.PI * 2); g.fill();
    g.shadowBlur = 0;
    g.strokeStyle = "rgba(255,255,255,0.5)";
    g.lineWidth = 1.6;
    g.beginPath(); g.arc(0, 0, 19, 0, Math.PI * 2); g.stroke();
    g.font = "20px system-ui";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(emoji, 0, 1);
  });
}
SPR.magnet = powSprite("🧲", "#ff6b6b");
SPR.shield = powSprite("🛡️", MINT);
SPR.boost = powSprite("⚡", GOLD);

// --- Kulisse: Kristallbaum ---
SPR.tree = makeSprite(90, 150, g => {
  g.translate(0, 0);
  const branch = (x, w, h, hue) => {
    g.shadowColor = hue; g.shadowBlur = 12;
    const gr = g.createLinearGradient(x, -h, x, 0);
    gr.addColorStop(0, "#e8d9ff"); gr.addColorStop(0.4, hue); gr.addColorStop(1, "#241238");
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(x, -h); g.lineTo(x + w / 2, 0); g.lineTo(x - w / 2, 0);
    g.closePath(); g.fill();
    g.shadowBlur = 0;
  };
  branch(-22, 30, 82, "#8f5aff");
  branch(24, 26, 70, "#c78aff");
  branch(0, 36, 140, VIOLET);
});

// --- Kulisse: Riesen-Zuckerpilz ---
SPR.mushroom = makeSprite(80, 90, g => {
  // Stiel
  const sg = g.createLinearGradient(-8, 0, 10, 0);
  sg.addColorStop(0, "#fff6ea"); sg.addColorStop(1, "#d9bfa0");
  g.fillStyle = sg;
  g.beginPath(); g.roundRect(-9, -46, 18, 46, 6); g.fill();
  // Hut
  g.shadowColor = PINK; g.shadowBlur = 14;
  const hg = g.createLinearGradient(0, -78, 0, -38);
  hg.addColorStop(0, "#ffa8d4"); hg.addColorStop(1, "#c74d8c");
  g.fillStyle = hg;
  g.beginPath();
  g.moveTo(-36, -42);
  g.quadraticCurveTo(0, -92, 36, -42);
  g.quadraticCurveTo(0, -30, -36, -42);
  g.closePath(); g.fill();
  g.shadowBlur = 0;
  // Punkte
  g.fillStyle = "rgba(255, 245, 235, 0.9)";
  for (const [px, py, r] of [[-16, -56, 5], [8, -66, 4], [22, -50, 5.5]]) {
    g.beginPath(); g.arc(px, py, r, 0, Math.PI * 2); g.fill();
  }
});

// --- Kulisse: schwebende Laterne ---
SPR.lantern = makeSprite(40, 120, g => {
  g.translate(0, -60);
  g.strokeStyle = "rgba(232, 193, 90, 0.35)";
  g.lineWidth = 1.5;
  g.beginPath(); g.moveTo(0, -14); g.lineTo(0, 58); g.stroke();
  g.shadowColor = GOLD; g.shadowBlur = 20;
  const gr = g.createRadialGradient(0, -26, 2, 0, -26, 15);
  gr.addColorStop(0, "#fffbe8"); gr.addColorStop(0.55, GOLD); gr.addColorStop(1, "rgba(163, 122, 30, 0.25)");
  g.fillStyle = gr;
  g.beginPath(); g.arc(0, -26, 13, 0, Math.PI * 2); g.fill();
  g.shadowBlur = 0;
});

// --- Bordstein-Kristalle (säumen den Weg) ---
SPR.edgeA = makeSprite(26, 30, g => {
  g.shadowColor = VIOLET; g.shadowBlur = 8;
  const gr = g.createLinearGradient(0, -26, 0, 0);
  gr.addColorStop(0, "#e8d9ff"); gr.addColorStop(0.5, VIOLET); gr.addColorStop(1, "#2b1440");
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(0, -26); g.lineTo(9, -8); g.lineTo(6, 0); g.lineTo(-6, 0); g.lineTo(-9, -10);
  g.closePath(); g.fill();
  g.shadowBlur = 0;
});
SPR.edgeB = makeSprite(26, 24, g => {
  g.shadowColor = PINK; g.shadowBlur = 8;
  const gr = g.createLinearGradient(0, -20, 0, 0);
  gr.addColorStop(0, "#ffe0f0"); gr.addColorStop(0.5, PINK); gr.addColorStop(1, "#3a1030");
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(-2, -20); g.lineTo(8, -6); g.lineTo(5, 0); g.lineTo(-7, 0); g.lineTo(-9, -8);
  g.closePath(); g.fill();
  g.shadowBlur = 0;
});

// --- Weiche Wolke ---
SPR.cloud = makeSprite(180, 70, g => {
  g.translate(0, -35);
  g.fillStyle = "rgba(255, 250, 255, 0.85)";
  for (const [cx2, cy2, r] of [[-52, 8, 22], [-18, -6, 30], [22, 0, 26], [54, 10, 18], [0, 12, 34]]) {
    g.beginPath(); g.arc(cx2, cy2, r, 0, Math.PI * 2); g.fill();
  }
});

// Ambient: Wolken + Glühwürmchen für Tiefe
const clouds = [
  { y: 0.18, sc: 1.3, sp: 5, x0: 0.15 },
  { y: 0.42, sc: 0.9, sp: 9, x0: 0.6 },
  { y: 0.3, sc: 0.65, sp: 13, x0: 0.9 },
];
const flies = [];
for (let i = 0; i < 16; i++) {
  flies.push({
    x0: Math.random(), y0: 0.42 + Math.random() * 0.4,
    ph: Math.random() * Math.PI * 2,
    r: 1.2 + Math.random() * 1.8,
    col: i % 3 === 0 ? MINT : i % 3 === 1 ? GOLD : "#ffd9ec",
    sp: 20 + Math.random() * 40,
  });
}

// ==================== Zonen / Farbwelten ====================
const ZONES = [
  {
    name: "Zuckerwiese", sub: "Zone 1",
    sky: ["#3b1d5e", "#8f3a78", "#ff9a80"],
    ground: ["#3a8a5c", "#245e3f"],
    road: ["#7a5499", "#553a73"],
    ridge: "#4a2668", stars: 0.12,
  },
  {
    name: "Kristallwald", sub: "Zone 2",
    sky: ["#081a33", "#14405e", "#2f7a99"],
    ground: ["#1e5c66", "#153e4c"],
    road: ["#2f5478", "#203a57"],
    ridge: "#12304a", stars: 0.65,
  },
  {
    name: "Glutfelder", sub: "Zone 3",
    sky: ["#2b0d12", "#8a3320", "#ffb366"],
    ground: ["#7a4226", "#54301e"],
    road: ["#8a5438", "#5e3a28"],
    ridge: "#571f14", stars: 0.2,
  },
  {
    name: "Sternenpass", sub: "Zone 4",
    sky: ["#04050f", "#0d1233", "#28306b"],
    ground: ["#28306b", "#1a2140"],
    road: ["#3a446b", "#272f57"],
    ridge: "#141a3d", stars: 1,
  },
];
const ZONE_LEN = 450; // Meter pro Zone

function hexRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}
function mixHex(a, b, u) {
  const A = hexRgb(a), B = hexRgb(b);
  return `rgb(${Math.round(A[0] + (B[0] - A[0]) * u)},${Math.round(A[1] + (B[1] - A[1]) * u)},${Math.round(A[2] + (B[2] - A[2]) * u)})`;
}
// Aktuelle Palette (weich zwischen Zonen überblendet)
function palette(meters) {
  const zi = Math.floor(meters / ZONE_LEN);
  const a = ZONES[zi % ZONES.length];
  const b = ZONES[(zi + 1) % ZONES.length];
  const into = meters - zi * ZONE_LEN;
  const u = Math.max(0, Math.min(1, (into - (ZONE_LEN - 60)) / 60)); // letzte 60 m blenden
  const mixArr = (ka) => a[ka].map((c, i) => mixHex(c, b[ka][i], u));
  return {
    sky: mixArr("sky"), ground: mixArr("ground"), road: mixArr("road"),
    ridge: mixHex(a.ridge, b.ridge, u),
    stars: a.stars + (b.stars - a.stars) * u,
  };
}

// ==================== Spielzustand ====================
let mode = "menu"; // menu | run | catch | over | pause
let o = 0;              // Welt-Offset (zurückgelegte Einheiten)
let speed = 0, meters = 0, coins = 0, score = 0;
let laneTarget = 1, laneCur = 1;
let jumpH = 0, jumpV = 0, sliding = 0;
let stumbleT = 0, invuln = 0, runPhase = 0;
let chase = 0.5;        // Einhorn-Nähe 0..1 (1 = erwischt)
let catchT = 0;
let shake = 0, flash = 0;
let magnetT = 0, boostT = 0, shieldOn = false;
let coinCombo = 0, comboT = 0;
let zoneShown = -1;
let nextSpawnW = 0, nextScenW = 0, nextPowM = 0;
let entities = [], sceneries = [], particles = [];
let submitted = false;
let stars = [];

const BASE_SPEED = 6.4, MAX_SPEED = 13.5;
const JUMP_V = 500, GRAV = 1400;
const SLIDE_DUR = 0.58;

function getName() { return (localStorage.getItem("bb_name") || "").trim(); }
let best = Number(localStorage.getItem("galopp_best") || 0);

function newRun() {
  o = 0; speed = BASE_SPEED; meters = 0; coins = 0; score = 0;
  laneTarget = 1; laneCur = 1;
  jumpH = 0; jumpV = 0; sliding = 0;
  stumbleT = 0; invuln = 0; runPhase = 0;
  chase = 0.5; catchT = 0; shake = 0; flash = 0;
  magnetT = 0; boostT = 0; shieldOn = false;
  coinCombo = 0; comboT = 0; zoneShown = -1;
  nextSpawnW = 14; nextScenW = 2; nextPowM = 180 + Math.random() * 120;
  entities = []; sceneries = []; particles = [];
  submitted = false;
  buildStars();
  updateHud(true);
  updatePills();
}

function buildStars() {
  stars = [];
  for (let i = 0; i < 70; i++) {
    stars.push({
      x: Math.random(), y: Math.random() * 0.9,
      r: 0.5 + Math.random() * 1.3, tw: Math.random() * Math.PI * 2,
    });
  }
}
buildStars();

// Bergrücken-Silhouetten (2 Parallax-Ebenen)
let ridges = [];
function buildRidges() {
  ridges = [0.35, 0.7].map((amp, li) => {
    const pts = [];
    const n = 24;
    for (let i = 0; i <= n; i++) {
      pts.push(0.25 + Math.abs(Math.sin(i * (2.7 + li * 1.3)) * 0.5 + Math.sin(i * 0.9 + li * 5) * 0.5) * amp);
    }
    return { pts, li };
  });
}
buildRidges();

// ==================== Spawner ====================
function difficulty() { return Math.min(1, meters / 1400); }

function spawnEvent(wz) {
  const d = difficulty();
  const r = Math.random();
  const lanes = [0, 1, 2];

  if (r < 0.16) {
    // Nur Taler
    spawnCoinPattern(wz, lanes[Math.floor(Math.random() * 3)]);
    return;
  }
  if (r < 0.30 && meters > 120) {
    // Ganze Breite: springen oder ducken
    const kind = Math.random() < 0.5 ? "hurdle" : "arch";
    entities.push({ type: "ob", kind, lane: -1, wz, passed: false });
    if (kind === "hurdle" && Math.random() < 0.6) spawnCoinArc(wz, Math.floor(Math.random() * 3));
    return;
  }
  // 1–2 Spuren blockiert (nie alle 3)
  const nBlock = (meters > 250 && Math.random() < 0.35 + d * 0.35) ? 2 : 1;
  const shuffled = lanes.sort(() => Math.random() - 0.5);
  for (let i = 0; i < nBlock; i++) {
    const kinds = ["hurdle", "arch", "rock"];
    const kind = kinds[Math.floor(Math.random() * (meters > 60 ? 3 : 2))];
    entities.push({ type: "ob", kind, lane: shuffled[i], wz: wz + (i ? Math.random() * 1.2 : 0), passed: false });
  }
  // Belohnung auf der freien Spur
  if (Math.random() < 0.45) spawnCoinPattern(wz + 1.5, shuffled[nBlock]);
}

function spawnCoinPattern(wz, lane) {
  const style = Math.random();
  if (style < 0.6) {
    // Linie
    const n = 5 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      entities.push({ type: "coin", kind: "coin", lane, lanePos: lane, wz: wz + i * 0.75, h: 26, taken: false });
    }
  } else if (style < 0.85) {
    // Zickzack über zwei Spuren
    const l2 = lane === 2 ? 1 : lane + 1;
    for (let i = 0; i < 8; i++) {
      const l = i % 4 < 2 ? lane : l2;
      entities.push({ type: "coin", kind: "coin", lane: l, lanePos: l, wz: wz + i * 0.75, h: 26, taken: false });
    }
  } else {
    // Juwel
    entities.push({ type: "coin", kind: "gem", lane, lanePos: lane, wz: wz + 1, h: 30, taken: false });
  }
}

function spawnCoinArc(wz, lane) {
  // Bogen überm Hindernis — belohnt den Sprung
  for (let i = 0; i < 5; i++) {
    const u = i / 4;
    entities.push({
      type: "coin", kind: "coin", lane, lanePos: lane,
      wz: wz - 1.2 + u * 2.4,
      h: 26 + Math.sin(u * Math.PI) * 56, taken: false,
    });
  }
}

function spawnPowerup(wz) {
  const kinds = ["magnet", "shield", "boost"];
  const kind = kinds[Math.floor(Math.random() * 3)];
  const lane = Math.floor(Math.random() * 3);
  entities.push({ type: "pow", kind, lane, lanePos: lane, wz, h: 30, taken: false });
}

function spawnScenery(wz) {
  const kinds = ["tree", "mushroom", "lantern", "tree"];
  sceneries.push({
    kind: kinds[Math.floor(Math.random() * kinds.length)],
    side: Math.random() < 0.5 ? -1 : 1,
    off: 40 + Math.random() * 130,
    sc: 0.8 + Math.random() * 0.7,
    wz,
  });
}

// ==================== Partikel ====================
function puff(x, y, color, n = 10, spd = 120, up = 0) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = spd * (0.4 + Math.random() * 0.8);
    particles.push({
      x, y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v - up,
      life: 0.5 + Math.random() * 0.4, age: 0,
      size: 2 + Math.random() * 3.5, color,
      grav: 300,
    });
  }
}
function sparkleTrail(x, y, color) {
  particles.push({
    x: x + (Math.random() - 0.5) * 16, y: y - Math.random() * 30,
    vx: (Math.random() - 0.5) * 30, vy: 40 + Math.random() * 60,
    life: 0.4 + Math.random() * 0.3, age: 0,
    size: 1.5 + Math.random() * 2.5, color, grav: 0,
  });
}

// ==================== Eingabe ====================
function doJump() {
  if (mode !== "run" || jumpH > 0) return;
  sliding = 0;
  jumpV = JUMP_V;
  jumpH = 0.01;
  sound.jump();
}
function doSlide() {
  if (mode !== "run") return;
  if (jumpH > 0) { jumpV = -JUMP_V * 1.4; } // Slam aus dem Sprung
  sliding = SLIDE_DUR;
  sound.slide();
}
function doLane(dir) {
  if (mode !== "run") return;
  const nl = Math.max(0, Math.min(2, laneTarget + dir));
  if (nl !== laneTarget) { laneTarget = nl; sound.whoosh(); }
}

let touchStart = null;
stage.addEventListener("pointerdown", e => {
  touchStart = { x: e.clientX, y: e.clientY, t: performance.now() };
});
stage.addEventListener("pointerup", e => {
  if (!touchStart) return;
  const dx = e.clientX - touchStart.x, dy = e.clientY - touchStart.y;
  touchStart = null;
  if (Math.abs(dx) > 26 && Math.abs(dx) > Math.abs(dy)) doLane(dx > 0 ? 1 : -1);
  else if (dy < -26) doJump();
  else if (dy > 26) doSlide();
  else doJump(); // Tippen = springen
});
window.addEventListener("keydown", e => {
  if (e.repeat) return;
  switch (e.key) {
    case "ArrowLeft": case "a": doLane(-1); break;
    case "ArrowRight": case "d": doLane(1); break;
    case "ArrowUp": case "w": case " ": doJump(); e.preventDefault(); break;
    case "ArrowDown": case "s": doSlide(); break;
    case "p": togglePause(); break;
  }
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && mode === "run") togglePause(true);
});
function togglePause(force) {
  if (mode === "run" || force) {
    if (mode !== "run") return;
    mode = "pause";
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.id = "pause-overlay";
    overlay.innerHTML = `
      <div class="panel">
        <h2>Pause</h2>
        <p class="sub">Das Einhorn wartet … noch.</p>
        <button class="btn-primary" id="p-go">▶️ Weiterrennen</button>
      </div>`;
    document.body.appendChild(overlay);
    overlay.querySelector("#p-go").onclick = () => { overlay.remove(); mode = "run"; };
  }
}

// ==================== Treffer-Logik ====================
function hitObstacle(e) {
  const px = laneX(laneCur, PLAYER_T), py = groundY(PLAYER_T);
  if (boostT > 0 || shieldOn) {
    // Durchbrechen!
    if (boostT <= 0) { shieldOn = false; updatePills(); sound.shieldPop(); }
    puff(px, py - 40, e.kind === "rock" ? VIOLET : PINK, 18, 220, 120);
    shake = Math.max(shake, 0.25);
    return;
  }
  if (invuln > 0) return;
  // Stolpern — das Einhorn holt auf!
  const gain = e.kind === "rock" ? 0.5 : 0.4;
  chase = Math.min(1, chase + gain);
  speed *= 0.5;
  invuln = 1.3;
  stumbleT = 0.5;
  shake = 0.6;
  flash = 0.35;
  coinCombo = 0;
  sound.stumble();
  puff(px, py - 20, "#c9b8d9", 14, 160, 80);
  if (chase >= 1) startCatch();
}

function startCatch() {
  mode = "catch";
  catchT = 0;
  sound.caught();
}

// ==================== Update ====================
function update(dt) {
  if (mode === "catch") {
    catchT += dt;
    speed = Math.max(0, speed - dt * 14);
    o += speed * dt;
    runPhase += speed * dt * 1.6;
    updateParticles(dt);
    if (catchT > 1.15) { mode = "over"; gameOver(); }
    return;
  }
  if (mode !== "run") { updateParticles(dt); return; }

  const d = difficulty();
  // Tempo
  const targetSpeed = (BASE_SPEED + (MAX_SPEED - BASE_SPEED) * d) * (boostT > 0 ? 1.75 : 1);
  speed += (targetSpeed - speed) * Math.min(1, dt * (stumbleT > 0 ? 0.8 : 1.6));
  o += speed * dt;
  meters += speed * dt * 3;
  runPhase += speed * dt * 1.55;
  sway = Math.sin(o * 0.085) * W * 0.09 + Math.sin(o * 0.021) * W * 0.05;

  // Zonen-Banner
  const zi = Math.floor(meters / ZONE_LEN);
  if (zi !== zoneShown) {
    zoneShown = zi;
    const z = ZONES[zi % ZONES.length];
    const banner = $("#zone-banner");
    banner.innerHTML = `<small>${z.sub === "Zone 1" && zi === 0 ? "Los!" : "Zone " + (zi + 1)}</small>${z.name}`;
    banner.classList.remove("hidden");
    banner.style.animation = "none";
    void banner.offsetWidth;
    banner.style.animation = "";
    if (zi > 0) sound.zone();
  }

  // Timer
  if (magnetT > 0) { magnetT -= dt; if (magnetT <= 0) updatePills(); }
  if (boostT > 0) { boostT -= dt; if (boostT <= 0) updatePills(); }
  if (invuln > 0) invuln -= dt;
  if (stumbleT > 0) stumbleT -= dt;
  if (comboT > 0) { comboT -= dt; if (comboT <= 0) coinCombo = 0; }
  if (shake > 0) shake = Math.max(0, shake - dt * 2.2);
  if (flash > 0) flash = Math.max(0, flash - dt * 1.8);

  // Einhorn schleicht sich zurück, wenn du sauber läufst
  const decay = boostT > 0 ? 0.14 : 0.032;
  chase = Math.max(0.08, chase - decay * dt);
  $("#chase-fill").style.width = (chase * 100).toFixed(1) + "%";
  $("#chase-horse").style.right = (chase * 100).toFixed(1) + "%";
  $("#chase-bar").classList.toggle("danger", chase > 0.72);
  if (chase > 0.6 && Math.floor(runPhase / Math.PI) !== Math.floor((runPhase - speed * dt * 1.55) / Math.PI)) {
    sound.gallop(chase);
  }

  // Spur / Sprung / Slide
  laneCur += (laneTarget - laneCur) * Math.min(1, dt * 11);
  if (jumpH > 0 || jumpV > 0) {
    jumpH += jumpV * dt;
    jumpV -= GRAV * dt;
    if (jumpH <= 0) {
      jumpH = 0; jumpV = 0;
      puff(laneX(laneCur, PLAYER_T), groundY(PLAYER_T), "rgba(220,200,240,0.7)", 5, 80);
    }
  }
  if (sliding > 0) sliding -= dt;

  // Boost-Funken
  if (boostT > 0) {
    sparkleTrail(laneX(laneCur, PLAYER_T), groundY(PLAYER_T) - jumpH, RAINBOW[Math.floor(Math.random() * 6)]);
  }

  // Spawnen
  while (nextSpawnW < o + SPAWN_Z) {
    spawnEvent(nextSpawnW);
    nextSpawnW += 4.6 - d * 1.7 + Math.random() * 1.6;
  }
  while (nextScenW < o + SPAWN_Z) {
    spawnScenery(nextScenW);
    nextScenW += 0.9 + Math.random() * 1.4;
  }
  if (meters > nextPowM) {
    spawnPowerup(o + SPAWN_Z - 1);
    nextPowM = meters + 280 + Math.random() * 180;
  }

  // Entities
  const px = laneX(laneCur, PLAYER_T);
  for (const e of entities) {
    const z = e.wz - o;
    if (e.type === "coin" && !e.taken) {
      // Magnet zieht Taler heran
      if (magnetT > 0 && z < PLAYER_Z + 5 && z > PLAYER_Z - 0.5) {
        e.lanePos += (laneCur - e.lanePos) * Math.min(1, dt * 8);
        e.h += (jumpH + 26 - e.h) * Math.min(1, dt * 8);
      }
      if (Math.abs(z - PLAYER_Z) < 0.42 && Math.abs(e.lanePos - laneCur) < 0.55 &&
          Math.abs((jumpH + 26) - e.h) < 52) {
        e.taken = true;
        const v = e.kind === "gem" ? 5 : 1;
        coins += v;
        coinCombo++;
        comboT = 1.4;
        sound.coin(Math.min(coinCombo, 12));
        const cy = groundY(tOf(z)) - e.h * tOf(z) / PLAYER_T;
        puff(laneX(e.lanePos, tOf(z)), cy, e.kind === "gem" ? PINK : GOLD, 7, 100, 60);
      }
    } else if (e.type === "pow" && !e.taken) {
      if (Math.abs(z - PLAYER_Z) < 0.45 && Math.abs(e.lane - laneCur) < 0.55) {
        e.taken = true;
        sound.power();
        if (e.kind === "magnet") magnetT = 8;
        if (e.kind === "shield") shieldOn = true;
        if (e.kind === "boost") { boostT = 3.2; chase = Math.max(0.08, chase - 0.15); sound.boost(); }
        updatePills();
        puff(px, groundY(PLAYER_T) - 46, e.kind === "shield" ? MINT : e.kind === "boost" ? GOLD : "#ff6b6b", 14, 160, 80);
      }
    } else if (e.type === "ob" && !e.passed) {
      if (z < PLAYER_Z + 0.12 && z > PLAYER_Z - 0.3) {
        const inLane = e.lane === -1 || Math.abs(e.lane - laneCur) < 0.5;
        if (inLane) {
          e.passed = true;
          const cleared =
            (e.kind === "hurdle" && jumpH > 30) ||
            (e.kind === "arch" && sliding > 0);
          if (!cleared) hitObstacle(e);
        }
      }
      if (z < PLAYER_Z - 0.3) e.passed = true;
    }
  }
  entities = entities.filter(e => e.wz - o > 0.6 && !(e.taken));
  sceneries = sceneries.filter(s => s.wz - o > 0.6);

  score = Math.floor(meters) + coins * 10;
  updateHud();
  updateParticles(dt);
}

function updateParticles(dt) {
  for (const p of particles) {
    p.age += dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += p.grav * dt;
  }
  particles = particles.filter(p => p.age < p.life);
}

let hudCache = "";
function updateHud(force) {
  const key = score + "|" + coins + "|" + Math.floor(meters);
  if (!force && key === hudCache) return;
  hudCache = key;
  $("#hud-score").textContent = score;
  $("#hud-dist").textContent = Math.floor(meters) + " m";
  $("#hud-coins").textContent = coins;
}

function updatePills() {
  const el = $("#power-pills");
  let html = "";
  if (shieldOn) html += `<span class="pill">🛡️</span>`;
  if (magnetT > 0) html += `<span class="pill">🧲 <span class="p-time">${Math.ceil(magnetT)}</span></span>`;
  if (boostT > 0) html += `<span class="pill">⚡ <span class="p-time">${Math.ceil(boostT)}</span></span>`;
  el.innerHTML = html;
}
setInterval(() => { if (mode === "run" && (magnetT > 0 || boostT > 0)) updatePills(); }, 500);

// ==================== Render ====================
let vignette = null;
function buildVignette() {
  vignette = document.createElement("canvas");
  vignette.width = W; vignette.height = H;
  const g = vignette.getContext("2d");
  const gr = g.createRadialGradient(W / 2, H * 0.45, Math.min(W, H) * 0.45, W / 2, H * 0.55, Math.max(W, H) * 0.78);
  gr.addColorStop(0, "rgba(0,0,0,0)");
  gr.addColorStop(1, "rgba(5,2,12,0.5)");
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
}
buildVignette();

function render(now) {
  const pal = palette(meters);
  const hY = horizonY();

  ctx.clearRect(0, 0, W, H);
  ctx.save();
  if (shake > 0) {
    ctx.translate((Math.random() - 0.5) * shake * 14, (Math.random() - 0.5) * shake * 14);
  }
  // Kamera: läuft mit (Kopf-Wippen) und lehnt sich in den Spurwechsel
  if (mode === "run" || mode === "catch") {
    const camBob = jumpH > 2 ? 0 : Math.abs(Math.sin(runPhase)) * 3;
    ctx.translate(W / 2, H / 2);
    ctx.rotate((laneTarget - laneCur) * 0.022);
    ctx.translate(-W / 2, -H / 2 + camBob);
  }

  // --- Himmel ---
  const sky = ctx.createLinearGradient(0, 0, 0, hY * 1.25);
  sky.addColorStop(0, pal.sky[0]);
  sky.addColorStop(0.62, pal.sky[1]);
  sky.addColorStop(1, pal.sky[2]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, hY * 1.3);

  // Sterne
  if (pal.stars > 0.05) {
    for (const s of stars) {
      const a = pal.stars * (0.4 + 0.6 * Math.abs(Math.sin(now * 0.0012 + s.tw)));
      ctx.globalAlpha = a;
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(s.x * W, s.y * hY, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Zwillingsmonde
  const moon = (mx, my, r, col, glow) => {
    ctx.shadowColor = glow; ctx.shadowBlur = 26;
    const gr = ctx.createRadialGradient(mx - r * 0.3, my - r * 0.3, r * 0.15, mx, my, r);
    gr.addColorStop(0, "#fffdf4"); gr.addColorStop(1, col);
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  };
  moon(W * 0.78, hY * 0.34, 26, "#e8d9b0", "rgba(232,217,176,0.8)");
  moon(W * 0.66, hY * 0.58, 9, "#d9b8e8", "rgba(217,184,232,0.8)");

  // Wolken ziehen vorbei (Parallax)
  for (const c of clouds) {
    const span = W + 260;
    const x = ((c.x0 * span - o * c.sp) % span + span) % span - 130;
    blitFoot(SPR.cloud, x, hY * c.y + 35 * c.sc, c.sc, 0.16);
  }

  // Glühen am Horizont — Tiefe & Licht
  const hg2 = ctx.createRadialGradient(W / 2, hY, 10, W / 2, hY, W * 0.75);
  hg2.addColorStop(0, pal.sky[2].replace("rgb", "rgba").replace(")", ",0.5)"));
  hg2.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = hg2;
  ctx.fillRect(0, hY - W * 0.3, W, W * 0.6);

  // --- Bergrücken (Parallax) ---
  for (const ridge of ridges) {
    const speedF = ridge.li === 0 ? 0.4 : 0.9;
    const shift = (o * speedF * 14) % W;
    const baseH = hY * (ridge.li === 0 ? 0.55 : 0.32);
    ctx.fillStyle = ridge.li === 0 ? pal.ridge : mixHex(pal.road[1], "#000000", 0.25);
    ctx.globalAlpha = ridge.li === 0 ? 0.85 : 1;
    ctx.beginPath();
    ctx.moveTo(0, hY + 2);
    const n = ridge.pts.length - 1;
    for (let rep = -1; rep <= 1; rep++) {
      for (let i = 0; i <= n; i++) {
        const x = (i / n) * W + rep * W - shift + W;
        ctx.lineTo(x, hY - ridge.pts[i] * baseH + 2);
      }
    }
    ctx.lineTo(W * 3, hY + 2);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // --- Boden: Streifen scrollen auf die Kamera zu ---
  const STRIPE = 2.4;
  ctx.fillStyle = pal.ground[1];
  ctx.fillRect(0, hY, W, H - hY);
  const kMin = Math.floor((o + NEAR * 0.7) / STRIPE);
  const kMax = Math.ceil((o + SPAWN_Z) / STRIPE);
  for (let k = kMin; k <= kMax; k++) {
    if (k % 2) continue;
    const zFar = Math.min(SPAWN_Z, (k + 1) * STRIPE - o);
    const zNear = Math.max(NEAR * 0.7, k * STRIPE - o);
    if (zFar <= zNear) continue;
    const yFar = groundY(tOf(zFar));
    const yNear = Math.min(H, groundY(tOf(zNear)));
    ctx.fillStyle = pal.ground[0];
    ctx.fillRect(0, yFar, W, yNear - yFar);
  }

  // --- Weg ---
  const tN = tOf(NEAR * 0.7), tF = tOf(SPAWN_Z);
  const roadGrad = ctx.createLinearGradient(0, groundY(tF), 0, H);
  roadGrad.addColorStop(0, pal.road[1]);
  roadGrad.addColorStop(1, pal.road[0]);
  ctx.fillStyle = roadGrad;
  ctx.beginPath();
  // Rand in mehreren z-Schritten sampeln, damit die Kurve sichtbar wird
  const steps = 14;
  const edge = [];
  for (let i = 0; i <= steps; i++) {
    const z = NEAR * 0.7 + (SPAWN_Z - NEAR * 0.7) * Math.pow(i / steps, 2.2);
    const t = tOf(z);
    edge.push([centerX(t) - roadHalf(t), centerX(t) + roadHalf(t), Math.min(H + 4, groundY(t)), t]);
  }
  ctx.moveTo(edge[0][0], edge[0][2]);
  for (let i = 1; i <= steps; i++) ctx.lineTo(edge[i][0], edge[i][2]);
  for (let i = steps; i >= 0; i--) ctx.lineTo(edge[i][1], edge[i][2]);
  ctx.closePath();
  ctx.fill();

  // Steinplatten-Fugen quer über den Weg
  ctx.strokeStyle = "rgba(10, 5, 20, 0.22)";
  const SLAB = 1.15;
  const sMin = Math.floor((o + NEAR * 0.7) / SLAB);
  const sMax = Math.ceil((o + SPAWN_Z) / SLAB);
  for (let k = sMin; k <= sMax; k++) {
    const z = k * SLAB - o;
    if (z < NEAR * 0.7 || z > SPAWN_Z) continue;
    const t = tOf(z);
    const y = groundY(t);
    if (y > H + 4) continue;
    ctx.lineWidth = Math.max(1, 2.6 * t);
    ctx.beginPath();
    ctx.moveTo(centerX(t) - roadHalf(t), y);
    ctx.lineTo(centerX(t) + roadHalf(t), y);
    ctx.stroke();
    // Lichtkante der Platte
    ctx.strokeStyle = "rgba(255, 245, 255, 0.06)";
    ctx.beginPath();
    ctx.moveTo(centerX(t) - roadHalf(t), y + Math.max(1, 2.6 * t));
    ctx.lineTo(centerX(t) + roadHalf(t), y + Math.max(1, 2.6 * t));
    ctx.stroke();
    ctx.strokeStyle = "rgba(10, 5, 20, 0.22)";
  }

  // Erhöhte Bordsteine links & rechts (wie die Tempelmauern)
  for (const side of [0, 1]) {
    const sgn = side === 0 ? -1 : 1;
    const wall = ctx.createLinearGradient(0, groundY(tOf(SPAWN_Z)), 0, H);
    wall.addColorStop(0, pal.ridge);
    wall.addColorStop(1, pal.road[0]);
    ctx.fillStyle = wall;
    ctx.beginPath();
    ctx.moveTo(edge[0][side], edge[0][2]);
    for (let i = 1; i <= steps; i++) ctx.lineTo(edge[i][side], edge[i][2]);
    for (let i = steps; i >= 0; i--) {
      const t = edge[i][3];
      ctx.lineTo(edge[i][side] + sgn * 34 * t, edge[i][2] - 20 * t);
    }
    ctx.closePath();
    ctx.fill();
    // Goldene Glow-Kante obenauf
    ctx.strokeStyle = "rgba(232, 193, 90, 0.5)";
    ctx.lineWidth = 2;
    ctx.shadowColor = GOLD; ctx.shadowBlur = 7;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = edge[i][3];
      const x = edge[i][side] + sgn * 34 * t, y = edge[i][2] - 20 * t;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  // Kristalle auf den Bordsteinen
  const EDGE_STEP = 1.35;
  const eMin = Math.floor((o + NEAR * 0.75) / EDGE_STEP);
  const eMax = Math.ceil((o + SPAWN_Z) / EDGE_STEP);
  for (let k = eMin; k <= eMax; k++) {
    const z = k * EDGE_STEP - o;
    if (z < NEAR * 0.75 || z > SPAWN_Z) continue;
    const t = tOf(z);
    const y = groundY(t) - 20 * t;
    if (y > H + 10) continue;
    const sp = (k % 2 === 0) ? SPR.edgeA : SPR.edgeB;
    const alpha = Math.min(1, t * 6);
    for (const sgn of [-1, 1]) {
      blitFoot(sp, centerX(t) + sgn * (roadHalf(t) + 17 * t), y, t / PLAYER_T * 1.25, alpha);
    }
  }

  // Spur-Trennstriche
  ctx.strokeStyle = "rgba(246, 238, 252, 0.28)";
  const DASH = 1.9;
  const dMin = Math.floor((o + NEAR * 0.7) / DASH);
  const dMax = Math.ceil((o + SPAWN_Z) / DASH);
  for (let k = dMin; k <= dMax; k++) {
    if (k % 2) continue;
    const z0 = Math.max(NEAR * 0.7, k * DASH - o);
    const z1 = Math.min(SPAWN_Z, (k + 0.55) * DASH - o);
    if (z1 <= z0) continue;
    const t0 = tOf(z0), t1 = tOf(z1);
    for (const b of [-0.5, 0.5]) {
      ctx.lineWidth = Math.max(1, 3.4 * t0);
      ctx.beginPath();
      ctx.moveTo(centerX(t0) + b * laneW() * t0, Math.min(H, groundY(t0)));
      ctx.lineTo(centerX(t1) + b * laneW() * t1, groundY(t1));
      ctx.stroke();
    }
  }

  // --- Objekte, weit → nah ---
  const drawables = [];
  for (const s of sceneries) {
    const z = s.wz - o;
    if (z < 0.6 || z > SPAWN_Z) continue;
    drawables.push({ z, kind: "scen", e: s });
  }
  for (const e of entities) {
    const z = e.wz - o;
    if (z < 0.6 || z > SPAWN_Z) continue;
    drawables.push({ z, kind: e.type, e });
  }
  drawables.sort((a, b) => b.z - a.z);

  for (const d of drawables) {
    const t = tOf(d.z);
    const alpha = Math.min(1, t * 6);
    const e = d.e;
    if (d.kind === "scen") {
      const x = centerX(t) + e.side * (roadHalf(t) + (34 + e.off) * t);
      blitFoot(SPR[e.kind], x, groundY(t), t / PLAYER_T * e.sc * 1.5, alpha);
    } else if (d.kind === "ob") {
      const lanes = e.lane === -1 ? [0, 1, 2] : [e.lane];
      for (const l of lanes) {
        const x = laneX(l, t);
        const y = groundY(t);
        // Schatten
        ctx.globalAlpha = alpha * 0.35;
        ctx.fillStyle = "#0a0512";
        ctx.beginPath();
        ctx.ellipse(x, y, 46 * t / PLAYER_T * OBS, 8 * t / PLAYER_T * OBS, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
        blitFoot(SPR[e.kind], x, y, t / PLAYER_T * OBS, alpha);
      }
    } else if (d.kind === "coin") {
      const x = laneX(e.lanePos, t);
      const bob = Math.sin(now * 0.005 + e.wz * 2) * 4;
      const y = groundY(t) - (e.h + bob) * t / PLAYER_T;
      const sc = t / PLAYER_T * ITEMS * (0.85 + 0.15 * Math.sin(now * 0.006 + e.wz * 3));
      blitFoot(SPR[e.kind], x, y + 17 * sc, sc, alpha);
    } else if (d.kind === "pow") {
      const x = laneX(e.lane, t);
      const bob = Math.sin(now * 0.004 + e.wz) * 6;
      const y = groundY(t) - (e.h + bob) * t / PLAYER_T;
      const sc = t / PLAYER_T * ITEMS * (1 + 0.08 * Math.sin(now * 0.005));
      blitFoot(SPR[e.kind], x, y + 23 * sc, sc, alpha);
    }
  }

  // Glühwürmchen schweben durch die Szene
  for (const f of flies) {
    const span = W + 60;
    const fx = ((f.x0 * span - o * f.sp) % span + span) % span - 30;
    const fy = f.y0 * H + Math.sin(now * 0.0012 + f.ph) * 16;
    const a = 0.35 + 0.45 * Math.abs(Math.sin(now * 0.002 + f.ph));
    ctx.globalAlpha = a;
    ctx.shadowColor = f.col; ctx.shadowBlur = 8;
    ctx.fillStyle = f.col;
    ctx.beginPath();
    ctx.arc(fx, fy, f.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  ctx.globalAlpha = 1;

  // --- Läufer:in ---
  if (mode !== "menu") drawRunner(now);

  // --- Einhorn ---
  if (mode !== "menu") drawUnicorn(now);

  // --- Partikel ---
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, 1 - p.age / p.life);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * (1 - p.age / p.life * 0.5), 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // --- Boost-Speedlines ---
  if (boostT > 0) {
    ctx.strokeStyle = "rgba(255, 243, 196, 0.35)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + now * 0.002;
      const r1 = Math.min(W, H) * 0.34, r2 = Math.min(W, H) * 0.6;
      ctx.beginPath();
      ctx.moveTo(W / 2 + Math.cos(a) * r1, H * 0.5 + Math.sin(a) * r1);
      ctx.lineTo(W / 2 + Math.cos(a) * r2, H * 0.5 + Math.sin(a) * r2);
      ctx.stroke();
    }
  }

  ctx.restore();

  // Blitz beim Stolpern / Fangen
  if (flash > 0) {
    ctx.fillStyle = `rgba(255, 122, 194, ${flash * 0.4})`;
    ctx.fillRect(0, 0, W, H);
  }
  if (mode === "catch") {
    const u = Math.min(1, catchT / 1.15);
    ctx.fillStyle = `rgba(255, 230, 245, ${u * u * 0.85})`;
    ctx.fillRect(0, 0, W, H);
  }

  ctx.drawImage(vignette, 0, 0);
}

// --- Die Diebin: kleine Kobold-Läuferin mit dem Zuckerkristall ---
function drawRunner(now) {
  const t = PLAYER_T;
  const x = laneX(laneCur, t);
  const yG = groundY(t);
  const y = yG - jumpH;
  const lean = (laneTarget - laneCur) * 0.5;
  const ph = runPhase;
  const inAir = jumpH > 2;
  const duck = sliding > 0;
  const blink = invuln > 0 && Math.floor(now / 80) % 2 === 0;
  if (blink) return;

  // Schatten
  ctx.globalAlpha = Math.max(0.12, 0.4 - jumpH * 0.002);
  ctx.fillStyle = "#0a0512";
  ctx.beginPath();
  ctx.ellipse(x, yG + 2, (26 - jumpH * 0.06) * RS, 7 * RS, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(lean * 0.35);
  ctx.scale(RS, RS);
  if (duck) { ctx.translate(0, 10); ctx.scale(1.15, 0.62); }

  const bob = inAir ? 0 : Math.abs(Math.sin(ph)) * 4;
  ctx.translate(0, -bob);

  // Umhang (flattert)
  ctx.fillStyle = "#5e3a8f";
  ctx.beginPath();
  const flut = Math.sin(ph * 2) * 5;
  ctx.moveTo(-8, -52);
  ctx.quadraticCurveTo(-22 - flut, -30, -16 - flut * 1.4, -8);
  ctx.quadraticCurveTo(-6, -18, -4, -30);
  ctx.closePath();
  ctx.fill();

  // Beine
  const legA = inAir ? 0.9 : Math.sin(ph);
  ctx.strokeStyle = "#3a2456";
  ctx.lineWidth = 7;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-3, -22);
  ctx.lineTo(-3 + legA * 10, -6 + Math.abs(legA) * -2);
  ctx.moveTo(3, -22);
  ctx.lineTo(3 - legA * 10, -6 + Math.abs(legA) * -2);
  ctx.stroke();
  // Schuhe
  ctx.fillStyle = GOLD;
  ctx.beginPath(); ctx.arc(-3 + legA * 10, -5, 4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(3 - legA * 10, -5, 4, 0, Math.PI * 2); ctx.fill();

  // Körper
  const bg = ctx.createLinearGradient(0, -52, 0, -18);
  bg.addColorStop(0, "#8a5cc7"); bg.addColorStop(1, "#4d2e78");
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(-11, -52, 22, 32, 10);
  ctx.fill();
  // Gürtel
  ctx.fillStyle = GOLD;
  ctx.fillRect(-11, -32, 22, 3.5);

  // Arme — einer pumpt, einer hält den Kristall
  const armA = inAir ? -0.7 : Math.sin(ph + Math.PI);
  ctx.strokeStyle = "#6d47a3";
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(-9, -46);
  ctx.lineTo(-13 + armA * 7, -34);
  ctx.stroke();
  // Kristall-Arm (nach vorn gestreckt)
  ctx.beginPath();
  ctx.moveTo(9, -46);
  ctx.lineTo(16, -40);
  ctx.stroke();
  // DER Zuckerkristall
  const crysGlow = 0.7 + 0.3 * Math.sin(now * 0.006);
  ctx.shadowColor = PINK; ctx.shadowBlur = 16 * crysGlow;
  const cg = ctx.createLinearGradient(16, -48, 16, -32);
  cg.addColorStop(0, "#ffe0f0"); cg.addColorStop(0.5, PINK); cg.addColorStop(1, "#b03a78");
  ctx.fillStyle = cg;
  ctx.beginPath();
  ctx.moveTo(16, -50); ctx.lineTo(22, -42); ctx.lineTo(16, -32); ctx.lineTo(10, -42);
  ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;

  // Kopf mit Kapuze
  ctx.fillStyle = "#f2d9c4";
  ctx.beginPath(); ctx.arc(0, -60, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#5e3a8f";
  ctx.beginPath();
  ctx.arc(0, -62, 10.5, Math.PI * 0.85, Math.PI * 2.15);
  ctx.quadraticCurveTo(-14, -56, -10, -50);
  ctx.closePath(); ctx.fill();
  // Zipfel
  ctx.beginPath();
  ctx.moveTo(-8, -68);
  ctx.quadraticCurveTo(-18, -72 - flut, -22, -64 - flut);
  ctx.quadraticCurveTo(-14, -64, -9, -62);
  ctx.closePath(); ctx.fill();
  // Auge (schaut ängstlich zurück? nein — nach vorn!)
  ctx.fillStyle = "#241238";
  ctx.beginPath(); ctx.arc(4, -60, 1.6, 0, Math.PI * 2); ctx.fill();

  ctx.restore();

  // Schild-Blase
  if (shieldOn) {
    ctx.strokeStyle = `rgba(111, 227, 193, ${0.5 + 0.3 * Math.sin(now * 0.005)})`;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = MINT; ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.ellipse(x, y - 36 * RS, 34 * RS, 46 * RS, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
}

// --- Das wütende Einhorn (zwischen Kamera und Läuferin) ---
function drawUnicorn(now) {
  let p = chase;
  if (mode === "catch") p = Math.min(1.55, 1 + catchT * 0.8);
  const s = 0.62 + p * 1.15; // Größe
  const gallopF = 6 + p * 5;
  const bob = Math.abs(Math.sin(now * 0.001 * gallopF)) * 14 * s;
  // Folgt der Spur mit Verzögerung
  const ux = laneX(laneCur, PLAYER_T) * 0.35 + (W / 2) * 0.65;
  const baseY = H + 150 * s * (0.62 - p * 0.5);
  const uy = baseY - bob;

  ctx.save();
  ctx.translate(ux, uy);
  ctx.scale(s, s);

  // Regenbogen-Mähne (fließende Bänder)
  for (let i = 0; i < 6; i++) {
    const off = i - 2.5;
    ctx.strokeStyle = RAINBOW[i];
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.shadowColor = RAINBOW[i]; ctx.shadowBlur = 8;
    ctx.beginPath();
    const wav = Math.sin(now * 0.004 + i * 0.9) * 12;
    ctx.moveTo(-14 + off * 2, -96);
    ctx.quadraticCurveTo(-48 + off * 5 + wav, -74 + off * 6, -60 + off * 6 + wav * 1.4, -30 + off * 9);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 1;

  // Hals + Kopf
  const hg = ctx.createLinearGradient(-20, -110, 30, -40);
  hg.addColorStop(0, "#ffffff"); hg.addColorStop(0.6, "#f0e6f7"); hg.addColorStop(1, "#cfb8e0");
  ctx.fillStyle = hg;
  ctx.beginPath();
  ctx.moveTo(-34, 10);
  ctx.quadraticCurveTo(-30, -70, -10, -98);   // Halsrücken
  ctx.quadraticCurveTo(4, -116, 26, -108);    // Stirn
  ctx.quadraticCurveTo(46, -102, 52, -88);    // Nasenrücken
  ctx.quadraticCurveTo(56, -78, 46, -74);     // Maul
  ctx.quadraticCurveTo(30, -70, 22, -58);     // Kinn
  ctx.quadraticCurveTo(10, -30, 16, 10);      // Halsvorderseite
  ctx.closePath();
  ctx.fill();

  // Nüstern (schnaubt!)
  ctx.fillStyle = "#b08ac2";
  ctx.beginPath(); ctx.ellipse(46, -82, 2.8, 4, -0.4, 0, Math.PI * 2); ctx.fill();
  // Dampfwölkchen beim Schnauben
  if (p > 0.45 && Math.sin(now * 0.003 * gallopF) > 0.7) {
    puff(ux + 50 * s, uy - 80 * s, "rgba(255,255,255,0.5)", 1, 40, 20);
  }

  // Wütendes Auge
  ctx.fillStyle = "#fff";
  ctx.beginPath(); ctx.ellipse(18, -92, 7.5, 8.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = p > 0.7 ? "#d92b4a" : "#7a2fd9";
  ctx.beginPath(); ctx.arc(20, -91, 4.2, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#1a0a24";
  ctx.beginPath(); ctx.arc(21, -91, 2, 0, Math.PI * 2); ctx.fill();
  // Zornige Braue
  ctx.strokeStyle = "#8a6aa8";
  ctx.lineWidth = 3.5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(8, -104); ctx.lineTo(28, -97);
  ctx.stroke();

  // Ohr
  ctx.fillStyle = "#e8dcf2";
  ctx.beginPath();
  ctx.moveTo(-4, -108); ctx.lineTo(4, -126); ctx.lineTo(10, -106);
  ctx.closePath(); ctx.fill();

  // DAS HORN — golden, spiralig, glühend
  const hornGlow = 0.6 + 0.4 * Math.sin(now * 0.005);
  ctx.shadowColor = GOLD; ctx.shadowBlur = 18 * hornGlow;
  const hgr = ctx.createLinearGradient(14, -160, 22, -110);
  hgr.addColorStop(0, CREAM); hgr.addColorStop(0.5, GOLD); hgr.addColorStop(1, "#a37a1e");
  ctx.fillStyle = hgr;
  ctx.beginPath();
  ctx.moveTo(10, -112);
  ctx.lineTo(20, -164);
  ctx.lineTo(28, -110);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  // Spirale
  ctx.strokeStyle = "rgba(138, 106, 28, 0.6)";
  ctx.lineWidth = 1.6;
  for (let i = 1; i <= 4; i++) {
    const yy = -112 - i * 11;
    const ww = 9 - i * 1.8;
    ctx.beginPath();
    ctx.moveTo(19 - ww, yy);
    ctx.quadraticCurveTo(19, yy - 4, 19 + ww, yy - 1);
    ctx.stroke();
  }

  // Vorderbeine im Galopp (nur sichtbar wenn nah)
  if (p > 0.4) {
    const leg = Math.sin(now * 0.001 * gallopF * Math.PI);
    ctx.strokeStyle = "#e0d2ec";
    ctx.lineWidth = 12;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-24, 4);
    ctx.quadraticCurveTo(-20 + leg * 14, 34, -14 + leg * 26, 52);
    ctx.moveTo(4, 6);
    ctx.quadraticCurveTo(8 - leg * 14, 36, 14 - leg * 26, 54);
    ctx.stroke();
    // Goldene Hufe
    ctx.fillStyle = GOLD;
    ctx.beginPath(); ctx.arc(-14 + leg * 26, 54, 7, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(14 - leg * 26, 54, 7, 0, Math.PI * 2); ctx.fill();
  }

  ctx.restore();

  // Funkel-Spur hinterm Einhorn
  if (p > 0.25 && Math.random() < p * 0.6) {
    sparkleTrail(ux + (Math.random() - 0.5) * 90 * s, uy - Math.random() * 60 * s, RAINBOW[Math.floor(Math.random() * 6)]);
  }
}

// ==================== Sound (WebAudio, synthetisiert) ====================
const sound = (() => {
  let ctxA = null;
  let muted = localStorage.getItem("galopp_muted") === "1";
  function ac() {
    if (!ctxA) {
      try {
        ctxA = new (window.AudioContext || window.webkitAudioContext)();
      } catch { return null; }
    }
    if (ctxA.state === "suspended") ctxA.resume();
    return ctxA;
  }
  function tone(f0, f1, dur, type = "sine", vol = 0.08, delay = 0) {
    if (muted) return;
    const a = ac(); if (!a) return;
    const t0 = a.currentTime + delay;
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g).connect(a.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.02);
  }
  let lastGallop = 0;
  return {
    jump() { tone(280, 640, 0.18, "sine", 0.07); },
    slide() { tone(300, 110, 0.16, "triangle", 0.06); },
    whoosh() { tone(500, 260, 0.09, "sine", 0.045); },
    coin(combo) { tone(660 + combo * 55, 880 + combo * 55, 0.09, "square", 0.045); },
    stumble() { tone(170, 55, 0.3, "sawtooth", 0.13); tone(90, 40, 0.25, "square", 0.09, 0.03); },
    power() { [660, 880, 1320].forEach((f, i) => tone(f, f * 1.1, 0.14, "sine", 0.07, i * 0.07)); },
    boost() { tone(220, 900, 0.45, "sawtooth", 0.07); },
    shieldPop() { tone(880, 300, 0.2, "triangle", 0.09); },
    zone() { [523, 784].forEach((f, i) => tone(f, f, 0.18, "sine", 0.06, i * 0.1)); },
    gallop(p) {
      const nowT = performance.now();
      if (nowT - lastGallop < 180) return;
      lastGallop = nowT;
      tone(75 + p * 30, 45, 0.11, "sine", 0.05 + p * 0.06);
    },
    caught() {
      tone(500, 70, 0.7, "sawtooth", 0.12);
      [440, 349, 262].forEach((f, i) => tone(f, f * 0.95, 0.3, "triangle", 0.08, 0.15 + i * 0.18));
    },
    fanfare() { [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.22, "sine", 0.1, i * 0.09)); },
    toggle() { muted = !muted; localStorage.setItem("galopp_muted", muted ? "1" : "0"); return muted; },
    get muted() { return muted; },
  };
})();

// ==================== Screens ====================
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
      <h2><span class="foil">Galopp</span></h2>
      <p class="sub">
        Du hast den <b>Zuckerkristall</b> des Einhorns stibitzt —<br>
        und es ist <b>stinksauer</b>. Renn um dein Leben!<br>
        Stolperst du, holt es auf. Holt es dich ein … 🦄
      </p>
      <div class="ctrl-grid">
        <div class="ctrl"><b>⬅️➡️</b>Wischen: Spur wechseln</div>
        <div class="ctrl"><b>⬆️</b>Hoch / Tipp: springen</div>
        <div class="ctrl"><b>⬇️</b>Runter: ducken</div>
        <div class="ctrl"><b>🧲🛡️⚡</b>Power-ups schnappen</div>
      </div>
      <button class="btn-primary" id="m-go">🏃 Lauf los!</button>
      <button class="btn-secondary" id="m-top">🏆 Bestenliste</button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#m-go").onclick = () => {
    overlay.remove();
    newRun();
    mode = "run";
  };
  overlay.querySelector("#m-top").onclick = () => showLeaderboard();
}

async function submitScore() {
  const name = getName();
  if (!name || score <= 0 || submitted) return null;
  submitted = true;
  try {
    const res = await fetch("/api/galopp/scores", {
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
  const isRecord = score >= best && score > 0;
  if (score > best) { best = score; localStorage.setItem("galopp_best", best); }
  if (isRecord) sound.fanfare();

  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="panel">
      <h2>${isRecord ? "Neuer Rekord!" : "Erwischt! 🦄"}</h2>
      <div class="go-score">${score}</div>
      ${isRecord ? `<div class="go-best-badge">👑 Persönliche Bestleistung</div>` : `<div class="sub">Rekord: ${best}</div>`}
      <div class="go-stats">
        <span>📏 ${Math.floor(meters)} m</span>
        <span>🪙 ${coins} Taler</span>
        <span>🗺️ ${ZONES[zoneShown % ZONES.length]?.name || "Zuckerwiese"}</span>
      </div>
      <div class="go-rank" id="go-rank"></div>
      <div id="go-name-area"></div>
      <button class="btn-primary" id="go-again">🏃 Nochmal rennen</button>
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
      <p class="sub">Die 50 schnellsten Läufer:innen weltweit</p>
      <div id="lb-content"><p class="lb-empty">Lade …</p></div>
      <button class="btn-secondary" id="lb-close">Schließen</button>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) close(); };
  overlay.querySelector("#lb-close").onclick = close;

  try {
    const res = await fetch("/api/galopp/scores");
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

// ==================== UI ====================
$("#btn-top").onclick = () => showLeaderboard();
const soundBtn = $("#btn-sound");
soundBtn.textContent = sound.muted ? "🔇" : "🔊";
soundBtn.onclick = () => { soundBtn.textContent = sound.toggle() ? "🔇" : "🔊"; };

// ==================== Auto-Test (?auto) ====================
// Einfacher Selbstläufer für schnelle Smoke-Tests.
const params = new URLSearchParams(location.search);
const AUTO = params.has("auto");
function autoPilot() {
  if (mode !== "run") return;
  let nearest = null;
  for (const e of entities) {
    if (e.type !== "ob" || e.passed) continue;
    const z = e.wz - o;
    if (z < PLAYER_Z || z > PLAYER_Z + 3.5) continue;
    if (!nearest || z < nearest.z) nearest = { e, z };
  }
  if (!nearest) return;
  const e = nearest.e;
  if (e.lane === -1) {
    if (e.kind === "hurdle" && nearest.z < PLAYER_Z + 1.4) doJump();
    if (e.kind === "arch" && nearest.z < PLAYER_Z + 1.4) doSlide();
  } else if (Math.abs(e.lane - laneTarget) < 0.5) {
    const free = [0, 1, 2].filter(l =>
      !entities.some(x => x.type === "ob" && !x.passed && (x.lane === l || x.lane === -1) &&
        Math.abs(x.wz - o - nearest.z) < 1.5));
    if (free.length) doLane(Math.sign(free[0] - laneTarget) || 1);
    else if (e.kind === "hurdle") doJump();
    else if (e.kind === "arch") doSlide();
  }
}

// ==================== Hauptschleife ====================
let lastT = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;
  if (AUTO) autoPilot();
  update(dt);
  render(now);
  requestAnimationFrame(loop);
}

newRun();
if (AUTO) { mode = "run"; }
else showMenu();
requestAnimationFrame(loop);
