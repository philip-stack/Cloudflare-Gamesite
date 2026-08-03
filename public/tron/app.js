// ====================================================================
// NEON-TRON — Client. Verbindet per WebSocket mit dem autoritativen
// Match-DO (TronRoom). Wir schicken nur unsere Wunsch-Richtung (aim) und
// rendern den Weltzustand des Servers weich (Interpolation); die Spuren
// bauen wir lokal aus den empfangenen Kopf-Positionen auf.
// ====================================================================

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const stage = document.getElementById("stage");
const $ = s => document.querySelector(s);
const GS = window.GS;
const ARENA = 1000;

let W = 0, H = 0, DPR = 1, scale = 1, offX = 0, offY = 0;
function resize() {
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = stage.clientWidth; H = stage.clientHeight;
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  scale = Math.min(W, H) * 0.96 / ARENA;
  offX = (W - ARENA * scale) / 2; offY = (H - ARENA * scale) / 2;
}
window.addEventListener("resize", resize);
resize();

// ---------- Netz-/Spielzustand ----------
let ws = null, myId = null, hostId = null, code = "";
let view = "menu";            // menu | lobby | playing | over
let players = new Map();      // id -> {name,color,ready,alive,x,y,a,rx,ry,pts:[]}
let pingT = null, aim = 0, pointerTarget = null, pointerMode = false, keyTurn = 0, lastAimSent = 0, canSteer = false;
let intentional = false, wantReady = false, reTries = 0, reTimer = null;

const wsUrl = c => (location.protocol === "https:" ? "wss" : "ws") + "://" + location.host + "/api/tron-live?code=" + encodeURIComponent(c);
const CODE_ABC = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
function randCode() { const a = new Uint8Array(4); crypto.getRandomValues(a); return [...a].map(b => CODE_ABC[b % CODE_ABC.length]).join(""); }

function connect(c, isRe) {
  code = c.toUpperCase();
  if (!isRe) { intentional = false; reTries = 0; wantReady = false; }
  if (reTimer) { clearTimeout(reTimer); reTimer = null; }
  try { ws = new WebSocket(wsUrl(code)); } catch { return tryReconnect(); }
  ws.onopen = () => {
    reTries = 0;
    send({ t: "join", name: GS.getName() || "Spieler" });
    if (wantReady) send({ t: "ready", v: true });          // Bereit-Status wiederherstellen
    if (pingT) clearInterval(pingT); pingT = setInterval(() => send({ t: "ping" }), 20000);
  };
  ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } onMsg(m); };
  ws.onclose = () => {
    if (pingT) { clearInterval(pingT); pingT = null; }
    if (intentional) return;
    // Mitten im Match verloren → zurück ins Menü. Sonst (Lobby/Warten): neu verbinden.
    if (view === "playing") { showMenu("Verbindung im Match verloren"); return; }
    tryReconnect();
  };
  ws.onerror = () => {};
}
function tryReconnect() {
  if (intentional) return;
  if (reTries >= 6) { showMenu("Verbindung getrennt"); return; }
  reTries++;
  const mEl = document.querySelector("#ov .msg"); if (mEl) mEl.textContent = "Verbindung unterbrochen — verbinde neu …";
  if (reTimer) clearTimeout(reTimer);
  reTimer = setTimeout(() => connect(code, true), 500 * reTries);
}
function send(o) { try { if (ws && ws.readyState === 1) ws.send(JSON.stringify(o)); } catch {} }
function leave() { intentional = true; if (reTimer) { clearTimeout(reTimer); reTimer = null; } try { ws && ws.close(); } catch {} ws = null; }

function onMsg(m) {
  switch (m.t) {
    case "welcome": myId = m.id; break;
    case "full": showMenu("Raum ist voll oder das Match läuft schon."); leave(); break;
    case "lobby":
      hostId = m.hostId;
      syncPlayers(m.players);
      if (view === "playing") break;
      if (m.state === "over") break;   // Sieger-Overlay bleibt
      view = "lobby"; showLobby();
      break;
    case "setup": {
      players = new Map();
      for (const p of m.players) players.set(p.id, { name: p.name, color: p.color, ready: true, alive: true, x: p.x, y: p.y, a: p.a, rx: p.x, ry: p.y, pts: [{ x: p.x, y: p.y }] });
      const me = players.get(myId); if (me) aim = me.a;
      view = "playing"; canSteer = false; closeOverlay(); $("#count").classList.remove("hidden");
      break;
    }
    case "count": $("#count").classList.remove("hidden"); $("#count").textContent = m.n; GS.sound.click(); break;
    case "go":
      $("#count").classList.add("hidden"); canSteer = true;
      $("#hint").classList.remove("hidden"); setTimeout(() => $("#hint").classList.add("hidden"), 2400);
      break;
    case "state":
      for (const s of m.players) {
        const p = players.get(s.id); if (!p) continue;
        p.a = s.a; p.alive = s.alive;
        if (s.alive) { const last = p.pts[p.pts.length - 1]; if (!last || Math.hypot(s.x - last.x, s.y - last.y) > 1) { p.pts.push({ x: s.x, y: s.y }); if (p.pts.length > 5000) p.pts.shift(); } }
        p.x = s.x; p.y = s.y;
      }
      break;
    case "dead": { const p = players.get(m.id); if (p) p.alive = false; if (m.id === myId) { GS.sound.lose(); GS.haptic(60); canSteer = false; } break; }
    case "over": view = "over"; if (m.winner && m.winner.id === myId) GS.sound.win(); showWinner(m.winner); break;
    case "pong": break;
  }
}

function syncPlayers(list) {
  const keep = new Map();
  for (const s of list) {
    const ex = players.get(s.id) || {};
    keep.set(s.id, Object.assign(ex, { name: s.name, color: s.color, ready: s.ready, alive: s.alive }));
  }
  players = keep;
}

// ---------- Overlays ----------
function closeOverlay() { const o = $("#ov"); if (o) o.remove(); }
function overlay(html) { closeOverlay(); const o = document.createElement("div"); o.id = "ov"; o.className = "overlay"; o.innerHTML = `<div class="panel">${html}</div>`; document.body.appendChild(o); return o; }

function showMenu(msg) {
  view = "menu"; players = new Map(); myId = null; canSteer = false; $("#count").classList.add("hidden");
  const o = overlay(`
    <h2><span class="foil">Neon-Tron</span></h2>
    <p class="sub">Echtzeit-Lichtrenner für <b>2–4 Spieler</b>. Zieh eine Neon-Spur — wer zuerst in eine Wand oder Spur fährt, verliert.</p>
    <p class="msg ${msg ? "err" : ""}">${msg ? GS.esc(msg) : ""}</p>
    <input type="text" id="mp-name" maxlength="12" placeholder="Dein Name" value="${GS.esc(GS.getName())}">
    <button class="btn-primary" id="mp-create">➕ Raum erstellen</button>
    <div class="btn-row">
      <input type="text" id="mp-code" class="code" maxlength="6" placeholder="CODE">
      <button class="btn-secondary" id="mp-join" style="margin:0">Beitreten</button>
    </div>`);
  const nameEl = o.querySelector("#mp-name");
  const saveName = () => { const v = nameEl.value.trim().slice(0, 12); if (v) GS.setName(v); };
  o.querySelector("#mp-create").onclick = () => { saveName(); connect(randCode()); };
  o.querySelector("#mp-join").onclick = () => { saveName(); const c = o.querySelector("#mp-code").value.trim().toUpperCase(); if (/^[A-Z0-9]{4,6}$/.test(c)) connect(c); else o.querySelector(".msg").textContent = "Bitte gültigen Code eingeben."; };
}

function showLobby() {
  const ps = [...players.values()];
  const meHost = myId === hostId;
  const meP = players.get(myId);
  const readyCount = ps.filter(p => p.ready).length;
  const canStart = meHost && ps.length >= 2;
  const o = overlay(`
    <h2>Warteraum</h2>
    <p class="sub">Teile den Code — Freunde tippen ihn im Menü ein.</p>
    <div class="code-big">${GS.esc(code)}</div>
    <button class="btn-secondary" id="lb-share">📤 Code teilen</button>
    <ul class="plist">${ps.map(p => `
      <li><span class="pdot" style="background:${p.color};color:${p.color}"></span>
        <span class="pname">${GS.esc(p.name)}${p.id === myId ? " (du)" : ""}</span>
        ${p.id === hostId ? `<span class="phost">Host</span>` : ""}
        <span class="pready ${p.ready ? "ok" : "no"}">${p.ready ? "✓ bereit" : "…"}</span>
      </li>`).join("")}</ul>
    <p class="msg">${ps.length < 2 ? "Warte auf mindestens eine:n weitere:n Spieler:in …" : (meHost ? `${readyCount}/${ps.length} bereit` : "Warte auf den Host …")}</p>
    <button class="btn-secondary" id="lb-ready">${meP && meP.ready ? "✓ Bereit (abwählen)" : "Bereit"}</button>
    ${meHost ? `<button class="btn-primary" id="lb-start" ${canStart ? "" : "disabled style=\"opacity:.5\""}>🏁 Start</button>` : ""}
    <button class="btn-secondary" id="lb-leave">Verlassen</button>`);
  o.querySelector("#lb-share").onclick = async () => {
    const r = await GS.share({ title: "Neon-Tron", text: `Spiel mit mir Neon-Tron 🏍️ — Raum-Code ${code}`, url: location.origin + "/tron/" });
    if (r === "copied") o.querySelector("#lb-share").textContent = "✔ kopiert";
  };
  o.querySelector("#lb-ready").onclick = () => { const meP = players.get(myId); const nv = !(meP && meP.ready); wantReady = nv; send({ t: "ready", v: nv }); };
  const st = o.querySelector("#lb-start"); if (st) st.onclick = () => send({ t: "start" });
  o.querySelector("#lb-leave").onclick = () => { leave(); showMenu(); };
}

function showWinner(winner) {
  $("#count").classList.add("hidden"); canSteer = false;
  const meHost = myId === hostId;
  const meWon = winner && winner.id === myId;
  const o = overlay(`
    <h2>${meWon ? "🏆 Gewonnen!" : "Runde vorbei"}</h2>
    <div class="win-name" style="color:${winner ? winner.color : "#8fa4c0"}">${winner ? GS.esc(winner.name) + " gewinnt" : "Unentschieden"}</div>
    <p class="sub">Raum-Code <b>${GS.esc(code)}</b></p>
    ${meHost ? `<button class="btn-primary" id="w-again">🔄 Revanche</button>` : `<p class="msg">Warte auf Revanche des Hosts …</p>`}
    <button class="btn-secondary" id="w-lobby">Zurück zum Warteraum</button>
    <button class="btn-secondary" id="w-leave">Verlassen</button>`);
  const ag = o.querySelector("#w-again"); if (ag) ag.onclick = () => send({ t: "start" });
  o.querySelector("#w-lobby").onclick = () => { send({ t: "again" }); view = "lobby"; showLobby(); };
  o.querySelector("#w-leave").onclick = () => { leave(); showMenu(); };
}

// ---------- Rendering ----------
function frame() {
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.translate(offX, offY); ctx.scale(scale, scale);

  // Gitter + Rand
  ctx.strokeStyle = "rgba(120,180,255,0.06)"; ctx.lineWidth = 1 / scale;
  for (let i = 100; i < ARENA; i += 100) { ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, ARENA); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(ARENA, i); ctx.stroke(); }
  ctx.strokeStyle = "rgba(80,180,255,0.5)"; ctx.lineWidth = 3 / scale;
  ctx.save(); ctx.shadowBlur = 14; ctx.shadowColor = "rgba(80,180,255,0.7)"; ctx.strokeRect(0, 0, ARENA, ARENA); ctx.restore();

  if (view === "playing" || view === "over") {
    for (const p of players.values()) {
      p.rx += (p.x - p.rx) * 0.4; p.ry += (p.y - p.ry) * 0.4;
      // Spur
      if (p.pts.length > 1) {
        ctx.lineJoin = "round"; ctx.lineCap = "round";
        ctx.save();
        ctx.globalAlpha = p.alive ? 1 : 0.4;
        ctx.shadowBlur = 12; ctx.shadowColor = p.color;
        ctx.strokeStyle = p.color; ctx.lineWidth = 5;
        ctx.beginPath(); ctx.moveTo(p.pts[0].x, p.pts[0].y);
        for (let i = 1; i < p.pts.length; i++) ctx.lineTo(p.pts[i].x, p.pts[i].y);
        ctx.lineTo(p.rx, p.ry);
        ctx.stroke();
        ctx.restore();
      }
      // Kopf
      if (p.alive) {
        ctx.save(); ctx.shadowBlur = 16; ctx.shadowColor = p.color; ctx.fillStyle = "#fff";
        ctx.beginPath(); ctx.arc(p.rx, p.ry, 6, 0, 6.2832); ctx.fill();
        ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.rx, p.ry, 3.4, 0, 6.2832); ctx.fill();
        ctx.restore();
      }
    }
  }
  ctx.restore();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- Eingabe ----------
function stepAim() {
  if (view !== "playing" || !canSteer) return;
  const me = players.get(myId); if (!me || !me.alive) return;
  const now = performance.now();
  if (pointerMode && pointerTarget) aim = Math.atan2(pointerTarget.y - me.y, pointerTarget.x - me.x);
  else if (keyTurn) aim += keyTurn * 3.0 * (1 / 60);
  if (now - lastAimSent > 55) { send({ t: "aim", a: aim }); lastAimSent = now; }
}
setInterval(stepAim, 1000 / 60);

function toArena(e) { const r = canvas.getBoundingClientRect(); return { x: ((e.clientX - r.left) - offX) / scale, y: ((e.clientY - r.top) - offY) / scale }; }
stage.addEventListener("pointermove", e => { if (view === "playing") { pointerTarget = toArena(e); pointerMode = true; } });
stage.addEventListener("pointerdown", e => { if (view === "playing") { pointerTarget = toArena(e); pointerMode = true; } });
window.addEventListener("keydown", e => {
  if (["ArrowLeft", "a", "A"].includes(e.key)) { keyTurn = -1; pointerMode = false; }
  else if (["ArrowRight", "d", "D"].includes(e.key)) { keyTurn = 1; pointerMode = false; }
});
window.addEventListener("keyup", e => { if (["ArrowLeft", "a", "A", "ArrowRight", "d", "D"].includes(e.key)) keyTurn = 0; });
window.addEventListener("beforeunload", leave);
// Zurück aus dem Hintergrund (z. B. nach dem Teilen via WhatsApp): sofort neu
// verbinden, falls der Browser die WebSocket im Hintergrund gekappt hat.
document.addEventListener("visibilitychange", () => {
  if (document.hidden || intentional || !code) return;
  if ((view === "lobby" || view === "over") && (!ws || ws.readyState > 1)) { reTries = 0; connect(code, true); }
});

// ---------- Start ----------
const soundBtn = $("#btn-sound");
soundBtn.textContent = GS.sound.on() ? "🔊" : "🔇";
soundBtn.onclick = () => { soundBtn.textContent = GS.sound.toggle() ? "🔊" : "🔇"; };
GS.markPlayed("tron");
const pre = new URLSearchParams(location.search).get("code");
if (pre && /^[A-Z0-9]{4,6}$/i.test(pre)) connect(pre.toUpperCase()); else showMenu();
