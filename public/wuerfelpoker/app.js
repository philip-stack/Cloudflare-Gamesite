const app = document.getElementById("app");

// ====================================================================
// Escalero / Würfelpoker — Verrechnungsblatt
// 5 Poker-Würfel (9,10,B,D,K,A), pro Zug bis 3 Würfe. Die App würfelt
// nur am Anfang aus, wer beginnt. Danach ist sie das digitale
// Verrechnungsblatt.
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

function lsLoad() {
  try { return JSON.parse(localStorage.getItem(LS_LOCAL) || "[]"); }
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
    if (!opts.shared) {
      const id = "L" + Date.now();
      const game = {
        id,
        name: opts.name || "Würfelpoker",
        code: null,
        status: opts.status || "starter",
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
        name: opts.name, players: opts.players, status: opts.status,
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
      if (body.starter_index !== undefined) g.starterIndex = body.starter_index;
      if (body.turn_index !== undefined) g.turnIndex = body.turn_index;
      lsPut(g);
      return { ok: true };
    }
    return api(`/games/${ref.id}?code=${ref.code}`, { method: "PATCH", body: JSON.stringify(body) });
  },

  async putCell(ref, b) {
    if (isLocalId(ref.id)) {
      const g = lsGet(ref.id);
      if (!g) throw new Error("Spiel nicht gefunden");
      const cells = (g.cells[b.player_id] ||= {});
      if (cells[b.cat_key]) throw new Error("Feld ist bereits ausgefüllt");
      cells[b.cat_key] = { kind: b.kind, v: b.value, serviert: !!b.serviert };
      (g.log ||= []).push({ pid: b.player_id, cat: b.cat_key });
      const finished = g.players.every(p => CATS.every(c => (g.cells[p.id] || {})[c.key]));
      g.turnIndex = b.turn_index;
      g.status = finished ? "finished" : "active";
      lsPut(g);
      return { ok: true, finished };
    }
    return api(`/games/${ref.id}/cells?code=${ref.code}`, { method: "PUT", body: JSON.stringify(b) });
  },

  async undo(ref) {
    if (isLocalId(ref.id)) {
      const g = lsGet(ref.id);
      if (!g || !(g.log || []).length) throw new Error("Nichts zum Löschen");
      const last = g.log.pop();
      if (g.cells[last.pid]) delete g.cells[last.pid][last.cat];
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
function playerTotal(game, pid) {
  const cells = game.cells[pid] || {};
  return CATS.reduce((sum, c) => sum + (cellValue(cells[c.key]) || 0), 0);
}
function filledCount(game, pid) {
  const cells = game.cells[pid] || {};
  return CATS.filter(c => cells[c.key]).length;
}
function ranking(game) {
  return [...game.players]
    .map(p => ({ ...p, pts: playerTotal(game, p.id) }))
    .sort((a, b) => b.pts - a.pts);
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
  const localGames = lsLoad();
  const refs = sharedRefs();

  const item = (g, ref, idx, extraBadge = "") => {
    const r = ranking(g);
    const lead = r[0];
    const sub = g.status === "finished"
      ? `🏆 ${esc(lead.name)} · ${lead.pts} P`
      : `Runde ${filledCount(g, g.players[0].id) + 1}/${CATS.length}`;
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

// ---------- Mit Code beitreten ----------
function renderJoin() {
  app.innerHTML = `
    <div class="topbar">
      <button class="btn-back" id="btn-back">←</button>
      <h1>Spiel beitreten</h1>
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

  app.innerHTML = `
    <div class="topbar">
      <button class="btn-back" id="btn-back">←</button>
      <h1>Neues Spiel</h1>
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
    e.target.disabled = true;
    try {
      localStorage.setItem("wp_last_players", JSON.stringify(names));
      const name = document.getElementById("game-name").value.trim() || null;
      const res = await store.create({ name, players: names, shared });
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
  if (game.starterIndex === null || game.starterIndex === undefined) {
    renderStarterRoll(game, ref);
  } else {
    renderSheet(game, ref);
  }
  startPolling(ref, game);
}

// Code-Zeile für geteilte Spiele (antippen = kopieren)
function codeChipHtml(game) {
  if (!game.code) return "";
  return `
    <button class="code-chip" data-code="${esc(game.code)}" title="Code kopieren">
      🔑 Beitritts-Code: <b>${esc(game.code)}</b> <span class="cc-hint">antippen zum Kopieren</span>
    </button>`;
}
function wireCodeChip() {
  const chip = app.querySelector(".code-chip");
  if (chip) chip.onclick = () => copyCode(chip.dataset.code);
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
  return `
    <span class="die3d" data-idx="${idx}">
      <span class="die3d-cube">
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

    cubes.forEach((cube, i) => {
      const o = DIE_ORIENT[rolls[i] - 1];
      const spinsX = (2 + Math.floor(Math.random() * 2)) * 360;
      const spinsY = (2 + Math.floor(Math.random() * 2)) * 360;
      cube.style.transitionDelay = `${i * 90}ms`;
      cube.style.transform = `rotateX(${o.x + spinsX}deg) rotateY(${o.y + spinsY}deg)`;
    });

    setTimeout(() => {
      const max = Math.max(...rolls);
      const winners = rolls.map((v, i) => ({ v, i })).filter(r => r.v === max);
      if (winners.length > 1) {
        toast(`Gleichstand (${DIE_FACES[max - 1]}) — nochmal würfeln`, true);
        btn.disabled = false;
      } else {
        app.querySelector(`.dice-roll-row[data-idx="${winners[0].i}"]`).classList.add("win");
        setTimeout(() => setStarter(winners[0].i), 1000);
      }
    }, 1600 + cubes.length * 90);
  };
}

// ---------- Verrechnungsblatt (Hauptansicht) ----------
function renderSheet(game, ref) {
  const turnPid = game.players[game.turnIndex].id;
  const roundNo = filledCount(game, turnPid) + 1;

  const headCells = game.players.map((p, i) => {
    const isTurn = i === game.turnIndex;
    return `<th class="p-head ${isTurn ? "turn" : ""}">${isTurn ? "🎲 " : ""}${esc(p.name)}</th>`;
  }).join("");

  const rowFor = cat => {
    const isCombo = cat.type === "combo";
    const cells = game.players.map(p => {
      const c = (game.cells[p.id] || {})[cat.key];
      const isTurn = p.id == turnPid;
      const editable = isTurn && !c;
      let inner = "&nbsp;";
      let cls = "cell";
      if (c) {
        if (c.kind === "strike") { inner = "✕"; cls += " struck"; }
        else { inner = c.v; cls += " filled"; if (c.serviert) cls += " serviert"; }
      } else if (editable) {
        cls += " editable";
      }
      if (isTurn) cls += " in-turn";
      return `<td class="${cls}" data-pid="${p.id}" data-cat="${cat.key}">${inner}</td>`;
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

  const totalCells = game.players.map(p =>
    `<td class="cell total">${playerTotal(game, p.id)}</td>`).join("");

  app.innerHTML = `
    <div class="topbar">
      <button class="btn-back" id="btn-back">←</button>
      <h1>${esc(game.name)}</h1>
      <button class="btn-icon" id="btn-rules" title="Regeln">ℹ️</button>
    </div>
    ${codeChipHtml(game)}
    <div class="starter-banner">
      <strong>${esc(playerName(game, turnPid))}</strong> ist dran · Runde ${roundNo}/${CATS.length}
    </div>
    <p class="hint">Echte Würfel werfen, dann ein freies Feld in deiner Spalte antippen. Nichts Passendes? Feld <strong>streichen</strong> (✕).</p>

    <div class="sheet-wrap">
      <table class="sheet">
        <thead><tr><th class="corner">Name</th>${headCells}</tr></thead>
        <tbody>
          ${CATS.map(rowFor).join("")}
          <tr class="total-row">
            <th class="row-label">Total</th>
            ${totalCells}
          </tr>
        </tbody>
      </table>
    </div>

    <div class="footer-actions">
      ${hasAnyEntry(game) ? `<button class="btn-secondary" id="btn-undo">↩︎ Letzten Eintrag löschen</button>` : ""}
      <button class="btn-danger" id="btn-finish">Spiel beenden</button>
    </div>
  `;

  document.getElementById("btn-back").onclick = () => navigate("#/");
  document.getElementById("btn-rules").onclick = showRules;
  wireCodeChip();

  app.querySelectorAll(".cell.editable").forEach(el => {
    el.onclick = () => openEntry(game, ref, el.dataset.pid, el.dataset.cat);
  });

  const undo = document.getElementById("btn-undo");
  if (undo) undo.onclick = async () => {
    undo.disabled = true;
    try { await store.undo(ref); await reload(ref); }
    catch (err) { toast(err.message, true); undo.disabled = false; }
  };

  document.getElementById("btn-finish").onclick = async e => {
    if (!confirm("Spiel wirklich vorzeitig beenden?")) return;
    e.target.disabled = true;
    try {
      await store.patch(ref, { status: "finished" });
      await reload(ref);
    } catch (err) { toast(err.message, true); e.target.disabled = false; }
  };
}

function hasAnyEntry(game) {
  return game.players.some(p => filledCount(game, p.id) > 0);
}

// ---------- Eintrag / Feld ausfüllen ----------
function openEntry(game, ref, pid, catKey) {
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
      { label: `${cat.name} serviert`, note: `${cat.serviert} P (im 1. Wurf)`,
        apply: { kind: "score", value: cat.serviert, serviert: true } },
      { label: `${cat.name}`, note: `${cat.base} P`,
        apply: { kind: "score", value: cat.base } },
    ];
  }

  const overlay = document.createElement("div");
  overlay.className = "sheet-overlay";
  overlay.innerHTML = `
    <div class="sheet-modal">
      <div class="sm-title">${esc(cat.name || cat.label)} — ${esc(playerName(game, pid))}</div>
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
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) close(); };
  overlay.querySelector("[data-cancel]").onclick = close;
  overlay.querySelector("[data-strike]").onclick = () => { close(); commit(game, ref, pid, catKey, { kind: "strike", value: 0 }); };
  overlay.querySelectorAll(".sm-opt[data-i]").forEach(el => {
    el.onclick = () => { close(); commit(game, ref, pid, catKey, options[Number(el.dataset.i)].apply); };
  });
}

async function commit(game, ref, pid, catKey, cell) {
  const nextTurn = (game.turnIndex + 1) % game.players.length;
  try {
    await store.putCell(ref, {
      player_id: Number(pid),
      cat_key: catKey,
      kind: cell.kind,
      value: cell.value,
      serviert: !!cell.serviert,
      turn_index: nextTurn,
    });
    await reload(ref);
  } catch (err) {
    toast(err.message, true);
    await reload(ref);
  }
}

// ---------- Endstand ----------
function renderFinished(game, ref) {
  const r = ranking(game);
  const topPts = r[0].pts;
  const winners = r.filter(p => p.pts === topPts);
  const nextCircleIdx = ((game.starterIndex ?? 0) + 1) % game.players.length;

  app.innerHTML = `
    <div class="topbar">
      <button class="btn-back" id="btn-back">←</button>
      <h1>${esc(game.name)}</h1>
    </div>
    <div class="winner-box">
      <div class="trophy">🏆</div>
      <div class="w-name">${winners.map(w => esc(w.name)).join(" & ")}</div>
      <div class="w-pts">${topPts} Punkte${winners.length > 1 ? " (geteilt)" : ""} · ${fmtDate(game.createdAt)}</div>
    </div>

    <div class="sheet-wrap">
      <table class="sheet readonly">
        <thead><tr><th class="corner">Name</th>${game.players.map(p =>
          `<th class="p-head">${esc(p.name)}</th>`).join("")}</tr></thead>
        <tbody>
          ${CATS.map(cat => `
            <tr class="${cat.type === "combo" ? "combo-row" : "upper-row"} ${cat.key === "S" ? "combo-start" : ""}">
              <th class="row-label"><span class="rl-main">${cat.label}</span>${cat.sub ? `<sub class="rl-sub">${cat.sub}</sub>` : ""}</th>
              ${game.players.map(p => {
                const c = (game.cells[p.id] || {})[cat.key];
                if (!c) return `<td class="cell">&nbsp;</td>`;
                if (c.kind === "strike") return `<td class="cell struck">✕</td>`;
                return `<td class="cell filled ${c.serviert ? "serviert" : ""}">${c.v}</td>`;
              }).join("")}
            </tr>`).join("")}
          <tr class="total-row"><th class="row-label">Total</th>
            ${game.players.map(p => `<td class="cell total">${playerTotal(game, p.id)}</td>`).join("")}
          </tr>
        </tbody>
      </table>
    </div>

    <h2>Neue Runde?</h2>
    <div class="stack">
      <button class="btn-primary" id="btn-rematch-winner">🏆 Sieger beginnt (${esc(winners[0].name)})</button>
      <button class="btn-secondary" id="btn-rematch-circle">Im Kreis weiter (${esc(game.players[nextCircleIdx].name)} beginnt)</button>
    </div>
  `;

  launchConfetti();

  document.getElementById("btn-back").onclick = () => navigate("#/");
  document.getElementById("btn-rematch-winner").onclick = () =>
    rematch(game, ref, game.players.findIndex(p => p.id === winners[0].id));
  document.getElementById("btn-rematch-circle").onclick = () =>
    rematch(game, ref, nextCircleIdx);
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
        <p>Nach deinem Zug trägst du dein Ergebnis in <strong>ein freies Feld deiner Spalte</strong> ein:</p>
        <ul>
          <li><strong>9,10,B,D,K,A:</strong> Anzahl der Würfel × Wert<br>(9=1, 10=2, B=3, D=4, K=5, A=6)</li>
          <li><strong>S</strong> Straße = 20 (serviert 25)</li>
          <li><strong>F</strong> Full House = 30 (serviert 35)</li>
          <li><strong>P</strong> Poker (Vierling) = 40 (serviert 45)</li>
          <li><strong>G</strong> Grande (Fünfling) = 50 (serviert 80)</li>
        </ul>
        <p><strong>Serviert</strong> = die Kombination gleich im 1. Wurf (ohne Nachwerfen).</p>
        <p>Passt nichts oder willst du nichts eintragen, musst du <strong>ein freies Feld streichen</strong> (0 Punkte) – z. B. das Grande.</p>
        <p>Das Spiel endet, wenn <strong>alle Felder ausgefüllt</strong> sind. Die höchste Gesamtsumme gewinnt.</p>
        <p><strong>Spielstände:</strong> Lokale Spiele bleiben nur auf diesem Gerät. Geteilte Spiele erreichst du auf jedem Gerät über den 6-stelligen Beitritts-Code.</p>
      </div>
      <button class="btn-secondary" data-cancel="1">Schließen</button>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) close(); };
  overlay.querySelector("[data-cancel]").onclick = close;
}

route();
