// ====================================================================
// KRITZELN & RATEN — Client. WebSocket zum DrawRoom-DO (Wahrheit für Wort,
// Runden, Punkte). Zeichner:in schickt Striche (relay), alle raten im Chat.
// Reconnect wie bei Tron (Hintergrund/Teilen kappt die Verbindung).
// ====================================================================
const $ = s => document.querySelector(s);
const GS = window.GS;
const canvas = $("#paper"), ctx = canvas.getContext("2d");
const REF = 800;
let cw = 0, ch = 0, DPR = 1;
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  const r = canvas.getBoundingClientRect(); cw = r.width; ch = r.height;
  canvas.width = Math.round(cw * DPR); canvas.height = Math.round(ch * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  redraw();
}
window.addEventListener("resize", () => { if (view === "playing") resize(); });

// ---------- Netz-/Spielzustand ----------
let ws = null, myId = null, hostId = null, code = "";
let view = "menu";                 // menu | lobby | playing | over
let players = [];                  // aus lobby/turnEnd
let iAmDrawer = false, phase = "", curWord = "", timeEnd = 0, timeTotal = 1;
let strokes = [];                  // {pts:[{x,y}], c, w}
let pingT = null, intentional = false, wantStartName = "", reTries = 0, reTimer = null;

// Zeichnen
let drawing = false, curColor = "#111827", curW = 6, curStroke = null, firstFlush = false, lastSentIdx = 0;

// Pro-Tab stabile Spieler-ID: übersteht Reload/Hintergrund (Reconnect behält
// dieselbe Identität), zwei Tabs = zwei Spieler. Nicht geräteweit (deviceId),
// damit man zum Testen zwei Fenster nebeneinander offen haben kann.
const TAB_UID = (() => {
  try { let u = sessionStorage.getItem("kritzeln_uid"); if (!u) { const a = new Uint8Array(12); crypto.getRandomValues(a); u = [...a].map(b => b.toString(16).padStart(2, "0")).join(""); sessionStorage.setItem("kritzeln_uid", u); } return u; }
  catch { return "t" + Math.floor(performance.now()).toString(36); }
})();

const wsUrl = c => (location.protocol === "https:" ? "wss" : "ws") + "://" + location.host + "/api/kritzeln-live?code=" + encodeURIComponent(c);
const CODE_ABC = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const randCode = () => { const a = new Uint8Array(4); crypto.getRandomValues(a); return [...a].map(b => CODE_ABC[b % CODE_ABC.length]).join(""); };
const r4 = v => Math.round(v * 1e4) / 1e4;
// Wortmuster mit Abständen darstellen: "_A__" → "_ A _ _"
const spaced = s => [...String(s || "")].join(" ");

function connect(c, isRe) {
  code = c.toUpperCase();
  if (!isRe) { intentional = false; reTries = 0; }
  if (reTimer) { clearTimeout(reTimer); reTimer = null; }
  try { ws = new WebSocket(wsUrl(code)); } catch { return tryReconnect(); }
  ws.onopen = () => { reTries = 0; send({ t: "join", name: GS.getName() || "Spieler", uid: TAB_UID }); if (pingT) clearInterval(pingT); pingT = setInterval(() => send({ t: "ping" }), 20000); };
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
    case "full": showMenu("Raum ist voll (max. 8)."); leave(); break;
    case "lobby":
      hostId = m.hostId; players = m.players || [];
      renderPlayers();
      if (view === "playing" || view === "over") break;
      view = "lobby"; showLobby(); break;
    case "choices": showWordPick(m.words); break;
    case "turn": onTurn(m); break;
    case "word": curWord = m.word; if (iAmDrawer) $("#i-word").innerHTML = "<b>" + GS.esc(m.word) + "</b>"; break;
    case "draw": if (!iAmDrawer) { const pts = m.pts.map(p => ({ x: p[0], y: p[1] })); strokes.push({ pts, c: m.c, w: m.w }); drawSeg(pts, m.c, m.w); } break;
    case "clear": strokes = []; clearCanvas(); break;
    case "hint": $("#i-word").textContent = spaced(m.pattern); break;
    case "chat": addChat(m.kind, m.name, m.text); break;
    case "guessed":
      addChat("good", null, (m.id === myId ? "Richtig! 🎉" : GS.esc(m.name) + " hat es erraten! ✅"));
      if (m.id === myId) { setGuessEnabled(false); }
      const pl = players.find(p => p.id === m.id); if (pl) pl.guessed = true; renderPlayers();
      break;
    case "close": addChat("close", null, "Ganz nah dran! 🔥"); break;
    case "turnEnd": onTurnEnd(m); break;
    case "over": view = "over"; showOver(m.players || []); break;
    case "pong": break;
  }
}

function onTurn(m) {
  closeOverlay(); view = "playing"; $("#board").classList.remove("hidden");
  iAmDrawer = m.drawerId === myId; strokes = []; clearCanvas(); resize();
  $("#i-turn").textContent = "Runde " + (m.round || 1) + " · Zug " + (m.turn || (m.round || 1)) + (m.total ? "/" + m.total : "");
  const drawer = players.find(p => p.id === m.drawerId);
  if (m.phase === "choose") {
    phase = "choose"; setTools(false); setGuessEnabled(false); stopTimer();
    $("#i-word").textContent = "";
    showNote(iAmDrawer ? "Wähle ein Wort …" : ((drawer ? drawer.name : "Jemand") + " wählt ein Wort …"));
    $("#i-time").textContent = "—"; $("#timefill").style.width = "100%";
  } else if (m.phase === "draw") {
    phase = "draw"; hideNote();
    if (iAmDrawer) { $("#i-word").innerHTML = curWord ? "<b>" + GS.esc(curWord) + "</b>" : "…"; setTools(true); setGuessEnabled(false); }
    else { $("#i-word").textContent = spaced(m.pattern || ""); setTools(false); setGuessEnabled(true); }
    startTimer(m.time || 75);
  }
  renderPlayers(m.drawerId);
}

function onTurnEnd(m) {
  phase = "reveal"; stopTimer(); setTools(false); setGuessEnabled(false);
  players = m.players || players; renderPlayers();
  showNote("Das Wort war: " + m.word);
  addChat("sys", null, "Das Wort war „" + GS.esc(m.word) + "“.");
}

// ---------- Zeichnen ----------
function toNorm(e) { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; }
function clearCanvas() { ctx.clearRect(0, 0, cw, ch); }
function drawSeg(pts, c, w) {
  if (!pts.length) return;
  ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.lineWidth = w * (cw / REF);
  ctx.beginPath(); ctx.moveTo(pts[0].x * cw, pts[0].y * ch);
  if (pts.length === 1) { ctx.arc(pts[0].x * cw, pts[0].y * ch, (w * (cw / REF)) / 2, 0, 6.2832); ctx.fill(); return; }
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * cw, pts[i].y * ch);
  ctx.stroke();
}
function redraw() { clearCanvas(); for (const s of strokes) drawSeg(s.pts, s.c, s.w); }

canvas.addEventListener("pointerdown", e => {
  if (view !== "playing" || phase !== "draw" || !iAmDrawer) return;
  drawing = true; const p = toNorm(e); curStroke = { pts: [p], c: curColor, w: curW }; strokes.push(curStroke);
  firstFlush = true; lastSentIdx = 0; drawSeg([p], curColor, curW);
});
canvas.addEventListener("pointermove", e => {
  if (!drawing) return; const p = toNorm(e); const prev = curStroke.pts[curStroke.pts.length - 1];
  curStroke.pts.push(p); drawSeg([prev, p], curStroke.c, curStroke.w);
});
function endStroke() { if (drawing) { flush(); drawing = false; } }
canvas.addEventListener("pointerup", endStroke);
canvas.addEventListener("pointercancel", endStroke);
canvas.addEventListener("pointerleave", endStroke);
function flush() {
  if (!drawing || !curStroke) return;
  const pts = curStroke.pts;
  if (!firstFlush && lastSentIdx >= pts.length - 1) return;
  const start = firstFlush ? 0 : lastSentIdx;
  const batch = pts.slice(start).map(p => [r4(p.x), r4(p.y)]);
  if (!batch.length) return;
  send({ t: "stroke", pts: batch, c: curStroke.c, w: curStroke.w, s: firstFlush });
  lastSentIdx = pts.length - 1; firstFlush = false;
}
setInterval(() => { if (drawing && iAmDrawer) flush(); }, 55);

// ---------- Werkzeuge ----------
const COLORS = ["#111827", "#6b7280", "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#8b5cf6", "#ec4899", "#8b5a2b"];
const SIZES = [3, 6, 12, 20];
function buildTools() {
  $("#swatches").innerHTML = COLORS.map((c, i) => `<i data-c="${c}" style="background:${c}" class="${i === 0 ? "sel" : ""}"></i>`).join("") + `<i data-c="#fbfdff" style="background:#fbfdff" title="Radierer">⌫</i>`;
  $("#sizes").innerHTML = SIZES.map((s, i) => `<i data-s="${s}" class="${i === 1 ? "sel" : ""}"><b style="width:${Math.min(18, s)}px;height:${Math.min(18, s)}px"></b></i>`).join("");
  $("#swatches").querySelectorAll("i").forEach(el => el.onclick = () => { curColor = el.dataset.c; $("#swatches").querySelectorAll("i").forEach(x => x.classList.remove("sel")); el.classList.add("sel"); });
  $("#sizes").querySelectorAll("i").forEach(el => el.onclick = () => { curW = +el.dataset.s; $("#sizes").querySelectorAll("i").forEach(x => x.classList.remove("sel")); el.classList.add("sel"); });
  $("#t-clear").onclick = () => { strokes = []; clearCanvas(); send({ t: "clear" }); };
}
function setTools(on) { $("#tools").classList.toggle("hidden", !on); }

// ---------- Timer ----------
let timerRAF = null;
function startTimer(sec) { timeTotal = sec; timeEnd = performance.now() + sec * 1000; if (!timerRAF) tickTimer(); }
function stopTimer() { if (timerRAF) cancelAnimationFrame(timerRAF); timerRAF = null; }
function tickTimer() {
  const left = Math.max(0, timeEnd - performance.now());
  $("#timefill").style.width = (left / (timeTotal * 1000) * 100) + "%";
  $("#i-time").textContent = Math.ceil(left / 1000) + "s";
  if (left <= 0) { timerRAF = null; return; }
  timerRAF = requestAnimationFrame(tickTimer);
}

// ---------- Chat / Spieler ----------
function addChat(kind, name, text) {
  const box = $("#chat"); const d = document.createElement("div");
  d.className = "c " + (kind === "good" ? "good" : kind === "sys" || kind === "system" ? "sys" : kind === "close" ? "close" : "");
  d.innerHTML = name ? `<span class="nm">${GS.esc(name)}:</span> ${GS.esc(text)}` : text;
  box.appendChild(d); box.scrollTop = box.scrollHeight;
  while (box.children.length > 80) box.removeChild(box.firstChild);
}
function renderPlayers(drawerId) {
  const el = $("#players"); if (!el) return;
  const dId = drawerId != null ? drawerId : (players.find(p => p.drawer) || {}).id;
  el.innerHTML = players.map(p => `<span class="pl ${p.id === dId ? "drawing" : ""} ${p.guessed ? "guessed" : ""}">${p.id === dId ? '<span class="pen">✏️</span>' : ""}${GS.esc(p.name)}${p.id === myId ? " (du)" : ""} <b>${p.score || 0}</b></span>`).join("");
}
function setGuessEnabled(on) {
  $("#inputbar").classList.toggle("hidden", !on);
  const g = $("#guess"); if (on) { g.disabled = false; g.value = ""; } else g.disabled = true;
}
$("#guess-send").onclick = sendGuess;
$("#guess").addEventListener("keydown", e => { if (e.key === "Enter") sendGuess(); });
function sendGuess() { const g = $("#guess"); const t = g.value.trim(); if (!t) return; send({ t: "guess", text: t }); g.value = ""; }

// ---------- Canvas-Notiz ----------
function showNote(txt) { const n = $("#cv-note"); n.textContent = txt; n.classList.remove("hidden"); }
function hideNote() { $("#cv-note").classList.add("hidden"); }

// ---------- Overlays ----------
function closeOverlay() { const o = $("#ov"); if (o) o.remove(); }
function overlay(html) { closeOverlay(); const o = document.createElement("div"); o.id = "ov"; o.className = "overlay"; o.innerHTML = `<div class="panel">${html}</div>`; document.body.appendChild(o); return o; }
// Zweite Overlay-Ebene (stapelt über Menü/Warteraum/Ergebnis) für die Bestenliste.
function closeOverlay2() { const o = $("#ov2"); if (o) o.remove(); }
function overlay2(html) { closeOverlay2(); const o = document.createElement("div"); o.id = "ov2"; o.className = "overlay"; o.style.zIndex = "60"; o.innerHTML = `<div class="panel">${html}</div>`; document.body.appendChild(o); o.onclick = e => { if (e.target === o) closeOverlay2(); }; return o; }

async function showScores() {
  const o = overlay2(`<h2>🏆 Bestenliste</h2><p class="sub">Gesamtpunkte über alle Kritzeln-Spiele</p><div id="sc-list"><p class="msg">Lade …</p></div><button class="btn-secondary" id="sc-close">Schließen</button>`);
  o.querySelector("#sc-close").onclick = closeOverlay2;
  try {
    const r = await fetch("/api/kritzeln-scores?me=" + encodeURIComponent(GS.getName() || ""));
    const d = await r.json(); const top = d.top || []; const me = (GS.getName() || "").toLowerCase();
    const list = top.length
      ? `<ul class="plist">${top.map((p, i) => `<li class="${p.name.toLowerCase() === me ? "win" : ""}"><span class="pname">${i < 3 ? ["🥇", "🥈", "🥉"][i] + " " : (i + 1) + ". "}${GS.esc(p.name)}</span><span class="psc">${p.points} P · ${p.wins}🏆</span></li>`).join("")}</ul>`
      : `<p class="msg">Noch keine Spiele gewertet — spielt die erste Runde zu Ende!</p>`;
    let mine = "";
    if (d.me) mine = `<p class="sub" style="margin-top:6px">Du (${GS.esc(d.me.name)}): Rang #${d.me.rank} · ${d.me.points} P · ${d.me.games} Spiele · ${d.me.wins} Siege · best ${d.me.best}</p>`;
    $("#sc-list").innerHTML = list + mine;
  } catch { const el = $("#sc-list"); if (el) el.innerHTML = `<p class="msg err">Bestenliste nicht erreichbar</p>`; }
}

function showMenu(msg) {
  view = "menu"; $("#board").classList.add("hidden"); setGuessEnabled(false); players = [];
  const o = overlay(`
    <h2><span class="foil">Kritzeln &amp; Raten</span></h2>
    <p class="sub">Einer malt, die anderen raten — live, für <b>2–8 Spieler</b>. Erstelle einen Raum und teile den Code.</p>
    <p class="msg ${msg ? "err" : ""}">${msg ? GS.esc(msg) : ""}</p>
    <input type="text" id="mp-name" maxlength="14" placeholder="Dein Name" value="${GS.esc(GS.getName())}">
    <button class="btn-primary" id="mp-create">➕ Raum erstellen</button>
    <div class="btn-row"><input type="text" id="mp-code" class="code" maxlength="6" placeholder="CODE"><button class="btn-secondary" id="mp-join">Beitreten</button></div>
    <button class="btn-secondary" id="mp-scores" style="margin-top:10px">🏆 Bestenliste</button>`);
  const save = () => { const v = o.querySelector("#mp-name").value.trim().slice(0, 14); if (v) GS.setName(v); };
  o.querySelector("#mp-create").onclick = () => { save(); connect(randCode()); };
  o.querySelector("#mp-join").onclick = () => { save(); const c = o.querySelector("#mp-code").value.trim().toUpperCase(); if (/^[A-Z0-9]{4,6}$/.test(c)) connect(c); else o.querySelector(".msg").textContent = "Bitte gültigen Code eingeben."; };
  o.querySelector("#mp-scores").onclick = showScores;
}

function showLobby() {
  const meHost = myId === hostId;
  const o = overlay(`
    <h2>Warteraum</h2>
    <p class="sub">Teile den Code — Freunde tippen ihn im Menü ein. Ab <b>2 Spielern</b> kann der Host starten.</p>
    <div class="code-big">${GS.esc(code)}</div>
    <button class="btn-secondary" id="lb-share">📤 Code teilen</button>
    <ul class="plist">${players.map(p => `<li><span class="pname">${GS.esc(p.name)}${p.id === myId ? " (du)" : ""}</span>${p.id === hostId ? '<span class="phost">Host</span>' : ""}</li>`).join("")}</ul>
    <p class="msg">${players.length < 2 ? "Warte auf mindestens eine:n weitere:n …" : (meHost ? "Bereit zum Start!" : "Warte auf den Host …")}</p>
    ${meHost ? `<button class="btn-primary" id="lb-start" ${players.length >= 2 ? "" : "disabled style=\"opacity:.5\""}>🎨 Starten</button>` : ""}
    <button class="btn-secondary" id="lb-leave">Verlassen</button>`);
  o.querySelector("#lb-share").onclick = async () => { const r = await GS.share({ title: "Kritzeln & Raten", text: `Mal & rate mit mir 🎨 — Raum-Code ${code}`, url: location.origin + "/kritzeln/" }); if (r === "copied") o.querySelector("#lb-share").textContent = "✔ kopiert"; };
  const st = o.querySelector("#lb-start"); if (st) st.onclick = () => send({ t: "start" });
  o.querySelector("#lb-leave").onclick = () => { leave(); showMenu(); };
}

function showWordPick(words) {
  const o = overlay(`<h2>Dein Wort</h2><p class="sub">Wähle, was du zeichnest:</p><div class="wordpick">${words.map(w => `<button class="btn-primary" data-w="${GS.esc(w)}">${GS.esc(w)}</button>`).join("")}</div>`);
  o.querySelectorAll("[data-w]").forEach(b => b.onclick = () => { send({ t: "choose", word: b.dataset.w }); closeOverlay(); });
}

function showOver(list) {
  const meHost = myId === hostId; const top = list[0];
  const o = overlay(`
    <h2>🏆 Ergebnis</h2>
    <div class="win-name" style="color:var(--gold);font-family:var(--font-display);font-weight:800;font-size:1.6rem;margin:2px 0 12px">${top ? GS.esc(top.name) + " gewinnt!" : ""}</div>
    <ul class="plist">${list.map((p, i) => `<li class="${i === 0 ? "win" : ""}"><span class="pname">${i === 0 ? "🥇 " : i === 1 ? "🥈 " : i === 2 ? "🥉 " : (i + 1) + ". "}${GS.esc(p.name)}</span><span class="psc">${p.score || 0}</span></li>`).join("")}</ul>
    ${meHost ? `<button class="btn-primary" id="ov-again">🔄 Nochmal</button>` : `<p class="msg">Warte auf den Host …</p>`}
    <button class="btn-secondary" id="ov-scores">🏆 Bestenliste</button>
    <button class="btn-secondary" id="ov-leave">Verlassen</button>`);
  const ag = o.querySelector("#ov-again"); if (ag) ag.onclick = () => { send({ t: "start" }); };
  o.querySelector("#ov-scores").onclick = showScores;
  o.querySelector("#ov-leave").onclick = () => { leave(); showMenu(); };
}

// ---------- Start / UI ----------
const soundBtn = $("#btn-sound");
soundBtn.textContent = GS.sound.on() ? "🔊" : "🔇";
soundBtn.onclick = () => { soundBtn.textContent = GS.sound.toggle() ? "🔊" : "🔇"; };
$("#btn-top").onclick = showScores;
window.addEventListener("beforeunload", leave);
document.addEventListener("visibilitychange", () => { if (document.hidden || intentional || !code) return; if ((view === "lobby" || view === "over") && (!ws || ws.readyState > 1)) { reTries = 0; connect(code, true); } });

buildTools();
GS.markPlayed("kritzeln");
const pre = new URLSearchParams(location.search).get("code");
if (pre && /^[A-Z0-9]{4,6}$/i.test(pre)) connect(pre.toUpperCase()); else showMenu();
