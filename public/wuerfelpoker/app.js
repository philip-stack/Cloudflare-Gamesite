const app = document.getElementById("app");

// ====================================================================
// Escalero / Würfelpoker — Verrechnungsblatt
// 5 Poker-Würfel (9,10,B,D,K,A), pro Zug bis 3 Würfe. Die App würfelt
// nur am Anfang aus, wer beginnt. Danach ist sie das digitale
// Verrechnungsblatt.
//
// Spielmodell:
//  - Ein Spiel besteht aus 1..n RUNDEN. Nach jeder vollen Runde kann
//    man weiterspielen; am Ende zählt die Gesamtsumme (Endgewinner),
//    zusätzlich gibt es Sieger je Runde.
//  - Jeder Spieler spielt 1..n SPALTEN (Blätter) gleichzeitig. Pro Zug
//    wird EIN freies Feld in einer beliebigen eigenen Spalte gefüllt.
//  - cells[pid][runde][spalte][kategorie] = { kind, v, serviert }
//
// Spielstände:
//  - Lokale Spiele  → nur auf diesem Gerät (localStorage), IDs "L…"
//  - Geteilte Spiele → Cloudflare D1, erreichbar NUR über einen
//    6-stelligen Beitritts-Code (#/game/<id>/<code>)
// ====================================================================

// ---------- Kategorien / Punkte ----------
const CATS = [
  { key: "9",  label: "9",  sub: "1", type: "upper", val: 1 },
  { key: "10", label: "10", sub: "2", type: "upper", val: 2 },
  { key: "B",  label: "B",  sub: "3", type: "upper", val: 3, name: "Bube" },
  { key: "D",  label: "D",  sub: "4", type: "upper", val: 4, name: "Dame" },
  { key: "K",  label: "K",  sub: "5", type: "upper", val: 5, name: "König" },
  { key: "A",  label: "A",  sub: "6", type: "upper", val: 6, name: "Ass" },
  { key: "S",  label: "S",  type: "combo", base: 20, serviert: 25, name: "Straße" },
  { key: "F",  label: "F",  type: "combo", base: 30, serviert: 35, name: "Full House" },
  { key: "P",  label: "P",  type: "combo", base: 40, serviert: 45, name: "Poker" },
  { key: "G",  label: "G",  type: "combo", base: 50, serviert: 80, name: "Grande" },
];
const CAT_BY_KEY = Object.fromEntries(CATS.map(c => [c.key, c]));

// ---------- API ----------
async function api(path, opts = {}) {
  const res = await fetch("/api" + path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Fehler ${res.status}`);
  return data;
}

// ---------- Lokale Spiele (localStorage) ----------
const LS_LOCAL = "wp_local_games";
const LS_SHARED = "wp_shared_refs";

const isLocalId = id => String(id).startsWith("L");

// Alte lokale Spiele (1 Spalte, 1 Runde, flaches cells-Objekt) anheben
function migrateLocal(g) {
  if (!g || g.cols) return g;
  g.cols = 1;
  g.round = 1;
  for (const p of g.players) {
    const old = g.cells[p.id] || {};
    g.cells[p.id] = { 1: { 0: old } };
  }
  g.log = (g.log || []).map(e => ({ ...e, round: 1, col: 0 }));
  return g;
}

function lsLoad() {
  try { return JSON.parse(localStorage.getItem(LS_LOCAL) || "[]").map(migrateLocal); }
  catch { return []; }
}
function lsSave(list) { localStorage.setItem(LS_LOCAL, JSON.stringify(list)); }
function lsGet(id) { return lsLoad().find(g => g.id === id) || null; }
function lsPut(game) {
  const list = lsLoad();
  const i = list.findIndex(g => g.id === game.id);
  if (i >= 0) list[i] = game; else list.unshift(game);
  lsSave(list);
}

// Gemerkte geteilte Spiele: [{id, code}]
function sharedRefs() {
  try { return JSON.parse(localStorage.getItem(LS_SHARED) || "[]"); }
  catch { return []; }
}
function addSharedRef(ref) {
  const list = sharedRefs().filter(r => r.id !== ref.id);
  list.unshift({ id: ref.id, code: ref.code });
  localStorage.setItem(LS_SHARED, JSON.stringify(list));
}
function removeSharedRef(id) {
  localStorage.setItem(LS_SHARED, JSON.stringify(sharedRefs().filter(r => r.id !== id)));
}

// ---------- Datenzugriff (lokal oder Server, gleiche Schnittstelle) ----------
const store = {
  async create(opts) {
    const cols = Math.max(1, Number(opts.cols) || 1);
    if (!opts.shared) {
      const id = "L" + Date.now();
      const game = {
        id,
        name: opts.name || "Würfelpoker",
        code: null,
        status: opts.status || "starter",
        cols,
        round: 1,
        starterIndex: Number.isInteger(opts.starter_index) ? opts.starter_index : null,
        turnIndex: Number.isInteger(opts.turn_index) ? opts.turn_index : null,
        createdAt: new Date().toISOString(),
        players: opts.players.map((n, i) => ({ id: i + 1, name: n, seat_order: i })),
        cells: Object.fromEntries(opts.players.map((_, i) => [i + 1, {}])),
        log: [],
      };
      lsPut(game);
      return { id, code: null };
    }
    const res = await api("/games", {
      method: "POST",
      body: JSON.stringify({
        name: opts.name, players: opts.players, cols, status: opts.status,
        starter_index: opts.starter_index, turn_index: opts.turn_index,
      }),
    });
    addSharedRef(res);
    return res;
  },

  async get(ref) {
    if (isLocalId(ref.id)) {
      const g = lsGet(ref.id);
      if (!g) throw new Error("Spiel nicht gefunden");
      return g;
    }
    return api(`/games/${ref.id}?code=${ref.code}`);
  },

  async patch(ref, body) {
    if (isLocalId(ref.id)) {
      const g = lsGet(ref.id);
      if (!g) throw new Error("Spiel nicht gefunden");
      if (body.status !== undefined) g.status = body.status;
      if (body.round !== undefined) g.round = body.round;
      if (body.starter_index !== undefined) g.starterIndex = body.starter_index;
      if (body.turn_index !== undefined) g.turnIndex = body.turn_index;
      lsPut(g);
      return { ok: true };
    }
    return api(`/games/${ref.id}?code=${ref.code}`, { method: "PATCH", body: JSON.stringify(body) });
  },

  // b: { player_id, col, cat_key, kind, value, serviert?, turn_index }
  async putCell(ref, b) {
    if (isLocalId(ref.id)) {
      const g = lsGet(ref.id);
      if (!g) throw new Error("Spiel nicht gefunden");
      const r = g.round;
      const colObj = (((g.cells[b.player_id] ||= {})[r] ||= {})[b.col] ||= {});
      if (colObj[b.cat_key]) throw new Error("Feld ist bereits ausgefüllt");
      colObj[b.cat_key] = { kind: b.kind, v: b.value, serviert: !!b.serviert };
      (g.log ||= []).push({ pid: b.player_id, cat: b.cat_key, round: r, col: b.col });
      const roundFull = g.players.every(p => {
        for (let c = 0; c < g.cols; c++) {
          const cc = colCells(g, p.id, r, c);
          if (!CATS.every(cat => cc[cat.key])) return false;
        }
        return true;
      });
      g.turnIndex = b.turn_index;
      g.status = roundFull ? "round_end" : "active";
      lsPut(g);
      return { ok: true, roundFull };
    }
    return api(`/games/${ref.id}/cells?code=${ref.code}`, { method: "PUT", body: JSON.stringify(b) });
  },

  async undo(ref) {
    if (isLocalId(ref.id)) {
      const g = lsGet(ref.id);
      if (!g || !(g.log || []).length) throw new Error("Nichts zum Löschen");
      const last = g.log[g.log.length - 1];
      if (last.round !== g.round) throw new Error("Einträge aus früheren Runden können nicht gelöscht werden");
      g.log.pop();
      const cc = colCells(g, last.pid, last.round, last.col);
      delete cc[last.cat];
      const p = g.players.find(p => p.id === last.pid);
      if (p) g.turnIndex = p.seat_order;
      g.status = "active";
      lsPut(g);
      return { ok: true };
    }
    return api(`/games/${ref.id}/cells?code=${ref.code}`, { method: "DELETE" });
  },

  async remove(ref) {
    if (isLocalId(ref.id)) {
      lsSave(lsLoad().filter(g => g.id !== ref.id));
      return { ok: true };
    }
    try {
      await api(`/games/${ref.id}?code=${ref.code}`, { method: "DELETE" });
    } finally {
      removeSharedRef(ref.id);
    }
    return { ok: true };
  },
};

// ---------- Helpers ----------
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

function toast(msg, isErr = false) {
  document.querySelectorAll(".toast").forEach(t => t.remove());
  const el = document.createElement("div");
  el.className = "toast" + (isErr ? " err" : "");
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2500);
}

// Overlay einfügen. Bewusst OHNE backdrop-filter (siehe CSS): dessen Ein-
// oder Umschalten beim Einfügen erzeugt in Chromium kurz einen schwarzen
// Frame ("Flackern"). Der abgedunkelte Hintergrund reicht optisch.
function mountOverlay(overlay) {
  document.body.appendChild(overlay);
  return overlay;
}

function fmtDate(iso) {
  const d = new Date(String(iso).replace(" ", "T") + (String(iso).includes("Z") ? "" : "Z"));
  return isNaN(d) ? "" : d.toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function gameHash(ref) {
  return isLocalId(ref.id) ? `#/game/${ref.id}` : `#/game/${ref.id}/${ref.code}`;
}

async function copyCode(code) {
  try {
    await navigator.clipboard.writeText(code);
    toast(`Code ${code} kopiert`);
  } catch {
    toast(`Beitritts-Code: ${code}`);
  }
}

// ---------- Spiel-Logik (arbeitet auf dem geladenen Spielobjekt) ----------
function cellValue(cell) {
  if (!cell) return null;
  return cell.kind === "strike" ? 0 : cell.v;
}
// Zellen einer Spalte: cells[pid][runde][spalte] → { catKey: cell }
function colCells(game, pid, round, col) {
  return ((game.cells[pid] || {})[round] || {})[col] || {};
}
// Eine Kategorie über alle Spalten eines Spielers (für die kompakte Ansicht)
function catAcross(game, pid, round, catKey) {
  let sum = 0, filled = 0, struck = 0, serviert = false;
  for (let c = 0; c < game.cols; c++) {
    const cell = colCells(game, pid, round, c)[catKey];
    if (!cell) continue;
    filled++;
    if (cell.kind === "strike") struck++;
    else { sum += cell.v; if (cell.serviert) serviert = true; }
  }
  return { sum, filled, struck, serviert };
}
function colTotal(game, pid, round, col) {
  const cc = colCells(game, pid, round, col);
  return CATS.reduce((s, c) => s + (cellValue(cc[c.key]) || 0), 0);
}
function roundTotal(game, pid, round) {
  let s = 0;
  for (let c = 0; c < game.cols; c++) s += colTotal(game, pid, round, c);
  return s;
}
function grandTotal(game, pid) {
  let s = 0;
  for (let r = 1; r <= game.round; r++) s += roundTotal(game, pid, r);
  return s;
}
// Eine Spalte ist ein eigenes Blatt: ihr Endstand ist die Summe dieser
// Spalte über ALLE Runden. (Bei einem 1-Runden-Spiel = colTotal der Runde.)
function colGrandTotal(game, pid, col) {
  let s = 0;
  for (let r = 1; r <= (game.round || 1); r++) s += colTotal(game, pid, r, col);
  return s;
}
function roundFilled(game, pid, round) {
  let n = 0;
  for (let c = 0; c < game.cols; c++) {
    const cc = colCells(game, pid, round, c);
    n += CATS.filter(cat => cc[cat.key]).length;
  }
  return n;
}
// Ranking mit Gleichstand (Competition Ranking: 1,1,3,…)
function withRanks(list) {
  const sorted = [...list].sort((a, b) => b.pts - a.pts);
  return sorted.map(e => ({ ...e, rank: 1 + sorted.filter(o => o.pts > e.pts).length }));
}
function grandRanking(game) {
  return withRanks(game.players.map(p => ({ ...p, pts: grandTotal(game, p.id) })));
}
function roundRanking(game, round) {
  return withRanks(game.players.map(p => ({ ...p, pts: roundTotal(game, p.id, round) })));
}
function colRanking(game, col) {
  return withRanks(game.players.map(p => ({ ...p, pts: colGrandTotal(game, p.id, col) })));
}
function rankClass(rank) { return rank <= 3 ? `rank-${rank}` : "rank-x"; }
function rankByPid(ranking) {
  return Object.fromEntries(ranking.map(e => [e.id, e.rank]));
}
function playerName(game, pid) {
  const p = game.players.find(p => p.id == pid);
  return p ? p.name : "?";
}

// ---------- Auto-Aktualisierung geteilter Spiele ----------
let pollTimer = null;
function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}
function startPolling(ref, game) {
  stopPolling();
  if (isLocalId(ref.id)) return;
  let last = JSON.stringify(game);
  pollTimer = setInterval(async () => {
    if (document.hidden || document.querySelector(".sheet-overlay")) return;
    try {
      const g = await store.get(ref);
      const s = JSON.stringify(g);
      if (s !== last) { last = s; renderGame(g, ref); }
    } catch { /* offline o.ä. – beim nächsten Tick erneut */ }
  }, 5000);
}

// ---------- Routing ----------
function navigate(hash) { location.hash = hash; }

async function route() {
  const hash = location.hash || "#/";
  stopPolling();
  try {
    if (hash === "#/" || hash === "") return await renderHome();
    if (hash === "#/new") return renderNewGame();
    if (hash === "#/join") return renderJoin();
    const m = hash.match(/^#\/game\/(L\d+|\d+)(?:\/([A-Za-z0-9]+))?$/);
    if (m) {
      const ref = { id: isLocalId(m[1]) ? m[1] : Number(m[1]), code: m[2] ? m[2].toUpperCase() : null };
      app.innerHTML = `<p class="loading">Lade Spiel …</p>`;
      const game = await store.get(ref);
      return renderGame(game, ref);
    }
    navigate("#/");
  } catch (e) {
    app.innerHTML = `<div class="topbar"><button class="btn-back" onclick="location.hash='#/'">←</button><h1>Fehler</h1></div>
      <p class="error-msg">${esc(e.message)}</p>`;
  }
}
window.addEventListener("hashchange", () => {
  if (document.startViewTransition) document.startViewTransition(() => route());
  else route();
});

async function reload(ref) {
  const game = await store.get(ref);
  renderGame(game, ref);
}

// ---------- Home ----------
async function renderHome() {
  GS.markPlayed("wuerfelpoker");
  GS.onboard("wuerfelpoker", {
    title: "Würfelpoker — so geht's",
    steps: [
      { icon: "🎲", text: "Am Tisch mit echten Würfeln spielen — die App ist euer Punkteblatt." },
      { icon: "➕", text: "Neues Spiel starten oder mit einem 6-stelligen Code / QR beitreten." },
      { icon: "🏆", text: "Mehrere Runden pro Spiel; die Gesamtsumme kürt den Sieger." },
    ],
  });
  const localGames = lsLoad();
  const refs = sharedRefs();

  const item = (g, ref, idx, extraBadge = "") => {
    const r = grandRanking(g);
    const lead = r[0];
    const colsNote = (g.cols || 1) > 1 ? ` · ${g.cols} Spalten` : "";
    const sub = g.status === "finished"
      ? `🏆 ${esc(lead.name)} · ${lead.pts} P${(g.round || 1) > 1 ? ` · ${g.round} Runden` : ""}`
      : `Runde ${g.round || 1}${colsNote} · es führt ${esc(lead.name)}`;
    return `
      <div class="game-row" style="--i:${idx}">
        <button class="game-list-item" data-hash="${gameHash(ref)}">
          <span class="gl-name">${esc(g.name || "Spiel")}</span>
          <span class="badge ${g.status === "finished" ? "finished" : "active"}">${g.status === "finished" ? "beendet" : "läuft"}</span>
          ${extraBadge}
          <div class="gl-meta">${esc(g.players.map(p => p.name).join(", "))}</div>
          <div class="gl-meta">${sub} · ${fmtDate(g.createdAt)}</div>
        </button>
        <button class="game-del" data-id="${ref.id}" data-code="${ref.code || ""}" data-name="${esc(g.name || "Spiel")}" title="Spiel löschen" aria-label="Spiel löschen">🗑</button>
      </div>`;
  };

  let idx = 0;
  const localHtml = localGames.map(g => item(g, { id: g.id, code: null }, idx++)).join("");

  app.innerHTML = `
    <a class="home-link" href="/">← Alle Apps</a>
    <button class="theme-fab" data-theme-toggle aria-label="Hell/Dunkel umschalten"></button>
    <header class="hero">
      <span class="overline">Escalero</span>
      <h1><span class="foil">Würfelpoker</span></h1>
      <div class="hero-dice">⚄ ⚀ ⚂ ⚅ ⚁</div>
    </header>
    <div class="home-actions">
      <button class="btn-primary" id="btn-new">+ Neues Spiel</button>
      <button class="btn-secondary btn-join" id="btn-join">🔑 Mit Code beitreten</button>
    </div>
    ${localGames.length ? `<h2>Auf diesem Gerät</h2><div class="stack">${localHtml}</div>` : ""}
    <div id="shared-section"></div>
    ${!localGames.length && !refs.length ? `<p class="loading">Noch keine Spiele.</p>` : ""}
    ${statsHtml(localGames)}
    <button class="btn-link" id="btn-rules">ℹ️ Spielregeln</button>
  `;

  document.getElementById("btn-new").onclick = () => navigate("#/new");
  document.getElementById("btn-join").onclick = () => navigate("#/join");
  document.getElementById("btn-rules").onclick = showRules;

  const wire = () => {
    app.querySelectorAll(".game-list-item").forEach(el => {
      el.onclick = () => navigate(el.dataset.hash);
    });
    app.querySelectorAll(".game-del").forEach(el => {
      el.onclick = async e => {
        e.stopPropagation();
        const shared = !isLocalId(el.dataset.id);
        const q = shared
          ? `Geteiltes Spiel „${el.dataset.name}" für ALLE Mitspieler löschen?`
          : `Spiel „${el.dataset.name}" wirklich löschen?`;
        if (!confirm(q)) return;
        el.disabled = true;
        try {
          const id = shared ? Number(el.dataset.id) : el.dataset.id;
          await store.remove({ id, code: el.dataset.code || null });
          toast("Spiel gelöscht");
          await renderHome();
        } catch (err) {
          // Auf dem Server schon weg → nur lokalen Verweis entfernen
          removeSharedRef(Number(el.dataset.id));
          toast(err.message, true);
          await renderHome();
        }
      };
    });
  };
  wire();

  // Geteilte Spiele nachladen (Codes sind auf diesem Gerät gemerkt)
  if (refs.length) {
    const section = document.getElementById("shared-section");
    section.innerHTML = `<h2>Geteilte Spiele</h2><p class="loading">Lade …</p>`;
    const results = await Promise.allSettled(refs.map(r => store.get(r)));
    let sIdx = 0;
    const rows = results.map((res, i) => {
      const ref = refs[i];
      const codeBadge = `<span class="badge code">🔑 ${esc(ref.code)}</span>`;
      if (res.status === "fulfilled") return item(res.value, ref, sIdx++, codeBadge);
      return `
        <div class="game-row" style="--i:${sIdx++}">
          <button class="game-list-item" disabled>
            <span class="gl-name">Code ${esc(ref.code)}</span>
            <span class="badge finished">nicht erreichbar</span>
            <div class="gl-meta">${esc(res.reason?.message || "Wurde das Spiel gelöscht?")}</div>
          </button>
          <button class="game-del" data-forget="${ref.id}" title="Verweis entfernen" aria-label="Verweis entfernen">🗑</button>
        </div>`;
    }).join("");
    section.innerHTML = `<h2>Geteilte Spiele</h2><div class="stack">${rows}</div>`;
    wire();
    section.querySelectorAll("[data-forget]").forEach(el => {
      el.onclick = () => { removeSharedRef(Number(el.dataset.forget)); renderHome(); };
    });
  }
}

// ---------- Statistik über abgeschlossene Spiele (dieses Gerät) ----------
function statsHtml(games) {
  const finished = games.filter(g => g.status === "finished");
  if (!finished.length) return "";
  const stats = {}; // name (lowercase) → { name, spiele, siege, punkte }
  for (const g of finished) {
    const r = grandRanking(g);
    const top = r[0].pts;
    for (const p of r) {
      const key = p.name.toLowerCase();
      const s = (stats[key] ||= { name: p.name, spiele: 0, siege: 0, punkte: 0 });
      s.spiele++;
      s.punkte += p.pts;
      if (p.pts === top && top > 0) s.siege++;
    }
  }
  const rows = Object.values(stats).sort((a, b) => b.siege - a.siege || b.punkte - a.punkte);
  return `
    <h2>Statistik</h2>
    <div class="stats-box">
      <div class="stats-row stats-head">
        <span class="st-name">Spieler</span><span>Siege</span><span>Spiele</span><span>Ø Punkte</span>
      </div>
      ${rows.map((s, i) => `
        <div class="stats-row">
          <span class="st-name">${i === 0 ? "👑 " : ""}${esc(s.name)}</span>
          <span class="st-wins">${s.siege}</span>
          <span>${s.spiele}</span>
          <span>${Math.round(s.punkte / s.spiele)}</span>
        </div>`).join("")}
    </div>`;
}

// ---------- Mit Code beitreten ----------
function renderJoin() {
  app.innerHTML = `
    <div class="topbar">
      <button class="btn-back" id="btn-back">←</button>
      <h1>Spiel beitreten</h1>
      <button class="btn-icon" data-theme-toggle></button>
    </div>
    <p class="hint">Gib den <strong>6-stelligen Code</strong> ein, den dir der Ersteller des Spiels geschickt hat.</p>
    <input type="text" id="join-code" class="code-input" placeholder="z. B. K7Q2ZX" maxlength="6"
           autocomplete="off" autocapitalize="characters" spellcheck="false">
    <div style="height:14px"></div>
    <button class="btn-primary" id="btn-go">Beitreten</button>
  `;

  const input = document.getElementById("join-code");
  input.focus();
  input.oninput = () => { input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, ""); };

  document.getElementById("btn-back").onclick = () => navigate("#/");
  const go = async () => {
    const code = input.value.trim().toUpperCase();
    if (code.length < 4) return toast("Code eingeben", true);
    const btn = document.getElementById("btn-go");
    btn.disabled = true;
    try {
      const game = await api(`/games?code=${code}`);
      addSharedRef({ id: game.id, code });
      navigate(`#/game/${game.id}/${code}`);
    } catch (err) {
      toast(err.message, true);
      btn.disabled = false;
    }
  };
  document.getElementById("btn-go").onclick = go;
  input.onkeydown = e => { if (e.key === "Enter") go(); };
}

// ---------- Neues Spiel ----------
function renderNewGame() {
  const savedNames = JSON.parse(localStorage.getItem("wp_last_players") || '["",""]');
  let shared = false;
  let cols = Number(localStorage.getItem("wp_last_cols") || 1) || 1;

  app.innerHTML = `
    <div class="topbar">
      <button class="btn-back" id="btn-back">←</button>
      <h1>Neues Spiel</h1>
      <button class="btn-icon" data-theme-toggle></button>
    </div>
    <div class="stack">
      <input type="text" id="game-name" placeholder="Spielname (optional)">
      <h2>Wo spielen?</h2>
      <div class="mode-grid">
        <button class="mode-tile selected" data-mode="local">
          <span class="mt-icon">📱</span>
          <span class="mt-name">Nur dieses Gerät</span>
          <span class="mt-note">bleibt privat, kein Internet nötig</span>
        </button>
        <button class="mode-tile" data-mode="shared">
          <span class="mt-icon">🔑</span>
          <span class="mt-name">Mit Code teilen</span>
          <span class="mt-note">andere treten per Code bei</span>
        </button>
      </div>
      <h2>Spalten pro Spieler</h2>
      <div class="stepper">
        <button type="button" id="col-minus" aria-label="Weniger Spalten">−</button>
        <input type="number" id="col-count" min="1" step="1" inputmode="numeric" value="${cols}">
        <button type="button" id="col-plus" aria-label="Mehr Spalten">+</button>
      </div>
      <p class="hint" style="margin-top:2px">Jede Spalte ist ein eigenes Blatt — wie mehrere Spiele gleichzeitig. Pro Zug füllst du <strong>ein Feld in einer beliebigen eigenen Spalte</strong>.</p>
      <h2>Spieler (mind. 2)</h2>
      <div id="players"></div>
      <button class="btn-secondary" id="btn-add">+ Spieler hinzufügen</button>
      <button class="btn-primary" id="btn-start">Weiter → Startspieler auswürfeln</button>
    </div>
  `;

  app.querySelectorAll(".mode-tile").forEach(el => {
    el.onclick = () => {
      shared = el.dataset.mode === "shared";
      app.querySelectorAll(".mode-tile").forEach(t => t.classList.toggle("selected", t === el));
    };
  });

  const colInput = document.getElementById("col-count");
  const clampCols = () => {
    cols = Math.max(1, Math.floor(Number(colInput.value) || 1));
    colInput.value = cols;
  };
  colInput.onchange = clampCols;
  document.getElementById("col-minus").onclick = () => { colInput.value = Math.max(1, cols - 1); clampCols(); };
  document.getElementById("col-plus").onclick = () => { colInput.value = cols + 1; clampCols(); };

  const playersDiv = document.getElementById("players");
  function addPlayerRow(value = "") {
    const row = document.createElement("div");
    row.className = "player-input-row";
    row.innerHTML = `
      <input type="text" placeholder="Name" value="${esc(value)}" autocomplete="off">
      <button type="button" title="Entfernen">✕</button>`;
    row.querySelector("button").onclick = () => {
      if (playersDiv.children.length > 2) row.remove();
      else row.querySelector("input").value = "";
    };
    playersDiv.appendChild(row);
    return row;
  }
  savedNames.forEach(n => addPlayerRow(n));
  while (playersDiv.children.length < 2) addPlayerRow();

  document.getElementById("btn-back").onclick = () => navigate("#/");
  document.getElementById("btn-add").onclick = () => addPlayerRow().querySelector("input").focus();

  document.getElementById("btn-start").onclick = async e => {
    const names = [...playersDiv.querySelectorAll("input")].map(i => i.value.trim()).filter(Boolean);
    if (names.length < 2) return toast("Mindestens 2 Spieler angeben", true);
    clampCols();
    e.target.disabled = true;
    try {
      localStorage.setItem("wp_last_players", JSON.stringify(names));
      localStorage.setItem("wp_last_cols", String(cols));
      const name = document.getElementById("game-name").value.trim() || null;
      const res = await store.create({ name, players: names, cols, shared });
      if (res.code) toast(`Beitritts-Code: ${res.code}`);
      navigate(gameHash(res));
    } catch (err) {
      toast(err.message, true);
      e.target.disabled = false;
    }
  };
}

// ---------- Spiel-Dispatcher ----------
function renderGame(game, ref) {
  if (game.status === "finished") { stopPolling(); return renderFinished(game, ref); }
  if (game.status === "round_end") {
    renderRoundEnd(game, ref);
  } else if (game.starterIndex === null || game.starterIndex === undefined) {
    renderStarterRoll(game, ref);
  } else {
    renderSheet(game, ref);
  }
  startPolling(ref, game);
}

// Code-Zeile für geteilte Spiele (antippen = kopieren; QR zum Beitreten)
function codeChipHtml(game) {
  if (!game.code) return "";
  return `
    <div class="code-row">
      <button class="code-chip" data-code="${esc(game.code)}" title="Code kopieren">
        🔑 Beitritts-Code: <b>${esc(game.code)}</b> <span class="cc-hint">antippen zum Kopieren</span>
      </button>
      <button class="code-qr" data-code="${esc(game.code)}" data-id="${esc(game.id)}" title="QR-Code zum Beitreten">📱 QR</button>
    </div>`;
}
function wireCodeChip() {
  const chip = app.querySelector(".code-chip");
  if (chip) chip.onclick = () => copyCode(chip.dataset.code);
  const qr = app.querySelector(".code-qr");
  if (qr) qr.onclick = () => showJoinQR(qr.dataset.id, qr.dataset.code);
}

// Overlay mit QR-Code + Link zum Beitreten (Mitspieler scannen einfach)
function showJoinQR(id, code) {
  const url = location.href.split("#")[0] + `#/game/${id}/${code}`;
  const overlay = document.createElement("div");
  overlay.className = "qr-overlay";
  overlay.innerHTML = `
    <div class="qr-modal">
      <button class="qr-x" id="qr-close" aria-label="Schließen">✕</button>
      <h2 class="qr-h">Zum Spiel einladen</h2>
      <p class="qr-sub">Mitspieler scannen den Code mit der Handy-Kamera.</p>
      <div class="qr-box"><canvas id="qr-canvas"></canvas></div>
      <p class="qr-code">🔑 <b>${esc(code)}</b></p>
      <button class="btn-primary" id="qr-share">📤 Link teilen</button>
    </div>`;
  mountOverlay(overlay);
  try {
    window.QR.toCanvas(url, overlay.querySelector("#qr-canvas"), { scale: 6, margin: 3, dark: "#141414", light: "#ffffff" });
  } catch (e) {
    overlay.querySelector(".qr-box").innerHTML = `<p class="sub">QR nicht verfügbar — nutze den Code ${esc(code)}.</p>`;
  }
  const close = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) close(); };
  overlay.querySelector("#qr-close").onclick = close;
  overlay.querySelector("#qr-share").onclick = async () => {
    const r = await GS.share({ title: "Würfelpoker", text: `Spiel mit mir Würfelpoker mit! Beitritts-Code: ${code}`, url });
    if (r === "copied") toast("Link kopiert");
  };
}

// ---------- Startspieler auswürfeln (einziges Würfeln der App) ----------
// Pokerwürfel-Seiten, aufsteigend: 9 < 10 < B < D < K < A
const DIE_FACES = ["9", "10", "B", "D", "K", "A"];
// Orientierung des Würfels, damit Seite n (1-6) vorne liegt
const DIE_ORIENT = [
  { x: 0, y: 0 },     // f1 vorne
  { x: 0, y: -90 },   // f2 rechts
  { x: -90, y: 0 },   // f3 oben
  { x: 90, y: 0 },    // f4 unten
  { x: 0, y: 90 },    // f5 links
  { x: 0, y: 180 },   // f6 hinten
];

function dieCube(idx) {
  // Echtes 3D-Modell (WebGL, die3d.js); CSS-Würfel nur als Fallback
  if (window.Die3D && Die3D.ok()) {
    return `<span class="die3d gl" data-idx="${idx}"><canvas class="die-canvas"></canvas></span>`;
  }
  return `
    <span class="die3d" data-idx="${idx}">
      <span class="die3d-cube">
        ${DIE_FACES.map((_, n) => `<span class="die-core c${n + 1}"></span>`).join("")}
        ${DIE_FACES.map((f, n) =>
          `<span class="die-face f${n + 1} ${n >= 4 ? "hi" : ""}">${f}</span>`).join("")}
      </span>
    </span>`;
}

function renderStarterRoll(game, ref) {
  app.innerHTML = `
    <div class="topbar">
      <button class="btn-back" id="btn-back">←</button>
      <h1>${esc(game.name)}</h1>
      <button class="btn-icon" data-theme-toggle></button>
    </div>
    ${codeChipHtml(game)}
    <div class="starter-banner">Wer beginnt? Jeder würfelt einmal — <strong>höchster Wurf beginnt</strong> (9 &lt; 10 &lt; B &lt; D &lt; K &lt; A).</div>
    <div class="dice-roll-list" id="roll-list">
      ${game.players.map((p, i) => `
        <div class="dice-roll-row" data-idx="${i}">
          <span class="drr-name">${esc(p.name)}</span>
          ${dieCube(i)}
        </div>`).join("")}
    </div>
    <button class="btn-primary" id="btn-roll">🎲 Würfeln</button>
    <button class="btn-link" id="btn-manual">Startspieler stattdessen antippen</button>
    <div class="player-grid hidden" id="manual-grid">
      ${game.players.map((p, i) => `<button class="player-tile" data-idx="${i}">${esc(p.name)}</button>`).join("")}
    </div>
  `;

  document.getElementById("btn-back").onclick = () => navigate("#/");
  wireCodeChip();

  // WebGL-Würfel an ihre Canvases binden (zeichnet die Ruhelage)
  const glDice = (window.Die3D && Die3D.ok())
    ? [...app.querySelectorAll("canvas.die-canvas")].map(c => Die3D.attach(c))
    : null;

  async function setStarter(idx) {
    try {
      await store.patch(ref, { status: "active", starter_index: idx, turn_index: idx });
      toast(`${game.players[idx].name} beginnt`);
      await reload(ref);
    } catch (err) { toast(err.message, true); }
  }

  document.getElementById("btn-manual").onclick = () => {
    document.getElementById("manual-grid").classList.toggle("hidden");
  };
  app.querySelectorAll("#manual-grid .player-tile").forEach(el => {
    el.onclick = () => setStarter(Number(el.dataset.idx));
  });

  document.getElementById("btn-roll").onclick = () => {
    const btn = document.getElementById("btn-roll");
    btn.disabled = true;
    app.querySelectorAll(".dice-roll-row").forEach(el => el.classList.remove("win"));

    const cubes = [...app.querySelectorAll(".die3d-cube")];
    const rolls = game.players.map(() => 1 + Math.floor(Math.random() * 6));

    GS.haptic(20);
    const spins = () => (2 + Math.floor(Math.random() * 2)) * 360;
    if (glDice) {
      // Echtes 3D-Modell: Zielrotation je Würfel, gestaffelt animiert
      Die3D.roll(glDice, rolls.map(r => {
        const o = DIE_ORIENT[r - 1];
        return { x: o.x + spins(), y: o.y + spins() };
      }));
    } else {
      cubes.forEach((cube, i) => {
        const o = DIE_ORIENT[rolls[i] - 1];
        cube.style.transitionDelay = `${i * 90}ms`;
        // perspective() bleibt in der Transform-Kette (s. CSS)
        cube.style.transform =
          `perspective(420px) rotateX(${o.x + spins()}deg) rotateY(${o.y + spins()}deg)`;
      });
    }
    // Rasselnde Würfel-Klänge während der Animation
    for (let k = 0; k < 8; k++) GS.sound.tone(140 + k * 20, 0.05, { type: "square", gain: 0.045, delay: k * 0.12 });

    setTimeout(() => {
      const max = Math.max(...rolls);
      const winners = rolls.map((v, i) => ({ v, i })).filter(r => r.v === max);
      if (winners.length > 1) {
        toast(`Gleichstand (${DIE_FACES[max - 1]}) — nochmal würfeln`, true);
        btn.disabled = false;
      } else {
        app.querySelector(`.dice-roll-row[data-idx="${winners[0].i}"]`).classList.add("win");
        GS.sound.win(); GS.haptic([15, 60, 15]);
        setTimeout(() => setStarter(winners[0].i), 1000);
      }
    }, 1600 + cubes.length * 90);
  };
}

// ---------- Verrechnungsblatt (Hauptansicht) ----------
// Aufgeklappter Spieler pro Spiel: undefined/null = automatisch (wer dran
// ist), -1 = alle zu, sonst die Spieler-ID.
const expandedChoice = {};

function renderSheet(game, ref) {
  const cols = game.cols || 1;
  const round = game.round || 1;
  const turnPid = game.players[game.turnIndex].id;
  const zug = roundFilled(game, turnPid, round) + 1;
  const zuegeGesamt = cols * CATS.length;

  const choice = expandedChoice[game.id];
  const expPid = cols === 1 ? null : (choice === undefined || choice === null ? turnPid : choice);

  const grand = rankByPid(grandRanking(game));

  // --- Kopfzeilen ---
  const isExp = p => cols > 1 && p.id === expPid;
  const anyExp = cols > 1 && game.players.some(isExp);
  const headCells = game.players.map((p, i) => {
    const isTurn = i === game.turnIndex;
    const exp = isExp(p);
    const attrs = cols > 1 ? `data-pid="${p.id}" role="button" tabindex="0"` : "";
    const chev = cols > 1 ? `<span class="ph-chev">${exp ? "▾" : "▸"}</span>` : "";
    const span = exp ? `colspan="${cols}"` : (anyExp ? `rowspan="2"` : "");
    return `<th class="p-head ${isTurn ? "turn" : ""} ${exp ? "expanded" : ""} ${cols > 1 ? "clickable" : ""}" ${span} ${attrs}>${isTurn ? "🎲 " : ""}${esc(p.name)}${chev}</th>`;
  }).join("");
  const subHead = anyExp
    ? `<tr>${game.players.map(p => isExp(p)
        ? Array.from({ length: cols }, (_, c) => `<th class="sub-head">${c + 1}</th>`).join("")
        : "").join("")}</tr>`
    : "";

  // --- Kategorie-Zeilen ---
  const rowFor = cat => {
    const isCombo = cat.type === "combo";
    const cells = game.players.map(p => {
      const isTurn = p.id == turnPid;
      if (isExp(p)) {
        // Einzelspalten sichtbar
        return Array.from({ length: cols }, (_, c) => {
          const cell = colCells(game, p.id, round, c)[cat.key];
          const editable = isTurn && !cell;
          let inner = "&nbsp;";
          let cls = "cell sub";
          if (cell) {
            if (cell.kind === "strike") { inner = "✕"; cls += " struck"; }
            else { inner = cell.v; cls += " filled"; if (cell.serviert) cls += " serviert"; }
          } else if (editable) {
            cls += " editable";
          }
          if (isTurn) cls += " in-turn";
          return `<td class="${cls}" data-pid="${p.id}" data-cat="${cat.key}" data-col="${c}">${inner}</td>`;
        }).join("");
      }
      // Kompakt: Summe der Kategorie über alle Spalten
      if (cols === 1) {
        const cell = colCells(game, p.id, round, 0)[cat.key];
        const editable = isTurn && !cell;
        let inner = "&nbsp;";
        let cls = "cell";
        if (cell) {
          if (cell.kind === "strike") { inner = "✕"; cls += " struck"; }
          else { inner = cell.v; cls += " filled"; if (cell.serviert) cls += " serviert"; }
        } else if (editable) {
          cls += " editable";
        }
        if (isTurn) cls += " in-turn";
        return `<td class="${cls}" data-pid="${p.id}" data-cat="${cat.key}" data-col="0">${inner}</td>`;
      }
      const a = catAcross(game, p.id, round, cat.key);
      let inner = "&nbsp;", cls = "cell compact";
      if (a.filled > 0) {
        inner = (a.filled === a.struck)
          ? `<span class="struck-x">✕</span>`
          : `${a.sum}`;
        cls += a.filled === a.struck ? " struck" : " filled";
        if (a.serviert) cls += " serviert";
        inner += `<span class="cc-progress">${a.filled}/${cols}</span>`;
      }
      if (isTurn) cls += " in-turn";
      return `<td class="${cls}">${inner}</td>`;
    }).join("");
    return `
      <tr class="${isCombo ? "combo-row" : "upper-row"} ${cat.key === "S" ? "combo-start" : ""}">
        <th class="row-label">
          <span class="rl-main">${cat.label}</span>
          ${cat.sub ? `<sub class="rl-sub">${cat.sub}</sub>` : ""}
        </th>
        ${cells}
      </tr>`;
  };

  // --- Total-Zeilen ---
  // Runde 1: eine Zeile "Total" (gefärbt). Ab Runde 2: "Runde" (neutral)
  // + "Gesamt" (gefärbt) — die Farben zeigen die Gesamtführung.
  const colorRoundRow = round === 1;
  const roundCells = game.players.map(p => {
    const cls = colorRoundRow ? `cell total ${rankClass(grand[p.id])}` : "cell total plain";
    if (isExp(p)) {
      return Array.from({ length: cols }, (_, c) =>
        `<td class="${cls} sub">${colTotal(game, p.id, round, c)}</td>`).join("");
    }
    return `<td class="${cls}">${roundTotal(game, p.id, round)}</td>`;
  }).join("");
  const grandRow = round > 1 ? `
    <tr class="total-row grand-row">
      <th class="row-label">Gesamt</th>
      ${game.players.map(p =>
        `<td class="cell total ${rankClass(grand[p.id])}" ${isExp(p) ? `colspan="${cols}"` : ""}>${grandTotal(game, p.id)}</td>`).join("")}
    </tr>` : "";

  app.innerHTML = `
    <div class="topbar">
      <button class="btn-back" id="btn-back">←</button>
      <h1>${esc(game.name)}</h1>
      <button class="btn-icon" data-theme-toggle></button>
      <button class="btn-icon" id="btn-rules" title="Regeln">ℹ️</button>
    </div>
    ${codeChipHtml(game)}
    <div class="starter-banner">
      <strong>${esc(playerName(game, turnPid))}</strong> ist dran · Runde ${round} · Zug ${zug}/${zuegeGesamt}
    </div>
    <p class="hint">Echte Würfel werfen, dann ein freies Feld ${cols > 1 ? "in einer <strong>beliebigen eigenen Spalte</strong>" : "in deiner Spalte"} antippen. Nichts Passendes? Feld <strong>streichen</strong> (✕).${cols > 1 ? " Spielernamen antippen zeigt dessen Spalten." : ""}</p>

    <div class="sheet-wrap">
      <table class="sheet">
        <thead>
          <tr><th class="corner" ${anyExp ? `rowspan="2"` : ""}>Name</th>${headCells}</tr>
          ${subHead}
        </thead>
        <tbody>
          ${CATS.map(rowFor).join("")}
          <tr class="total-row">
            <th class="row-label">${round === 1 ? "Total" : `Runde ${round}`}</th>
            ${roundCells}
          </tr>
          ${grandRow}
        </tbody>
      </table>
    </div>

    <div class="footer-actions">
      ${hasUndo(game) ? `<button class="btn-secondary" id="btn-undo">↩︎ Letzten Eintrag löschen</button>` : ""}
      <button class="btn-danger" id="btn-finish">Spiel beenden</button>
    </div>
  `;

  document.getElementById("btn-back").onclick = () => navigate("#/");
  document.getElementById("btn-rules").onclick = showRules;
  wireCodeChip();

  // Spieler auf-/zuklappen
  if (cols > 1) {
    app.querySelectorAll(".p-head.clickable").forEach(el => {
      el.onclick = () => {
        const pid = Number(el.dataset.pid);
        expandedChoice[game.id] = (pid === expPid) ? -1 : pid;
        renderSheet(game, ref);
      };
    });
  }

  app.querySelectorAll(".cell.editable").forEach(el => {
    el.onclick = () => openEntry(game, ref, el.dataset.pid, el.dataset.cat, Number(el.dataset.col));
  });

  const undo = document.getElementById("btn-undo");
  if (undo) undo.onclick = async () => {
    undo.disabled = true;
    try { await store.undo(ref); await reload(ref); }
    catch (err) { toast(err.message, true); undo.disabled = false; }
  };

  document.getElementById("btn-finish").onclick = async e => {
    if (!confirm("Spiel wirklich vorzeitig beenden? Der aktuelle Stand wird als Endstand gewertet.")) return;
    e.target.disabled = true;
    try {
      await store.patch(ref, { status: "finished" });
      await reload(ref);
    } catch (err) { toast(err.message, true); e.target.disabled = false; }
  };
}

function hasUndo(game) {
  if (isLocalId(game.id)) {
    const last = (game.log || [])[game.log?.length - 1];
    return !!last && last.round === game.round;
  }
  // Geteilt: Server prüft die Runde — Button zeigen, sobald in der
  // aktuellen Runde etwas eingetragen ist.
  return game.players.some(p => roundFilled(game, p.id, game.round) > 0);
}

// ---------- Eintrag / Feld ausfüllen ----------
function openEntry(game, ref, pid, catKey, col) {
  const cat = CAT_BY_KEY[catKey];
  let options;
  if (cat.type === "upper") {
    const name = cat.name || cat.label;
    options = [1, 2, 3, 4, 5].map(n => ({
      label: `${n}× ${name}`, note: `${n} × ${cat.val} = ${n * cat.val}`,
      apply: { kind: "score", value: n * cat.val },
    }));
  } else {
    options = [
      { label: `${cat.name}`, note: `${cat.base} P`,
        apply: { kind: "score", value: cat.base } },
      { label: `${cat.name} serviert`, note: `${cat.serviert} P (im 1. Wurf)`,
        apply: { kind: "score", value: cat.serviert, serviert: true } },
    ];
  }

  const colNote = (game.cols || 1) > 1 ? ` · Spalte ${col + 1}` : "";
  const overlay = document.createElement("div");
  overlay.className = "sheet-overlay";
  overlay.innerHTML = `
    <div class="sheet-modal">
      <div class="sm-title">${esc(cat.name || cat.label)} — ${esc(playerName(game, pid))}${colNote}</div>
      <div class="sm-options">
        ${options.map((o, i) => `
          <button class="sm-opt" data-i="${i}">
            <span class="smo-label">${esc(o.label)}</span>
            <span class="smo-note">${esc(o.note)}</span>
          </button>`).join("")}
        <button class="sm-opt strike" data-strike="1">
          <span class="smo-label">✕ Streichen</span>
          <span class="smo-note">0 Punkte</span>
        </button>
      </div>
      <button class="btn-secondary" data-cancel="1">Abbrechen</button>
    </div>`;
  mountOverlay(overlay);

  const close = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) close(); };
  overlay.querySelector("[data-cancel]").onclick = close;
  overlay.querySelector("[data-strike]").onclick = () => { close(); commit(game, ref, pid, catKey, col, { kind: "strike", value: 0 }); };
  overlay.querySelectorAll(".sm-opt[data-i]").forEach(el => {
    el.onclick = () => { close(); commit(game, ref, pid, catKey, col, options[Number(el.dataset.i)].apply); };
  });
}

async function commit(game, ref, pid, catKey, col, cell) {
  const nextTurn = (game.turnIndex + 1) % game.players.length;
  // Klang + Haptik: gestrichen dumpf, Punkte hell, großer Wurf glänzend
  if (cell.kind === "strike") { GS.sound.tone(200, 0.14, { type: "sawtooth", gain: 0.08 }); GS.haptic(8); }
  else if (cell.value >= 30) { GS.sound.great(); GS.haptic([12, 40, 12]); }
  else { GS.sound.good(); GS.haptic(12); }
  try {
    await store.putCell(ref, {
      player_id: Number(pid),
      col,
      cat_key: catKey,
      kind: cell.kind,
      value: cell.value,
      serviert: !!cell.serviert,
      turn_index: nextTurn,
    });
    // Nach dem Zug wieder automatisch den nächsten aktiven Spieler zeigen
    delete expandedChoice[game.id];
    await reload(ref);
  } catch (err) {
    toast(err.message, true);
    await reload(ref);
  }
}

// ---------- Gesamtstand-Tabelle (Rundenende + Endstand) ----------
function standingsTable(game, { withRoundRows = true } = {}) {
  const rounds = game.round || 1;
  const grand = grandRanking(game);
  const grandRank = rankByPid(grand);

  const roundRows = withRoundRows ? Array.from({ length: rounds }, (_, i) => {
    const r = i + 1;
    const rr = roundRanking(game, r);
    const best = rr[0].pts;
    return `
      <tr>
        <th class="row-label">Runde ${r}</th>
        ${game.players.map(p => {
          const pts = roundTotal(game, p.id, r);
          const win = pts === best && pts > 0;
          return `<td class="cell ${win ? "round-win" : ""}">${win ? "🏆 " : ""}${pts}</td>`;
        }).join("")}
      </tr>`;
  }).join("") : "";

  return `
    <div class="sheet-wrap">
      <table class="sheet readonly">
        <thead><tr><th class="corner">&nbsp;</th>${game.players.map(p =>
          `<th class="p-head">${esc(p.name)}</th>`).join("")}</tr></thead>
        <tbody>
          ${roundRows}
          <tr class="total-row grand-row">
            <th class="row-label">Gesamt</th>
            ${game.players.map(p =>
              `<td class="cell total ${rankClass(grandRank[p.id])}">${grandTotal(game, p.id)}</td>`).join("")}
          </tr>
        </tbody>
      </table>
    </div>`;
}

// ---------- Spalten-Wertung (jede Spalte = eigenes Blatt mit Sieger) ----------
// Nutzt die ohnehin gespeicherten Spaltendaten und wirkt daher auch
// rückwirkend für bereits gespielte Spiele. Nur sinnvoll ab 2 Spalten.
function columnStandings(game, { heading = true } = {}) {
  const cols = game.cols || 1;
  if (cols < 2) return "";
  const rows = Array.from({ length: cols }, (_, c) => {
    const rr = colRanking(game, c);
    const best = rr[0].pts;
    const rk = rankByPid(rr);
    return `
      <tr>
        <th class="row-label">Spalte ${c + 1}</th>
        ${game.players.map(p => {
          const pts = colGrandTotal(game, p.id, c);
          const win = pts === best && pts > 0;
          return `<td class="cell total ${rankClass(rk[p.id])}">${win ? "🏆 " : ""}${pts}</td>`;
        }).join("")}
      </tr>`;
  }).join("");
  return `
    ${heading ? "<h2>Spalten-Wertung</h2>" : ""}
    <div class="sheet-wrap">
      <table class="sheet readonly">
        <thead><tr><th class="corner">Spalte</th>${game.players.map(p =>
          `<th class="p-head">${esc(p.name)}</th>`).join("")}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}
// Kurz-Chips: „Spalte 1: 🏆 Name (Punkte)"
function columnChips(game) {
  const cols = game.cols || 1;
  if (cols < 2) return "";
  return `
    <div class="round-chips">
      ${Array.from({ length: cols }, (_, c) => {
        const rr = colRanking(game, c);
        const best = rr.filter(p => p.pts === rr[0].pts);
        return `<span class="round-chip">Spalte ${c + 1}: 🏆 ${best.map(b => esc(b.name)).join(" & ")} (${rr[0].pts})</span>`;
      }).join("")}
    </div>`;
}

// ---------- Rundenende: weiterspielen oder abschließen ----------
function renderRoundEnd(game, ref) {
  const round = game.round || 1;
  const rr = roundRanking(game, round);
  const topPts = rr[0].pts;
  const roundWinners = rr.filter(p => p.pts === topPts);
  const nextCircleIdx = ((game.starterIndex ?? 0) + 1) % game.players.length;
  const winnerSeat = game.players.findIndex(p => p.id === roundWinners[0].id);

  app.innerHTML = `
    <div class="topbar">
      <button class="btn-back" id="btn-back">←</button>
      <h1>${esc(game.name)}</h1>
      <button class="btn-icon" data-theme-toggle></button>
    </div>
    ${codeChipHtml(game)}
    <div class="winner-box small">
      <div class="trophy">🏆</div>
      <div class="w-name">${roundWinners.map(w => esc(w.name)).join(" & ")}</div>
      <div class="w-pts">gewinnt Runde ${round} mit ${topPts} Punkten${roundWinners.length > 1 ? " (geteilt)" : ""}</div>
    </div>

    <h2>Gesamtstand</h2>
    ${standingsTable(game)}
    ${columnStandings(game)}

    <h2>Wie geht's weiter?</h2>
    <div class="stack">
      <button class="btn-primary" id="btn-next-winner">▶️ Nächste Runde — 🏆 ${esc(roundWinners[0].name)} beginnt</button>
      <button class="btn-secondary" id="btn-next-circle">▶️ Nächste Runde — im Kreis (${esc(game.players[nextCircleIdx].name)} beginnt)</button>
      <button class="btn-danger" id="btn-end">🏁 Spiel abschließen — Endstand</button>
      <button class="btn-link" id="btn-undo">↩︎ Letzten Eintrag löschen (Runde fortsetzen)</button>
    </div>
  `;

  document.getElementById("btn-back").onclick = () => navigate("#/");
  wireCodeChip();

  const nextRound = async idx => {
    try {
      await store.patch(ref, { status: "active", round: round + 1, starter_index: idx, turn_index: idx });
      toast(`Runde ${round + 1} — ${game.players[idx].name} beginnt`);
      await reload(ref);
    } catch (err) { toast(err.message, true); }
  };
  document.getElementById("btn-next-winner").onclick = () => nextRound(winnerSeat);
  document.getElementById("btn-next-circle").onclick = () => nextRound(nextCircleIdx);
  document.getElementById("btn-end").onclick = async e => {
    e.target.disabled = true;
    try {
      await store.patch(ref, { status: "finished" });
      await reload(ref);
    } catch (err) { toast(err.message, true); e.target.disabled = false; }
  };
  document.getElementById("btn-undo").onclick = async e => {
    e.target.disabled = true;
    try { await store.undo(ref); await reload(ref); }
    catch (err) { toast(err.message, true); e.target.disabled = false; }
  };
}

// ---------- Endstand ----------
function renderFinished(game, ref) {
  const rounds = game.round || 1;
  const grand = grandRanking(game);
  const topPts = grand[0].pts;
  const winners = grand.filter(p => p.pts === topPts);
  const nextCircleIdx = ((game.starterIndex ?? 0) + 1) % game.players.length;

  // Rundensieger-Chips
  const roundChips = rounds > 1 ? `
    <div class="round-chips">
      ${Array.from({ length: rounds }, (_, i) => {
        const rr = roundRanking(game, i + 1);
        const best = rr.filter(p => p.pts === rr[0].pts);
        return `<span class="round-chip">R${i + 1}: 🏆 ${best.map(b => esc(b.name)).join(" & ")} (${rr[0].pts})</span>`;
      }).join("")}
    </div>` : "";

  app.innerHTML = `
    <div class="topbar">
      <button class="btn-back" id="btn-back">←</button>
      <h1>${esc(game.name)}</h1>
      <button class="btn-icon" data-theme-toggle></button>
    </div>
    <div class="winner-box">
      <div class="trophy">🏆</div>
      <div class="w-name">${winners.map(w => esc(w.name)).join(" & ")}</div>
      <div class="w-pts">${rounds > 1 ? `Endgewinner mit ${topPts} Punkten aus ${rounds} Runden` : ((game.cols || 1) > 1 ? `Gesamtsieger mit ${topPts} Punkten` : `${topPts} Punkte`)}${winners.length > 1 ? " (geteilt)" : ""} · ${fmtDate(game.createdAt)}</div>
    </div>
    ${roundChips}
    ${columnChips(game)}

    ${standingsTable(game, { withRoundRows: rounds > 1 })}
    ${columnStandings(game)}

    ${detailSheet(game)}

    <h2>Revanche?</h2>
    <div class="stack">
      <button class="btn-primary" id="btn-rematch-winner">🏆 Sieger beginnt (${esc(winners[0].name)})</button>
      <button class="btn-secondary" id="btn-rematch-circle">Im Kreis weiter (${esc(game.players[nextCircleIdx].name)} beginnt)</button>
    </div>
  `;

  launchConfetti();
  wireDetail(game);

  document.getElementById("btn-back").onclick = () => navigate("#/");
  document.getElementById("btn-rematch-winner").onclick = () =>
    rematch(game, ref, game.players.findIndex(p => p.id === winners[0].id));
  document.getElementById("btn-rematch-circle").onclick = () =>
    rematch(game, ref, nextCircleIdx);
}

// Detailblatt am Spielende: read-only, aber Spielernamen antippbar, um die
// Einzelspalten aufzuklappen (wie in der Live-Ansicht). Merkt sich je Runde,
// welcher Spieler ausgeklappt ist. Bei mehreren Runden: ein Blatt pro Runde.
const detailExpand = {}; // key `${gameId}:${round}` → pid (ausgeklappt) | undefined

function detailSheetTable(game, round) {
  const cols = game.cols || 1;
  const key = `${game.id}:${round}`;
  const expPid = cols > 1 ? detailExpand[key] : undefined;
  const isExp = p => cols > 1 && p.id === expPid;
  const anyExp = cols > 1 && game.players.some(isExp);

  const headCells = game.players.map(p => {
    const exp = isExp(p);
    const attrs = cols > 1 ? `data-pid="${p.id}" data-round="${round}" role="button" tabindex="0"` : "";
    const chev = cols > 1 ? `<span class="ph-chev">${exp ? "▾" : "▸"}</span>` : "";
    const span = exp ? `colspan="${cols}"` : (anyExp ? `rowspan="2"` : "");
    return `<th class="p-head ${exp ? "expanded" : ""} ${cols > 1 ? "clickable" : ""}" ${span} ${attrs}>${esc(p.name)}${chev}</th>`;
  }).join("");
  const subHead = anyExp
    ? `<tr>${game.players.map(p => isExp(p)
        ? Array.from({ length: cols }, (_, c) => `<th class="sub-head">${c + 1}</th>`).join("")
        : "").join("")}</tr>`
    : "";

  const rowFor = cat => {
    const cells = game.players.map(p => {
      if (isExp(p)) {
        return Array.from({ length: cols }, (_, c) => {
          const cell = colCells(game, p.id, round, c)[cat.key];
          if (!cell) return `<td class="cell sub">&nbsp;</td>`;
          if (cell.kind === "strike") return `<td class="cell sub struck">✕</td>`;
          return `<td class="cell sub filled ${cell.serviert ? "serviert" : ""}">${cell.v}</td>`;
        }).join("");
      }
      if (cols === 1) {
        const c = colCells(game, p.id, round, 0)[cat.key];
        if (!c) return `<td class="cell">&nbsp;</td>`;
        if (c.kind === "strike") return `<td class="cell struck">✕</td>`;
        return `<td class="cell filled ${c.serviert ? "serviert" : ""}">${c.v}</td>`;
      }
      const a = catAcross(game, p.id, round, cat.key);
      if (!a.filled) return `<td class="cell compact">&nbsp;</td>`;
      const prog = `<span class="cc-progress">${a.filled}/${cols}</span>`;
      if (a.filled === a.struck) return `<td class="cell compact struck"><span class="struck-x">✕</span>${prog}</td>`;
      return `<td class="cell compact filled ${a.serviert ? "serviert" : ""}">${a.sum}${prog}</td>`;
    }).join("");
    return `
      <tr class="${cat.type === "combo" ? "combo-row" : "upper-row"} ${cat.key === "S" ? "combo-start" : ""}">
        <th class="row-label"><span class="rl-main">${cat.label}</span>${cat.sub ? `<sub class="rl-sub">${cat.sub}</sub>` : ""}</th>
        ${cells}
      </tr>`;
  };

  // Total-Zeile mit Rang-Farben: aufgeklappt je Spalte (wer führt die Spalte),
  // kompakt je Runde (wer führt die Runde). Die Rang-Klassen machen den Text
  // auch wieder solide sichtbar (sonst transparenter Folientext).
  const roundRank = rankByPid(roundRanking(game, round));
  const colRank = Array.from({ length: cols }, (_, c) =>
    rankByPid(withRanks(game.players.map(p => ({ id: p.id, pts: colTotal(game, p.id, round, c) })))));
  const totalCells = game.players.map(p => isExp(p)
    ? Array.from({ length: cols }, (_, c) =>
        `<td class="cell total sub ${rankClass(colRank[c][p.id])}">${colTotal(game, p.id, round, c)}</td>`).join("")
    : `<td class="cell total ${rankClass(roundRank[p.id])}">${roundTotal(game, p.id, round)}</td>`).join("");

  return `
    <div class="sheet-wrap">
      <table class="sheet readonly">
        <thead>
          <tr><th class="corner" ${anyExp ? `rowspan="2"` : ""}>Name</th>${headCells}</tr>
          ${subHead}
        </thead>
        <tbody>
          ${CATS.map(rowFor).join("")}
          <tr class="total-row"><th class="row-label">Total</th>${totalCells}</tr>
        </tbody>
      </table>
    </div>`;
}

function detailSheet(game) {
  const rounds = game.round || 1;
  const hint = (game.cols || 1) > 1
    ? `<p class="hint">Spielernamen antippen zeigt dessen Einzelspalten.</p>` : "";
  return Array.from({ length: rounds }, (_, i) => {
    const r = i + 1;
    const head = rounds > 1 ? `<h2>Runde ${r} — Verrechnungsblatt</h2>` : `<h2>Verrechnungsblatt</h2>`;
    return `${head}${i === 0 ? hint : ""}<div class="detail-round" data-round="${r}">${detailSheetTable(game, r)}</div>`;
  }).join("");
}

// Klick auf Spielernamen im Endstand-Blatt → Spalten auf-/zuklappen
function wireDetail(game) {
  app.querySelectorAll(".detail-round .p-head.clickable").forEach(el => {
    el.onclick = () => {
      const pid = Number(el.dataset.pid);
      const round = Number(el.dataset.round);
      const key = `${game.id}:${round}`;
      detailExpand[key] = detailExpand[key] === pid ? undefined : pid;
      const box = app.querySelector(`.detail-round[data-round="${round}"]`);
      if (box) { box.innerHTML = detailSheetTable(game, round); wireDetail(game); }
    };
  });
}

function launchConfetti() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  document.querySelectorAll(".confetti").forEach(el => el.remove());
  const colors = ["#e8c15a", "#fff3c4", "#79c793", "#f6f1e0", "#a5851f"];
  const box = document.createElement("div");
  box.className = "confetti";
  box.innerHTML = Array.from({ length: 60 }, () => {
    const left = Math.random() * 100;
    const delay = Math.random() * 1.2;
    const dur = 2.6 + Math.random() * 2;
    const color = colors[Math.floor(Math.random() * colors.length)];
    const rot = Math.floor(Math.random() * 360);
    return `<i style="left:${left}vw;background:${color};transform:rotate(${rot}deg);animation-duration:${dur}s;animation-delay:${delay}s"></i>`;
  }).join("");
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 6500);
}

async function rematch(prev, prevRef, starterIndex) {
  try {
    const res = await store.create({
      name: prev.name,
      players: prev.players.map(p => p.name),
      cols: prev.cols || 1,
      shared: !isLocalId(prevRef.id),
      status: "active",
      starter_index: starterIndex,
      turn_index: starterIndex,
    });
    if (res.code) toast(`Neuer Beitritts-Code: ${res.code}`);
    navigate(gameHash(res));
  } catch (err) { toast(err.message, true); }
}

// ---------- Regeln ----------
function showRules() {
  const overlay = document.createElement("div");
  overlay.className = "sheet-overlay";
  overlay.innerHTML = `
    <div class="sheet-modal rules">
      <div class="sm-title">Spielregeln — Würfelpoker (Escalero)</div>
      <div class="rules-body">
        <p>Gespielt wird mit <strong>5 Poker-Würfeln</strong> (9, 10, B, D, K, A). Pro Zug darfst du bis zu <strong>3×</strong> würfeln – Würfel liegen lassen und nachwerfen.</p>
        <p>Am Anfang würfelt jeder einmal: <strong>höchste Zahl beginnt.</strong> Danach reihum im Kreis.</p>
        <p>Nach deinem Zug trägst du dein Ergebnis in <strong>ein freies Feld</strong> ein:</p>
        <ul>
          <li><strong>9,10,B,D,K,A:</strong> Anzahl der Würfel × Wert<br>(9=1, 10=2, B=3, D=4, K=5, A=6)</li>
          <li><strong>S</strong> Straße = 20 (serviert 25)</li>
          <li><strong>F</strong> Full House = 30 (serviert 35)</li>
          <li><strong>P</strong> Poker (Vierling) = 40 (serviert 45)</li>
          <li><strong>G</strong> Grande (Fünfling) = 50 (serviert 80)</li>
        </ul>
        <p><strong>Serviert</strong> = die Kombination gleich im 1. Wurf (ohne Nachwerfen).</p>
        <p>Passt nichts oder willst du nichts eintragen, musst du <strong>ein freies Feld streichen</strong> (0 Punkte) – z. B. das Grande.</p>
        <p><strong>Mehrere Spalten:</strong> Spielt ihr mit 2+ Spalten pro Spieler, füllst du pro Zug ein freies Feld in einer <strong>beliebigen eigenen Spalte</strong>. In der Tabelle siehst du kompakt die Summe je Kategorie — Spielernamen antippen zeigt die Einzelspalten. Jede Spalte ist ein <strong>eigenes Blatt mit eigenem Sieger</strong> (Summe über alle Runden); zusätzlich gibt es den <strong>Gesamtsieger</strong> über alle Spalten.</p>
        <p><strong>Runden:</strong> Sind alle Felder voll, ist die Runde vorbei — ihr könnt beliebig viele weitere Runden im selben Spiel spielen. Es gibt Sieger je Runde, am Ende gewinnt die <strong>höchste Gesamtsumme</strong>. Unten in der Tabelle zeigen die Farben (Gold/Silber/Bronze) live, wer insgesamt führt.</p>
        <p><strong>Spielstände:</strong> Lokale Spiele bleiben nur auf diesem Gerät. Geteilte Spiele erreichst du auf jedem Gerät über den 6-stelligen Beitritts-Code.</p>
      </div>
      <button class="btn-secondary" data-cancel="1">Schließen</button>
    </div>`;
  mountOverlay(overlay);
  const close = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) close(); };
  overlay.querySelector("[data-cancel]").onclick = close;
}

route();
