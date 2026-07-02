const app = document.getElementById("app");

// ====================================================================
// Escalero / Würfelpoker — Verrechnungsblatt
// 5 Poker-Würfel (9,10,B,D,K,A), pro Zug bis 3 Würfe. Die App würfelt
// nur am Anfang aus, wer beginnt. Danach ist sie das digitale
// Verrechnungsblatt. Spielstände liegen serverseitig in Cloudflare D1.
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

// ---------- Routing ----------
function navigate(hash) { location.hash = hash; }

async function route() {
  const hash = location.hash || "#/";
  try {
    if (hash === "#/" || hash === "") return await renderHome();
    if (hash === "#/new") return renderNewGame();
    const m = hash.match(/^#\/game\/(\d+)$/);
    if (m) {
      app.innerHTML = `<p class="loading">Lade Spiel …</p>`;
      const game = await api("/games/" + m[1]);
      return renderGame(game);
    }
    navigate("#/");
  } catch (e) {
    app.innerHTML = `<div class="topbar"><button class="btn-back" onclick="location.hash='#/'">←</button><h1>Fehler</h1></div>
      <p class="error-msg">${esc(e.message)}</p>`;
  }
}
window.addEventListener("hashchange", route);

async function reload(id) {
  const game = await api("/games/" + id);
  renderGame(game);
}

// ---------- Home ----------
async function renderHome() {
  app.innerHTML = `<p class="loading">Lade Spiele …</p>`;
  const games = await api("/games");
  const active = games.filter(g => g.status !== "finished");
  const finished = games.filter(g => g.status === "finished");

  const item = g => {
    const r = ranking(g);
    const lead = r[0];
    const sub = g.status === "finished"
      ? `🏆 ${esc(lead.name)} · ${lead.pts} P`
      : `Runde ${filledCount(g, g.players[0].id) + 1}/${CATS.length}`;
    return `
      <div class="game-row">
        <button class="game-list-item" data-id="${g.id}">
          <span class="gl-name">${esc(g.name || "Spiel")}</span>
          <span class="badge ${g.status === "finished" ? "finished" : "active"}">${g.status === "finished" ? "beendet" : "läuft"}</span>
          <div class="gl-meta">${esc(g.players.map(p => p.name).join(", "))}</div>
          <div class="gl-meta">${sub} · ${fmtDate(g.createdAt)}</div>
        </button>
        <button class="game-del" data-del="${g.id}" data-name="${esc(g.name || "Spiel")}" title="Spiel löschen" aria-label="Spiel löschen">🗑</button>
      </div>`;
  };

  app.innerHTML = `
    <div class="topbar"><h1>🎲 Würfelpoker</h1></div>
    <button class="btn-primary" id="btn-new">+ Neues Spiel</button>
    ${active.length ? `<h2>Laufende Spiele</h2><div class="stack">${active.map(item).join("")}</div>` : ""}
    ${finished.length ? `<h2>Beendete Spiele</h2><div class="stack">${finished.map(item).join("")}</div>` : ""}
    ${!games.length ? `<p class="loading">Noch keine Spiele.</p>` : ""}
    <button class="btn-link" id="btn-rules">ℹ️ Spielregeln</button>
  `;

  document.getElementById("btn-new").onclick = () => navigate("#/new");
  document.getElementById("btn-rules").onclick = showRules;
  app.querySelectorAll(".game-list-item").forEach(el => {
    el.onclick = () => navigate("#/game/" + el.dataset.id);
  });
  app.querySelectorAll(".game-del").forEach(el => {
    el.onclick = async e => {
      e.stopPropagation();
      if (!confirm(`Spiel „${el.dataset.name}" wirklich löschen?`)) return;
      el.disabled = true;
      try {
        await api("/games/" + el.dataset.del, { method: "DELETE" });
        toast("Spiel gelöscht");
        await renderHome();
      } catch (err) { toast(err.message, true); el.disabled = false; }
    };
  });
}

// ---------- Neues Spiel ----------
function renderNewGame() {
  const savedNames = JSON.parse(localStorage.getItem("wp_last_players") || '["",""]');

  app.innerHTML = `
    <div class="topbar">
      <button class="btn-back" id="btn-back">←</button>
      <h1>Neues Spiel</h1>
    </div>
    <div class="stack">
      <input type="text" id="game-name" placeholder="Spielname (optional)">
      <h2>Spieler (mind. 2)</h2>
      <div id="players"></div>
      <button class="btn-secondary" id="btn-add">+ Spieler hinzufügen</button>
      <button class="btn-primary" id="btn-start">Weiter → Startspieler auswürfeln</button>
    </div>
  `;

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
      const { id } = await api("/games", {
        method: "POST",
        body: JSON.stringify({ name, players: names }),
      });
      navigate("#/game/" + id);
    } catch (err) {
      toast(err.message, true);
      e.target.disabled = false;
    }
  };
}

// ---------- Spiel-Dispatcher ----------
function renderGame(game) {
  if (game.status === "finished") return renderFinished(game);
  if (game.starterIndex === null || game.starterIndex === undefined) return renderStarterRoll(game);
  return renderSheet(game);
}

// ---------- Startspieler auswürfeln (einziges Würfeln der App) ----------
function renderStarterRoll(game) {
  app.innerHTML = `
    <div class="topbar">
      <button class="btn-back" id="btn-back">←</button>
      <h1>${esc(game.name)}</h1>
    </div>
    <div class="starter-banner">Wer beginnt? Jeder würfelt einmal — <strong>höchste Zahl beginnt.</strong></div>
    <div class="dice-roll-list" id="roll-list">
      ${game.players.map((p, i) => `
        <div class="dice-roll-row" data-idx="${i}">
          <span class="drr-name">${esc(p.name)}</span>
          <span class="drr-die" data-idx="${i}">–</span>
        </div>`).join("")}
    </div>
    <button class="btn-primary" id="btn-roll">🎲 Würfeln</button>
    <button class="btn-link" id="btn-manual">Startspieler stattdessen antippen</button>
    <div class="player-grid hidden" id="manual-grid">
      ${game.players.map((p, i) => `<button class="player-tile" data-idx="${i}">${esc(p.name)}</button>`).join("")}
    </div>
  `;

  document.getElementById("btn-back").onclick = () => navigate("#/");

  async function setStarter(idx) {
    try {
      await api("/games/" + game.id, {
        method: "PATCH",
        body: JSON.stringify({ status: "active", starter_index: idx, turn_index: idx }),
      });
      toast(`${game.players[idx].name} beginnt`);
      await reload(game.id);
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
    const dieEls = [...app.querySelectorAll(".drr-die")];
    let ticks = 0;
    const spin = setInterval(() => {
      dieEls.forEach(el => (el.textContent = 1 + Math.floor(Math.random() * 6)));
      if (++ticks >= 12) {
        clearInterval(spin);
        const rolls = game.players.map(() => 1 + Math.floor(Math.random() * 6));
        dieEls.forEach((el, i) => (el.textContent = rolls[i]));
        const max = Math.max(...rolls);
        const winners = rolls.map((v, i) => ({ v, i })).filter(r => r.v === max);
        if (winners.length > 1) {
          toast("Gleichstand — nochmal würfeln", true);
          btn.disabled = false;
        } else {
          app.querySelector(`.dice-roll-row[data-idx="${winners[0].i}"]`).classList.add("win");
          setTimeout(() => setStarter(winners[0].i), 900);
        }
      }
    }, 70);
  };
}

// ---------- Verrechnungsblatt (Hauptansicht) ----------
function renderSheet(game) {
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

  app.querySelectorAll(".cell.editable").forEach(el => {
    el.onclick = () => openEntry(game, el.dataset.pid, el.dataset.cat);
  });

  const undo = document.getElementById("btn-undo");
  if (undo) undo.onclick = async () => {
    undo.disabled = true;
    try { await api(`/games/${game.id}/cells`, { method: "DELETE" }); await reload(game.id); }
    catch (err) { toast(err.message, true); undo.disabled = false; }
  };

  document.getElementById("btn-finish").onclick = async e => {
    if (!confirm("Spiel wirklich vorzeitig beenden?")) return;
    e.target.disabled = true;
    try {
      await api("/games/" + game.id, { method: "PATCH", body: JSON.stringify({ status: "finished" }) });
      await reload(game.id);
    } catch (err) { toast(err.message, true); e.target.disabled = false; }
  };
}

function hasAnyEntry(game) {
  return game.players.some(p => filledCount(game, p.id) > 0);
}

// ---------- Eintrag / Feld ausfüllen ----------
function openEntry(game, pid, catKey) {
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
  overlay.querySelector("[data-strike]").onclick = () => { close(); commit(game, pid, catKey, { kind: "strike", value: 0 }); };
  overlay.querySelectorAll(".sm-opt[data-i]").forEach(el => {
    el.onclick = () => { close(); commit(game, pid, catKey, options[Number(el.dataset.i)].apply); };
  });
}

async function commit(game, pid, catKey, cell) {
  const nextTurn = (game.turnIndex + 1) % game.players.length;
  try {
    await api(`/games/${game.id}/cells`, {
      method: "PUT",
      body: JSON.stringify({
        player_id: Number(pid),
        cat_key: catKey,
        kind: cell.kind,
        value: cell.value,
        serviert: !!cell.serviert,
        turn_index: nextTurn,
      }),
    });
    await reload(game.id);
  } catch (err) {
    toast(err.message, true);
    await reload(game.id);
  }
}

// ---------- Endstand ----------
function renderFinished(game) {
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

  document.getElementById("btn-back").onclick = () => navigate("#/");
  document.getElementById("btn-rematch-winner").onclick = () =>
    rematch(game, game.players.findIndex(p => p.id === winners[0].id));
  document.getElementById("btn-rematch-circle").onclick = () =>
    rematch(game, nextCircleIdx);
}

async function rematch(prev, starterIndex) {
  try {
    const { id } = await api("/games", {
      method: "POST",
      body: JSON.stringify({
        name: prev.name,
        players: prev.players.map(p => p.name),
        status: "active",
        starter_index: starterIndex,
        turn_index: starterIndex,
      }),
    });
    navigate("#/game/" + id);
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
      </div>
      <button class="btn-secondary" data-cancel="1">Schließen</button>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) close(); };
  overlay.querySelector("[data-cancel]").onclick = close;
}

route();
