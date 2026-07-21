// ====================================================================
// MEERI-MANIA — Merge-Idle mit Meerschweinchen.
//  - Meeries tapsen frei auf der Wiese und werfen Münz-Blasen ab (antippen).
//  - Zwei gleiche Meeries zusammenziehen → nächste (absurdere) Evolution.
//  - "+ Meeri kaufen" (Kosten steigen), Wiese mit Münzen vergrößern.
//  - Offline-Einnahmen, dezente goldene Meeries, Meeri-Album als Ziel.
//  - Alles lokal gespeichert (localStorage), kein Server nötig.
// ====================================================================
"use strict";

// ---------- Evolutionsstufen (absurd steigernd) ----------
const TIERS = [
  { name: "Baby-Meeri",        prop: "",     c1: "#e8c9a0", c2: "#c9a877", desc: "Frisch geboren, flauschig und ahnungslos." },
  { name: "Struppel-Meeri",    prop: "🌿",   c1: "#cf9f6a", c2: "#a97f4c", desc: "Hat sich im Gras gewälzt. Sieht wild aus." },
  { name: "Punk-Meeri",        prop: "🎸",   c1: "#ff7ab0", c2: "#d8558c", desc: "Laut, frech, Irokese aus Fell." },
  { name: "Ritter-Meeri",      prop: "⚔️",   c1: "#a9b7c6", c2: "#7d8b9c", desc: "Für Ehre und Salatblätter!" },
  { name: "Wikinger-Meeri",    prop: "🪓",   c1: "#c98a4b", c2: "#9c6733", desc: "Segelt über die Wiese, plündert Gurken." },
  { name: "Zauber-Meeri",      prop: "🪄",   c1: "#9b7bff", c2: "#6f4fd6", desc: "Zaubert Heu aus dem Nichts." },
  { name: "Piraten-Meeri",     prop: "🏴‍☠️", c1: "#6b6f76", c2: "#464b52", desc: "Arrr! Wo ist der Möhren-Schatz?" },
  { name: "Cowboy-Meeri",      prop: "🤠",   c1: "#d9a441", c2: "#a97c25", desc: "Der schnellste Knabberer im Westen." },
  { name: "Ninja-Meeri",       prop: "🥷",   c1: "#4a4f5a", c2: "#2b2f38", desc: "Lautlos. Tödlich. Süß." },
  { name: "König-Meeri",       prop: "👑",   c1: "#ffd23f", c2: "#d1a318", desc: "Herrscher über Wiese und Napf." },
  { name: "Roboter-Meeri",     prop: "🤖",   c1: "#9fb3c8", c2: "#6f8397", desc: "Piep bopp. Läuft auf Salat-Akku." },
  { name: "Superhelden-Meeri", prop: "🦸",   c1: "#ff4d6d", c2: "#c81f43", desc: "Rettet die Wiese im Umhang." },
  { name: "Astro-Meeri",       prop: "🚀",   c1: "#7aa7ff", c2: "#4a72d0", desc: "Zum Mond und zurück zum Napf." },
  { name: "Alien-Meeri",       prop: "👽",   c1: "#57e39b", c2: "#1f9d5c", desc: "Kommt in Frieden. Und wegen Gemüse." },
  { name: "Drachen-Meeri",     prop: "🐉",   c1: "#ff8a3d", c2: "#c85f14", desc: "Speit Feuer, kuschelt trotzdem gern." },
  { name: "Galaxie-Meeri",     prop: "🌌",   c1: "#b892ff", c2: "#7d55d6", desc: "Das Universum in Fellform. Endstufe!" },
];
const MAXT = TIERS.length - 1;
const coinVal = t => Math.round(Math.pow(2.1, t)) || 1;

// ---------- Wirtschaft ----------
const BUY_BASE = 10, BUY_GROW = 1.18;
const CAP_START = 6, CAP_STEP = 3, CAP_MAXLEVEL = 8;
const EXP_BASE = 100, EXP_GROW = 2.2;
const DROP_MIN = 3.2, DROP_MAX = 6.0;   // Sekunden zwischen Münz-Blasen je Meeri
const OFFLINE_EFF = 0.4, OFFLINE_CAP_H = 3;

// ---------- Upgrade-Shop ----------
const UPGRADES = [
  { key: "coin",   icon: "🪙", name: "Münzwert",     base: 50,  grow: 1.55, max: 40,
    desc: l => `+${l * 25}% Münzen` },
  { key: "speed",  icon: "⚡", name: "Wurf-Tempo",    base: 40,  grow: 1.7,  max: 20,
    desc: l => `+${l * 12}% schnellere Würfe` },
  { key: "magnet", icon: "🧲", name: "Auto-Sammler",  base: 250, grow: 2.5,  max: 5,
    desc: l => l === 0 ? "aus (Münzen selbst antippen)" : `Münzen nach ${Math.max(0.3, 2.6 - l * 0.5).toFixed(1)}s automatisch ein` },
  { key: "luck",   icon: "🍀", name: "Glücks-Wurf",   base: 150, grow: 2.0,  max: 10,
    desc: l => `${Math.round(Math.min(0.6, l * 0.06) * 100)}% Chance: gekauftes Meeri startet höher` },
];
const upCost = u => Math.round(u.base * Math.pow(u.grow, up[u.key] || 0));
const coinMult = () => 1 + 0.25 * (up.coin || 0);
const magnetDelay = () => (up.magnet || 0) > 0 ? Math.max(0.3, 2.6 - up.magnet * 0.5) : Infinity;
const luckChance = () => Math.min(0.6, (up.luck || 0) * 0.06);

// ---------- Zustand ----------
const SAVE = "meeri_save_v1";
let coins, meeries, capLevel, buyCount, album, lastSeen, uid, up;
let over = false, hudDirty = false;

function capacity() { return CAP_START + capLevel * CAP_STEP; }
function buyCost() { return Math.round(BUY_BASE * Math.pow(BUY_GROW, buyCount)); }
function expCost() { return Math.round(EXP_BASE * Math.pow(EXP_GROW, capLevel)); }

function newUp() { return { coin: 0, speed: 0, magnet: 0, luck: 0 }; }
function fresh() {
  coins = 0; meeries = []; capLevel = 0; buyCount = 0; album = {}; uid = 1;
  up = newUp(); lastSeen = Date.now();
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE) || "null");
    if (!s) { fresh(); return false; }
    coins = Number(s.coins) || 0;
    capLevel = Math.min(CAP_MAXLEVEL, Number(s.capLevel) || 0);
    buyCount = Number(s.buyCount) || 0;
    album = s.album || {};
    uid = Number(s.uid) || 1;
    up = Object.assign(newUp(), s.up || {});
    lastSeen = Number(s.lastSeen) || Date.now();
    meeries = (s.meeries || []).map(m => ({
      id: uid++, tier: Math.max(0, Math.min(MAXT, m.tier | 0)),
      x: m.x || 0.5, y: m.y || 0.5,
      vx: (Math.random() - 0.5), vy: (Math.random() - 0.5),
      phase: Math.random() * 7, nextDrop: rndDrop(), held: false,
    }));
    return true;
  } catch { fresh(); return false; }
}
let saveTimer = null, storageOK = true, storageWarned = false;
// iOS Safari sperrt localStorage im Privat-Modus (setItem wirft) — dann warnen wir sichtbar.
function testStorage() {
  try {
    localStorage.setItem("__meeri_test__", "1");
    const ok = localStorage.getItem("__meeri_test__") === "1";
    localStorage.removeItem("__meeri_test__");
    return ok;
  } catch { return false; }
}
function save() {
  lastSeen = Date.now();
  try {
    localStorage.setItem(SAVE, JSON.stringify({
      coins, capLevel, buyCount, album, uid, up, lastSeen,
      meeries: meeries.map(m => ({ tier: m.tier, x: m.x, y: m.y })),
    }));
    storageOK = true;
  } catch {
    storageOK = false;
    if (!storageWarned) { storageWarned = true; toast("⚠️ Speichern nicht möglich (Privater Modus?) — Fortschritt geht beim Schließen verloren."); }
  }
}
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 600); }

const rndDrop = () => (DROP_MIN + Math.random() * (DROP_MAX - DROP_MIN)) / (1 + 0.12 * (up ? up.speed : 0));

// ---------- Meeri-Verwaltung ----------
function discover(tier) {
  if (!album[tier]) {
    album[tier] = new Date().toISOString();
    GS.sound.great();
    if (tier >= 2) setTimeout(() => reveal(tier, true), 120);   // cooles Meeri → große Karte
    else toast(`📖 Neu im Album: ${TIERS[tier].name}!`);
    saveSoon();
  }
}
function spawnMeeri(tier, x, y) {
  const m = {
    id: uid++, tier, x: x ?? (0.2 + Math.random() * 0.6), y: y ?? (0.2 + Math.random() * 0.6),
    vx: (Math.random() - 0.5), vy: (Math.random() - 0.5),
    phase: Math.random() * 7, nextDrop: rndDrop(), held: false, pop: 0.001,
  };
  meeries.push(m);
  discover(tier);
  return m;
}
function buyMeeri() {
  if (over) return;
  if (meeries.length >= capacity()) { toast("Wiese voll — vergrößern oder mergen!"); return; }
  const c = buyCost();
  if (coins < c) { toast("Zu wenig Münzen"); return; }
  coins -= c; buyCount++;
  const startTier = (Math.random() < luckChance()) ? 1 : 0;   // Glücks-Wurf
  const m = spawnMeeri(startTier);
  if (startTier > 0) { floater("🍀", "#57e39b", m.x, m.y); GS.sound.good(); } else GS.sound.click();
  GS.haptic(8);
  updateHUD(); saveSoon();
}
function expandMeadow() {
  if (capLevel >= CAP_MAXLEVEL) { toast("Wiese ist schon riesig!"); return; }
  const c = expCost();
  if (coins < c) { toast("Zu wenig Münzen"); return; }
  coins -= c; capLevel++;
  GS.sound.good(); GS.haptic([10, 30]); burst("PLATZ!", "#57e39b");
  updateHUD(); saveSoon();
}
function mergeInto(target, src) {
  if (target.tier >= MAXT) { toast("Endstufe erreicht! 🌌"); return false; }
  target.tier++; target.pop = 0.001;
  meeries = meeries.filter(m => m.id !== src.id);
  const bonus = Math.round(coinVal(target.tier) * 3 * coinMult());   // kleiner Merge-Bonus
  coins += bonus;
  discover(target.tier);
  burst(target.tier >= MAXT ? "GALAXIE!" : "EVOLVE!", "#ffd23f");
  floater("+" + fmt(bonus), "#ffd23f", target.x, target.y);
  spawnConfetti(target.x, target.y, TIERS[target.tier].c1);
  GS.sound.great(); GS.haptic([12, 40, 12]);
  updateHUD(); saveSoon();
  return true;
}

// ---------- Offline-Einnahmen ----------
function passivePerSec() {
  let s = 0;
  const interval = ((DROP_MIN + DROP_MAX) / 2) / (1 + 0.12 * (up ? up.speed : 0));
  for (const m of meeries) s += coinVal(m.tier) / interval;
  return s * coinMult();
}
function applyOffline() {
  const elapsed = Math.max(0, (Date.now() - lastSeen) / 1000);
  if (elapsed < 30 || !meeries.length) return;
  const rate = passivePerSec() * OFFLINE_EFF;
  const gain = Math.floor(rate * Math.min(elapsed, OFFLINE_CAP_H * 3600));
  if (gain <= 0) return;
  coins += gain;
  const mins = Math.floor(Math.min(elapsed, OFFLINE_CAP_H * 3600) / 60);
  setTimeout(() => welcomeBack(gain, mins), 400);
}

// ====================================================================
// Rendering
// ====================================================================
const canvas = document.getElementById("meadow");
const ctx = canvas.getContext("2d");
let W = 320, H = 320, msize = 54;

function layout() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const wrap = canvas.parentElement;
  W = (wrap && wrap.clientWidth) || 320;
  H = Math.max(200, (wrap && wrap.clientHeight) || 320);
  canvas.style.width = W + "px"; canvas.style.height = H + "px";
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  msize = Math.max(40, Math.min(76, Math.min(W, H) / 6));
}

// Meeri-Position in Pixel (x,y sind 0..1 relativ, Rand einhalten)
function mx(m) { const pad = msize * 0.6; return pad + m.x * (W - pad * 2); }
function my(m) { const pad = msize * 0.6; return pad + m.y * (H - pad * 2); }

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

// ---- Zeichen-Helfer ----
function rrp(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r); g.closePath();
}
function starP(g, cx, cy, r, n, inner) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const rad = i % 2 ? r * inner : r;
    const a = -Math.PI / 2 + i * Math.PI / n;
    const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
    i ? g.lineTo(x, y) : g.moveTo(x, y);
  }
  g.closePath();
}
function fst(g) { g.fill(); g.stroke(); }

function drawMeeri(g, cx, cy, s, tier, t, pop) {
  const T = TIERS[tier];
  const sc = pop > 0 ? 1 + Math.sin(Math.min(1, pop) * Math.PI) * 0.25 : 1;
  const wob = Math.sin(t * 4 + tier) * s * 0.02;
  g.save();
  g.translate(cx, cy + wob);
  g.scale(sc, sc);
  const lw = Math.max(2, s * 0.07);
  g.lineWidth = lw; g.strokeStyle = "#123018"; g.lineJoin = "round"; g.lineCap = "round";

  // Aura bei hohen Stufen
  if (tier >= 9) {
    const glow = g.createRadialGradient(0, 0, s * 0.2, 0, 0, s * 0.78);
    const gc = tier >= 15 ? "rgba(184,146,255,0.6)" : tier >= 12 ? "rgba(122,167,255,0.5)" : "rgba(255,210,63,0.5)";
    glow.addColorStop(0, gc); glow.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = glow; g.beginPath(); g.arc(0, 0, s * 0.78, 0, 7); g.fill();
  }

  // Rücken-Deko (Umhang, Flügel) HINTER dem Körper
  featBack(g, s, tier, t, T);

  // Schatten
  g.save(); g.fillStyle = "rgba(0,0,0,0.18)";
  g.beginPath(); g.ellipse(0, s * 0.5, s * 0.42, s * 0.12, 0, 0, 7); g.fill(); g.restore();

  g.lineWidth = lw; g.strokeStyle = "#123018";
  // Füße
  g.fillStyle = T.c2;
  for (const fx of [-s * 0.22, s * 0.22]) { g.beginPath(); g.ellipse(fx, s * 0.42, s * 0.1, s * 0.07, 0, 0, 7); fst(g); }
  // Ohren
  for (const ex of [-s * 0.3, s * 0.3]) { g.beginPath(); g.ellipse(ex, -s * 0.28, s * 0.14, s * 0.12, 0, 0, 7); fst(g); }

  // Körper (Kartoffel) mit weichem Verlauf
  const grad = g.createLinearGradient(0, -s * 0.4, 0, s * 0.45);
  grad.addColorStop(0, T.c1); grad.addColorStop(1, T.c2);
  g.beginPath(); g.ellipse(0, 0, s * 0.44, s * 0.4, 0, 0, 7); g.fillStyle = grad; fst(g);
  // Fell-Glanzlicht
  g.save(); g.beginPath(); g.ellipse(0, 0, s * 0.44, s * 0.4, 0, 0, 7); g.clip();
  g.fillStyle = "rgba(255,255,255,0.22)"; g.beginPath(); g.ellipse(-s * 0.14, -s * 0.2, s * 0.18, s * 0.12, -0.5, 0, 7); g.fill();
  g.restore();
  // helle Schnauze
  g.beginPath(); g.ellipse(0, s * 0.12, s * 0.26, s * 0.2, 0, 0, 7); g.fillStyle = "rgba(255,255,255,0.5)"; g.fill();

  drawFace(g, s, tier, t);
  featFront(g, s, tier, t, T);
  g.restore();
}

// Gesicht mit stufenspezifischem Ausdruck
function drawFace(g, s, tier, t) {
  const lw = Math.max(2, s * 0.07);
  g.lineWidth = lw; g.strokeStyle = "#123018";

  if (tier === 10) { // Roboter — Rechteck-Display + Grill-Mund
    g.fillStyle = "#0b1b12"; rrp(g, -s * 0.26, -s * 0.14, s * 0.52, s * 0.18, s * 0.04); fst(g);
    const blink = 0.55 + 0.45 * Math.abs(Math.sin(t * 2.2));
    g.fillStyle = `rgba(90,230,180,${blink})`;
    for (const ex of [-s * 0.13, s * 0.13]) { g.beginPath(); g.arc(ex, -s * 0.05, s * 0.05, 0, 7); g.fill(); }
    g.strokeStyle = "#123018"; g.lineWidth = Math.max(1, s * 0.022);
    for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(-s * 0.13, s * 0.12 + i * s * 0.045); g.lineTo(s * 0.13, s * 0.12 + i * s * 0.045); g.stroke(); }
    return;
  }
  if (tier === 13) { // Alien — große schwarze Mandelaugen
    g.fillStyle = "#0a0a12"; g.lineWidth = lw;
    for (const ex of [-s * 0.17, s * 0.17]) {
      g.save(); g.translate(ex, -s * 0.02); g.rotate(ex < 0 ? 0.5 : -0.5);
      g.beginPath(); g.ellipse(0, 0, s * 0.085, s * 0.17, 0, 0, 7); fst(g);
      g.fillStyle = "rgba(255,255,255,0.85)"; g.beginPath(); g.ellipse(-s * 0.02, -s * 0.06, s * 0.02, s * 0.045, 0, 0, 7); g.fill();
      g.restore(); g.fillStyle = "#0a0a12";
    }
    g.strokeStyle = "#123018"; g.lineWidth = Math.max(1.5, s * 0.025);
    g.beginPath(); g.arc(0, s * 0.14, s * 0.05, 0.2, Math.PI - 0.2); g.stroke();
    return;
  }

  const cute = tier === 0;
  const er = cute ? s * 0.13 : s * 0.11;
  const eyeY = -s * 0.05;
  for (const ex of [-s * 0.16, s * 0.16]) {
    g.fillStyle = "#fff"; g.beginPath(); g.arc(ex, eyeY, er, 0, 7); g.fill();
    g.lineWidth = Math.max(1, s * 0.02); g.strokeStyle = "#123018"; g.stroke();
    g.fillStyle = (tier === 5 || tier === 15) ? "#2a1a4a" : "#123018";
    g.beginPath(); g.arc(ex + s * 0.02, eyeY + s * 0.02, er * 0.5, 0, 7); g.fill();
    g.fillStyle = "#fff"; g.beginPath(); g.arc(ex, eyeY - s * 0.01, er * 0.2, 0, 7); g.fill();
  }
  if (tier === 5 || tier === 15) { // Glüh-Augen
    g.save(); g.globalCompositeOperation = "lighter";
    g.fillStyle = tier === 15 ? "rgba(184,146,255,0.55)" : "rgba(155,123,255,0.55)";
    for (const ex of [-s * 0.16, s * 0.16]) { g.beginPath(); g.arc(ex, eyeY, er * 1.3, 0, 7); g.fill(); }
    g.restore();
  }
  g.lineWidth = lw; g.strokeStyle = "#123018";
  // Nase
  g.fillStyle = "#c8607f"; g.beginPath(); g.moveTo(-s * 0.05, s * 0.1); g.lineTo(s * 0.05, s * 0.1); g.lineTo(0, s * 0.16); g.closePath(); g.fill();
  // Zähnchen
  g.fillStyle = "#fff"; g.beginPath(); g.rect(-s * 0.035, s * 0.16, s * 0.07, s * 0.08); g.fill(); g.lineWidth = Math.max(1, s * 0.015); g.stroke();
  g.lineWidth = lw;

  // Böse Augenbrauen (Punk, Wikinger, Drache)
  if (tier === 2 || tier === 4 || tier === 14) {
    g.strokeStyle = "#123018"; g.lineWidth = Math.max(2, s * 0.045);
    g.beginPath(); g.moveTo(-s * 0.28, -s * 0.2); g.lineTo(-s * 0.07, -s * 0.13); g.stroke();
    g.beginPath(); g.moveTo(s * 0.28, -s * 0.2); g.lineTo(s * 0.07, -s * 0.13); g.stroke();
  }
  // Baby-Bäckchen
  if (cute) {
    g.fillStyle = "rgba(255,120,150,0.5)";
    for (const ex of [-s * 0.28, s * 0.28]) { g.beginPath(); g.arc(ex, s * 0.06, s * 0.06, 0, 7); g.fill(); }
  }
}

// Deko HINTER dem Körper (Umhänge, Flügel)
function featBack(g, s, tier, t, T) {
  g.lineWidth = Math.max(2, s * 0.06); g.strokeStyle = "#123018"; g.lineJoin = "round";
  if (tier === 9 || tier === 11) { // Umhang
    g.fillStyle = tier === 9 ? "#c81f43" : "#2f6df0";
    g.beginPath();
    g.moveTo(-s * 0.22, -s * 0.2);
    g.quadraticCurveTo(-s * 0.55, s * 0.1 + Math.sin(t * 3) * s * 0.03, -s * 0.34, s * 0.5);
    g.lineTo(s * 0.34, s * 0.5);
    g.quadraticCurveTo(s * 0.55, s * 0.1 - Math.sin(t * 3) * s * 0.03, s * 0.22, -s * 0.2);
    g.closePath(); fst(g);
    if (tier === 9) { // Fellkragen
      g.fillStyle = "#fff";
      for (let i = -2; i <= 2; i++) { g.beginPath(); g.arc(i * s * 0.11, -s * 0.2, s * 0.07, 0, 7); g.fill(); }
    }
  }
  if (tier === 14) { // Drachenflügel
    g.fillStyle = "#7a3ec8";
    for (const dir of [-1, 1]) {
      g.save(); g.scale(dir, 1);
      const flap = Math.sin(t * 5) * s * 0.05;
      g.beginPath();
      g.moveTo(s * 0.2, -s * 0.1);
      g.lineTo(s * 0.62, -s * 0.35 - flap);
      g.lineTo(s * 0.58, -s * 0.02);
      g.lineTo(s * 0.66, s * 0.02 + flap);
      g.lineTo(s * 0.5, s * 0.12);
      g.lineTo(s * 0.55, s * 0.22 + flap);
      g.lineTo(s * 0.28, s * 0.15);
      g.closePath(); fst(g);
      g.restore();
    }
  }
}

// Deko VOR dem Körper (Hüte, Masken, Gegenstände) — macht jede Stufe einzigartig
function featFront(g, s, tier, t, T) {
  g.lineWidth = Math.max(2, s * 0.06); g.strokeStyle = "#123018"; g.lineJoin = "round"; g.lineCap = "round";
  switch (tier) {
    case 0: { // Baby — Haarlocke + Funkeln
      g.strokeStyle = "#123018"; g.lineWidth = Math.max(2, s * 0.05);
      g.beginPath(); g.moveTo(0, -s * 0.4); g.quadraticCurveTo(s * 0.1, -s * 0.56, -s * 0.03, -s * 0.6); g.stroke();
      g.fillStyle = "#fff"; starP(g, s * 0.34, -s * 0.34, s * 0.07, 4, 0.4); g.fill();
      break;
    }
    case 1: { // Struppel — wildes Fell + Blatt
      g.fillStyle = T.c2;
      const tufts = [[-0.35, -0.2], [-0.4, 0.05], [0.4, -0.15], [0.42, 0.1], [-0.15, -0.42], [0.15, -0.44]];
      for (const [dx, dy] of tufts) {
        g.beginPath(); g.moveTo(dx * s, dy * s);
        g.lineTo(dx * s + s * 0.12 * Math.sign(dx || 1), dy * s - s * 0.06);
        g.lineTo(dx * s + s * 0.04, dy * s + s * 0.08); g.closePath(); fst(g);
      }
      g.fillStyle = "#4caf50"; g.save(); g.translate(s * 0.05, -s * 0.44); g.rotate(0.5);
      g.beginPath(); g.ellipse(0, 0, s * 0.06, s * 0.11, 0, 0, 7); fst(g); g.restore();
      break;
    }
    case 2: { // Punk — Irokese + Zunge
      const cols = ["#ff2d78", "#ffd23f", "#2ad1ff"];
      for (let i = -2; i <= 2; i++) {
        g.fillStyle = cols[(i + 2) % 3];
        const h = s * (0.5 - Math.abs(i) * 0.06);
        g.beginPath(); g.moveTo(i * s * 0.08 - s * 0.05, -s * 0.34);
        g.lineTo(i * s * 0.08, -h); g.lineTo(i * s * 0.08 + s * 0.05, -s * 0.34);
        g.closePath(); fst(g);
      }
      g.fillStyle = "#ff5a8a"; rrp(g, -s * 0.04, s * 0.2, s * 0.08, s * 0.1, s * 0.03); fst(g);
      break;
    }
    case 3: { // Ritter — Helm mit Visier + Feder
      g.fillStyle = "#b8c2cc";
      g.beginPath(); g.moveTo(-s * 0.34, -s * 0.16); g.arc(0, -s * 0.16, s * 0.34, Math.PI, 0); g.closePath(); fst(g);
      g.strokeStyle = "#123018"; g.lineWidth = Math.max(1.5, s * 0.03);
      g.beginPath(); g.moveTo(0, -s * 0.46); g.lineTo(0, -s * 0.18); g.stroke();
      g.fillStyle = "#e23"; g.beginPath(); g.moveTo(0, -s * 0.5); g.quadraticCurveTo(s * 0.16, -s * 0.74, s * 0.03, -s * 0.5); g.closePath(); fst(g);
      break;
    }
    case 4: { // Wikinger — Helm mit Hörnern
      g.fillStyle = "#9aa3ad";
      g.beginPath(); g.moveTo(-s * 0.3, -s * 0.2); g.arc(0, -s * 0.2, s * 0.3, Math.PI, 0); g.closePath(); fst(g);
      g.fillStyle = "#f2e6c8";
      for (const dir of [-1, 1]) {
        g.save(); g.scale(dir, 1);
        g.beginPath(); g.moveTo(s * 0.22, -s * 0.28);
        g.quadraticCurveTo(s * 0.46, -s * 0.34, s * 0.44, -s * 0.6);
        g.quadraticCurveTo(s * 0.34, -s * 0.42, s * 0.18, -s * 0.38); g.closePath(); fst(g);
        g.restore();
      }
      break;
    }
    case 5: { // Zauberer — Spitzhut + Funken
      g.fillStyle = "#4b2c8f";
      g.beginPath(); g.moveTo(-s * 0.3, -s * 0.34); g.lineTo(s * 0.12, -s * 0.8); g.lineTo(s * 0.16, -s * 0.34); g.closePath(); fst(g);
      g.fillStyle = "#3a2270"; rrp(g, -s * 0.34, -s * 0.4, s * 0.56, s * 0.1, s * 0.04); fst(g);
      g.fillStyle = "#ffd23f"; starP(g, -s * 0.04, -s * 0.52, s * 0.06, 5, 0.45); fst(g);
      g.fillStyle = "#ffe066";
      for (let i = 0; i < 3; i++) { const a = t * 2 + i * 2.1; g.beginPath(); g.arc(Math.cos(a) * s * 0.5, -s * 0.3 + Math.sin(a) * s * 0.2, s * 0.03, 0, 7); g.fill(); }
      break;
    }
    case 6: { // Pirat — Bandana + Augenklappe
      g.fillStyle = "#d33";
      g.beginPath(); g.moveTo(-s * 0.34, -s * 0.24); g.quadraticCurveTo(0, -s * 0.46, s * 0.34, -s * 0.24);
      g.lineTo(s * 0.34, -s * 0.34); g.quadraticCurveTo(0, -s * 0.52, -s * 0.34, -s * 0.32); g.closePath(); fst(g);
      g.beginPath(); g.moveTo(-s * 0.32, -s * 0.28); g.lineTo(-s * 0.52, -s * 0.34); g.lineTo(-s * 0.46, -s * 0.14); g.closePath(); fst(g);
      g.fillStyle = "#fff"; for (const dx of [-0.18, 0, 0.18]) { g.beginPath(); g.arc(dx * s, -s * 0.34, s * 0.02, 0, 7); g.fill(); }
      g.fillStyle = "#111"; g.beginPath(); g.arc(-s * 0.16, -s * 0.05, s * 0.1, 0, 7); fst(g);
      g.strokeStyle = "#111"; g.lineWidth = Math.max(1.5, s * 0.02); g.beginPath(); g.moveTo(-s * 0.24, -s * 0.17); g.lineTo(s * 0.3, -s * 0.24); g.stroke();
      break;
    }
    case 7: { // Cowboy — Hut + Halstuch
      g.fillStyle = "#a9762f";
      g.beginPath(); g.ellipse(0, -s * 0.34, s * 0.42, s * 0.1, 0, 0, 7); fst(g);
      g.beginPath(); g.moveTo(-s * 0.2, -s * 0.34); g.quadraticCurveTo(-s * 0.16, -s * 0.62, 0, -s * 0.62); g.quadraticCurveTo(s * 0.16, -s * 0.62, s * 0.2, -s * 0.34); g.closePath(); fst(g);
      g.strokeStyle = "#6e4a1c"; g.lineWidth = Math.max(2, s * 0.03); g.beginPath(); g.moveTo(-s * 0.18, -s * 0.4); g.lineTo(s * 0.18, -s * 0.4); g.stroke();
      g.fillStyle = "#d33"; g.strokeStyle = "#123018"; g.lineWidth = Math.max(2, s * 0.05);
      g.beginPath(); g.moveTo(-s * 0.16, s * 0.28); g.lineTo(s * 0.16, s * 0.28); g.lineTo(0, s * 0.44); g.closePath(); fst(g);
      break;
    }
    case 8: { // Ninja — Maske + Stirnband
      g.fillStyle = "#2b2f38"; rrp(g, -s * 0.42, s * 0.02, s * 0.84, s * 0.22, s * 0.08); fst(g);
      g.fillStyle = "#c0392b"; rrp(g, -s * 0.4, -s * 0.16, s * 0.8, s * 0.09, s * 0.02); fst(g);
      g.beginPath(); g.moveTo(s * 0.36, -s * 0.12); g.lineTo(s * 0.6, -s * 0.02 + Math.sin(t * 6) * s * 0.05); g.lineTo(s * 0.58, -s * 0.16); g.closePath(); fst(g);
      g.beginPath(); g.moveTo(s * 0.36, -s * 0.06); g.lineTo(s * 0.58, s * 0.12 + Math.sin(t * 6 + 1) * s * 0.05); g.lineTo(s * 0.5, -s * 0.02); g.closePath(); fst(g);
      break;
    }
    case 9: { // König — Krone
      g.fillStyle = "#ffd23f";
      g.beginPath(); g.moveTo(-s * 0.28, -s * 0.3); g.lineTo(-s * 0.28, -s * 0.5);
      g.lineTo(-s * 0.14, -s * 0.38); g.lineTo(0, -s * 0.56); g.lineTo(s * 0.14, -s * 0.38);
      g.lineTo(s * 0.28, -s * 0.5); g.lineTo(s * 0.28, -s * 0.3); g.closePath(); fst(g);
      g.fillStyle = "#e2385a"; for (const dx of [-0.14, 0, 0.14]) { g.beginPath(); g.arc(dx * s, -s * 0.34, s * 0.03, 0, 7); fst(g); }
      break;
    }
    case 10: { // Roboter — Antenne + Nieten
      g.strokeStyle = "#123018"; g.lineWidth = Math.max(2, s * 0.04);
      g.beginPath(); g.moveTo(0, -s * 0.4); g.lineTo(0, -s * 0.56); g.stroke();
      g.fillStyle = (Math.sin(t * 6) > 0) ? "#ff5a5a" : "#ffd23f"; g.beginPath(); g.arc(0, -s * 0.6, s * 0.06, 0, 7); fst(g);
      g.fillStyle = "#8fa3b5"; for (const ex of [-0.34, 0.34]) { g.beginPath(); g.arc(ex * s, 0, s * 0.05, 0, 7); fst(g); }
      break;
    }
    case 11: { // Superheld — Maske + Bruststern
      g.fillStyle = "#1746c8";
      g.beginPath();
      g.moveTo(-s * 0.3, -s * 0.14); g.quadraticCurveTo(0, -s * 0.04, s * 0.3, -s * 0.14);
      g.quadraticCurveTo(s * 0.3, s * 0.02, s * 0.16, s * 0.02);
      g.lineTo(s * 0.1, -s * 0.05); g.lineTo(-s * 0.1, -s * 0.05); g.lineTo(-s * 0.16, s * 0.02);
      g.quadraticCurveTo(-s * 0.3, s * 0.02, -s * 0.3, -s * 0.14); g.closePath(); fst(g);
      g.fillStyle = "#ffd23f"; starP(g, 0, s * 0.24, s * 0.1, 5, 0.45); fst(g);
      break;
    }
    case 12: { // Astronaut — Glashelm
      g.save();
      g.fillStyle = "rgba(150,210,255,0.28)"; g.strokeStyle = "#123018"; g.lineWidth = Math.max(2, s * 0.05);
      g.beginPath(); g.arc(0, -s * 0.06, s * 0.42, 0, 7); fst(g);
      g.strokeStyle = "rgba(255,255,255,0.7)"; g.lineWidth = Math.max(2, s * 0.04);
      g.beginPath(); g.arc(-s * 0.14, -s * 0.16, s * 0.2, Math.PI * 1.1, Math.PI * 1.6); g.stroke();
      g.restore();
      g.strokeStyle = "#123018"; g.lineWidth = Math.max(2, s * 0.03); g.beginPath(); g.moveTo(s * 0.3, -s * 0.36); g.lineTo(s * 0.4, -s * 0.5); g.stroke();
      g.fillStyle = "#ff5a5a"; g.beginPath(); g.arc(s * 0.4, -s * 0.52, s * 0.04, 0, 7); fst(g);
      break;
    }
    case 13: { // Alien — Antennen
      g.strokeStyle = "#123018"; g.lineWidth = Math.max(2, s * 0.035);
      for (const dir of [-1, 1]) {
        g.beginPath(); g.moveTo(dir * s * 0.12, -s * 0.38);
        g.quadraticCurveTo(dir * s * 0.3, -s * 0.56, dir * s * 0.2, -s * 0.64); g.stroke();
        g.fillStyle = "#9fffcf"; g.beginPath(); g.arc(dir * s * 0.2, -s * 0.66, s * 0.05, 0, 7); fst(g);
      }
      break;
    }
    case 14: { // Drache — Hörner + Rückenzacken + Feuer
      g.fillStyle = "#f2e6c8";
      for (const dir of [-1, 1]) {
        g.beginPath(); g.moveTo(dir * s * 0.14, -s * 0.34);
        g.quadraticCurveTo(dir * s * 0.28, -s * 0.5, dir * s * 0.34, -s * 0.6);
        g.quadraticCurveTo(dir * s * 0.2, -s * 0.46, dir * s * 0.06, -s * 0.4); g.closePath(); fst(g);
      }
      g.fillStyle = "#c85f14";
      for (let i = -1; i <= 1; i++) { g.beginPath(); g.moveTo(i * s * 0.16 - s * 0.05, -s * 0.34); g.lineTo(i * s * 0.16, -s * 0.5); g.lineTo(i * s * 0.16 + s * 0.05, -s * 0.34); g.closePath(); fst(g); }
      const fl = 1 + Math.sin(t * 12) * 0.15;
      g.fillStyle = "#ff9c1a"; g.beginPath(); g.moveTo(s * 0.02, s * 0.14); g.quadraticCurveTo(s * 0.42 * fl, s * 0.04, s * 0.5 * fl, s * 0.2); g.quadraticCurveTo(s * 0.36, s * 0.34, s * 0.02, s * 0.24); g.closePath(); g.fill();
      g.fillStyle = "#ffe066"; g.beginPath(); g.moveTo(s * 0.06, s * 0.16); g.quadraticCurveTo(s * 0.28 * fl, s * 0.12, s * 0.36 * fl, s * 0.2); g.quadraticCurveTo(s * 0.26, s * 0.28, s * 0.06, s * 0.22); g.closePath(); g.fill();
      break;
    }
    case 15: { // Galaxie — Sternenfell + Orbit
      g.fillStyle = "#fff";
      for (let i = 0; i < 7; i++) {
        const a = i * 1.3, rr = s * (0.14 + (i % 3) * 0.09);
        starP(g, Math.cos(a) * rr, Math.sin(a) * rr * 0.9, s * 0.03, 4, 0.4); g.fill();
      }
      g.fillStyle = "#ffe0ff";
      for (let i = 0; i < 2; i++) { const a = t * 1.5 + i * Math.PI; g.beginPath(); g.arc(Math.cos(a) * s * 0.55, Math.sin(a) * s * 0.5, s * 0.04, 0, 7); g.fill(); }
      break;
    }
  }
}

// ---------- Effekte ----------
let coinsFx = [], golds = [], bursts = [], floaters = [], confetti = [];
function spawnCoin(m) {
  coinsFx.push({ x: mx(m), y: my(m) - msize * 0.5, val: Math.round(coinVal(m.tier) * coinMult()), t: 0, life: 5.5, vy: -12 - Math.random() * 8, r: msize * 0.28 });
}
function spawnGold() {
  golds.push({ x: (0.15 + Math.random() * 0.7) * W, y: (0.15 + Math.random() * 0.7) * H, t: 0, life: 6, phase: Math.random() * 7 });
}
function burst(text, col) { bursts.push({ text, col, x: W / 2, y: H * 0.4, t: 0, life: 0.9 }); }
function floater(text, col, rx, ry) { floaters.push({ text, col, x: rx != null ? mx({ x: rx }) : W / 2, y: ry != null ? my({ y: ry }) : H * 0.5, t: 0, life: 1.1 }); }
function spawnConfetti(rx, ry, col) {
  const x = mx({ x: rx }), y = my({ y: ry });
  const cols = [col, "#ffd23f", "#ff5a8a", "#57e39b", "#fff"];
  for (let i = 0; i < 14; i++) confetti.push({ x, y, vx: (Math.random() - 0.5) * 6, vy: -Math.random() * 6 - 2, life: 1, size: msize * 0.12, col: cols[i % cols.length], rot: Math.random() * 7, vr: (Math.random() - 0.5) * 0.5 });
}

// ---------- Loop ----------
let lastT = 0, animT = 0, goldTimer = 8;
function frame(ts) {
  const dt = Math.min(0.05, (ts - lastT) / 1000 || 0); lastT = ts; animT += dt;

  if (!over) {
    // Meeries bewegen + Münzen abwerfen
    for (const m of meeries) {
      if (m.pop) { m.pop += dt * 2.2; if (m.pop >= 1) m.pop = 0; }
      if (m.held) continue;
      m.x += m.vx * dt * 0.06; m.y += m.vy * dt * 0.06;
      if (m.x < 0.02) { m.x = 0.02; m.vx = Math.abs(m.vx); }
      if (m.x > 0.98) { m.x = 0.98; m.vx = -Math.abs(m.vx); }
      if (m.y < 0.02) { m.y = 0.02; m.vy = Math.abs(m.vy); }
      if (m.y > 0.98) { m.y = 0.98; m.vy = -Math.abs(m.vy); }
      if (Math.random() < dt * 0.4) { m.vx = (Math.random() - 0.5); m.vy = (Math.random() - 0.5); }
      m.nextDrop -= dt;
      if (m.nextDrop <= 0) { m.nextDrop = rndDrop(); spawnCoin(m); }
    }
    // Goldenes Meeri
    goldTimer -= dt;
    if (goldTimer <= 0 && golds.length === 0 && meeries.length > 0) { goldTimer = 25 + Math.random() * 20; spawnGold(); }
  }

  // Auto-Sammler: Münz-Blasen nach kurzer Zeit von selbst einsammeln
  if (!over && (up.magnet || 0) > 0) {
    const md = magnetDelay();
    for (let i = coinsFx.length - 1; i >= 0; i--) {
      const c = coinsFx[i];
      if (c.t >= md) { coins += c.val; if (floaters.length < 3) floater("+" + fmt(c.val), "#ffd23f", null, null); coinsFx.splice(i, 1); hudDirty = true; }
    }
  }
  // Effekt-Timer
  coinsFx = coinsFx.filter(c => (c.t += dt) < c.life);
  coinsFx.forEach(c => { c.y += c.vy * dt; c.vy += 20 * dt; if (c.vy > 6) c.vy = 6; });
  golds = golds.filter(g => (g.t += dt) < g.life);
  bursts = bursts.filter(b => (b.t += dt) < b.life);
  floaters = floaters.filter(f => (f.t += dt) < f.life);
  confetti = confetti.filter(p => (p.life -= dt * 1.3) > 0);
  confetti.forEach(p => { p.x += p.vx; p.y += p.vy; p.vy += 0.3; p.rot += p.vr; });

  if (hudDirty) { updateHUD(); hudDirty = false; }
  draw();
  requestAnimationFrame(frame);
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  const light = document.documentElement.dataset.theme !== "dark";
  // Wiese (theme-abhängig: sonnig hell vs. abendlich gedämpft)
  roundRect(1.5, 1.5, W - 3, H - 3, 16);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  if (light) { g.addColorStop(0, "#5fd07f"); g.addColorStop(0.55, "#37b058"); g.addColorStop(1, "#218a44"); }
  else { g.addColorStop(0, "#2f6d42"); g.addColorStop(0.55, "#215233"); g.addColorStop(1, "#163a24"); }
  ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = 3.5; ctx.strokeStyle = "#123018"; ctx.stroke();
  ctx.save(); roundRect(1.5, 1.5, W - 3, H - 3, 16); ctx.clip();
  // Licht von oben (Sonne bzw. Mond)
  const sun = ctx.createRadialGradient(W * 0.3, H * 0.12, 0, W * 0.3, H * 0.12, W * 0.65);
  const sunA = light ? 0.18 : 0.1;
  sun.addColorStop(0, `rgba(255,255,255,${sunA})`); sun.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sun; ctx.fillRect(0, 0, W, H);
  // Grasbüschel
  ctx.strokeStyle = light ? "rgba(255,255,255,0.11)" : "rgba(255,255,255,0.07)"; ctx.lineWidth = 2; ctx.lineCap = "round";
  for (let i = 0; i < 16; i++) {
    const gx = ((i * 137) % 100) / 100 * W, gy = ((i * 79) % 100) / 100 * H;
    ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx - 4, gy - 9); ctx.moveTo(gx, gy); ctx.lineTo(gx, gy - 12); ctx.moveTo(gx, gy); ctx.lineTo(gx + 4, gy - 9); ctx.stroke();
  }
  // Blümchen
  const fcol = ["#ff6f91", "#ffd23f", "#ffffff", "#b892ff"];
  for (let i = 0; i < 7; i++) {
    const fx = ((i * 173 + 40) % 100) / 100 * W, fy = ((i * 111 + 66) % 100) / 100 * H;
    ctx.fillStyle = fcol[i % fcol.length];
    for (let p = 0; p < 5; p++) { const a = p / 5 * Math.PI * 2; ctx.beginPath(); ctx.arc(fx + Math.cos(a) * 4.2, fy + Math.sin(a) * 4.2, 2.7, 0, 7); ctx.fill(); }
    ctx.fillStyle = "#ffd23f"; ctx.beginPath(); ctx.arc(fx, fy, 2.4, 0, 7); ctx.fill();
  }
  // Vignette unten für Tiefe
  const vg = ctx.createLinearGradient(0, H * 0.62, 0, H);
  vg.addColorStop(0, "rgba(0,30,12,0)"); vg.addColorStop(1, light ? "rgba(0,40,15,0.22)" : "rgba(0,20,8,0.4)");
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // Meeries (nach y sortiert für Tiefe)
  const sorted = [...meeries].sort((a, b) => (a.held ? 1 : 0) - (b.held ? 1 : 0) || my(a) - my(b));
  for (const m of sorted) drawMeeri(ctx, mx(m), my(m), msize, m.tier, animT + m.phase, m.pop);

  // Münz-Blasen
  for (const c of coinsFx) {
    const k = c.t / c.life; ctx.save(); ctx.globalAlpha = k > 0.8 ? (1 - k) / 0.2 : 1;
    ctx.translate(c.x, c.y);
    ctx.beginPath(); ctx.arc(0, 0, c.r, 0, 7); ctx.fillStyle = "#ffd23f"; ctx.fill();
    ctx.lineWidth = Math.max(2, c.r * 0.16); ctx.strokeStyle = "#123018"; ctx.stroke();
    ctx.fillStyle = "#b97c10"; ctx.font = `800 ${c.r * 0.9}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("🪙", 0, 1);
    ctx.restore();
  }
  // Goldenes Meeri
  for (const gg of golds) {
    const bob = Math.sin((animT + gg.phase) * 3) * 6;
    const k = gg.t / gg.life; ctx.save(); ctx.globalAlpha = k > 0.85 ? (1 - k) / 0.15 : 1;
    ctx.translate(gg.x, gg.y + bob);
    ctx.shadowColor = "rgba(255,210,63,0.9)"; ctx.shadowBlur = 20;
    ctx.font = `${msize * 0.9}px "Segoe UI Emoji","Apple Color Emoji",sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("🪙", 0, 0); ctx.shadowBlur = 0;
    ctx.font = `${msize * 0.5}px "Segoe UI Emoji",sans-serif`; ctx.fillText("✨", msize * 0.35, -msize * 0.35);
    ctx.restore();
  }
  // Konfetti
  for (const p of confetti) {
    ctx.save(); ctx.globalAlpha = Math.max(0, p.life); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
    ctx.fillStyle = p.col; ctx.strokeStyle = "#123018"; ctx.lineWidth = 1.2;
    roundRect(-p.size / 2, -p.size / 2, p.size, p.size, p.size * 0.25); ctx.fill(); ctx.stroke(); ctx.restore();
  }
  // Floater
  for (const f of floaters) {
    const k = f.t / f.life; ctx.save(); ctx.globalAlpha = 1 - k;
    ctx.font = `800 ${msize * 0.42}px ${uiFont()}`; ctx.textAlign = "center"; ctx.lineWidth = 4; ctx.strokeStyle = "#123018"; ctx.fillStyle = f.col;
    ctx.strokeText(f.text, f.x, f.y - k * msize); ctx.fillText(f.text, f.x, f.y - k * msize); ctx.restore();
  }
  // Bursts
  for (const b of bursts) {
    const k = b.t / b.life; const sc = k < 0.3 ? (k / 0.3) * 1.15 : 1.15 - (k - 0.3) * 0.2;
    ctx.save(); ctx.globalAlpha = Math.max(0, 1 - k); ctx.translate(b.x, b.y); ctx.rotate(-0.06); ctx.scale(sc, sc);
    ctx.font = `900 italic ${msize * 0.9}px ${uiFont()}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.lineWidth = 7; ctx.strokeStyle = "#123018"; ctx.strokeText(b.text, 0, 0);
    ctx.fillStyle = b.col; ctx.fillText(b.text, 0, 0); ctx.restore();
  }
}
function uiFont() { return `${getComputedStyle(document.documentElement).getPropertyValue("--font-ui").trim() || "Outfit"}, sans-serif`; }

// ====================================================================
// Eingabe
// ====================================================================
let drag = null;
function pos(e) { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
function meeriAt(x, y) {
  for (let i = meeries.length - 1; i >= 0; i--) { const m = meeries[i]; if (Math.hypot(x - mx(m), y - my(m)) < msize * 0.5) return m; }
  return null;
}
canvas.addEventListener("pointerdown", e => {
  if (over) return;
  const { x, y } = pos(e);
  // Goldenes Meeri antippen
  for (const gg of golds) {
    if (Math.hypot(x - gg.x, y - gg.y) < msize * 0.6) {
      const bonus = Math.max(20, Math.round(passivePerSec() * 60) + coinVal(topTier()) * 5);
      coins += bonus; golds = golds.filter(z => z !== gg);
      floater("+" + fmt(bonus), "#ffd23f", null, null); burst("BONUS!", "#ffd23f");
      GS.sound.win(); GS.haptic([10, 30, 10]); updateHUD(); saveSoon(); return;
    }
  }
  // Münz-Blase einsammeln
  for (let i = coinsFx.length - 1; i >= 0; i--) {
    const c = coinsFx[i];
    if (Math.hypot(x - c.x, y - c.y) < c.r + 8) {
      coins += c.val; coinsFx.splice(i, 1);
      floater("+" + fmt(c.val), "#ffd23f", null, null);
      GS.sound.tone(560 + Math.random() * 120, 0.06, { type: "triangle", gain: 0.06 }); GS.haptic(5);
      updateHUD(); saveSoon(); return;
    }
  }
  // Meeri aufnehmen
  const m = meeriAt(x, y);
  if (m) { drag = m; m.held = true; canvas.setPointerCapture(e.pointerId); GS.haptic(6); }
});
canvas.addEventListener("pointermove", e => {
  if (!drag) return;
  const { x, y } = pos(e); const pad = msize * 0.6;
  drag.x = Math.max(0, Math.min(1, (x - pad) / (W - pad * 2)));
  drag.y = Math.max(0, Math.min(1, (y - pad) / (H - pad * 2)));
});
function drop() {
  if (!drag) return;
  const d = drag; drag = null; d.held = false;
  // Ziel-Meeri gleicher Stufe finden
  let target = null, best = msize * 0.7;
  for (const m of meeries) {
    if (m.id === d.id || m.tier !== d.tier) continue;
    const dist = Math.hypot(mx(m) - mx(d), my(m) - my(d));
    if (dist < best) { best = dist; target = m; }
  }
  if (target) mergeInto(target, d);
  else saveSoon();
}
canvas.addEventListener("pointerup", drop);
canvas.addEventListener("pointercancel", () => { if (drag) { drag.held = false; drag = null; } });

// ====================================================================
// HUD & UI
// ====================================================================
function fmt(n) {
  n = Math.floor(n);
  if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
  return String(n);
}
function topTier() { return meeries.reduce((a, m) => Math.max(a, m.tier), 0); }
function updateHUD() {
  document.getElementById("coins").textContent = fmt(coins);
  document.getElementById("cap").textContent = `🐹 ${meeries.length}/${capacity()}`;
  document.getElementById("rate").textContent = meeries.length ? `~${fmt(passivePerSec())}/s` : "kauf ein Meeri!";
  const buy = document.getElementById("buy"), exp = document.getElementById("expand");
  document.getElementById("buy-cost").textContent = "🪙 " + fmt(buyCost());
  const full = meeries.length >= capacity();
  buy.disabled = coins < buyCost() || full;
  document.getElementById("buy").querySelector(".cb-top").textContent = full ? "Wiese voll!" : "+ Meeri kaufen";
  if (capLevel >= CAP_MAXLEVEL) { exp.disabled = true; document.getElementById("exp-cost").textContent = "max"; }
  else { document.getElementById("exp-cost").textContent = "🪙 " + fmt(expCost()); exp.disabled = coins < expCost(); }
  document.getElementById("btn-sound").textContent = GS.sound.on() ? "🔊" : "🔇";
}

function toast(msg) {
  document.querySelectorAll(".meeri-toast").forEach(t => t.remove());
  const t = document.createElement("div"); t.className = "meeri-toast"; t.textContent = msg;
  t.style.cssText = "position:fixed;left:50%;bottom:calc(84px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:200;background:#123018;color:#fff;padding:10px 18px;border-radius:999px;font-weight:800;font-size:0.9rem;box-shadow:0 0 0 2px #fff8ec inset;max-width:90vw;text-align:center";
  document.body.appendChild(t); setTimeout(() => t.remove(), 2200);
}

function mkOverlay(html) {
  const ov = document.createElement("div"); ov.className = "overlay";
  ov.innerHTML = `<div class="panel">${html}</div>`;
  ov.onclick = e => { if (e.target === ov && ov.dataset.dismiss !== "0") ov.remove(); };
  document.body.appendChild(ov); return ov;
}

function showAlbum() {
  const found = Object.keys(album).length;
  const cells = TIERS.map((T, i) => {
    const got = !!album[i];
    return `<div class="album-cell ${got ? "" : "locked"}" ${got ? `data-tier="${i}" role="button" tabindex="0"` : ""}>
      <span class="album-dot" style="background:${got ? T.c1 : "#c9c9c9"}">${got ? (T.prop || "🐹") : "❓"}<span class="lvl">${i + 1}</span></span>
      <span class="album-name">${got ? esc(T.name) : "???"}</span>
      <span class="album-desc">${got ? esc(T.desc) : "noch nicht entdeckt"}</span>
    </div>`;
  }).join("");
  const ov = mkOverlay(`
    <h2><span class="foil">Meeri-Album</span></h2>
    <p class="sub">${found}/${TIERS.length} entdeckt · tippe ein Meeri zum Angeben 📤</p>
    <div class="album-grid">${cells}</div>
    <button class="btn-secondary" data-close="1">Schließen</button>`);
  ov.querySelectorAll(".album-cell[data-tier]").forEach(el => el.onclick = () => reveal(Number(el.dataset.tier), false));
  ov.querySelector("[data-close]").onclick = () => ov.remove();
}

function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

function welcomeBack(gain, mins) {
  const ov = mkOverlay(`
    <h2><span class="foil">Willkommen zurück!</span></h2>
    <p class="sub">Deine Meeries haben fleißig weitergesammelt${mins > 0 ? ` (~${mins} Min.)` : ""}.</p>
    <div class="big-num">🪙 +${fmt(gain)}</div>
    <button class="btn-primary" data-close="1">Juhu, weiter!</button>`);
  ov.dataset.dismiss = "0";
  ov.querySelector("[data-close]").onclick = () => ov.remove();
}

// Entdeck-/Angeber-Karte mit gezeichnetem Meeri + Teilen-Button
function reveal(tier, isNew) {
  const T = TIERS[tier];
  const ov = mkOverlay(`
    <h2><span class="foil">${isNew ? "Neu entdeckt!" : esc(T.name)}</span></h2>
    ${isNew ? `<p class="sub" style="margin-bottom:6px">Evolution freigeschaltet:</p>` : ""}
    <canvas class="reveal-canvas" width="200" height="200"></canvas>
    <div class="reveal-name">${esc(T.name)} ${T.prop}</div>
    <p class="sub">„${esc(T.desc)}"</p>
    <button class="btn-primary" id="rv-share">📤 Angeben &amp; Teilen</button>
    <button class="btn-secondary" id="rv-close">${isNew ? "Weiter wuseln" : "Schließen"}</button>`);
  const cv = ov.querySelector(".reveal-canvas");
  const g = cv.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  cv.width = 200 * dpr; cv.height = 200 * dpr; cv.style.width = "200px"; cv.style.height = "200px";
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawMeeri(g, 100, 104, 150, tier, 0, 0.6);
  spawnConfetti(0.5, 0.35, T.c1);
  GS.haptic([10, 30, 10]);
  ov.querySelector("#rv-close").onclick = () => ov.remove();
  ov.querySelector("#rv-share").onclick = async () => {
    const r = await GS.share({
      title: "MEERI-MANIA",
      text: `Ich hab das ${T.name} ${T.prop} in MEERI-MANIA entdeckt! 🐹 Schaffst du auch die Galaxie-Meeri?`,
      url: location.origin + "/meeri/",
    });
    if (r === "copied") toast("Link kopiert — jetzt angeben! 📤");
  };
}

// Upgrade-Shop
function showShop() {
  const ov = mkOverlay(`
    <h2><span class="foil">Meeri-Shop</span></h2>
    <p class="sub">Rüste deine Wiese auf und werde reicher.</p>
    <div id="shop-rows"></div>
    <button class="btn-secondary" id="shop-close">Schließen</button>`);
  const render = () => {
    ov.querySelector("#shop-rows").innerHTML = UPGRADES.map((u, i) => {
      const lvl = up[u.key] || 0, maxed = lvl >= u.max, cost = upCost(u);
      const can = !maxed && coins >= cost;
      return `<div class="shop-row">
        <span class="shop-ic">${u.icon}</span>
        <span class="shop-info"><b>${esc(u.name)} <span class="shop-lvl">Lv ${lvl}${maxed ? " (max)" : ""}</span></b><span class="shop-desc">${esc(u.desc(lvl))}</span></span>
        <button class="shop-buy" data-i="${i}" ${can ? "" : "disabled"}>${maxed ? "max" : "🪙 " + fmt(cost)}</button>
      </div>`;
    }).join("");
    ov.querySelectorAll(".shop-buy[data-i]").forEach(b => b.onclick = () => {
      const u = UPGRADES[Number(b.dataset.i)], lvl = up[u.key] || 0, cost = upCost(u);
      if (lvl >= u.max || coins < cost) return;
      coins -= cost; up[u.key] = lvl + 1;
      GS.sound.good(); GS.haptic(10); updateHUD(); saveSoon(); render();
    });
  };
  render();
  ov.querySelector("#shop-close").onclick = () => ov.remove();
}

function showMenu() {
  const ov = mkOverlay(`
    <h2><span class="foil">MEERI-MANIA</span></h2>
    <p class="sub">Kaufe Meeries, zieh gleiche zusammen und entdecke alle Evolutionen!</p>
    <button class="btn-primary" id="m-close">▶ Weiter wuseln</button>
    <div class="menu-grid">
      <button class="btn-secondary" id="m-album">📖 Album</button>
      <button class="btn-secondary" id="m-how">❓ Anleitung</button>
      <button class="btn-secondary full" id="m-reset">🗑️ Neu starten</button>
    </div>`);
  ov.querySelector("#m-close").onclick = () => ov.remove();
  ov.querySelector("#m-album").onclick = () => { ov.remove(); showAlbum(); };
  ov.querySelector("#m-how").onclick = () => howTo(true);
  ov.querySelector("#m-reset").onclick = () => {
    if (confirm("Wirklich komplett neu starten? Aller Fortschritt geht verloren.")) {
      fresh(); save(); ov.remove(); spawnMeeri(0); updateHUD(); toast("Neue Wiese!");
    }
  };
}
function howTo(force) {
  GS.onboard("meeri", {
    force: !!force,
    title: "So geht MEERI-MANIA",
    steps: [
      { icon: "🪙", text: "Meeries werfen Münz-Blasen ab — tippe sie an. Mit dem 🧲 Auto-Sammler geht das später von allein." },
      { icon: "🔀", text: "Zieh zwei GLEICHE Meeries zusammen → sie evolvieren zur nächsten, absurderen Stufe!" },
      { icon: "🛒", text: "Im Shop rüstest du auf: mehr Münzwert, schnellere Würfe, Auto-Sammler, Glücks-Wurf." },
      { icon: "📖", text: "Neue Evolutionen landen im Album — tippe sie an, um sie zu teilen. Schaffst du die Galaxie-Meeri? 🌌" },
    ],
  });
}

// ====================================================================
// Verdrahtung & Start
// ====================================================================
document.getElementById("buy").onclick = buyMeeri;
document.getElementById("expand").onclick = expandMeadow;
document.getElementById("btn-shop").onclick = showShop;
document.getElementById("btn-album").onclick = showAlbum;
document.getElementById("btn-menu").onclick = showMenu;
document.getElementById("btn-sound").onclick = () => { GS.sound.toggle(); GS.sound.click(); updateHUD(); };

let rt = null;
window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(layout, 120); });
window.addEventListener("orientationchange", () => setTimeout(layout, 250));
document.addEventListener("visibilitychange", () => { if (document.hidden) save(); });
window.addEventListener("pagehide", save);
window.addEventListener("blur", save);   // iOS: pagehide feuert nicht immer zuverlässig
setInterval(save, 15000);

// Browser bitten, den Speicher nicht automatisch zu löschen (iOS/ITP-Eviction)
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

GS.markPlayed("meeri");
storageOK = testStorage();
if (!storageOK) setTimeout(() => toast("⚠️ Fortschritt kann nicht gespeichert werden (Privater Modus?)."), 900);
const had = load();
layout();
if (!had || meeries.length === 0) { if (!had) fresh(); spawnMeeri(0); }
else applyOffline();
updateHUD();
requestAnimationFrame(frame);
howTo(false);
