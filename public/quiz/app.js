// ====================================================================
// QUIZ-DUELL — Client. WebSocket zum QuizRoom-DO (Wahrheit für Fragen,
// Lösung, Punkte, Runden, Timer). Alle beantworten dieselbe Frage live;
// Punkte = richtig + Tempo-Bonus. Reconnect wie bei Kritzeln.
// ====================================================================
const $ = s => document.querySelector(s);
const GS = window.GS;

// ---------- Netz-/Spielzustand ----------
let ws = null, myId = null, hostId = null, code = "";
let view = "menu";                 // menu | lobby | playing | over
let players = [];
let phase = "";                    // question | reveal
let roomCats = [], roomRounds = 10, roomDiff = 0, roomCatVotes = {};
let myVoteCats = [];               // eigene Kategorie-Stimmen (Abstimmung)
let iAmReady = false;
let lastHistory = [];              // Verlauf des letzten Spiels (für Ergebnis-Übersicht)
let curQuestion = "";              // aktueller Fragetext (für „Melden")
let fiftyUsed = false;             // 50:50-Joker in diesem Spiel verbraucht?
let tbAmTied = false;              // spiele ich bei der laufenden Stichfrage mit?
try { myVoteCats = JSON.parse(sessionStorage.getItem("quiz_votes") || "[]") || []; } catch { myVoteCats = []; }
function saveVotes() { try { sessionStorage.setItem("quiz_votes", JSON.stringify(myVoteCats)); } catch {} }
let curOptions = [], answered = false, myPick = -1, myLastFast = false;
let timeEnd = 0, timeTotal = 1;
let pingT = null, intentional = false, reTries = 0, reTimer = null;
// Lokale Statistik der laufenden Runde für Meilensteine (Server ist Wahrheit für
// Punkte; das hier ist nur fürs Badge-System, das pro Gerät zählt).
let gStats = { answered: 0, correct: 0, streakCur: 0, streakMax: 0, fast: 0, total: 0 };

// Meilensteine (lokal, gs_badges_quiz — fließen in Profil-Level & XP ein).
const QUIZ_BADGES = [
  { id: "firstgame", icon: "🧠", name: "Mitgeraten", desc: "Ein Quiz mitgespielt", test: (s, t) => t.runs >= 1 },
  { id: "win1", icon: "🏆", name: "Erster Sieg", desc: "Ein Quiz gewinnen", test: s => s.won >= 1 },
  { id: "win10", icon: "👑", name: "Quizmeister", desc: "10 Quiz gewinnen", test: (s, t) => t.sum_won >= 10 },
  { id: "correct50", icon: "✅", name: "Vielwisser", desc: "50 richtige Antworten insgesamt", test: (s, t) => t.sum_correct >= 50 },
  { id: "correct250", icon: "📚", name: "Wandelndes Lexikon", desc: "250 richtige Antworten insgesamt", test: (s, t) => t.sum_correct >= 250 },
  { id: "streak5", icon: "🔥", name: "Auf einer Welle", desc: "5 richtige Antworten in Folge", test: (s, t) => t.max_streak >= 5 },
  { id: "perfect", icon: "💯", name: "Makellos", desc: "Eine ganze Runde fehlerfrei (ab 5 Fragen)", test: s => s.perfect >= 1 },
  { id: "speed", icon: "⚡", name: "Schnelldenker", desc: "5 blitzschnelle Treffer in einer Runde", test: s => s.fast >= 5 },
];

const CAT_LABELS = {
  allgemein: "🧠 Allgemein", geografie: "🌍 Geografie", natur: "🐾 Natur & Tiere",
  wissenschaft: "🔬 Wissenschaft", geschichte: "🏛️ Geschichte", sport: "⚽ Sport",
  kultur: "🎭 Kultur", oesterreich: "🇦🇹 Österreich", essen: "🍎 Essen & Trinken",
  film: "🎬 Film & Serien", schwer: "🧩 Kopfnüsse",
};
const CAT_KEYS = Object.keys(CAT_LABELS);
const ROUND_CHOICES = [5, 10, 15, 20];
const DIFF_CHOICES = [0, 1, 2, 3];
const DIFF_LABELS = { 0: "🎲 Alle", 1: "🟢 Leicht", 2: "🟡 Mittel", 3: "🔴 Schwer" };

// Pro-Tab stabile Spieler-ID (Reconnect behält Identität; zwei Tabs = zwei Spieler).
const TAB_UID = (() => {
  try { let u = sessionStorage.getItem("quiz_uid"); if (!u) { const a = new Uint8Array(12); crypto.getRandomValues(a); u = [...a].map(b => b.toString(16).padStart(2, "0")).join(""); sessionStorage.setItem("quiz_uid", u); } return u; }
  catch { return "t" + Math.floor(performance.now()).toString(36); }
})();

const wsUrl = c => (location.protocol === "https:" ? "wss" : "ws") + "://" + location.host + "/api/quiz-live?code=" + encodeURIComponent(c);
const CODE_ABC = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const randCode = () => { const a = new Uint8Array(4); crypto.getRandomValues(a); return [...a].map(b => CODE_ABC[b % CODE_ABC.length]).join(""); };

function connect(c, isRe) {
  code = c.toUpperCase();
  try { sessionStorage.setItem("quiz_code", code); } catch {}
  if (!isRe) { intentional = false; reTries = 0; }
  if (reTimer) { clearTimeout(reTimer); reTimer = null; }
  // Alte Verbindung sauber schließen (Handler abhängen, damit ihr close KEINEN
  // weiteren Reconnect auslöst) — verhindert mehrere überlappende Verbindungen.
  if (ws) { try { ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null; ws.close(); } catch {} ws = null; }
  try { ws = new WebSocket(wsUrl(code)); } catch { return tryReconnect(); }
  ws.onopen = () => { reTries = 0; send({ t: "join", name: GS.getName() || "Spieler", uid: TAB_UID, dev: (GS.deviceId && GS.deviceId()) || "" }); if (myVoteCats.length) send({ t: "vote", cats: myVoteCats }); if (pingT) clearInterval(pingT); pingT = setInterval(() => send({ t: "ping" }), 15000); };
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } onMsg(m); };
  ws.onclose = () => { if (pingT) { clearInterval(pingT); pingT = null; } if (intentional) return; tryReconnect(); };
  ws.onerror = () => {};
}
function tryReconnect() {
  if (intentional) return;
  // Im Hintergrund (z. B. Link in WhatsApp teilen) NICHT die Versuche verbrauchen
  // und nicht ins Menü werfen — der Browser friert die Verbindung ohnehin ein.
  // Sobald der Tab wieder sichtbar wird, verbindet visibilitychange frisch neu.
  if (document.hidden) return;
  if (reTries >= 8) { showMenu("Verbindung getrennt"); return; }
  reTries++;
  const mEl = document.querySelector("#ov .msg"); if (mEl) mEl.textContent = "Verbindung unterbrochen — verbinde neu …";
  reTimer = setTimeout(() => connect(code, true), Math.min(4000, 500 * reTries));
}
function send(o) { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); } catch {} }
function leave() { intentional = true; if (reTimer) clearTimeout(reTimer); try { sessionStorage.removeItem("quiz_code"); } catch {} try { ws && ws.close(); } catch {} ws = null; }

// ---------- Nachrichten ----------
function onMsg(m) {
  switch (m.t) {
    case "welcome": myId = m.id; break;
    case "full": showMenu("Raum ist voll (max. 10)."); leave(); break;
    case "kicked": leave(); showMenu("Du wurdest vom Host entfernt."); break;
    case "lobby":
      hostId = m.hostId; players = m.players || [];
      if (Array.isArray(m.cats)) roomCats = m.cats; if (m.rounds) roomRounds = m.rounds;
      if (typeof m.diff === "number") roomDiff = m.diff;
      if (m.catVotes) roomCatVotes = m.catVotes;
      // Eigenen Bereit-Status aus dem Server-Stand spiegeln (nach Reconnect korrekt).
      { const me = players.find(p => p.id === myId); if (me) iAmReady = !!me.ready; }
      renderPlayers();
      if (view === "playing" || view === "over") break;
      view = "lobby";
      if (document.getElementById("ov") && document.querySelector("#ov .plist")) updateLobby();
      else showLobby();
      break;
    case "question": onQuestion(m); break;
    case "answered": onAnswered(m); break;
    case "reveal": onReveal(m); break;
    case "fifty": onFifty(m); break;
    case "reported": onReported(); break;
    case "tiebreak": onTiebreak(m); break;
    case "tbout": onTbOut(m); break;
    case "tbreveal": onTbReveal(m); break;
    case "tbresult": onTbResult(m); break;
    case "over": view = "over"; lastHistory = m.history || []; showOver(m.players || [], lastHistory); break;
    case "emote": floatEmote(m.e); break;
    case "chat": /* Systemmeldungen (z. B. Kick) — dezent ignorieren im Quiz */ break;
    case "pong": break;
  }
}

function onQuestion(m) {
  closeOverlay(); closeOverlay2(); view = "playing"; phase = "question"; tbAmTied = false;
  $("#board").classList.remove("hidden"); showLeave(true); showEmotes(true);
  if ((m.idx || 1) === 1) { gStats = { answered: 0, correct: 0, streakCur: 0, streakMax: 0, fast: 0, total: m.total || 0 }; fiftyUsed = false; }
  gStats.total = m.total || gStats.total;
  answered = !!m.locked; myPick = m.locked ? (m.yourIdx != null ? m.yourIdx : -1) : -1; myLastFast = false;
  curOptions = m.options || []; curQuestion = m.q || "";
  $("#i-turn").textContent = "Frage " + (m.idx || 1) + (m.total ? "/" + m.total : "");
  // Kategorie-Badge (woher die Frage kommt) — kleiner Kontext, worauf man sich einstellt.
  $("#i-cat").textContent = m.cat && CAT_LABELS[m.cat] ? CAT_LABELS[m.cat] : "";
  $("#q-text").textContent = m.q || "";
  setNote("");
  renderOptions(curOptions);
  if (answered && myPick >= 0) { markPick(myPick); setNote("Deine Wahl: " + "ABCD"[myPick] + " — du kannst noch wechseln, bis alle dran sind"); }
  showTools(true); updateTools();
  { const r = $("#btn-report"); if (r) { r.disabled = false; r.textContent = "🚩 Melden"; } }
  startTimer(m.time || 20);
  renderPlayers();
}

function onAnswered(m) {
  // jemand hat gesperrt → Fortschritt zählen (aus players kommt answered im lobby)
  const pl = players.find(p => p.id === m.id); if (pl) pl.answered = true;
  const n = players.filter(p => p.answered).length;
  if (phase === "question" && !answered) setNote(n + " von " + players.length + " haben geantwortet …");
  renderPlayers();
}

function onReveal(m) {
  phase = "reveal"; stopTimer(); showTools(false); players = m.players || players; renderPlayers();
  const results = m.results || [];
  const mine = results.find(r => r.id === myId);
  // Meilenstein-Statistik der Runde fortschreiben.
  if (answered) {
    gStats.answered++;
    if (myPick === m.correct) { gStats.correct++; gStats.streakCur++; gStats.streakMax = Math.max(gStats.streakMax, gStats.streakCur); if (myLastFast) gStats.fast++; }
    else gStats.streakCur = 0;
  } else gStats.streakCur = 0;
  // Optionen einfärben (richtig grün, eigene falsche rot).
  $("#options").querySelectorAll(".opt").forEach((b, idx) => {
    b.disabled = true;
    const t = (b.querySelector(".opt-txt") || {}).textContent || "";
    if (idx === m.correct) { b.classList.add("correct"); b.setAttribute("aria-label", t + " – richtige Antwort"); }
    else if (idx === myPick) { b.classList.add("wrong"); b.setAttribute("aria-label", t + " – deine Antwort, falsch"); }
  });
  // Ton/Haptik + Punkte-Popup fürs eigene Ergebnis.
  const myGain = mine ? mine.gain : 0;
  if (answered && myPick === m.correct) { floatPoints("+" + myGain, true); GS.sound.great(); GS.haptic(20); }
  else if (answered) { GS.sound.tone(180, 0.18, { type: "sawtooth", gain: 0.06 }); GS.haptic(10); }
  showReveal(m, mine);
}

// Kurze Ergebnis-Übersicht zwischen den Fragen: richtige Antwort, wer richtig/
// falsch lag, wer am schnellsten war (⚡) und die Punkte. Schließt automatisch,
// sobald die nächste Frage kommt (onQuestion ruft closeOverlay()).
function showReveal(m, mine) {
  const correctText = curOptions[m.correct] != null ? curOptions[m.correct] : "";
  const results = (m.results || []).slice();
  // richtige zuerst (schnellste oben), dann falsch beantwortet, dann keine Antwort.
  const rank = r => r.correct ? 0 : (r.answered ? 1 : 2);
  results.sort((a, b) => rank(a) - rank(b) || (b.remain - a.remain));
  let fastestId = null;
  for (const r of results) { if (r.correct) { fastestId = r.id; break; } }
  const rows = results.map(r => {
    const you = r.id === myId ? " (du)" : "";
    const cls = r.correct ? "win" : (r.answered ? "miss" : "none");
    const fire = (r.correct && r.streak >= 2) ? ` <span class="streak">🔥${r.streak}</span>` : "";
    const badge = !r.answered ? "–" : (r.correct ? (r.id === fastestId ? "⚡ +" + r.gain : "+" + r.gain) : "✗");
    return `<li class="${cls}"><span class="pname">${GS.esc(r.name)}${you}${fire}</span><span class="psc">${badge}</span></li>`;
  }).join("");
  const mineStreak = (mine && mine.correct && mine.streak >= 2) ? ` · 🔥 ${mine.streak}er-Serie${mine.bonus ? " (+" + mine.bonus + ")" : ""}` : "";
  const verdict = mine
    ? (mine.correct ? `<div class="reveal-verdict good">✅ Richtig! +${mine.gain}${mine.id === fastestId ? " · am schnellsten ⚡" : ""}${mineStreak}</div>`
      : (mine.answered ? `<div class="reveal-verdict bad">❌ Daneben</div>` : `<div class="reveal-verdict muted">⏱️ Nicht geantwortet</div>`))
    : "";
  overlay(`<h2>Auflösung</h2><div class="reveal-correct">✓ ${GS.esc(correctText)}</div>${verdict}<ul class="plist tight">${rows}</ul>
    <div class="reveal-cd"><div class="reveal-cd-bar"><i id="rcd-bar"></i></div><p class="msg" id="rcd-txt">Nächste Frage …</p></div>`);
  startRevealCd(m.next || 6);
}

// Countdown in der Auflösung: schrumpfender Balken + Sekunden, damit die nächste
// Frage nie „plötzlich" da ist. Läuft rein lokal ab der empfangenen Restzeit.
let revealRAF = null;
function stopRevealCd() { if (revealRAF) { cancelAnimationFrame(revealRAF); revealRAF = null; } }
function startRevealCd(secs) {
  stopRevealCd();
  const total = Math.max(1, secs) * 1000, end = performance.now() + total;
  const bar = document.getElementById("rcd-bar"), txt = document.getElementById("rcd-txt");
  const step = () => {
    const left = Math.max(0, end - performance.now());
    if (bar) bar.style.width = (left / total * 100) + "%";
    const s = Math.ceil(left / 1000);
    if (txt) txt.textContent = left > 0 ? ("Nächste Frage in " + s + " s") : "Nächste Frage …";
    if (left <= 0) { revealRAF = null; return; }
    revealRAF = requestAnimationFrame(step);
  };
  step();
}

// ---------- Optionen ----------
function renderOptions(options) {
  const el = $("#options");
  el.innerHTML = options.map((o, i) => `<button class="opt" data-i="${i}"><span class="opt-key">${"ABCD"[i]}</span><span class="opt-txt">${GS.esc(o)}</span></button>`).join("");
  el.querySelectorAll(".opt").forEach(b => b.onclick = () => pickAnswer(+b.dataset.i));
}
function pickAnswer(i) {
  // Stichfrage: nur Gleichstand-Spieler, Antwort ist endgültig (erste zählt).
  if (phase === "tiebreak") {
    if (!tbAmTied || answered) return;
    answered = true; myPick = i; markPick(i);
    send({ t: "answer", i });
    $("#options").querySelectorAll(".opt").forEach(b => b.disabled = true);
    setNote("Antwort abgegeben — Daumen drücken!");
    GS.sound.click(); GS.haptic(10);
    return;
  }
  if (phase !== "question") return;
  const changed = myPick !== i;
  answered = true;
  // „Schnell" = in der ersten Zughälfte geantwortet (für den Speed-Meilenstein).
  // Bei Änderung zählt der neue Zeitpunkt (wie beim Server).
  myLastFast = (timeEnd - performance.now()) >= (timeTotal * 1000) / 2;
  send({ t: "answer", i });
  markPick(i);
  setNote("Deine Wahl: " + "ABCD"[i] + " — du kannst noch wechseln, bis alle dran sind");
  updateTools();   // Joker nach dem Antworten sperren (Server nimmt ihn dann nicht mehr an)
  if (changed) { GS.sound.click(); GS.haptic(8); }
}
// Auswahl markieren — Buttons bleiben AKTIV, damit man bis zur Auflösung wechseln
// kann (der Server erlaubt Änderungen, solange nicht alle geantwortet haben).
function markPick(i) {
  myPick = i;
  $("#options").querySelectorAll(".opt").forEach((b, idx) => b.classList.toggle("mine", idx === i));
}
function setNote(txt, kind) {
  const n = $("#q-note"); if (!n) return;
  n.textContent = txt || "";
  n.className = "q-note" + (kind ? " " + kind : "");
}

// ---------- Timer ----------
let timerRAF = null, lastTickSec = -1;
function startTimer(sec) { timeTotal = sec; timeEnd = performance.now() + sec * 1000; lastTickSec = -1; clearHurry(); if (!timerRAF) tickTimer(); }
function stopTimer() { if (timerRAF) cancelAnimationFrame(timerRAF); timerRAF = null; clearHurry(); }
function clearHurry() { const b = $("#timebar"); if (b) b.classList.remove("hurry", "panic"); }
function tickTimer() {
  const left = Math.max(0, timeEnd - performance.now());
  const secs = Math.ceil(left / 1000);
  $("#timefill").style.width = (left / (timeTotal * 1000) * 100) + "%";
  $("#i-time").textContent = secs + "s";
  // Countdown-Spannung: Balken pulsiert die letzten 5 s (rot), die letzten 2 s
  // hektischer (panic). Visuell unabhängig davon, ob man schon geantwortet hat;
  // die Tick-Töne nur für alle, die noch grübeln (nicht nerven nach der Wahl).
  if (phase === "question") {
    const bar = $("#timebar");
    if (bar) { bar.classList.toggle("hurry", secs <= 5 && secs >= 1); bar.classList.toggle("panic", secs <= 2 && secs >= 1); }
    if (!answered && secs <= 5 && secs >= 1 && secs !== lastTickSec) {
      lastTickSec = secs; GS.sound.tone(secs <= 2 ? 880 : 640, 0.07, { type: "triangle", gain: 0.08 }); if (secs <= 2) GS.haptic(10);
    }
  }
  if (left <= 0) { timerRAF = null; clearHurry(); return; }
  timerRAF = requestAnimationFrame(tickTimer);
}

// ---------- Emotes / Punkte ----------
const EMOTES = ["👍", "❤️", "😂", "😮", "🎉", "🔥"];
function buildEmotes() {
  const bar = $("#emotes"); if (!bar) return;
  bar.innerHTML = EMOTES.map(e => `<button type="button" data-emote="${e}" aria-label="Reaktion ${e}">${e}</button>`).join("");
  bar.querySelectorAll("[data-emote]").forEach(b => b.onclick = () => { send({ t: "emote", e: b.dataset.emote }); floatEmote(b.dataset.emote); GS.haptic(6); });
}
function showEmotes(on) { const b = $("#emotes"); if (b) b.classList.toggle("hidden", !on); }
function floatEmote(e) {
  const wrap = $("#qcard"); if (!wrap || !e) return;
  const el = document.createElement("div"); el.className = "emote-fly"; el.textContent = e;
  el.style.left = (12 + Math.random() * 70) + "%";
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}
function floatPoints(txt, mine) {
  const wrap = $("#qcard"); if (!wrap) return;
  const el = document.createElement("div"); el.className = "points-fly" + (mine ? " mine" : "");
  el.textContent = txt; el.style.left = (30 + Math.random() * 40) + "%";
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 1300);
}
function confetti() {
  try {
    if (matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const cols = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899"];
    const box = document.createElement("div"); box.className = "confetti"; document.body.appendChild(box);
    for (let i = 0; i < 26; i++) {
      const s = document.createElement("i");
      s.style.left = (10 + Math.random() * 80) + "vw"; s.style.background = cols[i % cols.length];
      s.style.animationDelay = (Math.random() * 0.15) + "s"; s.style.transform = "rotate(" + (Math.random() * 360) + "deg)";
      box.appendChild(s);
    }
    setTimeout(() => box.remove(), 1700);
  } catch {}
}

// ---------- Spieler ----------
function renderPlayers() {
  const el = $("#players"); if (!el) return;
  // „answered" = hat gesperrt (neutral, Akzentfarbe + ✓) — sagt NICHTS über
  // richtig/falsch aus; das zeigt erst die Auflösung.
  el.innerHTML = players.map(p => `<span class="pl ${p.answered ? "answered" : ""}">${p.answered ? "✓ " : ""}${GS.esc(p.name)}${p.id === myId ? " (du)" : ""} <b>${p.score || 0}</b></span>`).join("");
}

// ---------- Overlays ----------
function closeOverlay() { stopRevealCd(); const o = $("#ov"); if (o) o.remove(); }
function overlay(html) { closeOverlay(); const o = document.createElement("div"); o.id = "ov"; o.className = "overlay"; o.innerHTML = `<div class="panel">${html}</div>`; document.body.appendChild(o); return o; }
function closeOverlay2() { const o = $("#ov2"); if (o) o.remove(); }
function overlay2(html) { closeOverlay2(); const o = document.createElement("div"); o.id = "ov2"; o.className = "overlay"; o.style.zIndex = "60"; o.innerHTML = `<div class="panel">${html}</div>`; document.body.appendChild(o); o.onclick = e => { if (e.target === o) closeOverlay2(); }; return o; }

async function showScores() {
  const o = overlay2(`<h2>🏆 Bestenliste</h2><p class="sub">Gesamtpunkte über alle Runden</p><div id="sc-list"><p class="msg">Lade …</p></div><button class="btn-secondary" id="sc-close">Schließen</button>`);
  o.querySelector("#sc-close").onclick = closeOverlay2;
  try {
    const r = await fetch("/api/quiz-scores?me=" + encodeURIComponent(GS.getName() || ""));
    const d = await r.json(); const top = d.top || []; const me = (GS.getName() || "").toLowerCase();
    const list = top.length
      ? `<ul class="plist">${top.map((p, i) => `<li class="${p.name.toLowerCase() === me ? "win" : ""}"><span class="pname">${i < 3 ? ["🥇", "🥈", "🥉"][i] + " " : (i + 1) + ". "}${GS.esc(p.name)}</span><span class="psc">${p.points} P · ${p.wins}🏆</span></li>`).join("")}</ul>`
      : `<p class="msg">Noch keine Spiele gewertet — spielt die erste Runde zu Ende!</p>`;
    let mine = "";
    if (d.me) mine = `<p class="sub" style="margin-top:6px">Du (${GS.esc(d.me.name)}): Rang #${d.me.rank} · ${d.me.points} P · ${d.me.games} Spiele · ${d.me.wins} Siege · best ${d.me.best}</p>`;
    $("#sc-list").innerHTML = list + mine;
  } catch { const el = $("#sc-list"); if (el) el.innerHTML = `<p class="msg err">Bestenliste nicht erreichbar</p>`; }
}

function showMenu(msg, prefillCode) {
  view = "menu"; $("#board").classList.add("hidden"); players = []; showLeave(false); showEmotes(false); stopTimer();
  const invited = !!prefillCode;
  const o = overlay(`
    <h2><span class="foil">Wer weiß's?</span></h2>
    <p class="sub">${invited
      ? `Du wurdest in Raum <b>${GS.esc(prefillCode)}</b> eingeladen 🧠 — gib deinen Namen ein und tritt bei.`
      : `Alle beantworten dieselbe Frage — live, für <b>2–10 Spieler</b>. Schnell &amp; richtig = mehr Punkte. Erstelle einen Raum und teile den Code.`}</p>
    <p class="msg ${msg ? "err" : ""}">${msg ? GS.esc(msg) : ""}</p>
    <input type="text" id="mp-name" maxlength="14" placeholder="Dein Name" value="${GS.esc(GS.getName())}">
    ${invited ? `<button class="btn-primary" id="mp-joinbig">🧠 Raum ${GS.esc(prefillCode)} beitreten</button>` : `<button class="btn-primary" id="mp-create">➕ Raum erstellen</button>`}
    <div class="btn-row"><input type="text" id="mp-code" class="code" maxlength="6" placeholder="CODE" value="${GS.esc(prefillCode || "")}"><button class="btn-secondary" id="mp-join">Beitreten</button></div>
    <button class="btn-secondary" id="mp-scores" style="margin-top:10px">🏆 Bestenliste</button>
    <button class="btn-secondary" id="mp-badges">🏅 Meilensteine</button>`);
  const save = () => { const v = o.querySelector("#mp-name").value.trim().slice(0, 14); if (v) GS.setName(v); };
  const join = () => { save(); const c = o.querySelector("#mp-code").value.trim().toUpperCase(); if (/^[A-Z0-9]{4,6}$/.test(c)) connect(c); else o.querySelector(".msg").textContent = "Bitte gültigen Code eingeben."; };
  const create = o.querySelector("#mp-create"); if (create) create.onclick = () => { save(); connect(randCode()); };
  const joinBig = o.querySelector("#mp-joinbig"); if (joinBig) joinBig.onclick = join;
  o.querySelector("#mp-join").onclick = join;
  o.querySelector("#mp-scores").onclick = showScores;
  o.querySelector("#mp-badges").onclick = () => GS.badges.show("quiz", "Meilensteine");
  if (invited && !GS.getName()) { const n = o.querySelector("#mp-name"); if (n) n.focus(); }
}

// Nicht-Host-Spieler:innen, die auf „Bereit" getippt haben (Host zählt nicht mit).
function readyCount() { return players.filter(p => p.id !== hostId && p.ready).length; }
function guestCount() { return players.filter(p => p.id !== hostId).length; }
function lobbySubText() {
  const cats = roomCats.length ? roomCats.map(k => CAT_LABELS[k] || k).join(" · ") : "Alle Kategorien";
  return `${cats} · ${DIFF_LABELS[roomDiff] || "Alle"} · ${roomRounds} Fragen`;
}
function lobbyMsgText(meHost) {
  if (players.length < 2) return "Warte auf mindestens eine:n weitere:n …";
  if (meHost) { const g = guestCount(), r = readyCount(); return g > 0 ? `${r}/${g} bereit — du kannst jederzeit starten.` : "Bereit zum Start!"; }
  return "Warte auf den Host …";
}
function playerListHtml(meHost) {
  return players.map(p => {
    const you = p.id === myId ? " (du)" : "";
    const readyMark = (p.id !== hostId && p.ready) ? '<span class="pready">✓ bereit</span>' : "";
    let tail;
    if (p.id === hostId) tail = '<span class="phost">Host</span>';
    else if (meHost) tail = readyMark + `<button class="kick" data-kick="${p.id}" title="Entfernen">✕</button>`;
    else tail = readyMark;
    return `<li><span class="pname">${GS.esc(p.name)}${you}</span>${tail}</li>`;
  }).join("");
}

// Kategorie-Chips für die Abstimmung: eigene Stimmen hervorgehoben, Stimmenzahl je Kategorie.
function catChipsHtml() {
  return CAT_KEYS.map(k => {
    const n = roomCatVotes[k] || 0, mine = myVoteCats.includes(k);
    return `<button class="chip ${mine ? "on" : ""}" data-cat="${k}">${CAT_LABELS[k]}${n ? ` <span class="votec">${n}</span>` : ""}</button>`;
  }).join("");
}
function bindCatVote(o) {
  o.querySelectorAll("#lb-cats .chip").forEach(b => b.onclick = () => {
    const k = b.dataset.cat;
    myVoteCats = myVoteCats.includes(k) ? myVoteCats.filter(x => x !== k) : [...myVoteCats, k];
    saveVotes(); b.classList.toggle("on", myVoteCats.includes(k)); send({ t: "vote", cats: myVoteCats });
  });
}

function showLobby() {
  showLeave(true); showEmotes(false); stopTimer();
  const meHost = myId === hostId;
  const hostExtra = meHost
    ? `<div class="set-lbl">Schwierigkeit</div>
        <div class="chips" id="lb-diff">${DIFF_CHOICES.map(d => `<button class="chip ${roomDiff === d ? "on" : ""}" data-d="${d}">${DIFF_LABELS[d]}</button>`).join("")}</div>
        <div class="set-lbl">Fragen</div>
        <div class="chips" id="lb-rounds">${ROUND_CHOICES.map(n => `<button class="chip ${roomRounds === n ? "on" : ""}" data-r="${n}">${n}</button>`).join("")}</div>`
    : `<p class="sub lobby-sub">${lobbySubText()}</p>`;
  const settings = `<div class="lobby-set">
      <div class="set-lbl">Kategorien <span class="hint">(abstimmen — keine = alle)</span></div>
      <div class="chips" id="lb-cats">${catChipsHtml()}</div>
      ${hostExtra}
    </div>`;
  const o = overlay(`
    <h2>Warteraum</h2>
    <p class="sub">Teile den Code — Freunde tippen ihn im Menü ein. Ab <b>2 Spielern</b> kann der Host starten (bis 10).</p>
    <div class="code-big">${GS.esc(code)}</div>
    <button class="btn-secondary" id="lb-share">📤 Code teilen</button>
    ${settings}
    <ul class="plist">${playerListHtml(meHost)}</ul>
    <p class="msg" id="lb-msg">${lobbyMsgText(meHost)}</p>
    ${meHost ? `<button class="btn-primary" id="lb-start" ${players.length >= 2 ? "" : "disabled style=\"opacity:.5\""}>🧠 Starten</button>`
      : `<button class="btn-secondary ready-btn ${iAmReady ? "on" : ""}" id="lb-ready">${iAmReady ? "✓ Bereit" : "Bereit?"}</button>`}
    <button class="btn-secondary" id="lb-leave">Verlassen</button>`);
  o.querySelector("#lb-share").onclick = async () => { const r = await GS.share({ title: "Wer weiß's?", text: `Rate mit mir 🧠 — tipp auf den Link, dann bist du direkt im Raum ${code}:`, url: location.origin + "/quiz/?code=" + encodeURIComponent(code) }); if (r === "copied") o.querySelector("#lb-share").textContent = "✔ kopiert"; };
  // Kategorie-Abstimmung: für ALLE (nicht nur Host).
  bindCatVote(o);
  if (meHost) {
    o.querySelectorAll("#lb-rounds .chip").forEach(b => b.onclick = () => { roomRounds = +b.dataset.r; send({ t: "rounds", n: roomRounds }); o.querySelectorAll("#lb-rounds .chip").forEach(x => x.classList.toggle("on", x === b)); });
    o.querySelectorAll("#lb-diff .chip").forEach(b => b.onclick = () => { roomDiff = +b.dataset.d; send({ t: "diff", d: roomDiff }); o.querySelectorAll("#lb-diff .chip").forEach(x => x.classList.toggle("on", x === b)); });
    o.querySelectorAll("[data-kick]").forEach(b => b.onclick = () => { const id = +b.dataset.kick; const pl = players.find(x => x.id === id); if (confirm((pl ? pl.name : "Spieler:in") + " entfernen?")) send({ t: "kick", id }); });
  }
  const rb = o.querySelector("#lb-ready"); if (rb) rb.onclick = () => { iAmReady = !iAmReady; send({ t: "ready", v: iAmReady }); rb.classList.toggle("on", iAmReady); rb.textContent = iAmReady ? "✓ Bereit" : "Bereit?"; GS.haptic(8); };
  const st = o.querySelector("#lb-start"); if (st) st.onclick = () => send({ t: "start" });
  o.querySelector("#lb-leave").onclick = () => { leave(); showMenu(); };
}

// Warteraum-Update OHNE Neuaufbau (kein Flackern/Fokusverlust).
function updateLobby() {
  const o = document.getElementById("ov"); if (!o) return showLobby();
  const meHost = myId === hostId;
  const hostControls = !!o.querySelector("#lb-diff");   // host-only Steuerung (Kategorie-Chips hat jede:r)
  if (meHost !== hostControls) return showLobby();
  // Kategorie-Abstimmung live nachziehen (Stimmenzahlen), Fokus/Struktur bleibt.
  const catBox = o.querySelector("#lb-cats");
  if (catBox) { catBox.innerHTML = catChipsHtml(); bindCatVote(o); }
  const list = o.querySelector(".plist");
  if (list) {
    list.innerHTML = playerListHtml(meHost);
    if (meHost) list.querySelectorAll("[data-kick]").forEach(b => b.onclick = () => { const id = +b.dataset.kick; const pl = players.find(x => x.id === id); if (confirm((pl ? pl.name : "Spieler:in") + " entfernen?")) send({ t: "kick", id }); });
  }
  const msg = o.querySelector("#lb-msg");
  if (msg) msg.textContent = lobbyMsgText(meHost);
  const st = o.querySelector("#lb-start");
  if (st) { const ok = players.length >= 2; st.disabled = !ok; st.style.opacity = ok ? "" : ".5"; }
  const rb = o.querySelector("#lb-ready");
  if (rb) { rb.classList.toggle("on", iAmReady); rb.textContent = iAmReady ? "✓ Bereit" : "Bereit?"; }
  if (!meHost) { const sub = o.querySelector(".lobby-sub"); if (sub) sub.textContent = lobbySubText(); }
}

function showOver(list, history) {
  showLeave(true); showEmotes(false); stopTimer();
  if (Array.isArray(history)) lastHistory = history;
  const meHost = myId === hostId; const top = list[0];
  if (top && top.id === myId) { GS.sound.win(); confetti(); } else { GS.sound.good(); }
  // Meilensteine verbuchen (lokal). Nur werten, wenn die Runde wirklich lief.
  let chips = "";
  if (gStats.answered > 0 || gStats.total > 0) {
    const won = !!(top && top.id === myId);
    const perfect = gStats.total >= 5 && gStats.correct === gStats.total && gStats.answered === gStats.total;
    try {
      const newly = GS.badges.record("quiz", { won: won ? 1 : 0, correct: gStats.correct, streak: gStats.streakMax, fast: gStats.fast, perfect: perfect ? 1 : 0 });
      chips = GS.badges.chipsHtml(newly);
    } catch {}
  }
  const o = overlay(`
    <h2>🏆 Ergebnis</h2>
    <div class="win-name">${top ? GS.esc(top.name) + " gewinnt!" : ""}</div>
    ${chips}
    <ul class="plist">${list.map((p, i) => `<li class="${i === 0 ? "win" : ""}"><span class="pname">${i === 0 ? "🥇 " : i === 1 ? "🥈 " : i === 2 ? "🥉 " : (i + 1) + ". "}${GS.esc(p.name)}</span><span class="psc">${p.score || 0}</span></li>`).join("")}</ul>
    ${meHost ? `<button class="btn-primary" id="ov-again">🔄 Nochmal</button>` : `<p class="msg">Warte auf den Host …</p>`}
    <div class="btn-row">
      ${lastHistory.length ? `<button class="btn-secondary" id="ov-history">📜 Verlauf</button>` : ""}
      <button class="btn-secondary" id="ov-share">📤 Teilen</button>
    </div>
    <button class="btn-secondary" id="ov-badges">🏅 Meilensteine</button>
    <button class="btn-secondary" id="ov-scores">🏆 Bestenliste</button>
    <button class="btn-secondary" id="ov-leave">Verlassen</button>`);
  const ag = o.querySelector("#ov-again"); if (ag) ag.onclick = () => { send({ t: "start" }); };
  const hb = o.querySelector("#ov-history"); if (hb) hb.onclick = () => showHistory(lastHistory, list);
  o.querySelector("#ov-share").onclick = () => shareResult(list);
  o.querySelector("#ov-badges").onclick = () => GS.badges.show("quiz", "Meilensteine");
  o.querySelector("#ov-scores").onclick = showScores;
  o.querySelector("#ov-leave").onclick = () => { leave(); showMenu(); };
}

// Ergebnis-Verlauf: pro Frage die richtige Antwort und wer sie hatte. Kompakt,
// scrollbar. players = Endstand (für die Namenszuordnung der ok-IDs).
function showHistory(history, players) {
  const nameOf = id => { const p = (players || []).find(x => x.id === id); return p ? p.name : "?"; };
  const rows = (history || []).map(h => {
    const who = (h.ok || []).map(id => GS.esc(nameOf(id)) + (id === myId ? " (du)" : "")).join(", ");
    const mine = (h.ok || []).includes(myId);
    return `<li class="${mine ? "win" : "miss"}">
      <div class="hist-q"><b>${h.n}.</b> ${GS.esc(h.q)}</div>
      <div class="hist-a">✓ ${GS.esc(h.answer)}</div>
      <div class="hist-who">${who ? "Richtig: " + who : "Niemand richtig"}</div>
    </li>`;
  }).join("");
  const o = overlay2(`<h2>📜 Verlauf</h2><p class="sub">Alle ${(history || []).length} Fragen dieser Runde</p><ul class="plist hist">${rows || '<li class="miss">Kein Verlauf.</li>'}</ul><button class="btn-secondary" id="hist-close">Schließen</button>`);
  o.querySelector("#hist-close").onclick = closeOverlay2;
}

// Ergebnis als Bild/Text teilen (violette Quiz-Karte).
async function shareResult(list) {
  const idx = (list || []).findIndex(p => p.id === myId);
  const me = idx >= 0 ? list[idx] : null;
  const won = list && list[0] && list[0].id === myId;
  const sub = won ? "🏆 Gewonnen!" : (me ? `Platz ${idx + 1} von ${list.length}` : "Mitgeraten");
  try {
    await GS.shareCard({
      title: "Wer weiß's?", emoji: "🧠", accent: "#a97bff",
      big: me ? String(me.score || 0) : "", subtitle: sub,
      url: location.origin + "/quiz/",
      text: won ? "Ich hab bei „Wer weiß's?“ gewonnen 🧠🏆 — trau dich, spiel mit:" : "Ich hab bei „Wer weiß's?“ mitgeraten 🧠 — spiel mit:",
    });
  } catch {}
}

// ---------- Werkzeuge: 50:50-Joker & Frage melden ----------
function showTools(on) { const t = $("#tools"); if (t) t.classList.toggle("hidden", !on); }
function updateTools() {
  const f = $("#btn-fifty");
  if (f) { const avail = !fiftyUsed && !answered && phase === "question"; f.disabled = !avail; f.classList.toggle("spent", fiftyUsed); f.textContent = fiftyUsed ? "🎲 50:50 ✓" : "🎲 50:50"; }
}
function onFifty(m) {
  fiftyUsed = true; const hide = m.hide || [];
  $("#options").querySelectorAll(".opt").forEach((b, idx) => { if (hide.includes(idx)) { b.classList.add("eliminated"); b.disabled = true; } });
  updateTools(); GS.haptic(8); setNote("50:50 – zwei falsche Antworten raus.");
}
function doReport() {
  if (!curQuestion) return;
  send({ t: "report" });
  const r = $("#btn-report"); if (r) { r.disabled = true; r.textContent = "🚩 gemeldet ✓"; }
}
function onReported() { const r = $("#btn-report"); if (r) { r.disabled = true; r.textContent = "🚩 gemeldet ✓"; } }

// ---------- Stichfrage (Sudden Death) ----------
function onTiebreak(m) {
  closeOverlay(); closeOverlay2(); view = "playing"; phase = "tiebreak";
  $("#board").classList.remove("hidden"); showLeave(true); showEmotes(true); showTools(false);
  const tied = m.tied || []; tbAmTied = tied.some(t => t.id === myId);
  answered = false; myPick = -1; curOptions = m.options || []; curQuestion = m.q || "";
  $("#i-turn").textContent = "🥇 Stichfrage" + (m.round > 1 ? " " + m.round : "");
  $("#i-cat").textContent = m.cat && CAT_LABELS[m.cat] ? CAT_LABELS[m.cat] : "";
  $("#q-text").textContent = m.q || "";
  renderOptions(curOptions);
  if (!tbAmTied) { $("#options").querySelectorAll(".opt").forEach(b => b.disabled = true); setNote("Gleichstand! " + tied.map(t => GS.esc(t.name)).join(" & ") + " spielen um den Sieg …"); }
  else setNote("Gleichstand — erste richtige Antwort gewinnt! Kein Wechseln.");
  startTimer(m.time || 15); renderPlayers(); GS.sound.good();
}
function onTbOut(m) { if (m.id === myId) setNote("❌ Daneben – in dieser Stichfrage raus."); }
function onTbReveal(m) {
  phase = "reveal-tb"; stopTimer();
  $("#options").querySelectorAll(".opt").forEach((b, idx) => { b.disabled = true; if (idx === m.correct) { b.classList.add("correct"); const t = (b.querySelector(".opt-txt") || {}).textContent || ""; b.setAttribute("aria-label", t + " – richtige Antwort"); } });
  setNote("Niemand richtig — es geht weiter …");
}
function onTbResult(m) {
  phase = "reveal-tb"; stopTimer(); if (Array.isArray(m.players)) players = m.players;
  $("#options").querySelectorAll(".opt").forEach((b, idx) => { b.disabled = true; if (idx === m.correct) { b.classList.add("correct"); const t = (b.querySelector(".opt-txt") || {}).textContent || ""; b.setAttribute("aria-label", t + " – richtige Antwort"); } });
  renderPlayers();
  if (m.winnerId === myId) { GS.sound.win(); confetti(); } else GS.sound.good();
  overlay(`<h2>🥇 Stichfrage entschieden</h2><div class="win-name">${GS.esc(m.winnerName || "")} gewinnt!</div><p class="msg">Ergebnis kommt gleich …</p>`);
}

// ---------- Start / UI ----------
const soundBtn = $("#btn-sound");
soundBtn.textContent = GS.sound.on() ? "🔊" : "🔇";
soundBtn.onclick = () => { soundBtn.textContent = GS.sound.toggle() ? "🔊" : "🔇"; };
$("#btn-top").onclick = showScores;
$("#btn-leave").onclick = () => { if (confirm("Raum verlassen?")) { leave(); showMenu(); } };
{ const f = $("#btn-fifty"); if (f) f.onclick = () => { if (fiftyUsed || answered || phase !== "question") return; send({ t: "fifty" }); f.disabled = true; GS.haptic(8); }; }
{ const r = $("#btn-report"); if (r) r.onclick = doReport; }
function showLeave(on) { const b = $("#btn-leave"); if (b) b.classList.toggle("hidden", !on); }
window.addEventListener("beforeunload", leave);
// Zurück aus dem Hintergrund (App-Wechsel/Teilen): wenn die Verbindung weg ist,
// in JEDER Spielansicht (Lobby, laufendes Spiel, Ergebnis) frisch neu verbinden.
// Nur im Menü nicht — dort ist man bewusst draußen.
document.addEventListener("visibilitychange", () => {
  if (document.hidden || intentional || !code || view === "menu") return;
  if (!ws || ws.readyState > 1) { reTries = 0; connect(code, true); }
});

buildEmotes();
GS.badges.define("quiz", QUIZ_BADGES);
GS.markPlayed("quiz");
const pre = new URLSearchParams(location.search).get("code");
const preCode = pre && /^[A-Z0-9]{4,6}$/i.test(pre) ? pre.toUpperCase() : "";
// Nach einem Reload (z. B. weil iOS den Tab beim App-Wechsel neu lädt) den zuletzt
// aktiven Raum automatisch wieder betreten — gleiche Tab-UID ⇒ der Server erkennt
// den Reconnect und man taucht NICHT als zweiter „Spieler" auf.
let storedCode = ""; try { storedCode = sessionStorage.getItem("quiz_code") || ""; } catch {}
if (preCode && GS.getName()) connect(preCode);
else if (preCode) showMenu("", preCode);
else if (storedCode && /^[A-Z0-9]{4,6}$/.test(storedCode) && GS.getName()) connect(storedCode, true);
else showMenu();
