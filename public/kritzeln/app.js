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
let strokes = [];                  // Ops: {k:"s",pts:[{x,y}],c,w,e} Strich  |  {k:"f",x,y,c} Füllung
let roomCats = [], roomRounds = 2, roomCustom = 0; // aus lobby (Kategorien/Runden/Anzahl eigene Wörter)
let customText = "";               // Textfeld-Inhalt der eigenen Wortliste (überlebt Re-Render)
let pingT = null, intentional = false, wantStartName = "", reTries = 0, reTimer = null;

// Zeichnen
let drawing = false, curColor = "#111827", curW = 6, curStroke = null, firstFlush = false, lastSentIdx = 0;
let tool = "pen";                  // pen | eraser | fill

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
      if (typeof m.customCount === "number") roomCustom = m.customCount;
      renderPlayers();
      if (view === "playing" || view === "over") break;
      view = "lobby";
      // Läuft der Warteraum schon? Nur die dynamischen Teile aktualisieren statt
      // den ganzen Overlay neu zu bauen — sonst flackert es bei jeder Einstellung
      // und der Host verliert beim Tippen den Fokus im Wörter-Feld.
      if (document.getElementById("ov") && document.querySelector("#ov .plist")) updateLobby();
      else showLobby();
      break;
    case "choices": showWordPick(m.words, m.time); break;
    case "emote": floatEmote(m.e); break;
    case "turn": onTurn(m); break;
    case "word": curWord = m.word; if (iAmDrawer) $("#i-word").innerHTML = "<b>" + GS.esc(m.word) + "</b>"; break;
    case "draw": if (!iAmDrawer) {
      const pts = m.pts.map(p => ({ x: p[0], y: p[1] })); const last = strokes[strokes.length - 1];
      if (m.s || !last || last.k !== "s") { strokes.push({ k: "s", pts: pts.slice(), c: m.c, w: m.w, e: !!m.e }); drawSeg(pts, m.c, m.w, m.e); }
      else { last.pts.push(...pts.slice(1)); drawSeg(pts, m.c, m.w, m.e); }   // pts[0] überlappt letzten Punkt → verbindet
    } break;
    case "fill": if (!iAmDrawer) { strokes.push({ k: "f", x: m.x, y: m.y, c: m.c }); floodFill(m.x, m.y, m.c); } break;
    case "undo": if (!iAmDrawer) { strokes.pop(); redraw(); } break;
    case "snapshot": applySnapshot(m.ops || []); break;
    case "clear": strokes = []; clearCanvas(); break;
    case "hint": $("#i-word").textContent = spaced(m.pattern); break;
    case "chat": addChat(m.kind, m.name, m.text); break;
    case "guessed": {
      const mine = m.id === myId;
      addChat("good", null, mine ? ("Richtig! 🎉 +" + (m.gain || "")) : GS.esc(m.name) + " hat es erraten! ✅");
      if (mine) { setGuessEnabled(false); GS.sound.great(); GS.haptic(20); confetti(); }
      else if (iAmDrawer) { GS.sound.good(); }
      const pl = players.find(p => p.id === m.id); if (pl) pl.guessed = true; renderPlayers();
      break;
    }
    case "close": addChat("close", null, "Ganz nah dran! 🔥"); break;
    case "turnEnd": onTurnEnd(m); break;
    case "over": view = "over"; showOver(m.players || []); break;
    case "pong": break;
  }
}

function onTurn(m) {
  closeOverlay(); view = "playing"; $("#board").classList.remove("hidden"); showLeave(true); showSkip(myId === hostId);
  stopChoose(); showEmotes(true);
  iAmDrawer = m.drawerId === myId; strokes = []; clearCanvas(); resize();
  $("#i-turn").textContent = "Runde " + (m.round || 1) + " · Zug " + (m.turn || (m.round || 1)) + (m.total ? "/" + m.total : "");
  const drawer = players.find(p => p.id === m.drawerId);
  if (m.phase === "choose") {
    phase = "choose"; setTools(false); setGuessEnabled(false); stopTimer();
    $("#i-word").textContent = "";
    showNote(iAmDrawer ? "Wähle ein Wort …" : ((drawer ? drawer.name : "Jemand") + " wählt ein Wort …"));
    $("#i-time").textContent = "—"; $("#timefill").style.width = "100%";
    startChoose(m.chooseTime || 15, iAmDrawer, drawer ? drawer.name : "Jemand");
  } else if (m.phase === "draw") {
    phase = "draw"; hideNote();
    if (iAmDrawer) { $("#i-word").innerHTML = curWord ? "<b>" + GS.esc(curWord) + "</b>" : "…"; setTools(true); setGuessEnabled(false); }
    else { $("#i-word").textContent = spaced(m.pattern || ""); setTools(false); setGuessEnabled(true); }
    startTimer(m.time || 75);
  }
  renderPlayers(m.drawerId);
}

function onTurnEnd(m) {
  phase = "reveal"; stopTimer(); stopChoose(); setTools(false); setGuessEnabled(false); hideNote(); showSkip(false);
  players = m.players || players; renderPlayers();
  const gains = m.gains || [];
  const rows = gains.length
    ? gains.map(g => `<li><span class="pname">${g.place === 1 ? "🥇" : g.place === 2 ? "🥈" : g.place === 3 ? "🥉" : "✅"} ${GS.esc(g.name)}</span><span class="psc">+${g.gain}</span></li>`).join("")
    : `<li class="none">Niemand hat es erraten 😬</li>`;
  const dr = m.drawerName ? `<p class="sub" style="margin-top:8px">✏️ ${GS.esc(m.drawerName)} (Zeichner:in): +${m.drawerGain || 0}</p>` : "";
  overlay(`<h2>Das Wort war</h2><div class="reveal-word">${GS.esc(m.word)}</div><ul class="plist tight">${rows}</ul>${dr}<p class="msg">Nächster Zug gleich …</p>`);
  addChat("sys", null, "Das Wort war „" + GS.esc(m.word) + "“.");
}

// Kurzer Konfetti-Regen (DOM-Partikel, CSP-konform, keine externen Libs).
function confetti() {
  try {
    if (matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const cols = ["#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899"];
    const box = document.createElement("div"); box.className = "confetti"; document.body.appendChild(box);
    for (let i = 0; i < 26; i++) {
      const s = document.createElement("i");
      s.style.left = (10 + Math.random() * 80) + "vw";
      s.style.background = cols[i % cols.length];
      s.style.animationDelay = (Math.random() * 0.15) + "s";
      s.style.transform = "rotate(" + (Math.random() * 360) + "deg)";
      box.appendChild(s);
    }
    setTimeout(() => box.remove(), 1700);
  } catch {}
}

// ---------- Zeichnen ----------
function toNorm(e) { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; }
function clearCanvas() { ctx.clearRect(0, 0, cw, ch); }
function drawSeg(pts, c, w, erase) {
  if (!pts.length) return;
  ctx.save();
  if (erase) ctx.globalCompositeOperation = "destination-out";
  ctx.strokeStyle = c; ctx.fillStyle = c; ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.lineWidth = w * (cw / REF);
  ctx.beginPath(); ctx.moveTo(pts[0].x * cw, pts[0].y * ch);
  if (pts.length === 1) { ctx.arc(pts[0].x * cw, pts[0].y * ch, (w * (cw / REF)) / 2, 0, 6.2832); ctx.fill(); ctx.restore(); return; }
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * cw, pts[i].y * ch);
  ctx.stroke(); ctx.restore();
}
function redraw() { clearCanvas(); for (const s of strokes) { if (s.k === "f") floodFill(s.x, s.y, s.c); else drawSeg(s.pts, s.c, s.w, s.e); } }

// Bisher Gemaltes vom Server übernehmen (Reconnect/Neuzugang mitten im Zug).
function applySnapshot(ops) {
  strokes = ops.map(o => o.k === "f"
    ? { k: "f", x: o.x, y: o.y, c: o.c }
    : { k: "s", pts: (o.pts || []).map(p => ({ x: p[0], y: p[1] })), c: o.c, w: o.w, e: !!o.e });
  if (!cw || !ch) resize(); else redraw();
}

// Fülleimer: 4er-Flood-Fill auf Geräte-Pixeln. Normierte Startkoordinate (0..1),
// damit es geräteübergreifend an derselben Bildstelle wirkt.
function floodFill(nx, ny, hex) {
  const W = canvas.width, H = canvas.height; if (!W || !H) return;
  const sx = Math.max(0, Math.min(W - 1, Math.round(nx * W)));
  const sy = Math.max(0, Math.min(H - 1, Math.round(ny * H)));
  let img; try { img = ctx.getImageData(0, 0, W, H); } catch { return; }
  const d = img.data, si = (sy * W + sx) * 4;
  const tr = d[si], tg = d[si + 1], tb = d[si + 2], ta = d[si + 3];
  const m = /^#?([0-9a-f]{6})$/i.exec(hex); if (!m) return;
  const n = parseInt(m[1], 16), fr = (n >> 16) & 255, fg = (n >> 8) & 255, fb = n & 255;
  if (tr === fr && tg === fg && tb === fb && ta === 255) return;        // schon die Farbe
  const tol = 40, near = i => Math.abs(d[i] - tr) <= tol && Math.abs(d[i + 1] - tg) <= tol && Math.abs(d[i + 2] - tb) <= tol && Math.abs(d[i + 3] - ta) <= tol;
  const stack = [sy * W + sx], seen = new Uint8Array(W * H);
  while (stack.length) {
    const px = stack.pop(); if (seen[px]) continue; seen[px] = 1;
    const i = px * 4; if (!near(i)) continue;
    d[i] = fr; d[i + 1] = fg; d[i + 2] = fb; d[i + 3] = 255;
    const x = px % W, y = (px / W) | 0;
    if (x > 0) stack.push(px - 1); if (x < W - 1) stack.push(px + 1);
    if (y > 0) stack.push(px - W); if (y < H - 1) stack.push(px + W);
  }
  ctx.putImageData(img, 0, 0);
}

canvas.addEventListener("pointerdown", e => {
  if (view !== "playing" || phase !== "draw" || !iAmDrawer) return;
  const p = toNorm(e);
  if (tool === "fill") {                       // Fülleimer: ein Klick, kein Ziehen
    strokes.push({ k: "f", x: p.x, y: p.y, c: curColor }); floodFill(p.x, p.y, curColor);
    send({ t: "fill", x: r4(p.x), y: r4(p.y), c: curColor }); return;
  }
  const erase = tool === "eraser";
  drawing = true; curStroke = { k: "s", pts: [p], c: curColor, w: curW, e: erase }; strokes.push(curStroke);
  firstFlush = true; lastSentIdx = 0; drawSeg([p], curColor, curW, erase);
});
canvas.addEventListener("pointermove", e => {
  if (!drawing) return; const p = toNorm(e); const prev = curStroke.pts[curStroke.pts.length - 1];
  curStroke.pts.push(p); drawSeg([prev, p], curStroke.c, curStroke.w, curStroke.e);
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
  send({ t: "stroke", pts: batch, c: curStroke.c, w: curStroke.w, s: firstFlush, e: curStroke.e });
  lastSentIdx = pts.length - 1; firstFlush = false;
}
setInterval(() => { if (drawing && iAmDrawer) flush(); }, 55);

// ---------- Werkzeuge ----------
const COLORS = ["#111827", "#6b7280", "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6", "#3b82f6", "#8b5cf6", "#ec4899", "#8b5a2b"];
const SIZES = [3, 6, 12, 20];
const CAT_LABELS = { tiere: "🐾 Tiere", essen: "🍎 Essen", dinge: "🎒 Dinge", fahrzeuge: "🚗 Fahrzeuge", natur: "🌳 Natur", fantasie: "🐉 Fantasie" };
function buildTools() {
  $("#swatches").innerHTML = COLORS.map((c, i) => `<i data-c="${c}" style="background:${c}" class="${i === 0 ? "sel" : ""}"></i>`).join("");
  $("#sizes").innerHTML = SIZES.map((s, i) => `<i data-s="${s}" class="${i === 1 ? "sel" : ""}"><b style="width:${Math.min(18, s)}px;height:${Math.min(18, s)}px"></b></i>`).join("");
  $("#swatches").querySelectorAll("i").forEach(el => el.onclick = () => { curColor = el.dataset.c; tool = "pen"; $("#swatches").querySelectorAll("i").forEach(x => x.classList.remove("sel")); el.classList.add("sel"); updateToolBtns(); });
  $("#sizes").querySelectorAll("i").forEach(el => el.onclick = () => { curW = +el.dataset.s; $("#sizes").querySelectorAll("i").forEach(x => x.classList.remove("sel")); el.classList.add("sel"); });
  $("#t-fill").onclick = () => { tool = tool === "fill" ? "pen" : "fill"; updateToolBtns(); };
  $("#t-eraser").onclick = () => { tool = tool === "eraser" ? "pen" : "eraser"; updateToolBtns(); };
  $("#t-undo").onclick = () => { if (drawing || !strokes.length) return; strokes.pop(); redraw(); send({ t: "undo" }); GS.haptic(8); };
  $("#t-clear").onclick = () => { if (!strokes.length) return; strokes = []; clearCanvas(); send({ t: "clear" }); };
}
function updateToolBtns() { $("#t-fill").classList.toggle("on", tool === "fill"); $("#t-eraser").classList.toggle("on", tool === "eraser"); }
function setTools(on) { if (on) { tool = "pen"; updateToolBtns(); } $("#tools").classList.toggle("hidden", !on); }

// ---------- Timer ----------
let timerRAF = null, lastTickSec = -1;
function startTimer(sec) { timeTotal = sec; timeEnd = performance.now() + sec * 1000; lastTickSec = -1; if (!timerRAF) tickTimer(); }
function stopTimer() { if (timerRAF) cancelAnimationFrame(timerRAF); timerRAF = null; }
function tickTimer() {
  const left = Math.max(0, timeEnd - performance.now());
  const secs = Math.ceil(left / 1000);
  $("#timefill").style.width = (left / (timeTotal * 1000) * 100) + "%";
  $("#i-time").textContent = secs + "s";
  // Warnton in den letzten 5 Sekunden (nur in der Zeichenphase, einmal pro Sekunde)
  if (phase === "draw" && secs <= 5 && secs >= 1 && secs !== lastTickSec) { lastTickSec = secs; GS.sound.tone(secs <= 2 ? 880 : 640, 0.07, { type: "triangle", gain: 0.08 }); if (secs <= 2) GS.haptic(10); }
  if (left <= 0) { timerRAF = null; return; }
  timerRAF = requestAnimationFrame(tickTimer);
}

// ---------- Wähl-Countdown (Wortauswahl) ----------
let chooseTimer = null;
function startChoose(sec, isDrawer, drawerName) {
  stopChoose();
  const end = performance.now() + (sec || 15) * 1000;
  const tick = () => {
    const left = Math.max(0, Math.ceil((end - performance.now()) / 1000));
    const wt = $("#wp-time"); if (wt) wt.textContent = left + "s";
    if (!isDrawer) { const n = $("#cv-note"); if (n && !n.classList.contains("hidden")) n.textContent = (drawerName || "Jemand") + " wählt ein Wort … " + left + "s"; }
    if (left <= 0) { chooseTimer = null; return; }
    chooseTimer = setTimeout(tick, 250);
  };
  tick();
}
function stopChoose() { if (chooseTimer) { clearTimeout(chooseTimer); chooseTimer = null; } }

// ---------- Emotes / Reaktionen ----------
const EMOTES = ["👍", "❤️", "😂", "😮", "🎉", "🔥"];
function buildEmotes() {
  const bar = $("#emotes"); if (!bar) return;
  bar.innerHTML = EMOTES.map(e => `<button type="button" data-emote="${e}" aria-label="Reaktion ${e}">${e}</button>`).join("");
  bar.querySelectorAll("[data-emote]").forEach(b => b.onclick = () => { send({ t: "emote", e: b.dataset.emote }); floatEmote(b.dataset.emote); GS.haptic(6); });
}
function showEmotes(on) { const b = $("#emotes"); if (b) b.classList.toggle("hidden", !on); }
function floatEmote(e) {
  const wrap = $("#cv-wrap"); if (!wrap || !e) return;
  const el = document.createElement("div"); el.className = "emote-fly"; el.textContent = e;
  el.style.left = (12 + Math.random() * 70) + "%";
  wrap.appendChild(el);
  setTimeout(() => el.remove(), 1400);
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

function showMenu(msg, prefillCode) {
  view = "menu"; $("#board").classList.add("hidden"); setGuessEnabled(false); players = []; showLeave(false); showSkip(false);
  showEmotes(false); stopChoose();
  const invited = !!prefillCode;
  const o = overlay(`
    <h2><span class="foil">Kritzeln &amp; Raten</span></h2>
    <p class="sub">${invited
      ? `Du wurdest in Raum <b>${GS.esc(prefillCode)}</b> eingeladen 🎨 — gib deinen Namen ein und tritt bei.`
      : `Einer malt, die anderen raten — live, für <b>2–10 Spieler</b>. Erstelle einen Raum und teile den Code.`}</p>
    <p class="msg ${msg ? "err" : ""}">${msg ? GS.esc(msg) : ""}</p>
    <input type="text" id="mp-name" maxlength="14" placeholder="Dein Name" value="${GS.esc(GS.getName())}">
    ${invited ? `<button class="btn-primary" id="mp-joinbig">🎨 Raum ${GS.esc(prefillCode)} beitreten</button>` : `<button class="btn-primary" id="mp-create">➕ Raum erstellen</button>`}
    <div class="btn-row"><input type="text" id="mp-code" class="code" maxlength="6" placeholder="CODE" value="${GS.esc(prefillCode || "")}"><button class="btn-secondary" id="mp-join">Beitreten</button></div>
    <button class="btn-secondary" id="mp-scores" style="margin-top:10px">🏆 Bestenliste</button>`);
  const save = () => { const v = o.querySelector("#mp-name").value.trim().slice(0, 14); if (v) GS.setName(v); };
  const join = () => { save(); const c = o.querySelector("#mp-code").value.trim().toUpperCase(); if (/^[A-Z0-9]{4,6}$/.test(c)) connect(c); else o.querySelector(".msg").textContent = "Bitte gültigen Code eingeben."; };
  const create = o.querySelector("#mp-create"); if (create) create.onclick = () => { save(); connect(randCode()); };
  const joinBig = o.querySelector("#mp-joinbig"); if (joinBig) joinBig.onclick = join;
  o.querySelector("#mp-join").onclick = join;
  o.querySelector("#mp-scores").onclick = showScores;
  // Bei Einladung ohne Namen direkt ins Namensfeld springen
  if (invited && !GS.getName()) { const n = o.querySelector("#mp-name"); if (n) n.focus(); }
}

function showLobby() {
  showLeave(true); showEmotes(false); stopChoose();
  const meHost = myId === hostId;
  showSkip(false);
  const catKeys = Object.keys(CAT_LABELS);
  const custActive = roomCustom >= 3;
  const settings = meHost
    ? `<div class="lobby-set">
        <div class="set-lbl">Kategorien <span class="hint">(keine = alle${custActive ? "; von eigenen Wörtern überschrieben" : ""})</span></div>
        <div class="chips" id="lb-cats">${catKeys.map(k => `<button class="chip ${roomCats.includes(k) ? "on" : ""}" data-cat="${k}">${CAT_LABELS[k]}</button>`).join("")}</div>
        <div class="set-lbl">Runden</div>
        <div class="chips" id="lb-rounds">${[1, 2, 3].map(n => `<button class="chip ${roomRounds === n ? "on" : ""}" data-r="${n}">${n}</button>`).join("")}</div>
        <div class="set-lbl">Eigene Wörter <span class="hint">(optional · Komma-getrennt · ab 3 Wörtern aktiv)</span></div>
        <textarea id="lb-words" class="words-in" rows="2" placeholder="z. B. Oma, Netflix, Trampolin, Schnitzel …">${GS.esc(customText)}</textarea>
        <div class="hint" id="lb-words-n">${roomCustom ? "✅ " + roomCustom + " eigene Wörter" + (custActive ? " aktiv" : " (mind. 3 nötig)") : ""}</div>
      </div>`
    : `<p class="sub lobby-sub">${custActive ? "✍️ Eigene Wörter (" + roomCustom + ")" : (roomCats.length ? roomCats.map(k => CAT_LABELS[k] || k).join(" · ") : "Alle Kategorien")} · ${roomRounds} Runden</p>`;
  const o = overlay(`
    <h2>Warteraum</h2>
    <p class="sub">Teile den Code — Freunde tippen ihn im Menü ein. Ab <b>2 Spielern</b> kann der Host starten (bis 10).</p>
    <div class="code-big">${GS.esc(code)}</div>
    <button class="btn-secondary" id="lb-share">📤 Code teilen</button>
    ${settings}
    <ul class="plist">${players.map(p => `<li><span class="pname">${GS.esc(p.name)}${p.id === myId ? " (du)" : ""}</span>${p.id === hostId ? '<span class="phost">Host</span>' : (meHost ? `<button class="kick" data-kick="${p.id}" title="Entfernen">✕</button>` : "")}</li>`).join("")}</ul>
    <p class="msg" id="lb-msg">${players.length < 2 ? "Warte auf mindestens eine:n weitere:n …" : (meHost ? "Bereit zum Start!" : "Warte auf den Host …")}</p>
    ${meHost ? `<button class="btn-primary" id="lb-start" ${players.length >= 2 ? "" : "disabled style=\"opacity:.5\""}>🎨 Starten</button>` : ""}
    <button class="btn-secondary" id="lb-leave">Verlassen</button>`);
  o.querySelector("#lb-share").onclick = async () => { const r = await GS.share({ title: "Kritzeln & Raten", text: `Mal & rate mit mir 🎨 — tipp auf den Link, dann bist du direkt im Raum ${code}:`, url: location.origin + "/kritzeln/?code=" + encodeURIComponent(code) }); if (r === "copied") o.querySelector("#lb-share").textContent = "✔ kopiert"; };
  if (meHost) {
    o.querySelectorAll("#lb-cats .chip").forEach(b => b.onclick = () => {
      const k = b.dataset.cat; roomCats = roomCats.includes(k) ? roomCats.filter(x => x !== k) : [...roomCats, k];
      b.classList.toggle("on"); send({ t: "cat", cats: roomCats });
    });
    o.querySelectorAll("#lb-rounds .chip").forEach(b => b.onclick = () => { roomRounds = +b.dataset.r; send({ t: "rounds", n: roomRounds }); o.querySelectorAll("#lb-rounds .chip").forEach(x => x.classList.toggle("on", x === b)); });
    o.querySelectorAll("[data-kick]").forEach(b => b.onclick = () => { const id = +b.dataset.kick; const pl = players.find(x => x.id === id); if (confirm((pl ? pl.name : "Spieler:in") + " entfernen?")) send({ t: "kick", id }); });
    const wa = o.querySelector("#lb-words");
    if (wa) { wa.oninput = () => { customText = wa.value; }; wa.onblur = () => { const list = wa.value.split(/[,\n]/).map(s => s.trim()).filter(Boolean); send({ t: "words", list }); }; }
  }
  const st = o.querySelector("#lb-start"); if (st) st.onclick = () => send({ t: "start" });
  o.querySelector("#lb-leave").onclick = () => { leave(); showMenu(); };
}

// Warteraum-Update OHNE Neuaufbau (verhindert Flackern + Fokusverlust). Rührt
// beim Host bewusst NICHT an Kategorie-/Runden-Chips oder dem Wörter-Textfeld —
// die steuert der Host lokal; hier werden nur Anzeige-Teile nachgezogen.
function updateLobby() {
  const o = document.getElementById("ov"); if (!o) return showLobby();
  const meHost = myId === hostId;
  const hostControls = !!o.querySelector("#lb-cats");
  if (meHost !== hostControls) return showLobby();   // Host-Wechsel → Layout neu bauen

  const list = o.querySelector(".plist");
  if (list) {
    list.innerHTML = players.map(p => `<li><span class="pname">${GS.esc(p.name)}${p.id === myId ? " (du)" : ""}</span>${p.id === hostId ? '<span class="phost">Host</span>' : (meHost ? `<button class="kick" data-kick="${p.id}" title="Entfernen">✕</button>` : "")}</li>`).join("");
    if (meHost) list.querySelectorAll("[data-kick]").forEach(b => b.onclick = () => { const id = +b.dataset.kick; const pl = players.find(x => x.id === id); if (confirm((pl ? pl.name : "Spieler:in") + " entfernen?")) send({ t: "kick", id }); });
  }
  const msg = o.querySelector("#lb-msg");
  if (msg) msg.textContent = players.length < 2 ? "Warte auf mindestens eine:n weitere:n …" : (meHost ? "Bereit zum Start!" : "Warte auf den Host …");
  const st = o.querySelector("#lb-start");
  if (st) { const ok = players.length >= 2; st.disabled = !ok; st.style.opacity = ok ? "" : ".5"; }

  const custActive = roomCustom >= 3;
  if (meHost) {
    const wn = o.querySelector("#lb-words-n");
    if (wn) wn.textContent = roomCustom ? "✅ " + roomCustom + " eigene Wörter" + (custActive ? " aktiv" : " (mind. 3 nötig)") : "";
  } else {
    const sub = o.querySelector(".lobby-sub");
    if (sub) sub.innerHTML = (custActive ? "✍️ Eigene Wörter (" + roomCustom + ")" : (roomCats.length ? roomCats.map(k => CAT_LABELS[k] || k).join(" · ") : "Alle Kategorien")) + " · " + roomRounds + " Runden";
  }
}

function showWordPick(words, time) {
  const o = overlay(`<h2>Dein Wort</h2><p class="sub">Wähle, was du zeichnest — <span id="wp-time" class="wp-time">${(time || 15)}s</span></p><div class="wordpick">${words.map(w => `<button class="btn-primary" data-w="${GS.esc(w)}">${GS.esc(w)}</button>`).join("")}</div>`);
  o.querySelectorAll("[data-w]").forEach(b => b.onclick = () => { stopChoose(); send({ t: "choose", word: b.dataset.w }); closeOverlay(); });
}

function showOver(list) {
  showLeave(true); showSkip(false); showEmotes(false); stopChoose();
  const meHost = myId === hostId; const top = list[0];
  if (top && top.id === myId) { GS.sound.win(); confetti(); } else { GS.sound.good(); }
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
$("#btn-leave").onclick = () => { if (confirm("Raum verlassen?")) { leave(); showMenu(); } };
function showLeave(on) { const b = $("#btn-leave"); if (b) b.classList.toggle("hidden", !on); }
$("#btn-skip").onclick = () => { if (confirm("Diesen Zug überspringen?")) send({ t: "skip" }); };
function showSkip(on) { const b = $("#btn-skip"); if (b) b.classList.toggle("hidden", !on); }
window.addEventListener("beforeunload", leave);
document.addEventListener("visibilitychange", () => { if (document.hidden || intentional || !code) return; if ((view === "lobby" || view === "over") && (!ws || ws.readyState > 1)) { reTries = 0; connect(code, true); } });

buildTools();
buildEmotes();
GS.markPlayed("kritzeln");
const pre = new URLSearchParams(location.search).get("code");
const preCode = pre && /^[A-Z0-9]{4,6}$/i.test(pre) ? pre.toUpperCase() : "";
// Per Einladungslink: mit gesetztem Namen direkt rein, sonst Menü mit
// vorbefülltem Code (Name zuerst eingeben, statt still als „Spieler" landen).
if (preCode && GS.getName()) connect(preCode);
else if (preCode) showMenu("", preCode);
else showMenu();
