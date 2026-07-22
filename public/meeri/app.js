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
  { name: "Piraten-Meeri",     prop: "🏴‍☠️", c1: "#6b6f76", c2: "#464b52", desc: "Arrr! Wo ist der Karotten-Schatz?" },
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
// Endgame: Galaxie-Meeries (oberste Stufe) lassen sich zu Kosmos-Stufen (gl)
// weiter verschmelzen — der Münzwert wächst dann pro Kosmos-Stufe weiter.
const coinValM = m => coinVal(m.tier) * (m.tier >= MAXT ? Math.pow(2.6, m.gl || 0) : 1) * variantMult(m.variant);
const effTier = m => m.tier + (m.tier >= MAXT ? (m.gl || 0) : 0);   // für Prestige-Wert

// ---------- Schillernde (seltene) Varianten ----------
const VARIANTS = [
  { id: "gold",    name: "Goldenes",   icon: "🥇", chance: 0.020, mult: 2, glow: "#ffd23f" },
  { id: "ghost",   name: "Geister",    icon: "👻", chance: 0.012, mult: 2, glow: "#bcd0ff" },
  { id: "rainbow", name: "Regenbogen", icon: "🌈", chance: 0.006, mult: 3, glow: "#ff6f91" },
];
const variantDef = id => VARIANTS.find(v => v.id === id) || null;
const variantMult = id => { const v = variantDef(id); return v ? v.mult : 1; };
function rollVariant() { for (const v of VARIANTS) if (Math.random() < v.chance) return v.id; return null; }

// ---------- Wirtschaft ----------
// Balance: etwas flüssigerer Einstieg (schnellere Würfe, mehr Startplatz),
// sanftere Ausbau-Kurve — spätes Spiel bleibt durch Merges/Prestige spannend.
const BUY_BASE = 10, BUY_GROW = 1.18;
const CAP_START = 7, CAP_STEP = 3, CAP_MAXLEVEL = 8;
const EXP_BASE = 80, EXP_GROW = 2.05;
const DROP_MIN = 2.8, DROP_MAX = 5.0;   // Sekunden zwischen Münz-Blasen je Meeri
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

// ---------- Prestige ("Wiese einstampfen") ----------
// Ab Zauber-Meeri (Stufe 5) lohnt sich der Neustart: man tauscht die Wiese
// gegen Goldene Karotten 🥕 ein und gibt sie im Karotten-Shop für dauerhafte
// Perks aus (Münz-Boost, Startkapital, Offline, Auto-Merge, Auto-Kauf).
const PRESTIGE_MIN = 5;                       // erst ab dieser Spitzenstufe möglich
const carrotGain = p => p < PRESTIGE_MIN ? 0 : Math.floor(Math.pow(1.8, p - 4));

// Karotten-Shop (Kosten & Wirkung in Goldenen Karotten)
const PSHOP = [
  { key: "boost",   icon: "🪙", name: "Karotten-Boost",   base: 1,  grow: 1.6, max: 60,
    desc: l => `+${l * 10}% Münzen für immer` },
  { key: "capital", icon: "💰", name: "Startkapital",   base: 2,  grow: 2.0, max: 25,
    desc: l => l ? `Start nach Prestige mit 🪙 ${fmt(startCapital())}` : "aus" },
  { key: "offline", icon: "🌙", name: "Offline-Meister", base: 3, grow: 1.9, max: 15,
    desc: l => `+${l} Std. & +${l * 10}% Offline-Ertrag` },
  { key: "amerge",  icon: "🔀", name: "Auto-Merge",     base: 6,  grow: 2.3, max: 6,
    desc: l => l ? `merged Gleiche alle ${mergeEvery().toFixed(1)}s` : "aus" },
  { key: "abuy",    icon: "🛒", name: "Auto-Kauf",      base: 10, grow: 2.5, max: 6,
    desc: l => l ? `kauft Meeries alle ${buyEvery().toFixed(1)}s` : "aus" },
];
const pCost = u => Math.round(u.base * Math.pow(u.grow, pp[u.key] || 0));
const prestigeMult = () => 1 + (pp.boost || 0) * 0.10;          // Münz-Boost-Perk
const startCapital = () => (pp.capital || 0) > 0 ? Math.floor(100 * Math.pow(3.2, pp.capital)) : 0;
const offlineHours = () => OFFLINE_CAP_H + (pp.offline || 0);
const offlineEff = () => OFFLINE_EFF + (pp.offline || 0) * 0.10;
const mergeEvery = () => Math.max(1.2, 7 - (pp.amerge || 0) * 1.0);
const buyEvery = () => Math.max(0.8, 6 - (pp.abuy || 0) * 0.9);

// ---------- Album-Sammelbonus ----------
const albumBonus = () => 1 + Object.keys(album).length * 0.03;   // +3 % je entdeckter Stufe

// ---------- Biome / Themen-Wiesen ----------
// Jede gekaufte Wiese gibt +5 % Münzen (dauerhaft) und einen eigenen Look.
const BIOMES = [
  { key: "wiese",       icon: "🌱", name: "Frühlingswiese", cost: 0,
    light: ["#5fd07f", "#37b058", "#218a44"], dark: ["#2f6d42", "#215233", "#163a24"], accent: "flowers" },
  { key: "strand",      icon: "🏖️", name: "Sonnenstrand",   cost: 8_000,
    light: ["#ffe6a8", "#ffd27f", "#e9b25a"], dark: ["#6b5a3a", "#4e422a", "#352c1c"], accent: "shells" },
  { key: "dschungel",   icon: "🌴", name: "Dschungel",       cost: 40_000,
    light: ["#4bbf6a", "#2f8a49", "#1c5e32"], dark: ["#1f5230", "#163f26", "#0c2818"], accent: "jungle" },
  { key: "wueste",      icon: "🏜️", name: "Wüste",           cost: 200_000,
    light: ["#ffd98a", "#f0b45a", "#d98a3a"], dark: ["#6a5330", "#4e3d20", "#332714"], accent: "sand" },
  { key: "schnee",      icon: "❄️", name: "Schneeland",      cost: 800_000,
    light: ["#eaf6ff", "#cfe6f7", "#a6cbe6"], dark: ["#3a4a5a", "#2a3846", "#1b2732"], accent: "snow" },
  { key: "vulkan",      icon: "🌋", name: "Vulkan",          cost: 2_000_000,
    light: ["#7a2a1e", "#571a12", "#33100b"], dark: ["#4a1810", "#33100b", "#1c0805"], accent: "embers" },
  { key: "unterwasser", icon: "🐠", name: "Unterwasser",     cost: 12_000_000,
    light: ["#4fc7e8", "#2f9fd0", "#155f9e"], dark: ["#123f5a", "#0c2c44", "#06182a"], accent: "bubbles" },
  { key: "candy",       icon: "🍭", name: "Zuckerland",      cost: 60_000_000,
    light: ["#ffd0ec", "#ff9ecf", "#f56fb0"], dark: ["#5a2b47", "#421f34", "#2c1422"], accent: "candy" },
  { key: "space",       icon: "🌌", name: "Weltraum",        cost: 300_000_000,
    light: ["#3a2b6b", "#241a4a", "#140f2e"], dark: ["#241a4a", "#160f33", "#0a0720"], accent: "stars" },
];
const biomeBonus = () => 1 + Math.max(0, biomesOwned.length - 1) * 0.05;
const biomeDef = () => BIOMES.find(b => b.key === biome) || BIOMES[0];

let eventMult = 1;   // temporärer Multiplikator durch Zufalls-Events
const coinMult = () => (1 + 0.25 * (up.coin || 0)) * prestigeMult() * albumBonus() * biomeBonus() * eventMult;
const magnetDelay = () => (up.magnet || 0) > 0 ? Math.max(0.3, 2.6 - up.magnet * 0.5) : Infinity;
const luckChance = () => Math.min(0.6, (up.luck || 0) * 0.06);

// ---------- Tägliche Aufgaben ----------
const DAILY_POOL = [
  { id: "merge",    icon: "🔀", text: n => `${n}× mergen`,               goal: 15 },
  { id: "buy",      icon: "🐹", text: n => `${n} Meeries kaufen`,        goal: 12 },
  { id: "collect",  icon: "🪙", text: n => `${n} Münz-Blasen sammeln`,   goal: 30 },
  { id: "discover", icon: "📖", text: n => `${n} neue Evolution finden`, goal: 1  },
  { id: "expand",   icon: "🌱", text: n => `Wiese ${n}× vergrößern`,     goal: 1  },
];
const todayStr = () => new Date().toISOString().slice(0, 10);
const dailyReward = () => Math.max(400, Math.round(passivePerSec() * 150));

// ---------- Zustand ----------
const SAVE = "meeri_save_v1";
let coins, meeries, capLevel, buyCount, album, lastSeen, uid, up;
let carrots, peak, biome, biomesOwned, pp, shinies;   // Prestige/Biome/Schillernde (überleben Prestige)
let daily, lastLogin, streak, stats;              // Aufgaben, Login, Statistik
let over = false, hudDirty = false, prestigeSeen = false;

function capacity() { return CAP_START + capLevel * CAP_STEP; }
function buyCost() { return Math.round(BUY_BASE * Math.pow(BUY_GROW, buyCount)); }
function expCost() { return Math.round(EXP_BASE * Math.pow(EXP_GROW, capLevel)); }

function newUp() { return { coin: 0, speed: 0, magnet: 0, luck: 0 }; }
function newPp() { return { boost: 0, capital: 0, offline: 0, amerge: 0, abuy: 0 }; }
function newStats() { return { merges: 0, buys: 0, coins: 0, prestiges: 0, play: 0, bestEff: 0 }; }
function fresh() {
  coins = 0; meeries = []; capLevel = 0; buyCount = 0; album = {}; uid = 1;
  up = newUp(); lastSeen = Date.now();
  carrots = 0; peak = 0; biome = "wiese"; biomesOwned = ["wiese"]; pp = newPp(); shinies = {};
  daily = null; lastLogin = ""; streak = 0; stats = newStats();
}
// Nur die laufende Wiese zurücksetzen — Karotten, Perks, Album, Biome & Aufgaben bleiben.
function resetRun() {
  coins = 0; meeries = []; capLevel = 0; buyCount = 0; uid = 1;
  up = newUp(); peak = 0; lastSeen = Date.now();
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
    carrots = Number(s.carrots) || 0;
    peak = Number(s.peak) || 0;
    biome = typeof s.biome === "string" && BIOMES.some(b => b.key === s.biome) ? s.biome : "wiese";
    biomesOwned = Array.isArray(s.biomesOwned) && s.biomesOwned.length ? s.biomesOwned.filter(k => BIOMES.some(b => b.key === k)) : ["wiese"];
    if (!biomesOwned.includes("wiese")) biomesOwned.unshift("wiese");
    pp = Object.assign(newPp(), s.pp || {});
    shinies = s.shinies || {};
    daily = s.daily || null;
    lastLogin = s.lastLogin || "";
    streak = Number(s.streak) || 0;
    stats = Object.assign(newStats(), s.stats || {});
    meeries = (s.meeries || []).map(m => ({
      id: uid++, tier: Math.max(0, Math.min(MAXT, m.tier | 0)), gl: Math.max(0, m.gl | 0),
      variant: variantDef(m.variant) ? m.variant : null,
      x: m.x || 0.5, y: m.y || 0.5,
      vx: (Math.random() - 0.5), vy: (Math.random() - 0.5),
      phase: Math.random() * 7, nextDrop: rndDrop(), held: false,
    }));
    peak = Math.max(peak, meeries.reduce((a, m) => Math.max(a, effTier(m)), 0));
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
      carrots, peak, biome, biomesOwned, pp, shinies, daily, lastLogin, streak, stats,
      meeries: meeries.map(m => ({ tier: m.tier, gl: m.gl || 0, x: m.x, y: m.y, variant: m.variant || null })),
    }));
    storageOK = true;
  } catch {
    storageOK = false;
    if (!storageWarned) { storageWarned = true; toast("⚠️ Speichern nicht möglich (Privater Modus?) — Fortschritt geht beim Schließen verloren."); }
  }
}
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(save, 600); }

const rndDrop = () => (DROP_MIN + Math.random() * (DROP_MAX - DROP_MIN)) / (1 + 0.12 * (up ? up.speed : 0));

// ---------- Tägliche Aufgaben & Login ----------
function rollDaily() {
  const pool = DAILY_POOL.slice();
  const pick = [];
  for (let i = 0; i < 3 && pool.length; i++) pick.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  daily = { day: todayStr(), tasks: pick.map(p => ({ id: p.id, goal: p.goal, prog: 0, claimed: false })) };
}
// Beim Start & Tageswechsel: Aufgaben erneuern + Login-Bonus geben.
function ensureDaily(popup) {
  const today = todayStr();
  if (!daily || daily.day !== today) rollDaily();
  if (lastLogin !== today) {
    const gap = lastLogin ? (Date.parse(today) - Date.parse(lastLogin)) / 864e5 : 99;
    streak = gap === 1 ? streak + 1 : 1;
    lastLogin = today;
    const bonus = Math.max(500, Math.round(passivePerSec() * 200 * (1 + streak * 0.15)));
    const carrotB = streak % 5 === 0 ? Math.max(1, Math.floor(streak / 5)) : 0;
    coins += bonus; carrots += carrotB; stats.coins += bonus;
    save(); checkBadges();
    if (popup) setTimeout(() => loginPopup(bonus, carrotB), 500);
  }
}
function taskDef(id) { return DAILY_POOL.find(t => t.id === id); }
function dailyClaimable() { return !!(daily && daily.tasks.some(t => t.prog >= t.goal && !t.claimed)); }
function dailyTick(id, n) {
  if (!daily) return;
  const t = daily.tasks.find(x => x.id === id);
  if (!t || t.claimed || t.prog >= t.goal) return;
  t.prog = Math.min(t.goal, t.prog + n);
  if (t.prog >= t.goal) { GS.sound.good(); toast(`✅ Aufgabe fertig: ${taskDef(id).text(t.goal)} — abholen!`); }
  hudDirty = true; saveSoon();
}

// ---------- Statistik ----------
function earn(n) { coins += n; stats.coins += n; }

// ---------- Meeri-Verwaltung ----------
function discover(tier) {
  if (!album[tier]) {
    album[tier] = new Date().toISOString();
    GS.sound.great();
    dailyTick("discover", 1);
    if (tier >= 2) setTimeout(() => reveal(tier, true), 120);   // cooles Meeri → große Karte
    else toast(`📖 Neu im Album: ${TIERS[tier].name}!`);
    checkBadges(); saveSoon();
  }
}
function spawnMeeri(tier, x, y, variant) {
  const m = {
    id: uid++, tier, gl: 0, variant: variant || null,
    x: x ?? (0.2 + Math.random() * 0.6), y: y ?? (0.2 + Math.random() * 0.6),
    vx: (Math.random() - 0.5), vy: (Math.random() - 0.5),
    phase: Math.random() * 7, nextDrop: rndDrop(), held: false, pop: 0.001,
  };
  meeries.push(m);
  if (tier > peak) peak = tier;
  discover(tier);
  if (m.variant) discoverShiny(m.variant);
  return m;
}
function discoverShiny(id) {
  if (shinies[id]) return;
  shinies[id] = new Date().toISOString();
  const v = variantDef(id);
  GS.sound.win(); GS.haptic([12, 40, 12]);
  toast(`${v.icon} SCHILLERND! Ein ${v.name} Meeri entdeckt!`);
  checkBadges(); saveSoon();
}
function buyMeeri(silent) {
  if (over) return false;
  if (meeries.length >= capacity()) { if (!silent) toast("Wiese voll — vergrößern oder mergen!"); return false; }
  const c = buyCost();
  if (coins < c) { if (!silent) toast("Zu wenig Münzen"); return false; }
  coins -= c; buyCount++;
  if (stats) stats.buys++;
  const startTier = (Math.random() < luckChance()) ? 1 : 0;   // Glücks-Wurf
  const m = spawnMeeri(startTier, undefined, undefined, rollVariant());
  if (startTier > 0) { floater("🍀", "#57e39b", m.x, m.y); GS.sound.good(); } else if (!silent) GS.sound.click();
  if (!silent) GS.haptic(8);
  dailyTick("buy", 1);
  updateHUD(); saveSoon();
  return true;
}
function expandMeadow() {
  if (capLevel >= CAP_MAXLEVEL) { toast("Wiese ist schon riesig!"); return; }
  const c = expCost();
  if (coins < c) { toast("Zu wenig Münzen"); return; }
  coins -= c; capLevel++;
  GS.sound.good(); GS.haptic([10, 30]); burst("PLATZ!", "#57e39b");
  dailyTick("expand", 1);
  updateHUD(); saveSoon();
}
function mergeInto(target, src) {
  const endgame = target.tier >= MAXT;
  if (endgame) { target.gl = (target.gl || 0) + 1; }   // Kosmos-Stufe hoch
  else { target.tier++; }
  target.pop = 0.001;
  if (!target.variant && src.variant) { target.variant = src.variant; discoverShiny(src.variant); }  // Schillern vererben
  meeries = meeries.filter(m => m.id !== src.id);
  peak = Math.max(peak, effTier(target));
  if (stats) { stats.merges++; stats.bestEff = Math.max(stats.bestEff, effTier(target)); }
  const bonus = Math.round(coinValM(target) * 3 * coinMult());   // Merge-Bonus
  earn(bonus);
  if (!endgame) discover(target.tier);
  burst(endgame ? `KOSMOS Lv.${target.gl}!` : (target.tier >= MAXT ? "GALAXIE!" : "EVOLVE!"), endgame ? "#b892ff" : "#ffd23f");
  floater("+" + fmt(bonus), "#ffd23f", target.x, target.y);
  spawnConfetti(target.x, target.y, endgame ? "#b892ff" : TIERS[target.tier].c1);
  shake(target.tier >= 8 ? 8 : 4);   // Kamerawackeln, stärker bei High-Tier
  if (target.tier >= 6 || endgame) flash(0.35);   // Aufblitzen bei größeren Evolutionen
  pulseCoins();
  dailyTick("merge", 1);
  if (endgame) { GS.sound.win(); toast(`🌌 Kosmos-Stufe ${target.gl}! Galaxie-Meeri wird noch mächtiger.`); }
  GS.sound.great(); GS.haptic([12, 40, 12]);
  checkBadges();
  updateHUD(); saveSoon();
  return true;
}

// Auto-Merge: erstes Paar gleicher Meeries (Stufe + Kosmos) verschmelzen
function autoMergePair() {
  for (let i = 0; i < meeries.length; i++) {
    const a = meeries[i]; if (a.held) continue;
    for (let j = i + 1; j < meeries.length; j++) {
      const b = meeries[j]; if (b.held) continue;
      if (a.tier === b.tier && (a.gl || 0) === (b.gl || 0)) { mergeInto(a, b); return; }
    }
  }
}

// ---------- Prestige ----------
function doPrestige() {
  const gain = carrotGain(peak);
  if (gain <= 0) return;
  carrots += gain;
  if (stats) stats.prestiges++;
  prestigeSeen = false;   // nach erneutem Aufstieg wieder auf Prestige hinweisen
  resetRun();
  coins = startCapital();          // Startkapital-Perk
  spawnMeeri(0);
  burst("EINGESTAMPFT!", "#ff9c3d"); shake(10);
  GS.sound.win(); GS.haptic([15, 50, 15, 50]);
  checkBadges();
  updateHUD(); save();
  toast(`🥕 +${gain} Goldene Karotten! Gib sie im Karotten-Shop aus.`);
}

// ---------- Offline-Einnahmen ----------
function passivePerSec() {
  let s = 0;
  const interval = ((DROP_MIN + DROP_MAX) / 2) / (1 + 0.12 * (up ? up.speed : 0));
  for (const m of meeries) s += coinValM(m) / interval;
  return s * coinMult();
}
function applyOffline() {
  const elapsed = Math.max(0, (Date.now() - lastSeen) / 1000);
  if (elapsed < 30 || !meeries.length) return;
  const capSec = offlineHours() * 3600;
  const rate = passivePerSec() * offlineEff();
  const gain = Math.floor(rate * Math.min(elapsed, capSec));
  if (gain <= 0) return;
  earn(gain);
  const mins = Math.floor(Math.min(elapsed, capSec) / 60);
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

function drawMeeri(g, cx, cy, s, tier, t, pop, gl, variant, m) {
  gl = gl || 0;
  const T = TIERS[tier];
  const vd = variantDef(variant);
  const sc = pop > 0 ? 1 + Math.sin(Math.min(1, pop) * Math.PI) * 0.25 : 1;
  // Lauf-Animation aus Meeri-Daten (falls vorhanden)
  const step = m ? (m.step || 0) : 0;
  const moving = m ? m.moving : false;
  const tilt = m ? (m.tilt || 0) : 0;
  const hop = moving ? Math.abs(Math.sin(step)) : 0;          // Hüpfen beim Laufen
  const breathe = moving ? 0 : Math.sin(t * 2.4) * 0.02;      // sanftes Atmen im Stand
  const wob = Math.sin(t * 4 + tier) * s * 0.015;
  const sqx = 1 + (moving ? (1 - hop) * 0.06 : 0) + breathe;  // Squash & Stretch
  const sqy = 1 - (moving ? (1 - hop) * 0.06 : 0) - breathe;
  const face = m ? (m.face || 1) : 1;
  const blink = m ? (((t * 0.6 + (m.id || 0) * 1.7) % 3.4) < 0.12) : false;
  g.save();
  g.translate(cx, cy + wob - hop * s * 0.14);
  g.rotate(tilt);
  g.scale(sc * sqx, sc * sqy);
  const lw = Math.max(2, s * 0.07);
  g.lineWidth = lw; g.strokeStyle = "#123018"; g.lineJoin = "round"; g.lineCap = "round";

  // Aura bei hohen Stufen (Kosmos-Stufen leuchten stärker)
  if (tier >= 9) {
    const glow = g.createRadialGradient(0, 0, s * 0.2, 0, 0, s * (0.78 + Math.min(gl, 6) * 0.05));
    const gc = tier >= 15 ? "rgba(184,146,255,0.6)" : tier >= 12 ? "rgba(122,167,255,0.5)" : "rgba(255,210,63,0.5)";
    glow.addColorStop(0, gc); glow.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = glow; g.beginPath(); g.arc(0, 0, s * (0.78 + Math.min(gl, 6) * 0.05), 0, 7); g.fill();
  }

  // Schillernder Glüh-Ring (seltene Variante)
  if (vd) {
    const pr = 0.6 + 0.4 * Math.sin(t * 4);
    g.save();
    if (variant === "rainbow") {
      const rg = g.createLinearGradient(-s * 0.5, 0, s * 0.5, 0);
      rg.addColorStop(0, "#ff5a8a"); rg.addColorStop(0.5, "#ffd23f"); rg.addColorStop(1, "#57e39b");
      g.strokeStyle = rg;
    } else g.strokeStyle = vd.glow;
    g.globalAlpha = 0.5 + pr * 0.4; g.lineWidth = s * 0.06;
    g.beginPath(); g.arc(0, 0, s * 0.52, 0, 7); g.stroke();
    g.restore();
    if (variant === "ghost") { g.globalAlpha = 0.75; }   // Geister leicht transparent
  }

  // Schatten (bleibt am Boden, dreht nicht mit)
  g.save(); g.fillStyle = "rgba(0,0,0,0.18)";
  g.beginPath(); g.ellipse(0, s * 0.5, s * 0.42 * (1 - hop * 0.25), s * 0.12 * (1 - hop * 0.3), 0, 0, 7); g.fill(); g.restore();

  // ===== Kreatur (spiegelt sich in Blickrichtung) =====
  g.save();
  g.scale(face, 1);
  g.lineWidth = lw; g.strokeStyle = "#123018";

  // Rücken-Deko (Umhang, Flügel) HINTER dem Körper
  featBack(g, s, tier, t, T);

  // Beine + Füße (schwingen abwechselnd beim Laufen)
  const fLx = -s * 0.18 + (moving ? Math.cos(step) * s * 0.08 : 0);
  const fRx = s * 0.18 + (moving ? Math.cos(step + Math.PI) * s * 0.08 : 0);
  const fLy = s * 0.44 - (moving ? Math.max(0, Math.sin(step)) * s * 0.12 : 0);
  const fRy = s * 0.44 - (moving ? Math.max(0, Math.sin(step + Math.PI)) * s * 0.12 : 0);
  const drawLeg = (hx, fx, fy) => {
    g.strokeStyle = "#123018"; g.lineWidth = s * 0.12; g.beginPath(); g.moveTo(hx, s * 0.26); g.lineTo(fx, fy); g.stroke();
    g.strokeStyle = T.c2; g.lineWidth = s * 0.07; g.beginPath(); g.moveTo(hx, s * 0.26); g.lineTo(fx, fy); g.stroke();
    g.strokeStyle = "#123018"; g.lineWidth = lw;
    g.fillStyle = T.c2; g.beginPath(); g.ellipse(fx, fy, s * 0.1, s * 0.07, 0, 0, 7); fst(g);
  };
  drawLeg(-s * 0.16, fLx, fLy);
  drawLeg(s * 0.16, fRx, fRy);

  // Ohren (flattern beim Hüpfen)
  const earFlop = (moving ? Math.sin(step) : Math.sin(t * 2.4)) * 0.18;
  const drawEar = (ex, rot) => {
    g.save(); g.translate(ex, -s * 0.24); g.rotate(rot);
    g.fillStyle = T.c2; g.beginPath(); g.ellipse(0, -s * 0.06, s * 0.14, s * 0.12, 0, 0, 7); fst(g);
    g.fillStyle = "rgba(255,150,170,0.5)"; g.beginPath(); g.ellipse(0, -s * 0.05, s * 0.07, s * 0.07, 0, 0, 7); g.fill();
    g.restore();
  };
  g.fillStyle = T.c2; g.strokeStyle = "#123018"; g.lineWidth = lw;
  drawEar(-s * 0.3, -earFlop);
  drawEar(s * 0.3, earFlop);

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

  drawFace(g, s, tier, t, blink);
  featFront(g, s, tier, t, T);
  g.restore();   // Ende Blickrichtungs-Spiegelung

  // Schillern-Symbol
  if (vd) {
    g.globalAlpha = 1;
    g.font = `${Math.round(s * 0.34)}px "Segoe UI Emoji","Apple Color Emoji",sans-serif`;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(vd.icon, -s * 0.34, -s * 0.34);
  }

  // Kosmos-Stufe (Endgame): Sternen-Badge mit Nummer
  if (gl > 0) {
    for (let i = 0; i < 3; i++) { const a = t * 2 + i * 2.1; g.fillStyle = "#fff"; starP(g, Math.cos(a) * s * 0.5, -s * 0.4 + Math.sin(a) * s * 0.15, s * 0.05, 4, 0.4); g.fill(); }
    g.save();
    g.fillStyle = "#2a1a4a"; g.strokeStyle = "#b892ff"; g.lineWidth = Math.max(1.5, s * 0.03);
    rrp(g, -s * 0.3, s * 0.32, s * 0.6, s * 0.2, s * 0.08); fst(g);
    g.fillStyle = "#fff"; g.font = `900 ${s * 0.16}px ${uiFont()}`; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("✦ " + gl, 0, s * 0.43);
    g.restore();
  }
  g.restore();
}

// Gesicht mit stufenspezifischem Ausdruck
function drawFace(g, s, tier, t, blink) {
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
    if (blink) {   // geschlossenes Auge (Blinzeln)
      g.strokeStyle = "#123018"; g.lineWidth = Math.max(2, s * 0.03);
      g.beginPath(); g.arc(ex, eyeY, er, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
      continue;
    }
    g.fillStyle = "#fff"; g.beginPath(); g.arc(ex, eyeY, er, 0, 7); g.fill();
    g.lineWidth = Math.max(1, s * 0.02); g.strokeStyle = "#123018"; g.stroke();
    g.fillStyle = (tier === 5 || tier === 15) ? "#2a1a4a" : "#123018";
    g.beginPath(); g.arc(ex + s * 0.02, eyeY + s * 0.02, er * 0.5, 0, 7); g.fill();
    g.fillStyle = "#fff"; g.beginPath(); g.arc(ex, eyeY - s * 0.01, er * 0.2, 0, 7); g.fill();
  }
  if (!blink && (tier === 5 || tier === 15)) { // Glüh-Augen
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
let shakeMag = 0, flashT = 0;
function shake(m) { shakeMag = Math.max(shakeMag, m); }
function flash(a) { flashT = Math.max(flashT, a); }
function pulseCoins() {
  const el = document.getElementById("coins");
  if (!el) return;
  el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump");
}
function spawnCoin(m) {
  coinsFx.push({ x: mx(m), y: my(m) - msize * 0.5, val: Math.round(coinValM(m) * coinMult()), t: 0, life: 5.5, vy: -12 - Math.random() * 8, r: msize * 0.28 });
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

// ---------- Zufalls-Events ----------
let eventT = 75, eventMultT = 0;
function fireEvent() {
  if (!meeries.length) return;
  const kinds = ["feast", "double", "lucky"];
  const kind = kinds[Math.floor(Math.random() * kinds.length)];
  if (kind === "feast") {
    burst("FUTTER-REGEN!", "#57e39b"); toast("🌽 Futter-Regen — sammle die Münzen ein!");
    const val = Math.max(5, Math.round(passivePerSec() * 2.5) || 5);
    // Münzen direkt auf der Wiese verteilen (antippbar / vom Auto-Sammler einsammelbar)
    for (let i = 0; i < 16; i++) coinsFx.push({ x: (0.12 + Math.random() * 0.76) * W, y: (0.18 + Math.random() * 0.6) * H, val, t: 0, life: 7, vy: -6 - Math.random() * 8, r: msize * 0.24 });
  } else if (kind === "double") {
    eventMult = 2; eventMultT = 30;
    burst("DOPPEL-MÜNZEN!", "#ffd23f"); toast("✨ 30 Sek. doppelte Münzen!");
  } else {
    const t = Math.max(0, Math.min(MAXT, topTier() - 1));
    if (meeries.length < capacity()) { const m = spawnMeeri(t, undefined, undefined, rollVariant()); floater("GRATIS!", "#57e39b", m.x, m.y); }
    else earn(Math.round(passivePerSec() * 30) + 50);
    burst("WILDES MEERI!", "#8be79a"); toast("🐹 Ein wildes Meeri gesellt sich dazu!");
  }
  GS.sound.great(); GS.haptic([10, 30, 10]);
}

// ---------- Loop ----------
let lastT = 0, animT = 0, goldTimer = 8, autoMergeT = 0, autoBuyT = 0, playAcc = 0;
function frame(ts) {
  const dt = Math.min(0.05, (ts - lastT) / 1000 || 0); lastT = ts; animT += dt;

  if (!over) {
    // Meeries bewegen + Münzen abwerfen
    for (const m of meeries) {
      if (m.pop) { m.pop += dt * 2.2; if (m.pop >= 1) m.pop = 0; }
      // Lauf-Animation: Schritt-Zyklus, Bewegungsstatus, Neigung
      const sp = Math.hypot(m.vx, m.vy);
      m.moving = !m.held && sp > 0.06;
      m.step = (m.step || 0) + (m.moving ? sp * dt * 11 : dt * 2);
      const tgtTilt = m.held ? 0 : (m.moving ? Math.max(-0.2, Math.min(0.2, m.vx * 0.38)) : 0);
      m.tilt = (m.tilt || 0) + (tgtTilt - (m.tilt || 0)) * Math.min(1, dt * 6);
      if (!m.face) m.face = 1;
      if (!m.held && Math.abs(m.vx) > 0.08) m.face = m.vx < 0 ? -1 : 1;   // Blickrichtung
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
    // Zufalls-Events
    eventT -= dt;
    if (eventT <= 0) { eventT = 90 + Math.random() * 90; fireEvent(); }
    if (eventMultT > 0) { eventMultT -= dt; if (eventMultT <= 0) { eventMult = 1; hudDirty = true; } }
    // Spielzeit-Statistik
    playAcc += dt; if (playAcc >= 1 && stats) { stats.play += Math.floor(playAcc); playAcc -= Math.floor(playAcc); }
    // Auto-Merge-Perk: gleiche Meeries automatisch verschmelzen
    if ((pp.amerge || 0) > 0) {
      autoMergeT -= dt;
      if (autoMergeT <= 0) { autoMergeT = mergeEvery(); autoMergePair(); }
    }
    // Auto-Kauf-Perk: Meeries automatisch nachkaufen
    if ((pp.abuy || 0) > 0) {
      autoBuyT -= dt;
      if (autoBuyT <= 0) { autoBuyT = buyEvery(); if (meeries.length < capacity() && coins >= buyCost()) buyMeeri(true); }
    }
  }

  // Auto-Sammler: Münz-Blasen nach kurzer Zeit von selbst einsammeln
  if (!over && (up.magnet || 0) > 0) {
    const md = magnetDelay();
    for (let i = coinsFx.length - 1; i >= 0; i--) {
      const c = coinsFx[i];
      if (c.t >= md) { earn(c.val); dailyTick("collect", 1); if (floaters.length < 3) floater("+" + fmt(c.val), "#ffd23f", null, null); coinsFx.splice(i, 1); hudDirty = true; }
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
  if (shakeMag > 0) { shakeMag = Math.max(0, shakeMag - dt * 40); }
  if (flashT > 0) { flashT = Math.max(0, flashT - dt * 1.2); }

  if (hudDirty) { updateHUD(); hudDirty = false; }
  draw();
  requestAnimationFrame(frame);
}

function draw() {
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  if (shakeMag > 0.3) ctx.translate((Math.random() - 0.5) * shakeMag, (Math.random() - 0.5) * shakeMag);
  const light = document.documentElement.dataset.theme !== "dark";
  const B = biomeDef();
  const pal = light ? B.light : B.dark;
  // Boden (biome- & theme-abhängig)
  roundRect(1.5, 1.5, W - 3, H - 3, 16);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, pal[0]); g.addColorStop(0.55, pal[1]); g.addColorStop(1, pal[2]);
  ctx.fillStyle = g; ctx.fill(); ctx.lineWidth = 3.5; ctx.strokeStyle = "#123018"; ctx.stroke();
  ctx.save(); roundRect(1.5, 1.5, W - 3, H - 3, 16); ctx.clip();
  // Licht von oben
  const sun = ctx.createRadialGradient(W * 0.3, H * 0.12, 0, W * 0.3, H * 0.12, W * 0.65);
  const sunA = light ? 0.18 : 0.1;
  sun.addColorStop(0, `rgba(255,255,255,${sunA})`); sun.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sun; ctx.fillRect(0, 0, W, H);
  drawBiomeDeco(B.accent, light);
  // Vignette unten für Tiefe
  const vg = ctx.createLinearGradient(0, H * 0.62, 0, H);
  vg.addColorStop(0, "rgba(0,20,12,0)"); vg.addColorStop(1, light ? "rgba(0,30,15,0.2)" : "rgba(0,10,6,0.42)");
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // Merge-Highlight: passende Partner leuchten, wenn man ein Meeri hält
  if (drag) {
    for (const m of meeries) {
      if (m.id === drag.id || m.tier !== drag.tier || (m.gl || 0) !== (drag.gl || 0)) continue;
      const pulse = 0.5 + 0.5 * Math.sin(animT * 8);
      ctx.save(); ctx.globalAlpha = 0.5 + pulse * 0.4;
      ctx.strokeStyle = "#ffe066"; ctx.lineWidth = 3 + pulse * 2;
      ctx.beginPath(); ctx.arc(mx(m), my(m), msize * (0.58 + pulse * 0.06), 0, 7); ctx.stroke();
      ctx.restore();
    }
  }

  // Meeries (nach y sortiert für Tiefe)
  const sorted = [...meeries].sort((a, b) => (a.held ? 1 : 0) - (b.held ? 1 : 0) || my(a) - my(b));
  for (const m of sorted) drawMeeri(ctx, mx(m), my(m), msize, m.tier, animT + m.phase, m.pop, m.gl || 0, m.variant, m);

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
  if (flashT > 0.01) { ctx.save(); ctx.globalAlpha = Math.min(0.6, flashT); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H); ctx.restore(); }
  ctx.restore();   // Shake-Wrapper schließen
}

// Biome-spezifische Deko im Hintergrund (deterministisch platziert)
function drawBiomeDeco(accent, light) {
  if (accent === "flowers") {
    ctx.strokeStyle = light ? "rgba(255,255,255,0.11)" : "rgba(255,255,255,0.07)"; ctx.lineWidth = 2; ctx.lineCap = "round";
    for (let i = 0; i < 16; i++) {
      const gx = ((i * 137) % 100) / 100 * W, gy = ((i * 79) % 100) / 100 * H;
      ctx.beginPath(); ctx.moveTo(gx, gy); ctx.lineTo(gx - 4, gy - 9); ctx.moveTo(gx, gy); ctx.lineTo(gx, gy - 12); ctx.moveTo(gx, gy); ctx.lineTo(gx + 4, gy - 9); ctx.stroke();
    }
    const fcol = ["#ff6f91", "#ffd23f", "#ffffff", "#b892ff"];
    for (let i = 0; i < 7; i++) {
      const fx = ((i * 173 + 40) % 100) / 100 * W, fy = ((i * 111 + 66) % 100) / 100 * H;
      ctx.fillStyle = fcol[i % fcol.length];
      for (let p = 0; p < 5; p++) { const a = p / 5 * Math.PI * 2; ctx.beginPath(); ctx.arc(fx + Math.cos(a) * 4.2, fy + Math.sin(a) * 4.2, 2.7, 0, 7); ctx.fill(); }
      ctx.fillStyle = "#ffd23f"; ctx.beginPath(); ctx.arc(fx, fy, 2.4, 0, 7); ctx.fill();
    }
  } else if (accent === "shells") {
    // Muscheln + Wellenlinien am Strand
    ctx.strokeStyle = "rgba(255,255,255,0.18)"; ctx.lineWidth = 2.5;
    for (let i = 0; i < 4; i++) {
      const wy = H * (0.75 + i * 0.05);
      ctx.beginPath();
      for (let x = 0; x <= W; x += 12) { const yy = wy + Math.sin(x * 0.05 + i) * 4; x ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy); }
      ctx.stroke();
    }
    for (let i = 0; i < 6; i++) {
      const sx = ((i * 151 + 30) % 100) / 100 * W, sy = ((i * 97 + 50) % 100) / 100 * H * 0.7;
      ctx.fillStyle = i % 2 ? "#ff9aa8" : "#fff3d6"; ctx.strokeStyle = "rgba(120,80,40,0.5)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx, sy, 5, Math.PI, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
    }
  } else if (accent === "stars") {
    for (let i = 0; i < 40; i++) {
      const sx = ((i * 149) % 100) / 100 * W, sy = ((i * 83) % 100) / 100 * H;
      const tw = 0.4 + 0.6 * Math.abs(Math.sin(animT * 2 + i));
      ctx.globalAlpha = tw; ctx.fillStyle = i % 7 === 0 ? "#ffd6f5" : "#ffffff";
      ctx.beginPath(); ctx.arc(sx, sy, i % 5 === 0 ? 1.8 : 1, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // ferner Planet
    ctx.fillStyle = "rgba(180,146,255,0.5)"; ctx.beginPath(); ctx.arc(W * 0.78, H * 0.2, 16, 0, 7); ctx.fill();
  } else if (accent === "embers") {
    // aufsteigende Glut-Funken
    for (let i = 0; i < 22; i++) {
      const ex = ((i * 127) % 100) / 100 * W;
      const ey = H - ((animT * 40 + i * 60) % (H * 0.9));
      ctx.globalAlpha = 0.4 + 0.5 * Math.abs(Math.sin(animT * 3 + i));
      ctx.fillStyle = i % 3 === 0 ? "#ffd23f" : "#ff7a2d";
      ctx.beginPath(); ctx.arc(ex, ey, 1.6, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Glut am Boden
    const gl = ctx.createLinearGradient(0, H, 0, H * 0.7);
    gl.addColorStop(0, "rgba(255,90,20,0.35)"); gl.addColorStop(1, "rgba(255,90,20,0)");
    ctx.fillStyle = gl; ctx.fillRect(0, 0, W, H);
  } else if (accent === "jungle") {
    // schwebende Blätter, die herabsinken und pendeln
    for (let i = 0; i < 14; i++) {
      const lx = ((i * 113) % 100) / 100 * W + Math.sin(animT * 0.8 + i) * 16;
      const ly = ((animT * 22 + i * 47) % (H + 30)) - 15;
      ctx.save(); ctx.translate(lx, ly); ctx.rotate(Math.sin(animT + i) * 0.6);
      ctx.fillStyle = i % 2 ? "rgba(60,180,90,0.5)" : "rgba(40,140,70,0.5)";
      ctx.beginPath(); ctx.ellipse(0, 0, 7, 3, 0, 0, 7); ctx.fill(); ctx.restore();
    }
  } else if (accent === "sand") {
    // Sand-Rippel + Kakteen
    ctx.strokeStyle = "rgba(200,150,80,0.35)"; ctx.lineWidth = 2;
    for (let i = 1; i < 5; i++) { ctx.beginPath(); for (let x = 0; x <= W; x += 12) { const yy = H * (0.55 + i * 0.1) + Math.sin(x * 0.04 + i) * 4; x ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy); } ctx.stroke(); }
    const cactus = (x, y, h) => { ctx.fillStyle = "#3f9e5a"; ctx.strokeStyle = "#123018"; ctx.lineWidth = 1.5; rrpc(x - 3, y - h, 6, h, 3); ctx.fill(); ctx.stroke(); rrpc(x - 3, y - h * 0.6, -8, 5, 2.5); ctx.fill(); ctx.stroke(); rrpc(x + 3, y - h * 0.75, 8, 5, 2.5); ctx.fill(); ctx.stroke(); };
    cactus(W * 0.2, H * 0.8, 26); cactus(W * 0.78, H * 0.7, 20);
  } else if (accent === "snow") {
    // Schneeflocken
    for (let i = 0; i < 26; i++) {
      const sx = ((i * 97) % 100) / 100 * W + Math.sin(animT * 1.2 + i) * 10;
      const sy = ((animT * 26 + i * 41) % (H + 20)) - 10;
      ctx.globalAlpha = 0.8; ctx.fillStyle = "#fff";
      ctx.beginPath(); ctx.arc(sx, sy, i % 4 === 0 ? 2.4 : 1.5, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
  } else if (accent === "bubbles") {
    // aufsteigende Luftblasen + Algen
    ctx.strokeStyle = "rgba(40,160,90,0.5)"; ctx.lineWidth = 4; ctx.lineCap = "round";
    for (const bx of [W * 0.15, W * 0.85]) { ctx.beginPath(); ctx.moveTo(bx, H); for (let y = H; y > H * 0.55; y -= 10) ctx.lineTo(bx + Math.sin(y * 0.05 + animT * 2) * 8, y); ctx.stroke(); }
    for (let i = 0; i < 16; i++) {
      const bx = ((i * 131) % 100) / 100 * W + Math.sin(animT + i) * 6;
      const by = H - ((animT * 30 + i * 53) % (H + 20));
      ctx.globalAlpha = 0.5; ctx.strokeStyle = "rgba(255,255,255,0.8)"; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(bx, by, 2 + (i % 3), 0, 7); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  } else if (accent === "candy") {
    // schwebende Zuckerstreusel
    const cc = ["#ff6f91", "#ffd23f", "#7ad1ff", "#b892ff", "#fff"];
    for (let i = 0; i < 22; i++) {
      const cx2 = ((i * 107) % 100) / 100 * W + Math.sin(animT + i) * 8;
      const cy2 = ((animT * 16 + i * 45) % (H + 20)) - 10;
      ctx.save(); ctx.translate(cx2, cy2); ctx.rotate(i + animT);
      ctx.fillStyle = cc[i % cc.length]; rrpc(-4, -1.5, 8, 3, 1.5); ctx.fill(); ctx.restore();
    }
  }
}
// kleiner Rechteck-Pfad-Helfer für Deko (ctx)
function rrpc(x, y, w, h, r) {
  if (w < 0) { x += w; w = -w; }
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
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
      earn(bonus); golds = golds.filter(z => z !== gg);
      floater("+" + fmt(bonus), "#ffd23f", null, null); burst("BONUS!", "#ffd23f");
      flash(0.25); pulseCoins();
      GS.sound.win(); GS.haptic([10, 30, 10]); updateHUD(); saveSoon(); return;
    }
  }
  // Münz-Blase einsammeln
  for (let i = coinsFx.length - 1; i >= 0; i--) {
    const c = coinsFx[i];
    if (Math.hypot(x - c.x, y - c.y) < c.r + 8) {
      earn(c.val); coinsFx.splice(i, 1); dailyTick("collect", 1);
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
    if (m.id === d.id || m.tier !== d.tier || (m.gl || 0) !== (d.gl || 0)) continue;
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
const NUM_SUFFIX = ["", "k", "M", "B", "T", "Qa", "Qi", "Sx", "Sp", "Oc", "No", "Dc"];
function fmt(n) {
  n = Math.floor(n);
  if (n < 1000) return String(n);
  const tier = Math.floor(Math.log10(Math.abs(n)) / 3);
  if (tier >= NUM_SUFFIX.length) return n.toExponential(2).replace("+", "");
  const scaled = n / Math.pow(10, tier * 3);
  return scaled.toFixed(scaled < 10 ? 2 : scaled < 100 ? 1 : 0) + NUM_SUFFIX[tier];
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
  // Karotten-Chip
  const chip = document.getElementById("carrots-chip");
  if (chip) { if (carrots > 0) { chip.hidden = false; document.getElementById("carrots").textContent = fmt(carrots); } else chip.hidden = true; }
  // Menü-Punkt, wenn eine Tagesaufgabe abholbereit ODER Prestige möglich ist
  const mb = document.getElementById("btn-menu");
  if (mb) mb.classList.toggle("has-dot", dailyClaimable() || (carrotGain(peak) > 0 && !prestigeSeen));
  // Sanfte Einstiegs-Tipps (je einmal)
  if (coins >= 50 && !(up.coin || up.speed || up.magnet || up.luck)) hint("shop", "🛒 Genug Münzen für dein erstes Upgrade — schau in den Shop!");
  if (peak >= PRESTIGE_MIN) hint("prestige", "🥕 Prestige ist jetzt verfügbar (Menü → Fortschritt): Wiese einstampfen für dauerhafte Boni!");
}

// Einmaliger Kontext-Tipp (pro Schlüssel nur einmal gezeigt)
function hint(key, msg) {
  const k = "meeri_hint_" + key;
  try { if (localStorage.getItem(k)) return; localStorage.setItem(k, "1"); } catch (_) {}
  toast(msg);
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
    const inner = got
      ? `<span class="album-dot" style="background:${T.c1}"><canvas class="album-cv" data-tier="${i}"></canvas><span class="lvl">${i + 1}</span></span>`
      : `<span class="album-dot" style="background:#c9c9c9">❓<span class="lvl">${i + 1}</span></span>`;
    return `<div class="album-cell ${got ? "" : "locked"}" ${got ? `data-tier="${i}" role="button" tabindex="0"` : ""}>
      ${inner}
      <span class="album-name">${got ? esc(T.name) : "???"}</span>
      <span class="album-desc">${got ? esc(T.desc) : "noch nicht entdeckt"}</span>
    </div>`;
  }).join("");
  const ov = mkOverlay(`
    <h2><span class="foil">Meeri-Album</span></h2>
    <p class="sub">${found}/${TIERS.length} entdeckt · tippe ein Meeri zum Angeben 📤</p>
    <div class="bonus-line">📖 Sammelbonus: <b>+${Math.round((albumBonus() - 1) * 100)}% Münzen</b> <span class="dim">(+3% je Stufe)</span></div>
    <div class="bonus-line">✨ Schillernd: <b>${Object.keys(shinies).length}/${VARIANTS.length}</b> <span class="dim">${VARIANTS.map(v => shinies[v.id] ? v.icon : "▫️").join(" ")}</span></div>
    <div class="album-grid">${cells}</div>
    <button class="btn-secondary" data-close="1">Schließen</button>`);
  ov.querySelectorAll(".album-cell[data-tier]").forEach(el => el.onclick = () => reveal(Number(el.dataset.tier), false));
  ov.querySelector("[data-close]").onclick = () => ov.remove();
  // Animierte Album-Meeris (laufen fröhlich auf der Stelle)
  const S = 52, dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const cvs = [...ov.querySelectorAll(".album-cv")].map(c => {
    c.width = S * dpr; c.height = S * dpr; c.style.width = S + "px"; c.style.height = S + "px";
    const g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { g, tier: Number(c.dataset.tier), node: c, ph: Math.random() * 7 };
  });
  if (cvs.length) {
    const tick = () => {
      if (!document.body.contains(cvs[0].node)) return;
      const t = performance.now() / 1000;
      for (const c of cvs) {
        c.g.clearRect(0, 0, S, S);
        const anim = { step: t * 6 + c.ph, moving: true, tilt: Math.sin(t * 2.5 + c.ph) * 0.06, face: 1, id: c.tier };
        drawMeeri(c.g, S / 2, S * 0.6, 34, c.tier, t + c.ph, 0, 0, null, anim);
      }
      requestAnimationFrame(tick);
    };
    tick();
  }
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
  // Animierter, laufender Meeri (dreht sich ab und zu um)
  const tick = () => {
    if (!document.body.contains(cv)) return;
    const tt = performance.now() / 1000;
    const anim = { step: tt * 6, moving: true, tilt: Math.sin(tt * 2.5) * 0.06, face: Math.sin(tt * 0.7) > 0 ? 1 : -1, id: tier };
    g.clearRect(0, 0, 200, 200);
    drawMeeri(g, 100, 122, 140, tier, tt, 0, 0, null, anim);
    requestAnimationFrame(tick);
  };
  tick();
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
    <div class="bonus-line">🪙 Münz-Bonus gesamt: <b id="shop-mult">×${coinMult().toFixed(2)}</b></div>
    <div id="shop-rows"></div>
    <button class="btn-secondary" id="shop-close">Schließen</button>`);
  const render = () => {
    const mm = ov.querySelector("#shop-mult"); if (mm) mm.textContent = "×" + coinMult().toFixed(2);
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

// Prestige-Overlay ("Wiese einstampfen")
function showPrestige() {
  const gain = carrotGain(peak);
  const canDo = gain > 0;
  const ov = mkOverlay(`
    <h2><span class="foil">Wiese einstampfen</span></h2>
    <p class="sub">Fang neu an und sammle <b>Goldene Karotten 🥕</b> — die gibst du im <b>Karotten-Shop</b> für dauerhafte Perks aus.</p>
    <div class="prestige-box">
      <div class="pr-row"><span>Aktuelle Karotten</span><b>🥕 ${fmt(carrots)}</b></div>
      <div class="pr-row"><span>Höchste Stufe (diese Wiese)</span><b>${esc(TIERS[Math.min(MAXT, peak)].name)}${peak > MAXT ? " ✦" + (peak - MAXT) : ""}</b></div>
      <div class="pr-row big"><span>Du bekommst</span><b class="${canDo ? "good" : ""}">🥕 +${fmt(gain)}</b></div>
    </div>
    ${canDo
      ? `<p class="sub dim">Karotten, Perks, Album, Biome & Aufgaben bleiben — Meeries, Münzen & Shop-Upgrades werden zurückgesetzt.</p>`
      : `<p class="sub dim">Bring erst ein Meeri mindestens auf <b>${esc(TIERS[PRESTIGE_MIN].name)}</b> (Stufe ${PRESTIGE_MIN + 1}), dann lohnt sich das Einstampfen.</p>`}
    <button class="btn-primary" id="pr-go" ${canDo ? "" : "disabled"}>🥕 Einstampfen &amp; ${fmt(gain)} Karotten holen</button>
    <button class="btn-secondary" id="pr-shop">🥕 Karotten-Shop (${fmt(carrots)})</button>
    <button class="btn-secondary" id="pr-close">Doch nicht</button>`);
  ov.querySelector("#pr-close").onclick = () => ov.remove();
  ov.querySelector("#pr-shop").onclick = () => { ov.remove(); showPShop(); };
  ov.querySelector("#pr-go").onclick = () => {
    if (!canDo) return;
    if (!confirm(`Wiese einstampfen und ${gain} Goldene Karotten holen? Meeries & Münzen dieser Wiese gehen dabei verloren.`)) return;
    ov.remove(); doPrestige();
  };
}

// Karotten-Shop (Perks mit Goldenen Karotten kaufen)
function showPShop() {
  const ov = mkOverlay(`
    <h2><span class="foil">Karotten-Shop</span></h2>
    <p class="sub">Gib Goldene Karotten für <b>dauerhafte</b> Perks aus — sie überstehen jedes Einstampfen.</p>
    <div class="bonus-line">🥕 Karotten: <b id="ps-carrots">${fmt(carrots)}</b></div>
    <div id="pshop-rows"></div>
    <button class="btn-secondary" id="ps-close">Schließen</button>`);
  const render = () => {
    ov.querySelector("#ps-carrots").textContent = fmt(carrots);
    ov.querySelector("#pshop-rows").innerHTML = PSHOP.map((u, i) => {
      const lvl = pp[u.key] || 0, maxed = lvl >= u.max, cost = pCost(u);
      const can = !maxed && carrots >= cost;
      return `<div class="shop-row">
        <span class="shop-ic">${u.icon}</span>
        <span class="shop-info"><b>${esc(u.name)} <span class="shop-lvl">Lv ${lvl}${maxed ? " (max)" : ""}</span></b><span class="shop-desc">${esc(u.desc(lvl))}</span></span>
        <button class="shop-buy carrot" data-i="${i}" ${can ? "" : "disabled"}>${maxed ? "max" : "🥕 " + fmt(cost)}</button>
      </div>`;
    }).join("");
    ov.querySelectorAll(".shop-buy[data-i]").forEach(b => b.onclick = () => {
      const u = PSHOP[Number(b.dataset.i)], lvl = pp[u.key] || 0, cost = pCost(u);
      if (lvl >= u.max || carrots < cost) return;
      carrots -= cost; pp[u.key] = lvl + 1;
      GS.sound.win(); GS.haptic(12); updateHUD(); saveSoon(); render();
    });
  };
  render();
  ov.querySelector("#ps-close").onclick = () => ov.remove();
}

// Tägliche Aufgaben
function showDaily() {
  ensureDaily(false);
  const ov = mkOverlay(`
    <h2><span class="foil">Tagesaufgaben</span></h2>
    <p class="sub">Jeden Tag neu · 🔥 ${streak} Tage in Folge</p>
    <div id="daily-rows"></div>
    <button class="btn-secondary" id="d-close">Schließen</button>`);
  const render = () => {
    ov.querySelector("#daily-rows").innerHTML = daily.tasks.map((t, i) => {
      const def = taskDef(t.id), done = t.prog >= t.goal, pct = Math.round(t.prog / t.goal * 100);
      const btn = t.claimed ? `<button class="shop-buy" disabled>✓</button>`
        : done ? `<button class="shop-buy" data-claim="${i}">holen</button>`
        : `<button class="shop-buy" disabled>${t.prog}/${t.goal}</button>`;
      return `<div class="shop-row">
        <span class="shop-ic">${def.icon}</span>
        <span class="shop-info"><b>${esc(def.text(t.goal))}</b>
          <span class="dbar"><span class="dbar-fill" style="width:${t.claimed ? 100 : pct}%"></span></span>
          <span class="shop-desc">Belohnung: 🪙 ${fmt(dailyReward())}</span></span>
        ${btn}
      </div>`;
    }).join("");
    ov.querySelectorAll("[data-claim]").forEach(b => b.onclick = () => {
      const t = daily.tasks[Number(b.dataset.claim)];
      if (!t || t.claimed || t.prog < t.goal) return;
      const rw = dailyReward(); earn(rw); t.claimed = true;
      floater("+" + fmt(rw), "#ffd23f", null, null); GS.sound.win(); GS.haptic([10, 30]);
      if (daily.tasks.every(x => x.claimed)) { const b2 = rw * 2; earn(b2); carrots += 1; toast(`🎉 Alle Aufgaben! Bonus 🪙 ${fmt(b2)} + 🥕 1`); }
      updateHUD(); saveSoon(); render();
    });
  };
  render();
  ov.querySelector("#d-close").onclick = () => ov.remove();
}

function loginPopup(bonus, carrotB) {
  const ov = mkOverlay(`
    <h2><span class="foil">Willkommen zurück!</span></h2>
    <p class="sub">🔥 ${streak} Tage in Folge — weiter so!</p>
    <div class="big-num">🪙 +${fmt(bonus)}${carrotB ? ` &nbsp;🥕 +${carrotB}` : ""}</div>
    <button class="btn-primary" data-close="1">Juhu!</button>`);
  ov.dataset.dismiss = "0";
  ov.querySelector("[data-close]").onclick = () => ov.remove();
}

// Statistik
function showStats() {
  const hrs = Math.floor(stats.play / 3600), mins = Math.floor((stats.play % 3600) / 60);
  const bestName = TIERS[Math.min(MAXT, stats.bestEff)].name + (stats.bestEff > MAXT ? " ✦" + (stats.bestEff - MAXT) : "");
  const ov = mkOverlay(`
    <h2><span class="foil">Statistik</span></h2>
    <div class="prestige-box">
      <div class="pr-row"><span>🔀 Merges gesamt</span><b>${fmt(stats.merges)}</b></div>
      <div class="pr-row"><span>🐹 Meeries gekauft</span><b>${fmt(stats.buys)}</b></div>
      <div class="pr-row"><span>🪙 Münzen verdient</span><b>${fmt(stats.coins)}</b></div>
      <div class="pr-row"><span>🥕 Prestige-Neustarts</span><b>${fmt(stats.prestiges)}</b></div>
      <div class="pr-row"><span>🏆 Höchste Stufe je</span><b>${esc(bestName)}</b></div>
      <div class="pr-row"><span>⏱️ Spielzeit</span><b>${hrs}h ${mins}m</b></div>
    </div>
    <button class="btn-secondary" id="st-close">Schließen</button>`);
  ov.querySelector("#st-close").onclick = () => ov.remove();
}

// ---------- Ambiente-Sound (sanfte Vogelzwitscher, abschaltbar) ----------
let ambientOn = false;
try { ambientOn = localStorage.getItem("meeri_ambient") === "1"; } catch (_) {}
function toggleAmbient() {
  ambientOn = !ambientOn;
  try { localStorage.setItem("meeri_ambient", ambientOn ? "1" : "0"); } catch (_) {}
  if (ambientOn) [523.3, 659.3, 784.0].forEach((f, i) => GS.sound.tone(f, 0.5, { type: "sine", gain: 0.03, delay: i * 0.05 }));
  toast(ambientOn ? "🎵 Musik an" : "🔇 Musik aus");
}
// Sanfte, langsam wechselnde Akkorde + gelegentliches Zwitschern (Hintergrundmusik)
const AMBIENT_CHORDS = [[261.6, 329.6, 392.0], [293.7, 349.2, 440.0], [329.6, 392.0, 493.9], [349.2, 440.0, 523.3]];
let ambientChord = 0;
function ambientLoop() {
  if (ambientOn && !document.hidden && GS.sound.on()) {
    const ch = AMBIENT_CHORDS[ambientChord % AMBIENT_CHORDS.length]; ambientChord++;
    ch.forEach((f, i) => GS.sound.tone(f, 2.6, { type: "sine", gain: 0.022, delay: i * 0.05 }));
    if (Math.random() < 0.5) setTimeout(() => GS.sound.tone(900 + Math.random() * 400, 0.09, { type: "sine", gain: 0.03 }), 700);
  }
  setTimeout(ambientLoop, 3400 + Math.random() * 1600);
}

// ---------- Erfolge / Achievements ----------
const BADGES = [
  { id: "firstmerge", icon: "🔀", name: "Erster Merge",     desc: "Verschmelze zwei Meeries",         test: s => s.merges >= 1 },
  { id: "merge100",   icon: "🔀", name: "Merge-Meister",    desc: "100 Merges insgesamt",             test: s => s.merges >= 100 },
  { id: "merge1000",  icon: "🌀", name: "Merge-Legende",    desc: "1000 Merges insgesamt",            test: s => s.merges >= 1000 },
  { id: "ninja",      icon: "🥷", name: "Leise & süß",      desc: "Ein Ninja-Meeri erreichen",        test: s => s.bestEff >= 8 },
  { id: "koenig",     icon: "👑", name: "Königlich",        desc: "Ein König-Meeri erreichen",        test: s => s.bestEff >= 9 },
  { id: "galaxie",    icon: "🌌", name: "Bis zur Galaxie",  desc: "Die Galaxie-Meeri erreichen",      test: s => s.bestEff >= 15 },
  { id: "kosmos5",    icon: "✦",  name: "Kosmos ✦5",        desc: "Kosmos-Stufe 5 erreichen",         test: s => s.bestEff >= 20 },
  { id: "album",      icon: "📖", name: "Sammler",          desc: "Alle 16 Evolutionen entdecken",    test: s => s.album >= 16 },
  { id: "shiny",      icon: "✨", name: "Schillernd",       desc: "Ein schillerndes Meeri finden",    test: s => s.shiny >= 1 },
  { id: "shinyall",   icon: "🌈", name: "Regenbogen-Jäger", desc: "Alle Schillern-Varianten finden",  test: s => s.shiny >= VARIANTS.length },
  { id: "prestige1",  icon: "🥕", name: "Neuanfang",        desc: "Zum ersten Mal einstampfen",       test: s => s.prestiges >= 1 },
  { id: "prestige10", icon: "🥕", name: "Karotten-Baron",     desc: "10× einstampfen",                  test: s => s.prestiges >= 10 },
  { id: "streak7",    icon: "🔥", name: "Treue Seele",      desc: "7 Tage in Folge spielen",          test: s => s.streak >= 7 },
  { id: "rich",       icon: "🪙", name: "Reich",            desc: "1 Mio. Münzen verdienen",          test: s => s.coins >= 1e6 },
];
GS.badges.define("meeri", BADGES);
function badgeSnapshot() {
  return {
    merges: stats.merges, buys: stats.buys, coins: stats.coins, prestiges: stats.prestiges,
    bestEff: stats.bestEff, carrots, streak,
    album: Object.keys(album).length, shiny: Object.keys(shinies).length,
  };
}
function checkBadges() {
  const newly = GS.badges.record("meeri", badgeSnapshot());
  for (const d of newly) toast(`🏅 Erfolg: ${d.icon} ${d.name}`);
}

// ---------- Speicher-Code (Export / Import) ----------
function showSaveCode() {
  let code = "";
  try { code = btoa(unescape(encodeURIComponent(localStorage.getItem(SAVE) || "{}"))); } catch (_) {}
  const ov = mkOverlay(`
    <h2><span class="foil">Speicher-Code</span></h2>
    <p class="sub">Sichere deinen Fortschritt oder übertrage ihn auf ein anderes Gerät. Code kopieren = Backup.</p>
    <textarea class="save-code" readonly rows="4">${esc(code)}</textarea>
    <button class="btn-primary" id="sc-copy">📋 Code kopieren</button>
    <button class="btn-secondary" id="sc-import">📥 Code einfügen &amp; laden</button>
    <button class="btn-secondary" id="sc-close">Schließen</button>`);
  ov.querySelector("#sc-copy").onclick = async () => {
    const ta = ov.querySelector(".save-code"); ta.select();
    try { await navigator.clipboard.writeText(ta.value); toast("📋 Code kopiert!"); }
    catch { document.execCommand("copy"); toast("📋 Code kopiert!"); }
  };
  ov.querySelector("#sc-import").onclick = () => {
    const inp = prompt("Speicher-Code hier einfügen:");
    if (!inp) return;
    try {
      const jsonStr = decodeURIComponent(escape(atob(inp.trim())));
      const obj = JSON.parse(jsonStr);
      if (!obj || typeof obj !== "object") throw 0;
      if (!confirm("Aktuellen Fortschritt durch den Code ersetzen?")) return;
      localStorage.setItem(SAVE, jsonStr);
      toast("✅ Geladen! Wird neu gestartet …");
      setTimeout(() => location.reload(), 800);
    } catch { toast("❌ Ungültiger Code."); }
  };
  ov.querySelector("#sc-close").onclick = () => ov.remove();
}

// ---------- Bestenliste ----------
async function openBoard() {
  let name = "";
  try { name = (localStorage.getItem("bb_name") || "").trim(); } catch (_) {}
  if (!name) {
    name = (prompt("Name für die Bestenliste (max. 16 Zeichen):") || "").trim().slice(0, 16);
    if (name) { try { localStorage.setItem("bb_name", name); } catch (_) {} }
  }
  if (name && carrots > 0) await GS.submitScore("meeri", carrots).catch(() => {});
  GS.showLeaderboard({ game: "meeri", title: "Bestenliste", sub: "Meiste Goldene Karotten 🥕 weltweit" });
}

// ---------- Ganze Wiese als Bild teilen ----------
function shareMeadow() {
  try {
    canvas.toBlob(blob => {
      if (!blob) { GS.share({ title: "MEERI-MANIA", text: "Meine Wiese in MEERI-MANIA! 🐹", url: location.origin + "/meeri/" }); return; }
      const file = new File([blob], "meeri-wiese.png", { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: "MEERI-MANIA", text: "Meine Wiese in MEERI-MANIA! 🐹" }).catch(() => {});
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = "meeri-wiese.png"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast("📸 Bild gespeichert!");
    }, "image/png");
  } catch (_) {
    GS.share({ title: "MEERI-MANIA", text: "Meine Wiese in MEERI-MANIA! 🐹", url: location.origin + "/meeri/" });
  }
}

// Biome-Auswahl als gezeichnete, animierte Welt-Karte
const BIOME_POS = {
  space:       { top: "8%",  left: "50%" },
  candy:       { top: "19%", left: "80%" },
  schnee:      { top: "33%", left: "13%" },
  dschungel:   { top: "50%", left: "31%" },
  wiese:       { top: "60%", left: "14%" },
  wueste:      { top: "62%", left: "67%" },
  vulkan:      { top: "42%", left: "90%" },
  strand:      { top: "86%", left: "32%" },
  unterwasser: { top: "87%", left: "68%" },
};
// Feste Sternpositionen (kein Flackern durch Zufall pro Frame)
const MAP_STARS = Array.from({ length: 46 }, (_, i) => ({ x: ((i * 89 + 13) % 100) / 100, y: ((i * 53 + 7) % 100) / 100, big: i % 7 === 0, pink: i % 9 === 0 }));
function drawWorldMap(g, W, H, t) {
  g.clearRect(0, 0, W, H);
  const spaceH = H * 0.30, seaTop = H * 0.72, landTop = H * 0.42;
  // --- Weltraum ---
  let sp = g.createLinearGradient(0, 0, 0, spaceH + 24);
  sp.addColorStop(0, "#070512"); sp.addColorStop(1, "#2c2060");
  g.fillStyle = sp; g.fillRect(0, 0, W, spaceH + 24);
  for (const st of MAP_STARS) {
    const tw = 0.35 + 0.65 * Math.abs(Math.sin(t * 2 + st.x * 20));
    g.globalAlpha = tw; g.fillStyle = st.pink ? "#ffd6f5" : "#fff";
    g.beginPath(); g.arc(st.x * W, st.y * spaceH, st.big ? 1.8 : 1, 0, 7); g.fill();
  }
  g.globalAlpha = 1;
  // Ringplanet + Mond
  g.save(); g.translate(W * 0.2, spaceH * 0.42);
  g.fillStyle = "#b892ff"; g.beginPath(); g.arc(0, 0, 12, 0, 7); g.fill();
  g.save(); g.rotate(-0.5); g.scale(1, 0.34); g.strokeStyle = "rgba(255,255,255,0.65)"; g.lineWidth = 2.4; g.beginPath(); g.arc(0, 0, 21, 0, 7); g.stroke(); g.restore();
  g.restore();
  g.fillStyle = "#f2f0d8"; g.beginPath(); g.arc(W * 0.8, spaceH * 0.32, 8, 0, 7); g.fill();
  // --- Himmel ---
  let sk = g.createLinearGradient(0, spaceH, 0, seaTop);
  sk.addColorStop(0, "#7db8ff"); sk.addColorStop(1, "#c7ecff");
  g.fillStyle = sk; g.fillRect(0, spaceH, W, seaTop - spaceH);
  // Sonne mit Strahlen
  g.save(); g.translate(W * 0.85, spaceH + (landTop - spaceH) * 0.4);
  g.strokeStyle = "rgba(255,205,50,0.6)"; g.lineWidth = 2.5;
  for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2 + t * 0.25; const r = 15 + 3 * Math.sin(t * 3 + i); g.beginPath(); g.moveTo(Math.cos(a) * 13, Math.sin(a) * 13); g.lineTo(Math.cos(a) * (13 + r), Math.sin(a) * (13 + r)); g.stroke(); }
  g.fillStyle = "#ffd23f"; g.beginPath(); g.arc(0, 0, 12, 0, 7); g.fill(); g.restore();
  // Wolken (driften)
  const cloud = (cx, cy, sc2) => { g.save(); g.translate(cx, cy); g.scale(sc2, sc2); g.fillStyle = "rgba(255,255,255,0.9)"; [[-12, 0, 9], [0, -4, 12], [13, 0, 9]].forEach(c => { g.beginPath(); g.arc(c[0], c[1], c[2], 0, 7); g.fill(); }); g.fillRect(-12, -2, 25, 8); g.restore(); };
  cloud((t * 12) % (W + 60) - 30, spaceH + 16, 0.8);
  cloud((t * 8 + W * 0.5) % (W + 60) - 30, landTop - 14, 1);
  // Zucker-Wölkchen (rosa) oben rechts + Lolli
  g.save(); g.translate(W * 0.8, H * 0.19 + Math.sin(t * 1.5) * 3);
  g.fillStyle = "rgba(255,170,210,0.95)"; [[-11, 0, 8], [0, -4, 11], [12, 0, 8]].forEach(c => { g.beginPath(); g.arc(c[0], c[1], c[2], 0, 7); g.fill(); }); g.fillRect(-11, -2, 23, 8);
  g.strokeStyle = "#fff"; g.lineWidth = 2; g.beginPath(); g.moveTo(2, 6); g.lineTo(2, 16); g.stroke();
  g.fillStyle = "#ff6f91"; g.strokeStyle = "#fff"; g.lineWidth = 1.5; g.beginPath(); g.arc(2, 18, 4, 0, 7); g.fill(); g.stroke();
  g.restore();
  // --- Land ---
  let ld = g.createLinearGradient(0, landTop, 0, seaTop);
  ld.addColorStop(0, "#84d493"); ld.addColorStop(1, "#3ca85a");
  g.fillStyle = ld; g.beginPath(); g.moveTo(0, seaTop);
  g.lineTo(0, landTop + 12);
  for (let x = 0; x <= W; x += 16) g.lineTo(x, landTop + 12 + Math.sin(x * 0.025 + 1) * 9);
  g.lineTo(W, seaTop); g.closePath(); g.fill();
  // Schneeberg links (für das Schneeland)
  g.save(); g.translate(W * 0.14, landTop + 8);
  g.fillStyle = "#8a97a8"; g.beginPath(); g.moveTo(-30, 40); g.lineTo(0, -34); g.lineTo(30, 40); g.closePath(); g.fill();
  g.strokeStyle = "#123018"; g.lineWidth = 1.5; g.stroke();
  g.fillStyle = "#fff"; g.beginPath(); g.moveTo(-12, -6); g.lineTo(0, -34); g.lineTo(12, -6); g.quadraticCurveTo(6, -2, 2, -8); g.quadraticCurveTo(-3, -1, -12, -6); g.closePath(); g.fill();
  g.restore();
  // Bäumchen (links, auf der Wiese)
  const tree = (x, y) => { g.fillStyle = "#7a4a24"; g.fillRect(x - 2, y, 4, 10); g.fillStyle = "#2f9e4f"; g.beginPath(); g.arc(x, y - 4, 9, 0, 7); g.fill(); g.strokeStyle = "#123018"; g.lineWidth = 1.5; g.stroke(); };
  tree(W * 0.3, landTop + 46); tree(W * 0.42, landTop + 40);
  // Wüsten-Sandfleck (rechte Landhälfte)
  g.save();
  g.fillStyle = "#f0c878"; g.beginPath(); g.ellipse(W * 0.67, seaTop - 20, 74, 30, 0, 0, 7); g.fill();
  g.strokeStyle = "rgba(190,140,70,0.55)"; g.lineWidth = 2;
  for (let i = 1; i <= 2; i++) { g.beginPath(); for (let x = -70; x <= 70; x += 10) { const yy = seaTop - 20 + i * 8 + Math.sin(x * 0.06) * 3; (x === -70) ? g.moveTo(W * 0.67 + x, yy) : g.lineTo(W * 0.67 + x, yy); } g.stroke(); }
  // kleiner Kaktus im Sand
  g.translate(W * 0.62, seaTop - 26); g.fillStyle = "#3f9e5a"; g.strokeStyle = "#123018"; g.lineWidth = 1.5;
  g.beginPath(); g.rect(-3, -16, 6, 20); g.fill(); g.stroke();
  g.beginPath(); g.rect(-9, -8, 6, 4); g.fill(); g.stroke(); g.beginPath(); g.rect(3, -12, 6, 4); g.fill(); g.stroke();
  g.restore();
  // Vulkan (ganz rechts)
  g.save(); g.translate(W * 0.88, landTop + 14);
  g.fillStyle = "#6e4b30"; g.beginPath(); g.moveTo(-36, seaTop - landTop - 14); g.lineTo(-10, -6); g.lineTo(10, -6); g.lineTo(36, seaTop - landTop - 14); g.closePath(); g.fill();
  g.strokeStyle = "#123018"; g.lineWidth = 1.5; g.stroke();
  const lf = 0.55 + 0.45 * Math.abs(Math.sin(t * 4));
  g.fillStyle = `rgb(255,${Math.round(70 + 90 * lf)},20)`; g.beginPath(); g.ellipse(0, -6, 11, 4, 0, 0, 7); g.fill();
  // Lava-Tropfen + Rauch
  g.fillStyle = "rgba(255,120,20,0.9)"; g.beginPath(); g.moveTo(-4, -6); g.quadraticCurveTo(-10, 6 + 6 * lf, -6, 14); g.quadraticCurveTo(-2, 6, -4, -6); g.fill();
  for (let i = 0; i < 3; i++) { const yy = -12 - ((t * 18 + i * 22) % 40); g.globalAlpha = Math.max(0, 0.5 - (-yy - 12) / 60); g.fillStyle = "#c9c9c9"; g.beginPath(); g.arc(Math.sin(t + i) * 4, yy, 4 + i, 0, 7); g.fill(); }
  g.globalAlpha = 1; g.restore();
  // --- Meer ---
  let se = g.createLinearGradient(0, seaTop, 0, H);
  se.addColorStop(0, "#43b8ea"); se.addColorStop(1, "#1668b8");
  g.fillStyle = se; g.fillRect(0, seaTop, W, H - seaTop);
  g.strokeStyle = "rgba(255,255,255,0.4)"; g.lineWidth = 2;
  for (let r = 0; r < 3; r++) { g.beginPath(); for (let x = 0; x <= W; x += 8) { const y = seaTop + 12 + r * 15 + Math.sin(x * 0.06 + t * 2 + r) * 3; x ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke(); }
  // Sandstrand + Palme
  g.fillStyle = "#f2d9a0"; g.beginPath(); g.ellipse(W * 0.5, seaTop + 4, 64, 16, 0, 0, 7); g.fill();
  g.save(); g.translate(W * 0.5 + 26, seaTop + 2);
  g.strokeStyle = "#7a4a24"; g.lineWidth = 4; g.beginPath(); g.moveTo(0, 6); g.quadraticCurveTo(-4, -10, 2, -20); g.stroke();
  g.fillStyle = "#2f9e4f"; for (let i = 0; i < 5; i++) { const a = -0.4 + i * 0.5 + Math.sin(t * 1.5) * 0.05; g.save(); g.translate(2, -20); g.rotate(a); g.beginPath(); g.ellipse(9, 0, 10, 3, 0, 0, 7); g.fill(); g.restore(); }
  g.restore();
}
function showBiomes() {
  const ov = mkOverlay(`
    <h2><span class="foil">Welt-Karte</span></h2>
    <p class="sub">Tippe einen Ort an — jede Wiese gibt dauerhaft <b>+5% Münzen</b>.</p>
    <div class="bonus-line">🗺️ Wiesen-Bonus: <b>+${Math.round((biomeBonus() - 1) * 100)}%</b></div>
    <div class="biome-map" id="biome-map"><canvas class="map-cv"></canvas></div>
    <button class="btn-secondary" id="bio-close">Schließen</button>`);
  const map = ov.querySelector("#biome-map");
  const cv = ov.querySelector(".map-cv");
  const g = cv.getContext("2d");
  let cw = 0, ch = 0;
  const sizeCv = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    cw = map.clientWidth || 320; ch = map.clientHeight || 270;
    cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
    cv.style.width = cw + "px"; cv.style.height = ch + "px";
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  sizeCv();
  const tick = () => {
    if (!document.body.contains(cv)) return;   // Stopp, wenn geschlossen
    drawWorldMap(g, cw, ch, performance.now() / 1000);
    requestAnimationFrame(tick);
  };
  tick();
  const render = () => {
    map.querySelectorAll(".biome-spot").forEach(e => e.remove());
    BIOMES.forEach(b => {
      const p = BIOME_POS[b.key] || { top: "50%", left: "50%" };
      const owned = biomesOwned.includes(b.key), active = biome === b.key;
      const el = document.createElement("button");
      el.className = `biome-spot ${active ? "active" : ""} ${owned ? "owned" : "locked"}`;
      el.style.top = p.top; el.style.left = p.left;
      el.innerHTML = `<span class="bs-ic">${b.icon}</span><span class="bs-name">${esc(b.name)}</span>` +
        `<span class="bs-tag">${active ? "✓ aktiv" : owned ? "wählen" : "🪙 " + fmt(b.cost)}</span>`;
      el.onclick = () => {
        if (active) return;
        if (owned) { biome = b.key; GS.sound.good(); GS.haptic(8); saveSoon(); render(); }
        else if (coins >= b.cost) {
          coins -= b.cost; biomesOwned.push(b.key); biome = b.key;
          GS.sound.win(); GS.haptic([10, 30, 10]); burst("NEUE WIESE!", "#57e39b");
          updateHUD(); saveSoon(); render();
        } else toast(`Zu wenig Münzen — kostet 🪙 ${fmt(b.cost)}`);
      };
      map.appendChild(el);
    });
  };
  render();
  ov.querySelector("#bio-close").onclick = () => ov.remove();
}

function showMenu() {
  const TABS = [
    { id: "play", icon: "🎮", name: "Spielen" },
    { id: "coll", icon: "📚", name: "Sammlung" },
    { id: "prog", icon: "🥕", name: "Fortschritt" },
    { id: "more", icon: "⚙️", name: "Mehr" },
  ];
  let cur = "play";
  prestigeSeen = true; updateHUD();   // Prestige-Hinweis am Menü-Knopf quittieren
  const ov = mkOverlay(`
    <h2><span class="foil">Menü</span></h2>
    <div class="menu-tabs">${TABS.map(t => `<button class="mtab" data-tab="${t.id}"><span class="mt-ic">${t.icon}</span><span>${t.name}</span></button>`).join("")}</div>
    <div id="menu-body"></div>
    <button class="btn-primary" id="m-close">▶ Weiter wuseln</button>`);
  const B = (id, label) => `<button class="btn-secondary" data-act="${id}">${label}</button>`;
  const bodies = {
    play: () => `<div class="menu-grid">
      ${B("shop", "🛒 Shop")}
      ${B("biome", "🗺️ Wiesen")}
      ${B("daily", `📅 Aufgaben${dailyClaimable() ? ' <span class="mdot"></span>' : ""}`)}
      ${B("how", "❓ Anleitung")}
    </div>`,
    coll: () => `<div class="menu-grid">
      ${B("album", "📖 Album")}
      ${B("badges", `🏅 Erfolge <span class="dim2">${GS.badges.earnedCount("meeri")}/${BADGES.length}</span>`)}
      ${B("stats", "📊 Statistik")}
      ${B("board", "🌍 Bestenliste")}
    </div>`,
    prog: () => `<div class="menu-grid">
      ${peak >= PRESTIGE_MIN
        ? B("prestige", `🥕 Prestige${carrotGain(peak) > 0 ? ' <span class="mdot"></span>' : ""}`)
        : `<button class="btn-secondary" disabled>🥕 Prestige <span class="dim2">ab ${esc(TIERS[PRESTIGE_MIN].name)}</span></button>`}
      ${B("code", "💾 Speicher-Code")}
    </div>`,
    more: () => `<div class="menu-grid">
      ${B("share", "📸 Wiese teilen")}
      ${B("music", ambientOn ? "🔇 Musik aus" : "🎵 Musik an")}
      ${B("reset", "🗑️ Neu starten")}
    </div>`,
  };
  const act = id => {
    const go = fn => { ov.remove(); fn(); };
    if (id === "shop") go(showShop);
    else if (id === "biome") go(showBiomes);
    else if (id === "daily") go(showDaily);
    else if (id === "how") { ov.remove(); howTo(true); }
    else if (id === "album") go(showAlbum);
    else if (id === "badges") { ov.remove(); GS.badges.show("meeri", "Erfolge"); }
    else if (id === "stats") go(showStats);
    else if (id === "board") go(openBoard);
    else if (id === "prestige") go(showPrestige);
    else if (id === "code") go(showSaveCode);
    else if (id === "share") go(shareMeadow);
    else if (id === "music") { toggleAmbient(); render(); }
    else if (id === "reset") {
      if (confirm("Wirklich komplett neu starten? Aller Fortschritt (auch Karotten, Album & Erfolge) geht verloren.")) {
        fresh(); save(); ov.remove(); spawnMeeri(0); ensureDaily(false); updateHUD(); toast("Neue Wiese!");
      }
    }
  };
  const render = () => {
    ov.querySelectorAll(".mtab").forEach(b => b.classList.toggle("sel", b.dataset.tab === cur));
    ov.querySelector("#menu-body").innerHTML = bodies[cur]();
    ov.querySelectorAll("[data-act]").forEach(b => b.onclick = () => act(b.dataset.act));
  };
  ov.querySelectorAll(".mtab").forEach(b => b.onclick = () => { cur = b.dataset.tab; render(); });
  ov.querySelector("#m-close").onclick = () => ov.remove();
  render();
}
function howTo(force) {
  GS.onboard("meeri", {
    force: !!force,
    title: "So geht MEERI-MANIA",
    steps: [
      { icon: "🪙", text: "Meeries werfen Münz-Blasen ab — tippe sie an. Mit dem 🧲 Auto-Sammler geht das später von allein." },
      { icon: "🔀", text: "Zieh zwei GLEICHE Meeries zusammen → sie evolvieren zur nächsten, absurderen Stufe!" },
      { icon: "🛒", text: "Im Shop rüstest du auf: mehr Münzwert, schnellere Würfe, Auto-Sammler, Glücks-Wurf." },
      { icon: "📖", text: "Neue Evolutionen landen im Album (+3% Münzen je Stufe) — tippe sie an, um sie zu teilen." },
      { icon: "🥕", text: "Stampf die Wiese beim Prestige ein und tausche sie gegen Goldene Karotten, die für immer alle Münzen erhöhen. Dazu Themen-Wiesen freischalten. Schaffst du die Galaxie-Meeri? 🌌" },
    ],
  });
}

// ====================================================================
// Verdrahtung & Start
// ====================================================================
document.getElementById("buy").onclick = () => buyMeeri();
document.getElementById("expand").onclick = expandMeadow;
document.getElementById("btn-shop").onclick = showShop;
document.getElementById("btn-album").onclick = showAlbum;
document.getElementById("btn-menu").onclick = showMenu;
document.getElementById("btn-sound").onclick = () => { GS.sound.toggle(); GS.sound.click(); updateHUD(); };

let rt = null;
window.addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(layout, 120); });
window.addEventListener("orientationchange", () => setTimeout(layout, 250));
document.addEventListener("visibilitychange", () => {
  if (document.hidden) save();
  else { ensureDaily(true); updateHUD(); }   // Tageswechsel bei Rückkehr erkennen
});
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
ensureDaily(true);       // Aufgaben rollen + Login-Bonus
updateHUD();
requestAnimationFrame(frame);
ambientLoop();
howTo(false);
