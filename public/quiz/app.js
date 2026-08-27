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
let roomCats = [], roomRounds = 10;
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
  film: "🎬 Film & Serien",
};
const CAT_KEYS = Object.keys(CAT_LABELS);
const ROUND_CHOICES = [5, 10, 15, 20];

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
  if (!isRe) { intentional = false; reTries = 0; }
  if (reTimer) { clearTimeout(reTimer); reTimer = null; }
  try { ws = new WebSocket(wsUrl(code)); } catch { return tryReconnect(); }
  ws.onopen = () => { reTries = 0; send({ t: "join", name: GS.getName() || "Spieler", uid: TAB_UID, dev: (GS.deviceId && GS.deviceId()) || "" }); if (pingT) clearInterval(pingT); pingT = setInterval(() => send({ t: "ping" }), 20000); };
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } onMsg(m); };
  ws.onclose = () => { if (pingT) { clearInterval(pingT); pingT = null; } if (intentional) return; tryReconnect(); };
  ws.onerror = () => {};
}
function tryReconnect() {
  if (intentional) return;
  if (reTries >= 6) { showMenu("Verbindung getrennt"); return; }
  reTries++;
  const mEl = document.querySelector("#ov .msg"); if (mEl) mEl.textContent = "Verbindung unterbrochen — verbinde neu …";
  reTimer = setTimeout(() => connect(code, true), 500 * reTries);
}
function send(o) { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); } catch {} }
function leave() { intentional = true; if (reTimer) clearTimeout(reTimer); try { ws && ws.close(); } catch {} ws = null; }

// ---------- Nachrichten ----------
function onMsg(m) {
  switch (m.t) {
    case "welcome": myId = m.id; break;
    case "full": showMenu("Raum ist voll (max. 10)."); leave(); break;
    case "kicked": leave(); showMenu("Du wurdest vom Host entfernt."); break;
    case "lobby":
      hostId = m.hostId; players = m.players || [];
      if (Array.isArray(m.cats)) roomCats = m.cats; if (m.rounds) roomRounds = m.rounds;
      renderPlayers();
      if (view === "playing" || view === "over") break;
      view = "lobby";
      if (document.getElementById("ov") && document.querySelector("#ov .plist")) updateLobby();
      else showLobby();
      break;
    case "question": onQuestion(m); break;
    case "answered": onAnswered(m); break;
    case "reveal": onReveal(m); break;
    case "over": view = "over"; showOver(m.players || []); break;
    case "emote": floatEmote(m.e); break;
    case "chat": /* Systemmeldungen (z. B. Kick) — dezent ignorieren im Quiz */ break;
    case "pong": break;
  }
}

function onQuestion(m) {
  closeOverlay(); view = "playing"; phase = "question";
  $("#board").classList.remove("hidden"); showLeave(true); showEmotes(true);
  if ((m.idx || 1) === 1) gStats = { answered: 0, correct: 0, streakCur: 0, streakMax: 0, fast: 0, total: m.total || 0 };
  gStats.total = m.total || gStats.total;
  answered = !!m.locked; myPick = m.locked ? (m.yourIdx != null ? m.yourIdx : -1) : -1; myLastFast = false;
  curOptions = m.options || [];
  $("#i-turn").textContent = "Frage " + (m.idx || 1) + (m.total ? "/" + m.total : "");
  $("#i-cat").textContent = "";
  $("#q-text").textContent = m.q || "";
  setNote("");
  renderOptions(curOptions);
  if (answered) { lockOptions(myPick); setNote("Antwort gespeichert — warte auf die anderen …"); }
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
  phase = "reveal"; stopTimer(); players = m.players || players; renderPlayers();
  // Meilenstein-Statistik der Runde fortschreiben.
  if (answered) {
    gStats.answered++;
    if (myPick === m.correct) { gStats.correct++; gStats.streakCur++; gStats.streakMax = Math.max(gStats.streakMax, gStats.streakCur); if (myLastFast) gStats.fast++; }
    else gStats.streakCur = 0;
  } else gStats.streakCur = 0;
  const opts = $("#options").querySelectorAll(".opt");
  opts.forEach((b, idx) => { b.disabled = true; if (idx === m.correct) b.classList.add("correct"); else if (idx === myPick) b.classList.add("wrong"); });
  const myGain = (m.gains || []).find(g => g.id === myId);
  if (answered && myPick === m.correct) { setNote("✅ Richtig! +" + (myGain ? myGain.gain : 0), "good"); floatPoints("+" + (myGain ? myGain.gain : 0), true); GS.sound.great(); GS.haptic(20); confetti(); }
  else if (answered) { setNote("❌ Leider falsch", "bad"); GS.sound.tone(180, 0.18, { type: "sawtooth", gain: 0.06 }); GS.haptic(10); }
  else { setNote("⏱️ Zu langsam!", "muted"); }
}

// ---------- Optionen ----------
function renderOptions(options) {
  const el = $("#options");
  el.innerHTML = options.map((o, i) => `<button class="opt" data-i="${i}"><span class="opt-key">${"ABCD"[i]}</span><span class="opt-txt">${GS.esc(o)}</span></button>`).join("");
  el.querySelectorAll(".opt").forEach(b => b.onclick = () => pickAnswer(+b.dataset.i));
}
function pickAnswer(i) {
  if (answered || phase !== "question") return;
  answered = true; myPick = i;
  // „Schnell" = in der ersten Zughälfte geantwortet (für den Speed-Meilenstein).
  myLastFast = (timeEnd - performance.now()) >= (timeTotal * 1000) / 2;
  send({ t: "answer", i });
  lockOptions(i);
  setNote("Antwort gespeichert — warte auf die anderen …");
  GS.sound.click(); GS.haptic(8);
}
function lockOptions(i) {
  myPick = i;
  $("#options").querySelectorAll(".opt").forEach((b, idx) => { b.disabled = true; b.classList.toggle("mine", idx === i); });
}
function setNote(txt, kind) {
  const n = $("#q-note"); if (!n) return;
  n.textContent = txt || "";
  n.className = "q-note" + (kind ? " " + kind : "");
}

// ---------- Timer ----------
let timerRAF = null, lastTickSec = -1;
function startTimer(sec) { timeTotal = sec; timeEnd = performance.now() + sec * 1000; lastTickSec = -1; if (!timerRAF) tickTimer(); }
function stopTimer() { if (timerRAF) cancelAnimationFrame(timerRAF); timerRAF = null; }
function tickTimer() {
  const left = Math.max(0, timeEnd - performance.now());
  const secs = Math.ceil(left / 1000);
  $("#timefill").style.width = (left / (timeTotal * 1000) * 100) + "%";
  $("#i-time").textContent = secs + "s";
  if (phase === "question" && !answered && secs <= 5 && secs >= 1 && secs !== lastTickSec) {
    lastTickSec = secs; GS.sound.tone(secs <= 2 ? 880 : 640, 0.07, { type: "triangle", gain: 0.08 }); if (secs <= 2) GS.haptic(10);
  }
  if (left <= 0) { timerRAF = null; return; }
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
  el.innerHTML = players.map(p => `<span class="pl ${p.answered ? "answered" : ""}">${GS.esc(p.name)}${p.id === myId ? " (du)" : ""} <b>${p.score || 0}</b></span>`).join("");
}

// ---------- Overlays ----------
function closeOverlay() { const o = $("#ov"); if (o) o.remove(); }
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

function showLobby() {
  showLeave(true); showEmotes(false); stopTimer();
  const meHost = myId === hostId;
  const settings = meHost
    ? `<div class="lobby-set">
        <div class="set-lbl">Kategorien <span class="hint">(keine = alle)</span></div>
        <div class="chips" id="lb-cats">${CAT_KEYS.map(k => `<button class="chip ${roomCats.includes(k) ? "on" : ""}" data-cat="${k}">${CAT_LABELS[k]}</button>`).join("")}</div>
        <div class="set-lbl">Fragen</div>
        <div class="chips" id="lb-rounds">${ROUND_CHOICES.map(n => `<button class="chip ${roomRounds === n ? "on" : ""}" data-r="${n}">${n}</button>`).join("")}</div>
      </div>`
    : `<p class="sub lobby-sub">${roomCats.length ? roomCats.map(k => CAT_LABELS[k] || k).join(" · ") : "Alle Kategorien"} · ${roomRounds} Fragen</p>`;
  const o = overlay(`
    <h2>Warteraum</h2>
    <p class="sub">Teile den Code — Freunde tippen ihn im Menü ein. Ab <b>2 Spielern</b> kann der Host starten (bis 10).</p>
    <div class="code-big">${GS.esc(code)}</div>
    <button class="btn-secondary" id="lb-share">📤 Code teilen</button>
    ${settings}
    <ul class="plist">${players.map(p => `<li><span class="pname">${GS.esc(p.name)}${p.id === myId ? " (du)" : ""}</span>${p.id === hostId ? '<span class="phost">Host</span>' : (meHost ? `<button class="kick" data-kick="${p.id}" title="Entfernen">✕</button>` : "")}</li>`).join("")}</ul>
    <p class="msg" id="lb-msg">${players.length < 2 ? "Warte auf mindestens eine:n weitere:n …" : (meHost ? "Bereit zum Start!" : "Warte auf den Host …")}</p>
    ${meHost ? `<button class="btn-primary" id="lb-start" ${players.length >= 2 ? "" : "disabled style=\"opacity:.5\""}>🧠 Starten</button>` : ""}
    <button class="btn-secondary" id="lb-leave">Verlassen</button>`);
  o.querySelector("#lb-share").onclick = async () => { const r = await GS.share({ title: "Wer weiß's?", text: `Rate mit mir 🧠 — tipp auf den Link, dann bist du direkt im Raum ${code}:`, url: location.origin + "/quiz/?code=" + encodeURIComponent(code) }); if (r === "copied") o.querySelector("#lb-share").textContent = "✔ kopiert"; };
  if (meHost) {
    o.querySelectorAll("#lb-cats .chip").forEach(b => b.onclick = () => {
      const k = b.dataset.cat; roomCats = roomCats.includes(k) ? roomCats.filter(x => x !== k) : [...roomCats, k];
      b.classList.toggle("on"); send({ t: "cat", cats: roomCats });
    });
    o.querySelectorAll("#lb-rounds .chip").forEach(b => b.onclick = () => { roomRounds = +b.dataset.r; send({ t: "rounds", n: roomRounds }); o.querySelectorAll("#lb-rounds .chip").forEach(x => x.classList.toggle("on", x === b)); });
    o.querySelectorAll("[data-kick]").forEach(b => b.onclick = () => { const id = +b.dataset.kick; const pl = players.find(x => x.id === id); if (confirm((pl ? pl.name : "Spieler:in") + " entfernen?")) send({ t: "kick", id }); });
  }
  const st = o.querySelector("#lb-start"); if (st) st.onclick = () => send({ t: "start" });
  o.querySelector("#lb-leave").onclick = () => { leave(); showMenu(); };
}

// Warteraum-Update OHNE Neuaufbau (kein Flackern/Fokusverlust).
function updateLobby() {
  const o = document.getElementById("ov"); if (!o) return showLobby();
  const meHost = myId === hostId;
  const hostControls = !!o.querySelector("#lb-cats");
  if (meHost !== hostControls) return showLobby();
  const list = o.querySelector(".plist");
  if (list) {
    list.innerHTML = players.map(p => `<li><span class="pname">${GS.esc(p.name)}${p.id === myId ? " (du)" : ""}</span>${p.id === hostId ? '<span class="phost">Host</span>' : (meHost ? `<button class="kick" data-kick="${p.id}" title="Entfernen">✕</button>` : "")}</li>`).join("");
    if (meHost) list.querySelectorAll("[data-kick]").forEach(b => b.onclick = () => { const id = +b.dataset.kick; const pl = players.find(x => x.id === id); if (confirm((pl ? pl.name : "Spieler:in") + " entfernen?")) send({ t: "kick", id }); });
  }
  const msg = o.querySelector("#lb-msg");
  if (msg) msg.textContent = players.length < 2 ? "Warte auf mindestens eine:n weitere:n …" : (meHost ? "Bereit zum Start!" : "Warte auf den Host …");
  const st = o.querySelector("#lb-start");
  if (st) { const ok = players.length >= 2; st.disabled = !ok; st.style.opacity = ok ? "" : ".5"; }
  if (!meHost) { const sub = o.querySelector(".lobby-sub"); if (sub) sub.textContent = (roomCats.length ? roomCats.map(k => CAT_LABELS[k] || k).join(" · ") : "Alle Kategorien") + " · " + roomRounds + " Fragen"; }
}

function showOver(list) {
  showLeave(true); showEmotes(false); stopTimer();
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
    <button class="btn-secondary" id="ov-badges">🏅 Meilensteine</button>
    <button class="btn-secondary" id="ov-scores">🏆 Bestenliste</button>
    <button class="btn-secondary" id="ov-leave">Verlassen</button>`);
  const ag = o.querySelector("#ov-again"); if (ag) ag.onclick = () => { send({ t: "start" }); };
  o.querySelector("#ov-badges").onclick = () => GS.badges.show("quiz", "Meilensteine");
  o.querySelector("#ov-scores").onclick = showScores;
  o.querySelector("#ov-leave").onclick = () => { leave(); showMenu(); };
}

// ---------- Start / UI ----------
const soundBtn = $("#btn-sound");
soundBtn.textContent = GS.sound.on() ? "🔊" : "🔇";
soundBtn.onclick = () => { soundBtn.textContent = GS.sound.toggle() ? "🔊" : "🔇"; };
$("#btn-top").onclick = showScores;
$("#btn-leave").onclick = () => { if (confirm("Raum verlassen?")) { leave(); showMenu(); } };
function showLeave(on) { const b = $("#btn-leave"); if (b) b.classList.toggle("hidden", !on); }
window.addEventListener("beforeunload", leave);
document.addEventListener("visibilitychange", () => { if (document.hidden || intentional || !code) return; if ((view === "lobby" || view === "over") && (!ws || ws.readyState > 1)) { reTries = 0; connect(code, true); } });

buildEmotes();
GS.badges.define("quiz", QUIZ_BADGES);
GS.markPlayed("quiz");
const pre = new URLSearchParams(location.search).get("code");
const preCode = pre && /^[A-Z0-9]{4,6}$/i.test(pre) ? pre.toUpperCase() : "";
if (preCode && GS.getName()) connect(preCode);
else if (preCode) showMenu("", preCode);
else showMenu();
