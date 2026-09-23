// ====================================================================
// GALOPP — Endless-Runner (2026)
//
// Du hast den Zuckerkristall des Einhorns stibitzt — und jetzt ist es
// SAUER. Renn! Wischen = Spur wechseln, hoch = springen, runter =
// ducken. Sammle Taler, schnapp dir Power-ups und lass das Einhorn
// nicht aufholen. Pseudo-3D komplett auf Canvas gerendert.
// ====================================================================

// Challenge-Modi (?daily / ?weekly): gleicher Seed = gleiche Strecke.
// rngW steuert NUR die Weltgenerierung (Hindernisse, Kurven, Power-ups);
// Optik/Partikel bleiben bei Math.random.
const _params0 = new URLSearchParams(location.search);
const DAILY = _params0.has("daily");
const WEEKLY = _params0.has("weekly");
const CHALLENGE = DAILY || WEEKLY;
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
let rngW = Math.random;

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

// ==================== Skins (über Meilensteine freispielbar) ====================
// Jeder Skin färbt die Läuferin: Tunika, Umhang, Kapuze, Beine, Stiefel, Haar.
GS.skins.define("galopp", [
  { id: "violett", name: "Kapuzenlila", req: 0, swatch: ["#8a5cc7", "#6d47a3", "#e8c15a"],
    colors: { tunic: ["#8a5cc7", "#4d2e78"], cloak: ["#6d47a3", "#452a66"], hood: "#5e3a8f", leg: "#3a2456", boot: GOLD, hair: "#e8a25e" } },
  { id: "smaragd", name: "Smaragd", req: 3, swatch: ["#3fc98a", "#2b8f63", "#ffe066"],
    colors: { tunic: ["#3fc98a", "#1f6e4c"], cloak: ["#2f9d6d", "#1c5c40"], hood: "#278a5e", leg: "#16402c", boot: "#ffe066", hair: "#e8a25e" } },
  { id: "karmesin", name: "Karmesin", req: 6, swatch: ["#ff5a7a", "#c02f4d", "#ffd36e"],
    colors: { tunic: ["#ff6b83", "#a82440"], cloak: ["#d43f5c", "#7e1c30"], hood: "#b73048", leg: "#4a1220", boot: "#ffd36e", hair: "#2a1a12" } },
  { id: "mitternacht", name: "Mitternachtsgold", req: 9, swatch: ["#22304a", "#e8c15a", "#fff3c4"],
    colors: { tunic: ["#2c3d5c", "#141d30"], cloak: ["#e8c15a", "#8a6a1c"], hood: "#1c2740", leg: "#0d1422", boot: "#fff3c4", hair: "#e8c15a" } },
]);
let SKIN = GS.skins.get("galopp");

// Einhorn-Skins (färben Körper, Mähne, Horn, Hufe) — über Galopp-Abzeichen frei
GS.skins.define("galopp_unicorn", [
  { id: "regenbogen", name: "Regenbogen", req: 0, swatch: ["#f0e6f7", "#ff6b6b", "#56d5e8"],
    colors: {
      body: ["#ffffff", "#f0e6f7", "#cfb8e0"], ear: "#e8dcf2", nostril: "#b08ac2", brow: "#8a6aa8", leg: "#e0d2ec",
      horn: ["#fff3c4", "#e8c15a", "#a37a1e"], hornGlow: "#e8c15a", hoof: "#e8c15a",
      mane: ["#ff6b6b", "#ffa14d", "#ffe066", "#69d98a", "#56d5e8", "#b678ff"],
    } },
  { id: "schatten", name: "Schattenmähre", req: 3, swatch: ["#332f42", "#8a4de0", "#c4ccdf"],
    colors: {
      body: ["#4a4458", "#332f42", "#211d2e"], ear: "#3a3448", nostril: "#6a5a80", brow: "#141020", leg: "#2e2a3c",
      horn: ["#eef2fa", "#9aa4c0", "#4a5170"], hornGlow: "#9fb0e0", hoof: "#c4ccdf",
      mane: ["#6a3fd9", "#8a4de0", "#b04de0", "#5a2fa8", "#7a3fd0", "#3a2f8a"],
    } },
  { id: "inferno", name: "Inferno", req: 6, swatch: ["#5e2418", "#ff5a2d", "#ffd24d"],
    colors: {
      body: ["#5e2418", "#3a1410", "#210a08"], ear: "#4a1a12", nostril: "#8a3a20", brow: "#160604", leg: "#3a1610",
      horn: ["#fff3c4", "#ff9d4d", "#a34d1e"], hornGlow: "#ff7a3d", hoof: "#ff9d4d",
      mane: ["#ffd24d", "#ff9d3d", "#ff5a2d", "#ff3d3d", "#ffb04d", "#ff6a1d"],
    } },
  { id: "eishorn", name: "Eishorn", req: 9, swatch: ["#e0f0ff", "#5ec8ff", "#ffffff"],
    colors: {
      body: ["#ffffff", "#e0f0ff", "#a9cdec"], ear: "#d6ecff", nostril: "#7fb0d8", brow: "#5a86b8", leg: "#c9e4f7",
      horn: ["#ffffff", "#bfe6ff", "#5a9fd0"], hornGlow: "#9fdcff", hoof: "#bfe6ff",
      mane: ["#eafcff", "#9fe0ff", "#5ec8ff", "#3aa0e0", "#7fd8ff", "#bfefff"],
    } },
], "galopp");
let USKIN = GS.skins.get("galopp_unicorn");
let UNI_GLOSS = null; // gecachter Körper-Glanzverlauf (einmal erzeugt)
let HOOD_GLOSS = null; // gecachtes Kapuzen-Glanzlicht

// ==================== Projektion ====================
// Pseudo-3D: t = NEAR/z ∈ (0..1], t=1 ist die Unterkante der Bühne.
// Der Weg schlängelt sich sanft (sway), das gibt Kurven-Gefühl.
const NEAR = 1, SPAWN_Z = 26, PLAYER_T = 0.8;
const PLAYER_Z = NEAR / PLAYER_T;
// Größenfaktoren: Kamera dicht hinter der Läuferin wie bei Temple Run —
// die Figur ist groß im unteren Bilddrittel, der Weg füllt die Bühne.
const RS = 2.2, OBS = 1.55, ITEMS = 1.45;
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
  // Ursprung UNTEN-Mitte: alle Sprites zeichnen in y ∈ [-h, 0] und
  // stehen mit dem Fußpunkt auf 0 — passend zu blitFoot.
  g.translate(w / 2, h);
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

// --- Regenbogen-Balken (ducken!) — schwebt auf Kopfhöhe ---
SPR.arch = makeSprite(140, 100, g => {
  // Halteseile nach oben (aus dem Bild hinaus)
  g.strokeStyle = "rgba(217, 201, 160, 0.85)";
  g.lineWidth = 2.5;
  for (const x of [-56, 56]) {
    g.beginPath(); g.moveTo(x, -100); g.lineTo(x, -84); g.stroke();
  }
  // Massiver leuchtender Regenbogen-Balken
  const bg = g.createLinearGradient(-62, 0, 62, 0);
  RAINBOW.forEach((c, i) => bg.addColorStop(i / 5, c));
  g.shadowColor = "#fff"; g.shadowBlur = 14;
  g.fillStyle = bg;
  g.beginPath(); g.roundRect(-64, -88, 128, 14, 7); g.fill();
  g.shadowBlur = 0;
  // Lichtkante
  g.fillStyle = "rgba(255,255,255,0.5)";
  g.beginPath(); g.roundRect(-60, -86, 120, 4, 2); g.fill();
  // Wimpel hängen herab — klares Signal: DRUNTER DURCH!
  for (let i = 0; i < 6; i++) {
    const x = -52 + i * 20.8;
    g.fillStyle = RAINBOW[i];
    g.shadowColor = RAINBOW[i]; g.shadowBlur = 8;
    g.beginPath();
    g.moveTo(x - 8, -74); g.lineTo(x + 8, -74); g.lineTo(x, -54);
    g.closePath(); g.fill();
    g.shadowBlur = 0;
  }
  // Funkel-Punkte auf dem Balken
  g.fillStyle = "rgba(255,255,255,0.9)";
  for (const [px, py] of [[-38, -81], [4, -84], [40, -80]]) {
    g.beginPath(); g.arc(px, py, 1.8, 0, Math.PI * 2); g.fill();
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

// --- Sterntaler (glänzende Goldmünze) ---
SPR.coin = makeSprite(34, 34, g => {
  g.translate(0, -17);
  g.shadowColor = GOLD; g.shadowBlur = 14;
  // Dicke Prägekante
  const rim = g.createLinearGradient(0, -13, 0, 13);
  rim.addColorStop(0, "#fff3c4"); rim.addColorStop(0.5, "#f0b93e"); rim.addColorStop(1, "#8a5f14");
  g.fillStyle = rim;
  g.beginPath(); g.arc(0, 0, 13, 0, Math.PI * 2); g.fill();
  g.shadowBlur = 0;
  // Vertiefte Mitte
  const face = g.createRadialGradient(-3, -4, 2, 0, 1, 12);
  face.addColorStop(0, "#fffbe6"); face.addColorStop(0.55, "#ffd24d"); face.addColorStop(1, "#c48f22");
  g.fillStyle = face;
  g.beginPath(); g.arc(0, 0, 10.5, 0, Math.PI * 2); g.fill();
  // Stern
  g.fillStyle = "rgba(150, 106, 24, 0.75)";
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 3 : 7;
    const a = -Math.PI / 2 + i * Math.PI / 5;
    g[i ? "lineTo" : "moveTo"](Math.cos(a) * r, Math.sin(a) * r);
  }
  g.closePath(); g.fill();
  // Glanz: heller Sichelreflex oben-links + Funkelpunkt
  g.strokeStyle = "rgba(255, 255, 255, 0.85)";
  g.lineWidth = 2.2; g.lineCap = "round";
  g.beginPath(); g.arc(0, 0, 10, Math.PI * 1.05, Math.PI * 1.5); g.stroke();
  g.fillStyle = "rgba(255,255,255,0.95)";
  g.beginPath(); g.arc(-4.5, -5.5, 2, 0, Math.PI * 2); g.fill();
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
SPR.mushroom = makeSprite(80, 100, g => {
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

// --- Weiche, fluffige Wolke (heller Kern + weiche Unterschattierung) ---
// --- Grasbüschel & Blumen am Wegrand ---
// Halme aus Schatten + Licht statt fester Farbe: so passen sie auf Wiese, Eis
// und Glutfeld gleichermaßen.
SPR.tuft = makeSprite(34, 24, g => {
  const blade = (x, dx, h, col, w) => {
    g.strokeStyle = col; g.lineWidth = w; g.lineCap = "round";
    g.beginPath(); g.moveTo(x, 0); g.quadraticCurveTo(x + dx * 0.3, -h * 0.6, x + dx, -h); g.stroke();
  };
  [[-10, -6, 15], [-5, -3, 20], [0, 1, 23], [5, 4, 19], [10, 7, 14], [-2, -8, 13], [3, 9, 12]]
    .forEach(([x, dx, h]) => blade(x, dx, h, "rgba(10,30,10,0.34)", 3));
  [[-5, -3, 20], [0, 1, 23], [5, 4, 19]].forEach(([x, dx, h]) => blade(x + 0.8, dx, h - 3, "rgba(255,255,230,0.3)", 1.3));
});
const flower = (col) => makeSprite(18, 26, g => {
  g.strokeStyle = "rgba(10,40,10,0.45)"; g.lineWidth = 2;
  g.beginPath(); g.moveTo(0, 0); g.quadraticCurveTo(2, -10, 0, -17); g.stroke();
  g.fillStyle = col;
  for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; g.beginPath(); g.arc(Math.cos(a) * 4, -19 + Math.sin(a) * 4, 3.4, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = "#fff3b0"; g.beginPath(); g.arc(0, -19, 2.6, 0, Math.PI * 2); g.fill();
});
SPR.flowerA = flower("#ff8ac8");
SPR.flowerB = flower("#fff6e8");

SPR.cloud = makeSprite(180, 90, g => {
  g.translate(0, -48);
  const puffs = [[-52, 8, 22], [-18, -6, 30], [22, 0, 26], [54, 10, 18], [0, 12, 34]];
  // Weiche Unterschattierung für Volumen
  g.fillStyle = "rgba(210, 224, 245, 0.5)";
  for (const [cx2, cy2, r] of puffs) { g.beginPath(); g.arc(cx2, cy2 + 4, r, 0, Math.PI * 2); g.fill(); }
  // Heller Wolkenkörper
  g.fillStyle = "rgba(255, 255, 255, 0.95)";
  for (const [cx2, cy2, r] of puffs) { g.beginPath(); g.arc(cx2, cy2, r, 0, Math.PI * 2); g.fill(); }
  // Sonnenbeschienene Oberkante
  g.fillStyle = "rgba(255, 255, 255, 1)";
  for (const [cx2, cy2, r] of puffs) { g.beginPath(); g.arc(cx2, cy2 - r * 0.35, r * 0.6, 0, Math.PI * 2); g.fill(); }
});

// --- Sonne (einmal vorgerendert: Bloom + Scheibe) ---
SPR.sun = makeSprite(300, 300, g => {
  g.translate(0, -150); // in die Sprite-Mitte
  const r = 32;
  const bloom = g.createRadialGradient(0, 0, 4, 0, 0, r * 4.5);
  bloom.addColorStop(0, "rgba(255,247,214,0.6)");
  bloom.addColorStop(0.5, "rgba(255,236,180,0.22)");
  bloom.addColorStop(1, "rgba(255,236,180,0)");
  g.fillStyle = bloom;
  g.beginPath(); g.arc(0, 0, r * 4.5, 0, Math.PI * 2); g.fill();
  const disc = g.createRadialGradient(-r * 0.3, -r * 0.3, r * 0.2, 0, 0, r);
  disc.addColorStop(0, "#fffef4"); disc.addColorStop(0.55, "#fff0c8"); disc.addColorStop(1, "#ffd873");
  g.fillStyle = disc;
  g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
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
// Kräftige, sonnige Farbwelten im Subway-Surfers-Stil: heller Himmel,
// satte Böden, klar lesbarer Weg. Jede Zone hat ihren eigenen Tag-Vibe.
const ZONES = [
  {
    name: "Zuckerwiese", sub: "Zone 1",
    sky: ["#37b6ff", "#8fe0ff", "#ffe6bf"],   // sonniger Himmel → warmer Horizont
    ground: ["#57d477", "#33a857"],           // frisches Wiesengrün
    road: ["#c295e6", "#9a63cf"],             // helle Zuckerstraße
    ridge: "#8a58c4", stars: 0,
  },
  {
    name: "Kristallwald", sub: "Zone 2",
    sky: ["#12a6dc", "#45cfe8", "#c2f3ee"],   // leuchtendes Türkis
    ground: ["#33bda8", "#1e8f7e"],
    road: ["#3f9ec8", "#2c7098"],
    ridge: "#1f7292", stars: 0.3,
  },
  {
    name: "Glutfelder", sub: "Zone 3",
    sky: ["#ff7a3d", "#ffad5c", "#ffe39a"],   // warmes Sonnenuntergangsgold
    ground: ["#d98a44", "#a15f2c"],
    road: ["#c2825a", "#94603f"],
    ridge: "#9a4826", stars: 0.1,
  },
  {
    name: "Sternenpass", sub: "Zone 4",
    sky: ["#1c1c66", "#3a3ab8", "#7a7af0"],   // satte Sternennacht
    ground: ["#3a3a8c", "#242461"],
    road: ["#4e4ea6", "#353576"],
    ridge: "#26265c", stars: 1,
  },
  {
    name: "Polarnacht", sub: "Zone 5",
    sky: ["#0d3a5e", "#1f93b0", "#5fe6cf"],   // Aurora-Türkis
    ground: ["#d2ecf5", "#9ec8d8"],           // helles Eis
    road: ["#a6cfe0", "#729aae"],
    ridge: "#356a80", stars: 0.85,
  },
  {
    name: "Morgenröte", sub: "Zone 6",
    sky: ["#6a45a8", "#f06a9c", "#ffd9a6"],   // leuchtender Sonnenaufgang
    ground: ["#eaa76e", "#bd7044"],
    road: ["#d6927e", "#a86a58"],
    ridge: "#9a4f68", stars: 0.05,
  },
];
const ZONE_LEN = 450; // Meter pro Zone

// Versteht #rrggbb UND rgb(r,g,b): palette() liefert rgb-Strings, und die wurden
// hier früher als Hex gelesen → rgb(NaN,…) → der Canvas ignorierte die Farbe still.
function hexRgb(c) {
  if (c[0] !== "#") { const m = String(c).match(/\d+(\.\d+)?/g) || []; return [+m[0] || 0, +m[1] || 0, +m[2] || 0]; }
  return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
}
function rgbaOf(c, a) { const A = hexRgb(c); return `rgba(${A[0]},${A[1]},${A[2]},${a})`; }
// Deterministischer Zufall je (Reihe, Spalte) — Platten & Gräser „wandern" nicht.
function hash2(a, b) {
  let h = (a * 374761393 + b * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// Energiesparen (Profil → Einstellungen): Deko-Extras weglassen
const LOWP = () => document.documentElement.hasAttribute("data-lowpower");
function mixHex(a, b, u) {
  const A = hexRgb(a), B = hexRgb(b);
  return `rgb(${Math.round(A[0] + (B[0] - A[0]) * u)},${Math.round(A[1] + (B[1] - A[1]) * u)},${Math.round(A[2] + (B[2] - A[2]) * u)})`;
}
// Aktuelle Palette (weich zwischen Zonen überblendet)
function palette(meters) {
  const zi = Math.max(0, Math.floor(meters / ZONE_LEN));
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
let uniLane = 1;        // Spur des Einhorns — folgt der Läuferin träge
let jumpH = 0, jumpV = 0, sliding = 0;
let stumbleT = 0, invuln = 0, runPhase = 0, landT = 0;
let chase = 0.5;        // Einhorn-Nähe 0..1 (1 = erwischt)
let catchT = 0;
let shake = 0, flash = 0;
let magnetT = 0, boostT = 0, shieldOn = false;
let coinCombo = 0, comboT = 0;
let zoneShown = -1;
let whip = null, swayKick = 0, turnCount = 0; // Abbiege-Zustand
let turnAnim = null, bgPan = 0, bgPanT = 0;    // 90°-Schwenk: Horizont zieht weiter
let nextSpawnW = 0, nextScenW = 0, nextPowM = 0, nextTurnM = 0;
let entities = [], sceneries = [], particles = [];
let submitted = false;
let stars = [];

// Ruhiger Einstieg, sanfte Steigerung — Tempo-Gefühl kommt aus der
// Kameranähe, nicht aus hektischem Scrolling.
const BASE_SPEED = 4.6, MAX_SPEED = 9.5;
const JUMP_V = 560, GRAV = 1400;
const SLIDE_DUR = 0.65;

let best = Number(localStorage.getItem("galopp_best") || 0);

function newRun() {
  o = 0; speed = BASE_SPEED; meters = 0; coins = 0; score = 0;
  laneTarget = 1; laneCur = 1; uniLane = 1;
  jumpH = 0; jumpV = 0; sliding = 0;
  stumbleT = 0; invuln = 0; runPhase = 0; landT = 0;
  chase = 0.5; catchT = 0; shake = 0; flash = 0;
  magnetT = 0; boostT = 0; shieldOn = false;
  coinCombo = 0; comboT = 0; zoneShown = -1;
  whip = null; swayKick = 0; turnCount = 0;
  turnAnim = null; bgPan = 0; bgPanT = 0;
  if (DAILY) {
    const d = new Date();
    rngW = mulberry32(d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate());
  } else if (WEEKLY) {
    // UTC-Wochen-Bucket (Montag-Start): jede:r läuft diese Woche dieselbe Strecke
    const week = Math.floor((Date.now() / 86400000 - 4) / 7);
    rngW = mulberry32(7000000 + week);
  }
  nextSpawnW = 18; nextScenW = 2; nextPowM = 180 + rngW() * 120;
  nextTurnM = 160 + rngW() * 100;
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

// Bergrücken-Silhouetten (3 Parallax-Ebenen: fern & dunstig → nah & satt)
let ridges = [];
function buildRidges() {
  ridges = [0.3, 0.42, 0.7].map((amp, li) => {
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
function difficulty() { return Math.min(1, meters / 2000); }

function spawnEvent(wz) {
  const d = difficulty();
  const r = rngW();
  const lanes = [0, 1, 2];

  if (r < 0.16) {
    // Nur Taler
    spawnCoinPattern(wz, lanes[Math.floor(rngW() * 3)]);
    return;
  }
  if (r < 0.30 && meters > 120) {
    // Ganze Breite: springen oder ducken
    const kind = rngW() < 0.5 ? "hurdle" : "arch";
    entities.push({ type: "ob", kind, lane: -1, wz, passed: false });
    if (kind === "hurdle" && rngW() < 0.6) spawnCoinArc(wz, Math.floor(rngW() * 3));
    return;
  }
  // 1–2 Spuren blockiert (nie alle 3)
  const nBlock = (meters > 250 && rngW() < 0.35 + d * 0.35) ? 2 : 1;
  const shuffled = lanes.sort(() => rngW() - 0.5);
  for (let i = 0; i < nBlock; i++) {
    const kinds = ["hurdle", "arch", "rock"];
    const kind = kinds[Math.floor(rngW() * (meters > 60 ? 3 : 2))];
    entities.push({ type: "ob", kind, lane: shuffled[i], wz: wz + (i ? rngW() * 1.2 : 0), passed: false });
  }
  // Belohnung auf der freien Spur
  if (rngW() < 0.45) spawnCoinPattern(wz + 1.5, shuffled[nBlock]);
}

function spawnCoinPattern(wz, lane) {
  const style = rngW();
  if (style < 0.6) {
    // Linie
    const n = 5 + Math.floor(rngW() * 4);
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
  const kind = kinds[Math.floor(rngW() * 3)];
  const lane = Math.floor(rngW() * 3);
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
  // Steht eine Abzweigung an? Dann zählt der Wisch als Abbiegen.
  const turn = activeTurn();
  if (turn && dir === turn.dir) { executeTurn(turn); return; }
  const nl = Math.max(0, Math.min(2, laneTarget + dir));
  if (nl !== laneTarget) { laneTarget = nl; sound.whoosh(); }
}

// Abzweigung im Reaktionsfenster vor der Läuferin
function activeTurn() {
  for (const e of entities) {
    if (e.kind !== "turn" || e.passed || e.taken) continue;
    const z = e.wz - o;
    if (z > PLAYER_Z - 0.05 && z < PLAYER_Z + 4.0) return e;
  }
  return null;
}

// Nächste Abzweigung in Sichtweite (für Warnhinweis)
function upcomingTurn() {
  let best2 = null;
  for (const e of entities) {
    if (e.kind !== "turn" || e.passed || e.taken) continue;
    const z = e.wz - o;
    if (z > PLAYER_Z && z < 16 && (!best2 || z < best2.z)) best2 = { e, z };
  }
  return best2;
}

function executeTurn(e) {
  if (e.taken) return;
  e.taken = true;
  e.passed = true;
  turnCount++;
  // Wie bei Temple Run: ruhiger 90°-Schwenk um die Läuferin. Der Horizont zieht
  // eine Bildbreite weiter, der neue Weg schwingt von der Seite herein, wo eben
  // noch der Seitenweg lag. Vorher kippte die Kamera, sprang zur Seite und
  // wackelte — alles gleichzeitig.
  turnAnim = { dir: e.dir, t: 0 };
  bgPanT += e.dir * W * 1.15;
  swayKick = e.dir * W * 1.25;
  sound.turn();
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
  if (e.kind === "turn") {
    // Verpasste Abzweigung: Schild/Boost lenken automatisch, sonst
    // knallt man frontal in die Balustrade — das Einhorn ist fast da.
    if (boostT > 0 || shieldOn) {
      if (boostT <= 0) { shieldOn = false; updatePills(); sound.shieldPop(); }
      executeTurn(e);
      return;
    }
    e.taken = true;
    chase = Math.min(1, chase + 0.75);
    speed *= 0.4;
    invuln = 1.6;
    stumbleT = 0.7;
    shake = 0.45;
    flash = 0.22;
    coinCombo = 0;
    sound.stumble();
    puff(px, py - 40, VIOLET, 22, 240, 130);
    if (chase >= 1) startCatch();
    return;
  }
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
  shake = 0.32;
  flash = 0.16;
  coinCombo = 0;
  sound.stumble();
  puff(px, py - 20, "#c9b8d9", 14, 160, 80);
  if (chase >= 1) startCatch();
}

function startCatch() {
  mode = "catch";
  // Unverwundbarkeit (Blinken) beenden: im Fang und danach läuft kein Timer
  // mehr — die Figur blinkte sonst hinter „Nochmal rennen" endlos weiter.
  invuln = 0;
  catchT = 0;
  sound.caught();
}

// ==================== Update ====================
function update(dt) {
  if (mode === "catch") {
    catchT += dt;
    uniLane += (laneCur - uniLane) * Math.min(1, dt * 5);
    speed = Math.max(0, speed - dt * 14);
    o += speed * dt;
    runPhase += speed * dt * 1.6;
    updateParticles(dt);
    if (catchT > 1.15) { mode = "over"; gameOver(); }
    return;
  }
  // Im Menü läuft die Welt gemächlich weiter und die Figur trabt auf der
  // Stelle — das Menü liegt jetzt halb durchsichtig über dem Spiel.
  if (mode === "menu") { o += dt * 3.2; runPhase += dt * 7; }
  if (mode !== "run") { updateParticles(dt); return; }

  const d = difficulty();
  // Tempo
  const targetSpeed = (BASE_SPEED + (MAX_SPEED - BASE_SPEED) * d) * (boostT > 0 ? 1.6 : 1);
  speed += (targetSpeed - speed) * Math.min(1, dt * (stumbleT > 0 ? 0.8 : 1.6));
  o += speed * dt;
  meters += speed * dt * 2.2;
  runPhase += speed * dt * 1.55;
  swayKick *= Math.exp(-dt * 5.5);   // schwingt zügig, aber weich zurück
  sway = Math.sin(o * 0.085) * W * 0.09 + Math.sin(o * 0.021) * W * 0.05 + swayKick;
  bgPan += (bgPanT - bgPan) * Math.min(1, dt * 7);
  if (turnAnim) { turnAnim.t += dt; if (turnAnim.t > 0.45) turnAnim = null; }

  // Zonen-Banner
  const zi = Math.max(0, Math.floor(meters / ZONE_LEN));
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
  uniLane += (laneCur - uniLane) * Math.min(1, dt * 3.2);   // zieht hinterher, springt nicht mit
  if (jumpH > 0 || jumpV > 0) {
    jumpH += jumpV * dt;
    jumpV -= GRAV * dt;
    if (jumpH <= 0) {
      jumpH = 0; jumpV = 0; landT = 0.16;
      puff(laneX(laneCur, PLAYER_T), groundY(PLAYER_T), "rgba(220,200,240,0.7)", 5, 80);
    }
  }
  if (sliding > 0) {
    sliding -= dt;
    // Rutsch-Staub unter der Figur
    if (!LOWP() && Math.random() < 0.55) {
      puff(laneX(laneCur, PLAYER_T) + (Math.random() - 0.5) * 34, groundY(PLAYER_T), "rgba(236, 226, 246, 0.6)", 1, 90, 24);
    }
  }
  if (landT > 0) landT -= dt;

  // Boost-Funken
  if (boostT > 0) {
    sparkleTrail(laneX(laneCur, PLAYER_T), groundY(PLAYER_T) - jumpH, RAINBOW[Math.floor(Math.random() * 6)]);
  }

  // Spawnen
  if (meters > nextTurnM) {
    // Abzweigung! Der Weg endet an einer Balustrade — wisch in Pfeilrichtung.
    const dir = rngW() < 0.5 ? -1 : 1;
    entities.push({ type: "ob", kind: "turn", dir, lane: -1, wz: o + SPAWN_Z, passed: false, taken: false });
    nextTurnM = meters + 240 + rngW() * 200;
    nextSpawnW = Math.max(nextSpawnW, o + SPAWN_Z + 6.5); // Luft nach der Kurve
  }
  while (nextSpawnW < o + SPAWN_Z) {
    spawnEvent(nextSpawnW);
    nextSpawnW += 5.4 - d * 1.6 + rngW() * 1.8;
  }
  while (nextScenW < o + SPAWN_Z) {
    spawnScenery(nextScenW);
    nextScenW += 0.9 + Math.random() * 1.4;
  }
  if (meters > nextPowM) {
    spawnPowerup(o + SPAWN_Z - 1);
    nextPowM = meters + 280 + rngW() * 180;
  }

  // Entities
  const px = laneX(laneCur, PLAYER_T);
  for (const e of entities) {
    const z = e.wz - o;
    // Warn-Glöckchen, wenn eine Abzweigung in Sichtweite kommt
    if (e.kind === "turn" && !e.warned && !e.passed && z < 13) {
      e.warned = true;
      sound.turnWarn();
    }
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
            (e.kind === "hurdle" && jumpH > 38) ||
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
    const camBob = jumpH > 2 ? 0 : Math.abs(Math.sin(runPhase)) * 4;
    ctx.translate(W / 2, H / 2);
    ctx.rotate((laneTarget - laneCur) * 0.018);
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
      ctx.arc(((s.x * W - bgPan * 0.9) % W + W) % W, s.y * hY, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // Himmelskörper: tagsüber strahlende Sonne mit Bloom, nachts Zwillingsmonde
  // Sonne/Monde wandern beim Abbiegen mit dem Horizont (in einem 2,4-fachen
  // Bildband, damit sie nach ein paar Kurven wieder auftauchen)
  const skyX = x0 => ((x0 - bgPan) % (W * 2.4) + W * 2.4) % (W * 2.4) - W * 0.7;
  if (pal.stars < 0.4) {
    blitFoot(SPR.sun, skyX(W * 0.75), hY * 0.4 + SPR.sun.h / 2, 1, 1);
  } else {
    const moon = (mx, my, r, col, glow) => {
      ctx.shadowColor = glow; ctx.shadowBlur = 26;
      const gr = ctx.createRadialGradient(mx - r * 0.3, my - r * 0.3, r * 0.15, mx, my, r);
      gr.addColorStop(0, "#fffdf4"); gr.addColorStop(1, col);
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(mx, my, r, 0, Math.PI * 2); ctx.fill();
      ctx.shadowBlur = 0;
    };
    moon(skyX(W * 0.78), hY * 0.34, 26, "#e8d9b0", "rgba(232,217,176,0.8)");
    moon(skyX(W * 0.66), hY * 0.58, 9, "#d9b8e8", "rgba(217,184,232,0.8)");
  }

  // Wolken ziehen vorbei (Parallax) — tagsüber hell & fluffig
  const cloudA = 0.5 * (1 - pal.stars * 0.7);
  for (const c of clouds) {
    const span = W + 260;
    const x = ((c.x0 * span - o * c.sp - bgPan * 0.8) % span + span) % span - 130;
    blitFoot(SPR.cloud, x, hY * c.y + 35 * c.sc, c.sc, cloudA);
  }

  // Glühen am Horizont — Tiefe & Licht
  const hg2 = ctx.createRadialGradient(W / 2, hY, 10, W / 2, hY, W * 0.75);
  hg2.addColorStop(0, pal.sky[2].replace("rgb", "rgba").replace(")", ",0.5)"));
  hg2.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = hg2;
  ctx.fillRect(0, hY - W * 0.3, W, W * 0.6);

  // --- Bergrücken (Parallax) ---
  // Luftperspektive: je ferner, desto heller und blasser; Gipfel im Licht
  // (bei der fernsten Kette wie Schnee), am Fuß Dunst in Horizontfarbe.
  const RL = [{ sp: 0.18, h: 0.68, haze: 0.62, lit: 0.5 }, { sp: 0.4, h: 0.5, haze: 0.4, lit: 0.2 }, { sp: 0.9, h: 0.32, haze: 0.15, lit: 0.1 }];
  for (const ridge of ridges) {
    const L = RL[ridge.li];
    const shift = (((o * L.sp * 14 + bgPan * (0.55 + ridge.li * 0.2)) % W) + W) % W;
    const baseH = hY * L.h;
    const base = ridge.li === 0 ? mixHex(pal.ridge, pal.sky[1], 0.4)
      : ridge.li === 1 ? pal.ridge : mixHex(pal.ridge, "#000000", 0.3);
    const rg = ctx.createLinearGradient(0, hY - baseH * 1.05, 0, hY);
    rg.addColorStop(0, mixHex(base, "#ffffff", L.lit));
    rg.addColorStop(0.4, base);
    rg.addColorStop(1, mixHex(base, pal.sky[2], L.haze));
    ctx.fillStyle = rg;
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

  // Nahe Schnittebene = Bildunterkante (+ Rand für Kamera-Neigung und Abbiege-
  // Schwenk). Früher endete alles Flache bei z = 0,7 — weit unter dem Bild — und
  // die y-Koordinate wurde an den Rand geklemmt, x aber nicht: die unterste
  // Reihe (Fugen, Spurstriche, Mauerkante) knickte dadurch nach außen weg und
  // „sprang" beim Verschwinden. Jetzt endet alles genau am Rand, ohne Klemmen.
  const tBot = (H + 70 - hY) / (H * 1.08 - hY);
  const ZN = Math.max(NEAR * 0.7, NEAR / tBot);

  // Kreuzung voraus? Dann endet der Weg an ihrer Mauer (dahinter Wiese), und
  // die Randmauer auf der Abbiege-Seite öffnet sich für den Seitenweg — die
  // Kreuzung selbst ist der Hinweis, wie bei Temple Run (keine Pfeile).
  let jun = null;
  for (const e of entities) {
    if (e.kind !== "turn" || e.taken) continue;
    const z = e.wz - o;
    if (z > 0.6 && (!jun || z < jun.z)) jun = { e, z, dir: e.dir };
  }
  const ZF = jun ? Math.max(ZN + 0.05, Math.min(SPAWN_Z, jun.z)) : SPAWN_Z;
  const gapZ = jun ? jun.z - JUN_D : Infinity;   // ab hier offen zur Abbiege-Seite

  // --- Boden: Streifen scrollen auf die Kamera zu ---
  const STRIPE = 3.4;
  ctx.fillStyle = pal.ground[1];
  ctx.fillRect(0, hY, W, H - hY);
  const kMin = Math.floor((o + ZN) / STRIPE);
  const kMax = Math.ceil((o + SPAWN_Z) / STRIPE);
  for (let k = kMin; k <= kMax; k++) {
    if (k % 2) continue;
    const zFar = Math.min(SPAWN_Z, (k + 1) * STRIPE - o);
    const zNear = Math.max(ZN, k * STRIPE - o);
    if (zFar <= zNear) continue;
    const yFar = groundY(tOf(zFar));
    const yNear = groundY(tOf(zNear));
    ctx.fillStyle = pal.ground[0];
    ctx.fillRect(0, yFar, W, yNear - yFar);
  }

  // Grasbüschel & Blumen am Wegrand — laufen perspektivisch mit, fern → nah
  if (!LOWP()) {
    const TB = 1.1;
    const bMin = Math.floor((o + NEAR * 0.8) / TB), bMax = Math.ceil((o + SPAWN_Z * 0.8) / TB);
    for (let k = bMax; k >= bMin; k--) {
      const z = k * TB - o;
      if (z < NEAR * 0.8 || z > SPAWN_Z * 0.8) continue;
      const t = tOf(z), y = groundY(t);
      if (y > H + 30) continue;
      const alpha = Math.min(1, t * 5);
      for (const sgn of [-1, 1]) for (let j = 0; j < 2; j++) {
        if (jun && sgn === jun.dir && z > gapZ - 0.4 && z < jun.z + 0.6) continue;
        const h = hash2(k * 2 + j, sgn);
        const x = centerX(t) + sgn * roadHalf(t) * (1.22 + h * 1.9 + j * 0.35);
        if (x < -30 || x > W + 30) continue;
        const sp = h > 0.86 ? SPR.flowerA : h > 0.76 ? SPR.flowerB : SPR.tuft;
        blitFoot(sp, x, y, t / PLAYER_T * (1 + h * 0.4), alpha);
      }
    }
  }

  // --- Weg ---
  const tN = tOf(ZN), tF = tOf(ZF);
  const roadGrad = ctx.createLinearGradient(0, groundY(tF), 0, H);
  roadGrad.addColorStop(0, pal.road[1]);
  roadGrad.addColorStop(1, pal.road[0]);
  ctx.fillStyle = roadGrad;
  ctx.beginPath();
  // Rand in mehreren z-Schritten sampeln, damit die Kurve sichtbar wird
  const steps = 14;
  const sampleEdge = zB => {
    const out = [];
    for (let i = 0; i <= steps; i++) {
      const z = ZN + (zB - ZN) * Math.pow(i / steps, 2.2);
      const t = tOf(z);
      out.push([centerX(t) - roadHalf(t), centerX(t) + roadHalf(t), groundY(t), t]);
    }
    return out;
  };
  const edge = sampleEdge(ZF);
  ctx.moveTo(edge[0][0], edge[0][2]);
  for (let i = 1; i <= steps; i++) ctx.lineTo(edge[i][0], edge[i][2]);
  for (let i = steps; i >= 0; i--) ctx.lineTo(edge[i][1], edge[i][2]);
  ctx.closePath();
  ctx.fill();

  // Steinplatten: Reihen hell/dunkel im Wechsel, je Spur leicht anders getönt.
  // Das ist das Haupt-Signal für Tempo und Tiefe — vorher war der Weg eine
  // glatte Fläche mit kaum sichtbaren Fugen.
  const SLAB = 1.7;
  const sMin = Math.floor((o + ZN) / SLAB);
  const sMax = Math.ceil((o + ZF) / SLAB);
  // Pflaster: 6 Platten je Reihe, jede zweite Reihe um eine halbe Platte versetzt
  // (Verband wie echtes Steinpflaster), mit senkrechten Fugen.
  const NC = 6, PW = 2 / NC;
  ctx.lineWidth = 1;
  for (let k = sMin; k <= sMax; k++) {
    const z0 = Math.max(ZN, k * SLAB - o), z1 = Math.min(ZF, (k + 1) * SLAB - o);
    if (z1 <= z0) continue;
    const t0 = tOf(z0), t1 = tOf(z1);
    const y0 = groundY(t0), y1 = groundY(t1);
    if (y1 > H + 4) continue;
    const off = (k & 1) ? 0.5 : 0;
    const X = (t, u) => centerX(t) + u * roadHalf(t);
    for (let c = -1; c < NC; c++) {
      const u0 = Math.max(-1, -1 + (c + off) * PW), u1 = Math.min(1, -1 + (c + 1 + off) * PW);
      if (u1 <= u0) continue;
      const v = ((k & 1) ? 0.06 : -0.04) + (hash2(k, c + 10) - 0.5) * 0.13;
      ctx.fillStyle = v > 0 ? `rgba(255,250,255,${v.toFixed(3)})` : `rgba(14,4,26,${(-v).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(X(t0, u0), y0); ctx.lineTo(X(t0, u1), y0);
      ctx.lineTo(X(t1, u1), y1); ctx.lineTo(X(t1, u0), y1);
      ctx.closePath();
      ctx.fill();
    }
    // senkrechte Fugen dieser Reihe
    ctx.strokeStyle = "rgba(10,5,20,0.24)";
    ctx.lineWidth = Math.max(1, 2 * t0);
    ctx.beginPath();
    for (let c = 0; c <= NC; c++) {
      const u = -1 + (c + off) * PW;
      if (u <= -0.98 || u >= 0.98) continue;
      ctx.moveTo(X(t0, u), y0); ctx.lineTo(X(t1, u), y1);
    }
    ctx.stroke();
  }
  // Randschatten an den Mauern + heller Glanzstreifen in der Mitte
  const band = (u0, u1, col) => {
    ctx.fillStyle = col;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) { const t = edge[i][3]; const x = centerX(t) + u0 * roadHalf(t); i ? ctx.lineTo(x, edge[i][2]) : ctx.moveTo(x, edge[i][2]); }
    for (let i = steps; i >= 0; i--) { const t = edge[i][3]; ctx.lineTo(centerX(t) + u1 * roadHalf(t), edge[i][2]); }
    ctx.closePath();
    ctx.fill();
  };
  for (const sg of [-1, 1]) { band(sg * 1, sg * 0.9, "rgba(10,4,22,0.22)"); band(sg * 0.9, sg * 0.76, "rgba(10,4,22,0.09)"); }
  band(-0.22, 0.22, "rgba(255,255,255,0.045)");

  // Steinplatten-Fugen quer über den Weg
  ctx.strokeStyle = "rgba(10, 5, 20, 0.3)";
  for (let k = sMin; k <= sMax; k++) {
    const z = k * SLAB - o;
    if (z < ZN || z > ZF) continue;
    const t = tOf(z);
    const y = groundY(t);
    if (y > H + 4) continue;
    ctx.lineWidth = Math.max(1, 2.6 * t);
    ctx.beginPath();
    ctx.moveTo(centerX(t) - roadHalf(t), y);
    ctx.lineTo(centerX(t) + roadHalf(t), y);
    ctx.stroke();
    // Lichtkante der Platte
    ctx.strokeStyle = "rgba(255, 245, 255, 0.11)";
    ctx.beginPath();
    ctx.moveTo(centerX(t) - roadHalf(t), y + Math.max(1, 2.6 * t));
    ctx.lineTo(centerX(t) + roadHalf(t), y + Math.max(1, 2.6 * t));
    ctx.stroke();
    ctx.strokeStyle = "rgba(10, 5, 20, 0.3)";
  }

  // Randmauern links & rechts (wie die Tempelmauern): Innenwand im Schatten,
  // Oberseite im Licht, Blockfugen im Takt der Platten. Vorher eine flache,
  // schräge Kante, die man kaum als Mauer lesen konnte.
  const WH = 24, WT = 30;   // Mauerhöhe und Breite der Oberseite bei t = 1
  const edgeGap = jun && gapZ > ZN + 0.05 ? sampleEdge(Math.min(gapZ, ZF)) : null;
  for (const side of [0, 1]) {
    const sgn = side === 0 ? -1 : 1;
    const E = jun && sgn === jun.dir ? edgeGap : edge;
    if (!E) continue;
    const wallTopY = i => E[i][2] - WH * E[i][3];
    const face = ctx.createLinearGradient(0, groundY(tOf(SPAWN_Z)), 0, H);
    face.addColorStop(0, mixHex(pal.ridge, "#000000", 0.3));
    face.addColorStop(1, mixHex(pal.road[1], "#000000", 0.42));
    ctx.fillStyle = face;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) i ? ctx.lineTo(E[i][side], E[i][2]) : ctx.moveTo(E[i][side], E[i][2]);
    for (let i = steps; i >= 0; i--) ctx.lineTo(E[i][side], wallTopY(i));
    ctx.closePath();
    ctx.fill();
    const top = ctx.createLinearGradient(0, groundY(tOf(SPAWN_Z)), 0, H);
    top.addColorStop(0, pal.ridge);
    top.addColorStop(1, mixHex(pal.road[0], "#ffffff", 0.28));
    ctx.fillStyle = top;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) i ? ctx.lineTo(E[i][side], wallTopY(i)) : ctx.moveTo(E[i][side], wallTopY(i));
    for (let i = steps; i >= 0; i--) { const t = E[i][3]; ctx.lineTo(E[i][side] + sgn * WT * t, wallTopY(i) - 5 * t); }
    ctx.closePath();
    ctx.fill();
    // Goldene Glow-Kante an der Innenkante oben
    ctx.strokeStyle = "rgba(232, 193, 90, 0.55)";
    ctx.lineWidth = 2;
    ctx.shadowColor = GOLD; ctx.shadowBlur = 7;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) i ? ctx.lineTo(E[i][side], wallTopY(i)) : ctx.moveTo(E[i][side], wallTopY(i));
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  // Blockfugen: senkrecht in der Innenwand, weiter über die Oberseite
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  for (let k = sMin; k <= sMax; k++) {
    if (k % 2) continue;
    const z = k * SLAB - o;
    if (z < ZN || z > ZF) continue;
    const t = tOf(z), y = groundY(t);
    if (y > H + 4) continue;
    ctx.lineWidth = Math.max(1, 2 * t);
    for (const sgn of [-1, 1]) {
      if (jun && sgn === jun.dir && z > gapZ) continue;
      const x = centerX(t) + sgn * roadHalf(t);
      ctx.beginPath();
      ctx.moveTo(x, y); ctx.lineTo(x, y - WH * t); ctx.lineTo(x + sgn * WT * t, y - WH * t - 5 * t);
      ctx.stroke();
    }
  }

  // Kristalle auf den Bordsteinen
  const EDGE_STEP = 1.8;
  const eMin = Math.floor((o + NEAR * 0.75) / EDGE_STEP);
  const eMax = Math.ceil((o + SPAWN_Z) / EDGE_STEP);
  for (let k = eMin; k <= eMax; k++) {
    const z = k * EDGE_STEP - o;
    if (z < NEAR * 0.75 || z > ZF) continue;
    const t = tOf(z);
    const y = groundY(t) - WH * t - 3 * t;   // auf der Mauerkrone
    if (y > H + 10) continue;
    const sp = (k % 2 === 0) ? SPR.edgeA : SPR.edgeB;
    const alpha = Math.min(1, t * 6);
    for (const sgn of [-1, 1]) {
      if (jun && sgn === jun.dir && z > gapZ) continue;
      blitFoot(sp, centerX(t) + sgn * (roadHalf(t) + WT * 0.5 * t), y, t / PLAYER_T * 1.25, alpha);
    }
  }

  // Spur-Trennstriche — klar & hell (Subway-Surfers-Gleise)
  ctx.strokeStyle = "rgba(255, 252, 240, 0.55)";
  ctx.lineCap = "round";
  const DASH = 2.6;
  const dMin = Math.floor((o + ZN) / DASH);
  const dMax = Math.ceil((o + ZF) / DASH);
  for (let k = dMin; k <= dMax; k++) {
    if (k % 2) continue;
    const z0 = Math.max(ZN, k * DASH - o);
    const z1 = Math.min(ZF, (k + 0.55) * DASH - o);
    if (z1 <= z0) continue;
    const t0 = tOf(z0), t1 = tOf(z1);
    for (const b of [-0.5, 0.5]) {
      ctx.lineWidth = Math.max(1, 3.4 * t0);
      ctx.beginPath();
      ctx.moveTo(centerX(t0) + b * laneW() * t0, groundY(t0));
      ctx.lineTo(centerX(t1) + b * laneW() * t1, groundY(t1));
      ctx.stroke();
    }
  }

  // --- Objekte, weit → nah ---
  const drawables = [];
  for (const s of sceneries) {
    const z = s.wz - o;
    if (z < 0.6 || z > SPAWN_Z) continue;
    if (jun && s.side === jun.dir && z > gapZ - 0.8 && z < jun.z + 1.2) continue;   // nicht auf dem Seitenweg
    drawables.push({ z, kind: "scen", e: s });
  }
  for (const e of entities) {
    const z = e.wz - o;
    if (z < 0.6 || z > SPAWN_Z) continue;
    if (jun && e.kind !== "turn" && z > jun.z + 0.05) continue;   // liegt hinter der Ecke
    drawables.push({ z, kind: e.type, e });
  }
  drawables.sort((a, b) => b.z - a.z);

  // Luftperspektive: Boden, Weg und FERNE Objekte verblassen in der Horizont-
  // farbe. Wird zwischen fernen und nahen Objekten gemalt — Nahes bleibt satt.
  const FOG_Z = 10;
  let fogged = false;
  const drawFog = () => {
    fogged = true;
    const yF = groundY(tOf(FOG_Z));
    const fg = ctx.createLinearGradient(0, hY, 0, yF);
    fg.addColorStop(0, rgbaOf(pal.sky[2], 0.62));
    fg.addColorStop(0.45, rgbaOf(pal.sky[2], 0.22));
    fg.addColorStop(1, rgbaOf(pal.sky[2], 0));
    ctx.fillStyle = fg;
    ctx.fillRect(-W, hY - 1, W * 3, yF - hY + 1);
  };

  for (const d of drawables) {
    if (!fogged && d.z < FOG_Z) drawFog();
    const t = tOf(d.z);
    const alpha = Math.min(1, t * 6);
    const e = d.e;
    if (d.kind === "scen") {
      const x = centerX(t) + e.side * (roadHalf(t) + (34 + e.off) * t);
      blitFoot(SPR[e.kind], x, groundY(t), t / PLAYER_T * e.sc * 1.5, alpha);
    } else if (d.kind === "ob" && e.kind === "turn") {
      drawJunction(e, now, pal);
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
      const powCol = e.kind === "shield" ? MINT : e.kind === "boost" ? GOLD : "#ff6b6b";
      // Pulsierender Lichtschein + aufsteigende Ringe machen Power-ups von Weitem sichtbar
      const pulse = 0.5 + 0.5 * Math.sin(now * 0.006 + e.wz);
      const oy = y; // Zentrum des Orbs (blitFoot + powSprite-Versatz heben sich auf)
      ctx.save();
      ctx.globalAlpha = alpha * (0.25 + 0.25 * pulse);
      const halo = ctx.createRadialGradient(x, oy - 4 * sc, 2, x, oy - 4 * sc, 46 * sc);
      halo.addColorStop(0, powCol);
      halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = halo;
      ctx.beginPath(); ctx.arc(x, oy - 4 * sc, 46 * sc, 0, Math.PI * 2); ctx.fill();
      // aufsteigender Ring
      const rp = (now * 0.0011 + e.wz) % 1;
      ctx.globalAlpha = alpha * (1 - rp) * 0.8;
      ctx.strokeStyle = powCol; ctx.lineWidth = 2.5 * sc;
      ctx.beginPath();
      ctx.ellipse(x, oy + 6 * sc - rp * 34 * sc, (14 + rp * 10) * sc, (5 + rp * 3) * sc, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;
      blitFoot(SPR[e.kind], x, y + 23 * sc, sc, alpha);
    }
  }

  if (!fogged) drawFog();

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
  // Nach dem Fangen ist die Läuferin „weg" — das Einhorn steht groß im Bild
  if (mode !== "over") drawRunner(now);

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

// --- Kreuzung wie bei Temple Run ---
// Der Weg endet an einer Mauer quer vor dir; zur Abbiege-Seite geht ein
// gepflasterter Seitenweg im rechten Winkel ab (Kanten konstanter Tiefe sind
// am Schirm waagrecht, Fugen quer dazu laufen zum Fluchtpunkt). Keine Pfeile —
// nur bei den ersten zwei Kreuzungen ein dezenter Hinweis auf dem Seitenweg.
const JUN_D = 2.6;   // Breite des Seitenwegs in Tiefen-Einheiten
function drawJunction(e, now, pal) {
  const z1 = e.wz - o, z0 = Math.max(0.7, z1 - JUN_D);
  if (z1 < 0.7) return;
  const t0 = tOf(z0), t1 = tOf(z1);
  const y0 = groundY(t0), y1 = groundY(t1);
  const dir = e.dir;
  const alpha = Math.min(1, t1 * 10);
  const X = (t, k) => centerX(t) + dir * (roadHalf(t) + k * t);   // k = Abstand vom Wegrand (px bei t = 1)
  const out = dir > 0 ? W + 80 : -80;
  const WH = 24, WT = 30, EH = 36;   // Seitenmauer-Höhe/-Breite wie am Weg, Endmauer etwas höher

  ctx.save();
  ctx.globalAlpha = alpha;

  // Seitenweg
  const rg = ctx.createLinearGradient(0, y1, 0, y0);
  rg.addColorStop(0, pal.road[1]); rg.addColorStop(1, pal.road[0]);
  ctx.fillStyle = rg;
  ctx.beginPath();
  ctx.moveTo(X(t0, 0), y0); ctx.lineTo(out, y0); ctx.lineTo(out, y1); ctx.lineTo(X(t1, 0), y1);
  ctx.closePath(); ctx.fill();
  // Pflaster: zwei Reihen, Platten versetzt, Fugen zum Fluchtpunkt
  const TW = W * 0.2, zm = (z0 + z1) / 2, tm = tOf(zm), ym = groundY(tm);
  for (let r = 0; r < 2; r++) {
    const ta = r ? tm : t0, tb = r ? t1 : tm, ya = r ? ym : y0, yb = r ? y1 : ym;
    for (let k = 0; k < 14; k++) {
      const ka = (k + (r ? 0.5 : 0)) * TW, kb = ka + TW;
      const xa = X(ta, ka), xb = X(ta, kb);
      if (dir > 0 ? Math.min(xa, X(tb, ka)) > W + 80 : Math.max(xa, X(tb, ka)) < -80) break;
      const v = ((k + r) % 2 ? 0.055 : -0.035) + (hash2(k + r * 31, 91) - 0.5) * 0.1;
      ctx.fillStyle = v > 0 ? `rgba(255,250,255,${v.toFixed(3)})` : `rgba(14,4,26,${(-v).toFixed(3)})`;
      ctx.beginPath();
      ctx.moveTo(xa, ya); ctx.lineTo(xb, ya); ctx.lineTo(X(tb, kb), yb); ctx.lineTo(X(tb, ka), yb);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(10,5,20,0.24)"; ctx.lineWidth = Math.max(1, 2 * ta);
      ctx.beginPath(); ctx.moveTo(xa, ya); ctx.lineTo(X(tb, ka), yb); ctx.stroke();
    }
  }
  ctx.strokeStyle = "rgba(10,5,20,0.28)"; ctx.lineWidth = Math.max(1, 2.4 * tm);
  ctx.beginPath(); ctx.moveTo(X(tm, 0), ym); ctx.lineTo(out, ym); ctx.stroke();
  // Schatten der Endmauer auf dem Seitenweg
  const sh = ctx.createLinearGradient(0, y1, 0, y1 + (y0 - y1) * 0.45);
  sh.addColorStop(0, "rgba(10,4,22,0.28)"); sh.addColorStop(1, "rgba(10,4,22,0)");
  ctx.fillStyle = sh;
  ctx.fillRect(Math.min(X(t1, 0), out), y1, Math.abs(out - X(t1, 0)), (y0 - y1) * 0.45);

  // Mauerkopf dort, wo die Randmauer für den Seitenweg aufhört
  ctx.fillStyle = mixHex(pal.ridge, "#000000", 0.42);
  ctx.beginPath();
  ctx.moveTo(X(t0, 0), y0); ctx.lineTo(X(t0, 0), y0 - WH * t0);
  ctx.lineTo(X(t0, WT), y0 - WH * t0 - 5 * t0); ctx.lineTo(X(t0, WT), y0 - 5 * t0);
  ctx.closePath(); ctx.fill();

  // Endmauer quer vor dir — vom gegenüberliegenden Wegrand bis zum Bildrand
  const xa = centerX(t1) - dir * roadHalf(t1);
  const x0 = Math.min(xa, out), x1 = Math.max(xa, out);
  const face = ctx.createLinearGradient(0, y1 - EH * t1, 0, y1);
  face.addColorStop(0, mixHex(pal.ridge, "#000000", 0.15));
  face.addColorStop(1, mixHex(pal.road[1], "#000000", 0.45));
  ctx.fillStyle = face;
  ctx.fillRect(x0, y1 - EH * t1, x1 - x0, EH * t1);
  // Krone im Licht
  ctx.fillStyle = mixHex(pal.road[0], "#ffffff", 0.22);
  ctx.fillRect(x0, y1 - EH * t1 - 6 * t1, x1 - x0, 6 * t1);
  // Blockfugen
  ctx.strokeStyle = "rgba(0,0,0,0.3)"; ctx.lineWidth = Math.max(1, 1.8 * t1);
  ctx.beginPath();
  ctx.moveTo(x0, y1 - EH * t1 * 0.5); ctx.lineTo(x1, y1 - EH * t1 * 0.5);
  const bw = W * 0.16 * t1;
  for (let bx = xa - dir * bw * 0.3, i = 0; i < 30; i++, bx += dir * bw) {
    if (bx < x0 - 1 || bx > x1 + 1) break;
    const off = (i % 2) * bw * 0.5 * dir;
    ctx.moveTo(bx, y1 - EH * t1); ctx.lineTo(bx, y1 - EH * t1 * 0.5);
    ctx.moveTo(bx + off, y1 - EH * t1 * 0.5); ctx.lineTo(bx + off, y1);
  }
  ctx.stroke();
  // Goldene Lichtkante wie an den Randmauern
  ctx.strokeStyle = "rgba(232, 193, 90, 0.55)"; ctx.lineWidth = 2;
  ctx.shadowColor = GOLD; ctx.shadowBlur = 7;
  ctx.beginPath(); ctx.moveTo(x0, y1 - EH * t1); ctx.lineTo(x1, y1 - EH * t1); ctx.stroke();
  ctx.shadowBlur = 0;
  // Kristalle auf der Krone
  for (let i = 0; i < 4; i++) {
    const cxk = xa + dir * (roadHalf(t1) * (0.35 + i * 0.55));
    if (cxk < -40 || cxk > W + 40) continue;
    blitFoot(i % 2 ? SPR.edgeA : SPR.edgeB, cxk, y1 - EH * t1 - 5 * t1, t1 / PLAYER_T * 1.25, alpha);
  }

  // Lernhilfe: nur bei den ersten zwei Kreuzungen, dezent auf dem Seitenweg
  if (turnCount < 2) {
    const pulse = 0.35 + 0.3 * (0.5 + 0.5 * Math.sin(now * 0.006));
    ctx.globalAlpha = alpha * pulse;
    ctx.strokeStyle = "#fff6d8"; ctx.lineWidth = Math.max(2, 5 * tm);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    const hh = (y0 - y1) * 0.22;
    for (let i = 0; i < 3; i++) {
      const cx = X(tm, TW * (0.5 + i * 0.7));
      const aw = 12 * tm;
      ctx.beginPath();
      ctx.moveTo(cx - dir * aw, ym - hh); ctx.lineTo(cx + dir * aw, ym); ctx.lineTo(cx - dir * aw, ym + hh);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// Cartoon-Umriss + Streiflicht: vorher war die Figur Lila auf lila Pflaster
// ohne Kontur — von hinten nur ein dunkler Fleck mit einer Kugel darauf.
const R_OUT = "rgba(18, 8, 32, 0.82)";
const R_RIM = "rgba(255, 238, 200, 0.6)";   // Sonne steht rechts oben
let lastStep = 0;
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
  ctx.globalAlpha = Math.max(0.12, 0.42 - jumpH * 0.002);
  ctx.fillStyle = "#0a0512";
  ctx.beginPath();
  ctx.ellipse(x, yG + 2, (26 - jumpH * 0.06) * RS, 7 * RS, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;

  // Staubwölkchen bei jedem Auftritt
  const step = Math.sin(ph) > 0 ? 1 : -1;
  if (mode === "run" && !inAir && !duck && step !== lastStep && !LOWP()) {
    puff(x + step * 9 * RS, yG - 2, "rgba(236, 226, 246, 0.55)", 3, 55, 18);
  }
  lastStep = step;

  // In die Kurve legen (Abbiegen), Taumeln beim Stolpern
  const turnLean = turnAnim ? turnAnim.dir * 0.3 * Math.sin(Math.PI * Math.min(1, turnAnim.t / 0.45)) : 0;
  const wobble = stumbleT > 0 ? Math.sin(now * 0.028) * 0.2 * Math.min(1, stumbleT / 0.5) : 0;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(lean * 0.35 + turnLean + wobble);
  ctx.scale(RS, RS);
  if (duck) { ctx.translate(0, 13); ctx.scale(1.1, 0.64); }          // tief gerutscht
  else if (inAir && jumpV > 0) ctx.scale(0.95, 1.06);                 // Streckung im Absprung
  else if (landT > 0) { const k = landT / 0.16; ctx.scale(1 + k * 0.12, 1 - k * 0.16); }   // Einfedern

  // Kopf-Wippen mit Doppelschlag (zwei Schritte je Zyklus)
  const bob = inAir || duck ? 0 : Math.abs(Math.sin(ph)) * 4.5;
  ctx.translate(0, -bob);
  ctx.lineCap = "round"; ctx.lineJoin = "round";

  // ---- RÜCKENANSICHT wie bei Temple Run: wir laufen ihr hinterher ----
  const flut = Math.sin(ph * 2) * 5;
  const legA = inAir ? 0.35 : Math.sin(ph);
  // Linie mit Umriss: erst dick dunkel, dann farbig darüber
  const line = (w, col, path) => {
    ctx.strokeStyle = R_OUT; ctx.lineWidth = w + 3; ctx.beginPath(); path(); ctx.stroke();
    ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); path(); ctx.stroke();
  };
  // Fläche mit Umriss: Kontur streichen, dann füllen (Füllung deckt die Innenhälfte)
  const shape = (fill, path, ow = 3) => {
    ctx.beginPath(); path();
    ctx.strokeStyle = R_OUT; ctx.lineWidth = ow; ctx.stroke();
    ctx.fillStyle = fill; ctx.fill();
  };

  // Laufzyklus von hinten (wie Temple Run): das Standbein schiebt zur Kamera,
  // das Schwungbein holt mit hochschnellender Ferse aus — Knie leicht nach
  // außen, die Sohle blitzt auf. Hüfte → Knie → Fuß als EIN Pfad (runde Gelenke).
  const leg = (side, c) => {
    const lift = inAir ? (side < 0 ? 0.95 : 0.65) : Math.max(0, c);   // Sprung: Knie angezogen
    const plant = inAir ? 0 : Math.max(0, -c);
    const hipX = side * 5.5, hipY = -27;
    const kx = side * (7.5 + lift * 3.5), ky = -15.5 - lift * 7;
    const fx = side * (6 + plant * 2.5 - lift * 1.5), fy = -3 - lift * 20 + plant;
    line(7.6, SKIN.leg, () => { ctx.moveTo(hipX, hipY); ctx.lineTo(kx, ky); ctx.lineTo(fx, fy); });
    // Stiefel: hochgeschnellte Ferse zeigt die Sohle
    const bh = 3.8 + lift * 2.8;
    shape(SKIN.boot, () => ctx.ellipse(fx, fy, 5.6, bh, 0, 0, Math.PI * 2), 2.5);
    ctx.fillStyle = "rgba(40, 20, 12, 0.55)";
    ctx.beginPath(); ctx.ellipse(fx, fy + bh * 0.3, 4.4, bh * 0.55 * (0.4 + lift), 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath(); ctx.ellipse(fx - 1.5, fy - bh * 0.5, 2.2, 1.2, 0, 0, Math.PI * 2); ctx.fill();
  };
  if (!duck) {   // im Rutschen liegen die Beine vorn (von hinten verdeckt)
    // das Schwungbein (Ferse hoch) wird zuletzt gezeichnet
    const cL = Math.sin(ph), cR = -cL;
    if (cL > cR) { leg(1, cR); leg(-1, cL); } else { leg(-1, cL); leg(1, cR); }
  }

  // Oberkörper dreht leicht gegen die Beine
  ctx.save();
  ctx.translate(0, -27);
  ctx.rotate(inAir || duck ? 0 : Math.sin(ph) * 0.055);
  ctx.translate(Math.sin(ph) * (inAir || duck ? 0 : 1.2), 27);

  // Arme wie beim echten Laufen von hinten: angewinkelt an den Seiten. Der
  // nach hinten (zur Kamera) schwingende Arm liegt neben der Hüfte und ist ganz
  // zu sehen; der nach vorn schwingende verschwindet hinter dem Körper — darum
  // wird er VOR dem Rumpf gezeichnet. Vorher schwangen beide Hände zur Mitte
  // über den Rücken, als wären die Arme hinten verschränkt.
  const armA = Math.sin(ph + Math.PI);
  const flail = stumbleT > 0 ? Math.sin(now * 0.04) * 7 : 0;
  const arms = front => {
    for (const side of [-1, 1]) {
      const sw = side === -1 ? armA : -armA;          // +1 = nach hinten zur Kamera
      const back = inAir || duck || stumbleT > 0 ? true : sw >= 0;
      if (back !== front) continue;
      let ex, ey, hx, hy;
      if (inAir) { ex = side * 19; ey = -57; hx = side * 23; hy = -66; }             // Arme hoch
      else if (duck) { ex = side * 19; ey = -46; hx = side * 26; hy = -39; }         // seitlich abstützen
      else if (sw >= 0) {                                                            // hinten: neben der Hüfte
        ex = side * (15.5 + sw * 1.5); ey = -44 + sw * 1.5;
        hx = side * (17 + sw * 1.5); hy = -35 + sw * 4;
      } else {                                                                       // vorn: Richtung Brust
        const f = -sw;
        ex = side * (15 - f * 1.5); ey = -45 - f * 2;
        hx = side * (12.5 - f * 3); hy = -45 - f * 4;
      }
      hy += flail * side;
      line(6.3, SKIN.cloak[0], () => { ctx.moveTo(side * 11.5, -52); ctx.lineTo(ex, ey); ctx.lineTo(hx, hy); });
      shape("#f2d9c4", () => ctx.arc(hx, hy + 1, 3.4, 0, Math.PI * 2), 2);
    }
  };
  arms(false);   // vorn schwingende Arme: vom Rumpf teilweise verdeckt

  // Rumpf (Rücken)
  const bg = ctx.createLinearGradient(0, -58, 0, -22);
  bg.addColorStop(0, SKIN.tunic[0]); bg.addColorStop(1, SKIN.tunic[1]);
  shape(bg, () => ctx.roundRect(-13, -58, 26, 36, 11));
  // Gürtel
  ctx.fillStyle = "rgba(20, 10, 34, 0.45)";
  ctx.fillRect(-12.5, -30, 25, 3.5);

  // Umhang liegt auf dem Rücken und flattert nach unten aus
  const cloakPath = () => {
    ctx.moveTo(-12, -56);
    ctx.lineTo(12, -56);
    ctx.quadraticCurveTo(15 + flut, -36, 10 - flut, -14 + Math.abs(flut));
    ctx.quadraticCurveTo(0, -20 - flut * 0.6, -10 + flut, -16 - Math.abs(flut) * 0.5);
    ctx.quadraticCurveTo(-15 - flut, -36, -12, -56);
    ctx.closePath();
  };
  const cg2 = ctx.createLinearGradient(-14, -56, 14, -14);
  cg2.addColorStop(0, SKIN.cloak[1]); cg2.addColorStop(0.55, SKIN.cloak[0]); cg2.addColorStop(1, SKIN.cloak[1]);
  shape(cg2, cloakPath);
  // Faltenwurf
  ctx.strokeStyle = "rgba(14, 6, 26, 0.3)"; ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-4, -52); ctx.quadraticCurveTo(-6 + flut * 0.5, -36, -5 + flut, -19);
  ctx.moveTo(5, -52); ctx.quadraticCurveTo(7 + flut * 0.5, -36, 5 - flut * 0.5, -18);
  ctx.stroke();
  // Streiflicht rechts
  ctx.strokeStyle = R_RIM; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(11.5, -54); ctx.quadraticCurveTo(14.5 + flut, -36, 10 - flut, -15 + Math.abs(flut)); ctx.stroke();
  // Goldsaum
  ctx.strokeStyle = "rgba(242, 205, 110, 0.95)";
  ctx.lineWidth = 2.2;
  ctx.beginPath();
  ctx.moveTo(10 - flut, -14 + Math.abs(flut));
  ctx.quadraticCurveTo(0, -20 - flut * 0.6, -10 + flut, -16 - Math.abs(flut) * 0.5);
  ctx.stroke();

  // DER Zuckerkristall — geschultert, lugt über die Schulter (Glow!)
  const crysGlow = 0.7 + 0.3 * Math.sin(now * 0.006);
  line(3, "#8a6a1c", () => { ctx.moveTo(11, -56); ctx.lineTo(-9, -30); });   // Gurt
  ctx.shadowColor = PINK; ctx.shadowBlur = 18 * crysGlow;
  const cg = ctx.createLinearGradient(13, -78, 13, -52);
  cg.addColorStop(0, "#ffe0f0"); cg.addColorStop(0.5, PINK); cg.addColorStop(1, "#b03a78");
  shape(cg, () => { ctx.moveTo(13, -79); ctx.lineTo(20.5, -66); ctx.lineTo(13, -51); ctx.lineTo(5.5, -66); ctx.closePath(); }, 2.2);
  ctx.shadowBlur = 0;
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  ctx.beginPath(); ctx.moveTo(13, -76); ctx.lineTo(16, -67); ctx.lineTo(13, -66); ctx.closePath(); ctx.fill();

  // Arme vorn (zur Kamera schwingend) — nach dem Körper gezeichnet
  arms(true);

  // Schal im Fahrtwind — Farbakzent, der die Figur vom Weg abhebt
  const sw1 = Math.sin(now * 0.012) * 4, sw2 = Math.sin(now * 0.012 + 1.3) * 5;
  // Die Enden wehen seitlich weg (nicht über den Rücken — dort liegt der Gurt)
  const scarf = (ex, ey, wv) => shape(SKIN.boot, () => {
    ctx.moveTo(-8, -58);
    ctx.quadraticCurveTo(-18, -60 + wv * 0.4, ex, ey + wv);
    ctx.lineTo(ex + 1, ey + wv + 3.5);
    ctx.quadraticCurveTo(-17, -55 + wv * 0.4, -8, -55);
    ctx.closePath();
  }, 2);
  scarf(-31, -61, sw1);
  scarf(-28, -53, sw2);
  shape(SKIN.boot, () => ctx.roundRect(-10, -60, 20, 6, 3), 2.2);   // Schlaufe am Hals

  // Kopf von hinten: Kapuze mit Zipfel (eine Silhouette statt Kugel + Anhängsel)
  const tip = flut * 0.6;
  const hoodPath = () => {
    ctx.moveTo(-10.5, -57);
    ctx.bezierCurveTo(-14, -66, -11, -76, -3, -78.5);
    ctx.quadraticCurveTo(0 + tip, -83, -5 + tip * 1.6, -86);   // Zipfel, hängt nach hinten
    ctx.quadraticCurveTo(6 + tip, -84, 7, -77);
    ctx.bezierCurveTo(12.5, -74, 13.5, -64, 10.5, -57);
    ctx.quadraticCurveTo(0, -54, -10.5, -57);
    ctx.closePath();
  };
  shape(SKIN.hood, hoodPath);
  if (!HOOD_GLOSS) {
    HOOD_GLOSS = ctx.createRadialGradient(4, -74, 1, 0, -68, 14);
    HOOD_GLOSS.addColorStop(0, "rgba(255,255,255,0.35)"); HOOD_GLOSS.addColorStop(1, "rgba(255,255,255,0)");
  }
  ctx.fillStyle = HOOD_GLOSS;
  ctx.beginPath(); hoodPath(); ctx.fill();
  // Naht in der Mitte + Streiflicht rechts
  ctx.strokeStyle = "rgba(14, 6, 26, 0.35)"; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(1, -78); ctx.quadraticCurveTo(2, -67, 0.5, -57); ctx.stroke();
  ctx.strokeStyle = R_RIM; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(8, -75); ctx.bezierCurveTo(12, -71, 12.5, -64, 10, -59); ctx.stroke();
  // Ein Büschel Haar lugt unter der Kapuze hervor
  ctx.fillStyle = SKIN.hair;
  ctx.beginPath();
  ctx.ellipse(0, -56.5, 6, 2.6, 0, 0, Math.PI);
  ctx.fill();

  ctx.restore();   // Oberkörper
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
// --- Das wütende Einhorn — rennt dir HINTERHER ---
// Rückansicht wie die Verfolger bei Temple Run: es läuft in dieselbe Richtung
// wie du, direkt hinter dir (zwischen Kamera und Läuferin) und folgt deiner
// Spur mit Verzögerung. Man sieht Hinterhand mit Regenbogenschweif, die
// galoppierenden Hinterbeine (Sohlen blitzen auf), dahinter Rücken, Hals mit
// Mähne und Hinterkopf mit Ohren und Horn. Läufst du sauber, fällt es zurück
// und verschwindet unter dem Bildrand; stolperst du, taucht es hinter dir auf.
// Ursprung = Boden zwischen den Hinterhufen, y nach oben negativ.
const U_OUT = "rgba(34, 18, 52, 0.62)";
function drawUnicorn(now) {
  let p = chase;
  if (mode === "catch") p = Math.min(1.55, 1 + catchT * 0.8);
  if (mode === "over") p = 1.55;
  const pc = Math.min(p, 1), over = Math.max(0, p - 1);
  const s = 1.4 + pc * 0.3 + over * 0.8;
  const gallopF = 1.7 + pc * 1.1;                          // Galoppsprünge pro Sekunde
  const gp = now * 0.001 * gallopF * Math.PI * 2;
  // Wie weit ragt es über den unteren Rand? 0 = ganz unten verschwunden.
  // Bis zum Fangen höchstens bis zu deinen Beinen — es darf dich nicht verdecken,
  // sonst sähe man nach einem Stolperer weder sich noch die nächsten Hindernisse.
  const rise = Math.max(0, Math.min(1, (p - 0.1) / 0.9)) * 165 + over * 420;
  if (rise <= 1) return;
  const bob = (0.5 + 0.5 * Math.sin(gp + 1.2)) * 9 * s;
  const ux = laneX(uniLane, PLAYER_T) + Math.sin(gp * 0.5) * 3 * s;
  const uy = H + 212 * s - rise - bob;

  ctx.save();
  ctx.translate(ux, uy);
  ctx.scale(s, s);
  ctx.rotate(Math.sin(gp) * 0.035);                        // Hinterhand schaukelt
  ctx.lineCap = "round"; ctx.lineJoin = "round";
  const hi = Math.sin(gp);                                  // welches Hinterbein oben ist

  // --- Vorderbeine (weit vorn, zwischen den Hinterbeinen, dunkler) ---
  const fcol = mixHex(USKIN.leg, "#000000", 0.32);
  for (const side of [-1, 1]) {
    const lift = Math.max(0, Math.sin(gp + 2.2 + (side > 0 ? 0.6 : 0)));
    const fx = side * 11, fy = -12 - lift * 22;
    ctx.strokeStyle = U_OUT; ctx.lineWidth = 11;
    ctx.beginPath(); ctx.moveTo(side * 12, -74); ctx.lineTo(side * (11 + lift * 3), -44 - lift * 10); ctx.lineTo(fx, fy); ctx.stroke();
    ctx.strokeStyle = fcol; ctx.lineWidth = 7.5;
    ctx.beginPath(); ctx.moveTo(side * 12, -74); ctx.lineTo(side * (11 + lift * 3), -44 - lift * 10); ctx.lineTo(fx, fy); ctx.stroke();
    ctx.fillStyle = mixHex(USKIN.hoof, "#000000", 0.3);
    ctx.beginPath(); ctx.ellipse(fx, fy + 2, 5.5, 3.5, 0, 0, Math.PI * 2); ctx.fill();
  }

  // --- Hals + Hinterkopf (weiter weg → höher im Bild, schmaler) ---
  const neckG = ctx.createLinearGradient(0, -180, 0, -100);
  neckG.addColorStop(0, USKIN.body[1]); neckG.addColorStop(1, USKIN.body[2]);
  const headBob = Math.sin(gp + Math.PI) * 3;
  const neckPath = () => {
    ctx.beginPath();
    ctx.moveTo(-20, -104);
    ctx.bezierCurveTo(-18, -130, -15, -150, -13, -160 + headBob);
    ctx.lineTo(13, -160 + headBob);
    ctx.bezierCurveTo(15, -150, 18, -130, 20, -104);
    ctx.closePath();
  };
  ctx.strokeStyle = U_OUT; ctx.lineWidth = 3;
  neckPath(); ctx.stroke(); ctx.fillStyle = neckG; ctx.fill();
  // Ohren (zurückgelegt vor Zorn, wenn es nah ist)
  const earTilt = pc > 0.7 ? 0.35 : 0;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side * 9, -172 + headBob);
    ctx.rotate(side * (0.25 + earTilt));
    ctx.fillStyle = USKIN.ear; ctx.strokeStyle = U_OUT; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-5, 3); ctx.lineTo(0, -18); ctx.lineTo(5, 3); ctx.closePath(); ctx.stroke(); ctx.fill();
    ctx.fillStyle = "rgba(255, 150, 190, 0.55)";
    ctx.beginPath(); ctx.moveTo(-2.5, 1); ctx.lineTo(0, -12); ctx.lineTo(2.5, 1); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  // Hinterkopf
  const headG = ctx.createRadialGradient(-4, -174 + headBob, 2, 0, -166 + headBob, 18);
  headG.addColorStop(0, USKIN.body[0]); headG.addColorStop(1, USKIN.body[1]);
  ctx.fillStyle = headG; ctx.strokeStyle = U_OUT; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.ellipse(0, -166 + headBob, 16, 13, 0, 0, Math.PI * 2); ctx.stroke(); ctx.fill();
  // Horn — zeigt nach vorn, von hinten also steil nach oben, glühend
  const hornGlow = 0.6 + 0.4 * Math.sin(now * 0.005);
  ctx.shadowColor = USKIN.hornGlow; ctx.shadowBlur = LOWP() ? 0 : 18 * hornGlow;
  const hg = ctx.createLinearGradient(0, -214, 0, -174);
  hg.addColorStop(0, USKIN.horn[0]); hg.addColorStop(0.5, USKIN.horn[1]); hg.addColorStop(1, USKIN.horn[2]);
  ctx.fillStyle = hg;
  ctx.beginPath(); ctx.moveTo(-5, -176 + headBob); ctx.lineTo(0, -216 + headBob); ctx.lineTo(5, -176 + headBob); ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = "rgba(138, 106, 28, 0.6)"; ctx.lineWidth = 1.3;
  for (let i = 1; i <= 4; i++) {
    const yy = -176 - i * 8 + headBob, w = 5 * (1 - i / 5.2);
    ctx.beginPath(); ctx.moveTo(-w, yy + 1.5); ctx.lineTo(w, yy - 1.5); ctx.stroke();
  }
  // Glühende Augen seitlich am Kopf — nur wenn es dir gefährlich nah ist
  if (pc > 0.6) {
    const a = Math.min(1, (pc - 0.6) / 0.3) * (0.7 + 0.3 * Math.sin(now * 0.01));
    ctx.globalAlpha = a;
    ctx.fillStyle = "#ff3b5c"; ctx.shadowColor = "#ff3b5c"; ctx.shadowBlur = LOWP() ? 0 : 10;
    // schmale, schräge Schlitze am Kopfrand (wie Glut, die seitlich hervorleuchtet)
    ctx.strokeStyle = "#ff3b5c"; ctx.lineWidth = 2; ctx.lineCap = "round";
    for (const side of [-1, 1]) {
      ctx.beginPath(); ctx.moveTo(side * 13, -169 + headBob); ctx.lineTo(side * 17.5, -166.5 + headBob); ctx.stroke();
    }
    ctx.shadowBlur = 0; ctx.globalAlpha = 1;
  }
  // Mähne: viele feine Strähnen, die vom Mähnenkamm über die Halsseite fallen
  // und im Galopp mitschwingen (vorher sechs dicke Balken quer über den Hals)
  const mSide = Math.sin(gp) > 0 ? 1 : -1;
  const mSwing = Math.sin(gp) * 3;
  ctx.shadowBlur = 0;
  for (let i = 0; i < 12; i++) {
    const u = i / 11, yy = -162 + u * 56 + headBob * (1 - u);
    const hw = 13 + u * 6;                                   // halbe Halsbreite an dieser Höhe
    const wav = Math.sin(now * 0.009 + i * 0.8) * 2.5;
    ctx.strokeStyle = USKIN.mane[i % 6];
    ctx.lineWidth = 3.4;
    ctx.globalAlpha = 0.92;
    ctx.beginPath();
    ctx.moveTo(-1 * mSide, yy);
    ctx.quadraticCurveTo(mSide * hw * 0.6 + mSwing, yy + 2 + wav, mSide * (hw + 3) + mSwing * 1.4, yy + 11 + wav);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // Schopf zwischen den Ohren
  ctx.strokeStyle = USKIN.mane[0]; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(0, -176 + headBob); ctx.quadraticCurveTo(mSide * 5, -172 + headBob, mSide * 7, -166 + headBob); ctx.stroke();

  // --- Rumpf von hinten (Rücken sichtbar, weil die Kamera etwas höher steht) ---
  const bodyG = ctx.createLinearGradient(0, -130, 0, -60);
  bodyG.addColorStop(0, USKIN.body[0]); bodyG.addColorStop(0.55, USKIN.body[1]); bodyG.addColorStop(1, USKIN.body[2]);
  ctx.fillStyle = bodyG; ctx.strokeStyle = U_OUT; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.ellipse(0, -104, 30, 18, 0, 0, Math.PI * 2); ctx.stroke(); ctx.fill();   // Rücken dahinter

  // Hinterhand: zwei runde Backen + breite Kruppe als eine Form
  const rumpPath = () => {
    ctx.beginPath();
    ctx.ellipse(0, -96, 40, 24, 0, 0, Math.PI * 2);
    ctx.moveTo(-1, -84); ctx.arc(-19, -84, 22, 0, Math.PI * 2);
    ctx.moveTo(39, -84); ctx.arc(19, -84, 22, 0, Math.PI * 2);
  };
  rumpPath(); ctx.lineWidth = 3.4; ctx.stroke();
  ctx.fillStyle = bodyG; ctx.fill();
  // Streiflicht oben, Schatten der Backen-Falte
  const gl = ctx.createLinearGradient(0, -122, 0, -80);
  gl.addColorStop(0, "rgba(255,255,255,0.5)"); gl.addColorStop(1, "rgba(255,255,255,0)");
  rumpPath(); ctx.fillStyle = gl; ctx.fill();
  ctx.strokeStyle = "rgba(40,20,60,0.28)"; ctx.lineWidth = 2.2;
  ctx.beginPath(); ctx.moveTo(0, -104); ctx.quadraticCurveTo(-2, -82, 0, -64); ctx.stroke();

  // --- Hinterbeine: Standbein gestreckt, Schwungbein angewinkelt (Sohle zeigt) ---
  for (const side of [-1, 1]) {
    const c = side < 0 ? hi : -hi;
    const lift = Math.max(0, c);
    const hx = side * 20, hy = -68;
    const kx = side * (22 + lift * 2), ky = -34 - lift * 12;     // Sprunggelenk
    const fx = side * (18 - lift * 2), fy = -3 - lift * 30;      // Huf
    ctx.strokeStyle = U_OUT; ctx.lineWidth = 17.5;
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(kx, ky); ctx.stroke();
    ctx.strokeStyle = USKIN.leg; ctx.lineWidth = 14;
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(kx, ky); ctx.stroke();
    ctx.strokeStyle = U_OUT; ctx.lineWidth = 11.5;
    ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();
    ctx.strokeStyle = USKIN.leg; ctx.lineWidth = 8.5;
    ctx.beginPath(); ctx.moveTo(kx, ky); ctx.lineTo(fx, fy); ctx.stroke();
    // Huf; beim hochgeschnellten Bein sieht man die Sohle
    ctx.fillStyle = USKIN.hoof; ctx.strokeStyle = U_OUT; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.ellipse(fx, fy + 1, 7, 4 + lift * 2.5, 0, 0, Math.PI * 2); ctx.stroke(); ctx.fill();
    if (lift > 0.3) {
      ctx.fillStyle = "rgba(40, 24, 10, 0.45)";
      ctx.beginPath(); ctx.ellipse(fx, fy + 1.5, 4.5, 2.5 * lift, 0, 0, Math.PI * 2); ctx.fill();
    }
  }

  // --- Regenbogen-Schweif: hängt zur Kamera, schwingt im Galopp ---
  const sw = Math.sin(gp) * 16;
  for (let i = 0; i < 6; i++) {
    const off = (i - 2.5) * 3.2, wav = Math.sin(now * 0.007 + i * 0.7) * 5;
    ctx.strokeStyle = USKIN.mane[i]; ctx.lineWidth = 6.5;
    ctx.shadowColor = USKIN.mane[i]; ctx.shadowBlur = LOWP() ? 0 : 8;
    ctx.beginPath();
    ctx.moveTo(off * 0.4, -112);
    ctx.bezierCurveTo(off + sw * 0.4, -92, off * 1.4 + sw + wav, -66, off * 1.8 + sw * 1.3 + wav, -38);
    ctx.stroke();
  }
  ctx.shadowBlur = 0;

  ctx.restore();

  // Hufstaub beim Aufsetzen, Funkel-Spur
  if (mode === "run" && !LOWP() && Math.abs(hi) > 0.97) {
    puff(ux + (hi > 0 ? 1 : -1) * 18 * s, uy - 2, "rgba(236, 226, 246, 0.55)", 2, 70, 18);
  }
  if (p > 0.3 && Math.random() < p * 0.45) {
    sparkleTrail(ux + (Math.random() - 0.5) * 70 * s, uy - Math.random() * 150 * s, USKIN.mane[Math.floor(Math.random() * 6)]);
  }
}

// ==================== Sound (WebAudio, synthetisiert) ====================
const sound = (() => {
  let ctxA = null;
  // Einmalige Migration des alten spieleigenen Mute-Zustands in den globalen Schalter
  try { const _m = localStorage.getItem("galopp_muted"); if (_m !== null) { if (_m === "1" && GS.sound.on()) GS.sound.toggle(); localStorage.removeItem("galopp_muted"); } } catch {}
  function ac() {
    if (!ctxA) {
      try {
        ctxA = new (window.AudioContext || window.webkitAudioContext)();
      } catch { return null; }
    }
    wake();   // auch "interrupted" (iOS), nicht nur "suspended"
    return ctxA;
  }
  // iOS lässt den Kontext nach Anruf/App-Wechsel auf "suspended"/"interrupted"
  // stehen → stumm bis zum Neuladen. Darum vor jedem Ton und bei jedem Tippen wecken.
  function wake() { if (ctxA && ctxA.state !== "running") try { const p = ctxA.resume(); if (p && p.catch) p.catch(() => {}); } catch {} }
  const unlock = () => { if (GS.sound.on()) ac(); };   // ac() weckt mit
  ["pointerdown", "touchend"].forEach(ev => window.addEventListener(ev, unlock, { capture: true, passive: true }));
  function tone(f0, f1, dur, type = "sine", vol = 0.08, delay = 0) {
    if (!GS.sound.on()) return;
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
    turn() { tone(520, 240, 0.24, "sine", 0.06); tone(260, 150, 0.2, "triangle", 0.035, 0.03); },
    turnWarn() { [880, 1175].forEach((f, i) => tone(f, f * 0.99, 0.16, "sine", 0.07, i * 0.14)); },
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
    toggle() { return !GS.sound.toggle(); },
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
  overlay.className = "overlay menu";
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
        <div class="ctrl"><b>↩️</b>An der Mauer: in Pfeilrichtung wischen!</div>
      </div>
      ${DAILY ? `<p class="sub" style="margin-top:-6px"><b>🗓️ Tages-Challenge:</b> Heute läuft jede:r dieselbe Strecke!</p>` : ""}
      ${WEEKLY ? `<p class="sub" style="margin-top:-6px"><b>📅 Wochen-Challenge:</b> Diese Woche läuft jede:r dieselbe Strecke!</p>` : ""}
      <button class="btn-primary" id="m-go">🏃 Lauf los!</button>
      <div class="menu-grid">
        <button class="btn-secondary" id="m-top">🏆 Bestenliste</button>
        ${CHALLENGE
          ? `<button class="btn-secondary" id="m-normal">🎲 Normaler Modus</button>`
          : `<button class="btn-secondary" id="m-daily">🗓️ Tages-Challenge</button>
             <button class="btn-secondary" id="m-weekly">📅 Wochen-Challenge</button>`}
        <button class="btn-secondary" id="m-badges">🏅 Meilensteine</button>
        <button class="btn-secondary" id="m-skins">🎨 Läufer-Skins</button>
        <button class="btn-secondary" id="m-uskins">🦄 Einhorn-Skins</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector("#m-go").onclick = () => {
    overlay.remove();
    newRun();
    mode = "run";
  };
  overlay.querySelector("#m-top").onclick = () => showLeaderboard();
  const setMode = q => { location.search = q; };
  if (overlay.querySelector("#m-normal")) overlay.querySelector("#m-normal").onclick = () => setMode("");
  if (overlay.querySelector("#m-daily")) overlay.querySelector("#m-daily").onclick = () => setMode("?daily=1");
  if (overlay.querySelector("#m-weekly")) overlay.querySelector("#m-weekly").onclick = () => setMode("?weekly=1");
  overlay.querySelector("#m-badges").onclick = () => GS.badges.show("galopp", "Meilensteine — Galopp");
  overlay.querySelector("#m-skins").onclick = () =>
    GS.skins.picker("galopp", { title: "Läufer-Skins", onChange: c => { SKIN = c; } });
  overlay.querySelector("#m-uskins").onclick = () =>
    GS.skins.picker("galopp_unicorn", { title: "Einhorn-Skins", onChange: c => { USKIN = c; } });
}


async function gameOver() {
  const newBadges = GS.badges.record("galopp", { meters: Math.floor(meters), coins, turns: turnCount, score });
  const isRecord = score >= best && score > 0;
  if (score > best) { best = score; try { localStorage.setItem("galopp_best", best); } catch (_) {} }
  if (isRecord) sound.fanfare();

  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="panel">
      <h2>${DAILY ? "🗓️ " : WEEKLY ? "📅 " : ""}${isRecord ? "Neuer Rekord!" : "Erwischt! 🦄"}</h2>
      <div class="go-score">${score}</div>
      ${isRecord ? `<div class="go-best-badge">👑 Persönliche Bestleistung</div>` : `<div class="sub">Rekord: ${best}</div>`}
      <div class="go-stats">
        <span>📏 ${Math.floor(meters)} m</span>
        <span>🪙 ${coins} Taler</span>
        <span>↩️ ${turnCount} Kurven</span>
        <span>🗺️ ${ZONES[zoneShown % ZONES.length]?.name || "Zuckerwiese"}</span>
      </div>
      ${GS.badges.chipsHtml(newBadges)}
      <div class="go-rank" id="go-rank"></div>
      <div id="go-name-area"></div>
      <button class="btn-primary" id="go-again">🏃 Nochmal rennen</button>
      <button class="btn-secondary" id="go-top">🏆 Bestenliste</button>
      <button class="btn-secondary" id="go-share" style="margin-top:10px">📤 Teilen</button>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector("#go-again").onclick = () => {
    overlay.remove();
    newRun();
    mode = "run";
  };
  overlay.querySelector("#go-top").onclick = () => showLeaderboard();
  const shareBtn = overlay.querySelector("#go-share");
  shareBtn.onclick = async () => {
    const r = await GS.shareCard({
      title: "Galopp", emoji: "🦄", accent: "#ff6f91", big: score,
      subtitle: `${Math.floor(meters)} m gerannt`,
      url: GS.duelLink("galopp", score),
      text: `Ich bin bei Galopp 🦄 ${Math.floor(meters)} m weit gerannt (${score} Punkte) — schlag mich!`,
    });
    if (r === "copied" || r === "downloaded") shareBtn.textContent = "✔ geteilt";
  };

  GS.scoreFlow(overlay.querySelector("#go-name-area"), overlay.querySelector("#go-rank"), {
    game: "galopp", score, daily: DAILY, weekly: WEEKLY,
    meta: { meters: Math.floor(meters), coins },
  });
}

function showLeaderboard() {
  GS.showLeaderboard({
    game: "galopp", daily: DAILY, weekly: WEEKLY,
    title: WEEKLY ? "Wochen-Challenge" : DAILY ? "Tages-Challenge" : "Bestenliste",
    sub: WEEKLY ? "Die Besten dieser Woche — gleiche Strecke für alle"
       : DAILY ? "Die Besten von heute — gleiche Strecke für alle"
       : "Die 50 schnellsten Läufer:innen weltweit",
  });
}
// ==================== UI ====================
$("#btn-top").onclick = () => showLeaderboard();
const soundBtn = $("#btn-sound");
soundBtn.textContent = !GS.sound.on() ? "🔇" : "🔊";
soundBtn.onclick = () => { soundBtn.textContent = sound.toggle() ? "🔇" : "🔊"; };
$("#btn-pause").onclick = () => togglePause();

// ==================== Auto-Test (?auto) ====================
// Einfacher Selbstläufer für schnelle Smoke-Tests.
const params = new URLSearchParams(location.search);
const AUTO = params.has("auto");
function autoPilot() {
  if (mode !== "run") return;
  // Abzweigung nehmen
  const turn = activeTurn();
  if (turn && turn.wz - o < PLAYER_Z + 1.6) { doLane(turn.dir); return; }
  let nearest = null;
  for (const e of entities) {
    if (e.type !== "ob" || e.passed || e.kind === "turn") continue;
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
  // Nie negativ: der erste rAF-Zeitstempel kann VOR dem Startzeitpunkt liegen —
  // dann lief die Strecke ins Minus, palette() fand ZONES[-1] und warf ab da
  // in jedem Frame (schwarze Bühne).
  const dt = Math.max(0, Math.min(0.05, (now - lastT) / 1000));
  lastT = now;
  if (AUTO) autoPilot();
  update(dt);
  render(now);
  requestAnimationFrame(loop);
}

GS.markPlayed("galopp");
newRun();
if (AUTO) { mode = "run"; }
else showMenu();
requestAnimationFrame(loop);

// ---------- Meilensteine ----------
GS.badges.define("galopp", [
  { id: "m100",    icon: "🏃", name: "Warmgelaufen",   desc: "100 m in einem Lauf",     test: s => s.meters >= 100 },
  { id: "m500",    icon: "💨", name: "Sprinter:in",    desc: "500 m in einem Lauf",     test: s => s.meters >= 500 },
  { id: "m1000",   icon: "🏔️", name: "Marathoni", desc: "1.000 m in einem Lauf",  test: s => s.meters >= 1000 },
  { id: "zone4",   icon: "🗺️", name: "Zonenwandler", desc: "Den Sternenpass erreicht", test: s => s.meters >= 1350 },
  { id: "turns5",  icon: "↩️", name: "Kurvenkönig:in", desc: "5 Kurven in einem Lauf", test: s => s.turns >= 5 },
  { id: "c100",    icon: "🪙", name: "Talerfreund",    desc: "100 Taler in einem Lauf", test: s => s.coins >= 100 },
  { id: "sumc1k",  icon: "💰", name: "Dagobert",       desc: "1.000 Taler insgesamt",   test: (s, t) => t.sum_coins >= 1000 },
  { id: "summ10k", icon: "🌍", name: "Dauerläufer:in", desc: "10 km insgesamt",    test: (s, t) => t.sum_meters >= 10000 },
  { id: "runs25",  icon: "🎖️", name: "Stammgast", desc: "25 Läufe gerannt",  test: (s, t) => t.runs >= 25 },
]);
