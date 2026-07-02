const app = document.getElementById("app");

let state = {
  game: null,
  selectedWinner: null,
};

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
  const d = new Date(iso.replace(" ", "T") + "Z");
  return d.toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function starterKey(gameId) {
  return "wp_starter_" + gameId;
}

function playerName(game, id) {
  const p = game.players.find(p => p.id === id);
  return p ? p.name : "?";
}

// ---------- Routing ----------
function navigate(hash) {
  location.hash = hash;
}

async function route() {
  const hash = location.hash || "#/";
  state.selectedWinner = null;
  try {
    if (hash === "#/" || hash === "") {
      await renderHome();
    } else if (hash === "#/new") {
      renderNewGame();
    } else {
      const m = hash.match(/^#\/game\/(\d+)$/);
      if (m) {
        await renderGame(Number(m[1]));
      } else {
        navigate("#/");
      }
    }
  } catch (e) {
    app.innerHTML = `<div class="topbar"><button class="btn-back" onclick="location.hash='#/'">←</button><h1>Fehler</h1></div>
      <p class="error-msg">${esc(e.message)}</p>`;
  }
}

window.addEventListener("hashchange", route);

// ---------- Home: Spieleliste ----------
async function renderHome() {
  app.innerHTML = `<p class="loading">Lade Spiele …</p>`;
  const games = await api("/games");

  const active = games.filter(g => g.status === "active");
  const finished = games.filter(g => g.status === "finished");

  const item = g => `
    <button class="game-list-item" data-id="${g.id}">
      <span class="gl-name">${esc(g.name || "Spiel #" + g.id)}</span>
      <span class="badge ${g.status}">${g.status === "active" ? "läuft" : "beendet"}</span>
      <div class="gl-meta">${fmtDate(g.created_at)}</div>
    </button>`;

  app.innerHTML = `
    <div class="topbar"><h1>🎲 Würfelpoker</h1></div>
    <button class="btn-primary" id="btn-new">+ Neues Spiel</button>
    ${active.length ? `<h2>Laufende Spiele</h2><div class="stack">${active.map(item).join("")}</div>` : ""}
    ${finished.length ? `<h2>Beendete Spiele</h2><div class="stack">${finished.map(item).join("")}</div>` : ""}
    ${!games.length ? `<p class="loading">Noch keine Spiele.</p>` : ""}
  `;

  document.getElementById("btn-new").onclick = () => navigate("#/new");
  app.querySelectorAll(".game-list-item").forEach(el => {
    el.onclick = () => navigate("#/game/" + el.dataset.id);
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
      <button class="btn-primary" id="btn-start">Spiel starten</button>
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
    const names = [...playersDiv.querySelectorAll("input")]
      .map(i => i.value.trim())
      .filter(Boolean);
    if (names.length < 2) {
      toast("Mindestens 2 Spieler angeben", true);
      return;
    }
    e.target.disabled = true;
    try {
      const name = document.getElementById("game-name").value.trim() || null;
      const { id } = await api("/games", {
        method: "POST",
        body: JSON.stringify({ name, players: names }),
      });
      localStorage.setItem("wp_last_players", JSON.stringify(names));
      navigate("#/game/" + id);
    } catch (err) {
      toast(err.message, true);
      e.target.disabled = false;
    }
  };
}

// ---------- Spiel ----------
async function renderGame(id) {
  app.innerHTML = `<p class="loading">Lade Spiel …</p>`;
  const game = await api("/games/" + id);
  state.game = game;

  if (game.status === "finished") {
    renderFinished(game);
    return;
  }

  const localStarter = Number(localStorage.getItem(starterKey(game.id))) || null;
  if (!game.rounds.length && !localStarter) {
    renderStarterPick(game);
    return;
  }

  renderActiveGame(game, localStarter);
}

// ---------- Startspieler auswürfeln ----------
function renderStarterPick(game) {
  app.innerHTML = `
    <div class="topbar">
      <button class="btn-back" id="btn-back">←</button>
      <h1>${esc(game.name || "Spiel #" + game.id)}</h1>
    </div>
    <div class="starter-banner">Jeder würfelt einmal aus — <strong>höchste Zahl beginnt</strong>. Würfe eintragen oder Startspieler direkt antippen.</div>
    <h2>Würfe eintragen</h2>
    <div id="rolls">
      ${game.players.map(p => `
        <div class="roll-row">
          <label>${esc(p.name)}</label>
          <input type="number" inputmode="numeric" min="1" data-pid="${p.id}" placeholder="–">
        </div>`).join("")}
    </div>
    <button class="btn-primary" id="btn-eval">Höchster beginnt</button>
    <h2>Oder direkt antippen</h2>
    <div class="player-grid">
      ${game.players.map(p => `<button class="player-tile" data-pid="${p.id}">${esc(p.name)}</button>`).join("")}
    </div>
  `;

  document.getElementById("btn-back").onclick = () => navigate("#/");

  function setStarter(pid) {
    localStorage.setItem(starterKey(game.id), pid);
    renderActiveGame(game, pid);
  }

  document.getElementById("btn-eval").onclick = () => {
    const rolls = [...document.querySelectorAll("#rolls input")]
      .map(i => ({ pid: Number(i.dataset.pid), val: Number(i.value) }))
      .filter(r => r.val > 0);
    if (rolls.length < game.players.length) {
      toast("Bitte für alle Spieler einen Wurf eintragen", true);
      return;
    }
    const max = Math.max(...rolls.map(r => r.val));
    const top = rolls.filter(r => r.val === max);
    if (top.length > 1) {
      const names = top.map(r => playerName(game, r.pid)).join(", ");
      toast(`Gleichstand (${names}) — nochmal auswürfeln oder antippen`, true);
      return;
    }
    setStarter(top[0].pid);
  };

  app.querySelectorAll(".player-tile").forEach(el => {
    el.onclick = () => setStarter(Number(el.dataset.pid));
  });
}

// ---------- Laufendes Spiel ----------
function renderActiveGame(game, localStarter) {
  const starterId = game.next_starter_player_id || localStarter;
  const ranking = [...game.players]
    .map(p => ({ ...p, pts: game.totals[p.id] || 0 }))
    .sort((a, b) => b.pts - a.pts);

  app.innerHTML = `
    <div class="topbar">
      <button class="btn-back" id="btn-back">←</button>
      <h1>${esc(game.name || "Spiel #" + game.id)}</h1>
    </div>
    ${starterId ? `<div class="starter-banner">🎲 <strong>${esc(playerName(game, starterId))}</strong> beginnt</div>` : ""}

    <h2>Runde ${game.rounds.length + 1}: Wer hat gewonnen?</h2>
    <div class="player-grid" id="winner-grid">
      ${game.players.map(p => `<button class="player-tile" data-pid="${p.id}">${esc(p.name)}</button>`).join("")}
    </div>

    <h2>Mit welcher Hand?</h2>
    <div class="hand-grid" id="hand-grid">
      ${Object.entries(game.scoring).map(([hand, pts]) => `
        <button class="hand-tile" data-hand="${esc(hand)}" disabled>
          <span class="h-name">${esc(hand)}</span>
          <span class="h-pts">${pts} ${pts === 1 ? "Punkt" : "Punkte"}</span>
        </button>`).join("")}
    </div>

    <h2>Rangliste</h2>
    <table class="score-table">
      ${ranking.map((p, i) => `
        <tr>
          <td class="rank">${i + 1}.</td>
          <td>${esc(p.name)}</td>
          <td class="pts">${p.pts}</td>
        </tr>`).join("")}
    </table>

    ${game.rounds.length ? `
      <h2>Verlauf</h2>
      <ul class="history">
        ${game.rounds.map(r => `
          <li>
            <span class="rno">${r.round_no}.</span>
            <span class="rwho">${esc(playerName(game, r.winner_player_id))} — ${esc(r.hand)}</span>
            <span class="rpts">+${r.points}</span>
          </li>`).join("")}
      </ul>` : ""}

    <div class="footer-actions">
      ${game.rounds.length ? `<button class="btn-secondary" id="btn-undo">↩︎ Letzte Runde löschen</button>` : ""}
      <button class="btn-danger" id="btn-finish">Spiel beenden</button>
    </div>
  `;

  document.getElementById("btn-back").onclick = () => navigate("#/");

  const handButtons = [...app.querySelectorAll(".hand-tile")];

  app.querySelectorAll("#winner-grid .player-tile").forEach(el => {
    el.onclick = () => {
      app.querySelectorAll("#winner-grid .player-tile").forEach(t => t.classList.remove("selected"));
      el.classList.add("selected");
      state.selectedWinner = Number(el.dataset.pid);
      handButtons.forEach(b => (b.disabled = false));
    };
  });

  handButtons.forEach(el => {
    el.onclick = async () => {
      if (!state.selectedWinner) return;
      handButtons.forEach(b => (b.disabled = true));
      try {
        await api(`/games/${game.id}/rounds`, {
          method: "POST",
          body: JSON.stringify({ winner_player_id: state.selectedWinner, hand: el.dataset.hand }),
        });
        state.selectedWinner = null;
        await renderGame(game.id);
      } catch (err) {
        toast(err.message, true);
        handButtons.forEach(b => (b.disabled = false));
      }
    };
  });

  const undoBtn = document.getElementById("btn-undo");
  if (undoBtn) {
    undoBtn.onclick = async () => {
      undoBtn.disabled = true;
      try {
        await api(`/games/${game.id}/rounds`, { method: "DELETE" });
        toast("Letzte Runde gelöscht");
        await renderGame(game.id);
      } catch (err) {
        toast(err.message, true);
        undoBtn.disabled = false;
      }
    };
  }

  document.getElementById("btn-finish").onclick = async e => {
    if (!confirm("Spiel wirklich beenden?")) return;
    e.target.disabled = true;
    try {
      await api(`/games/${game.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "finished" }),
      });
      await renderGame(game.id);
    } catch (err) {
      toast(err.message, true);
      e.target.disabled = false;
    }
  };
}

// ---------- Endstand ----------
function renderFinished(game) {
  const ranking = [...game.players]
    .map(p => ({ ...p, pts: game.totals[p.id] || 0 }))
    .sort((a, b) => b.pts - a.pts);
  const winner = ranking[0];

  app.innerHTML = `
    <div class="topbar">
      <button class="btn-back" id="btn-back">←</button>
      <h1>${esc(game.name || "Spiel #" + game.id)}</h1>
    </div>
    <div class="winner-box">
      <div class="trophy">🏆</div>
      <div class="w-name">${esc(winner.name)}</div>
      <div class="w-pts">${winner.pts} Punkte · ${game.rounds.length} Runden · ${fmtDate(game.created_at)}</div>
    </div>
    <h2>Endstand</h2>
    <table class="score-table">
      ${ranking.map((p, i) => `
        <tr>
          <td class="rank">${i + 1}.</td>
          <td>${esc(p.name)}</td>
          <td class="pts">${p.pts}</td>
        </tr>`).join("")}
    </table>
    ${game.rounds.length ? `
      <h2>Verlauf</h2>
      <ul class="history">
        ${game.rounds.map(r => `
          <li>
            <span class="rno">${r.round_no}.</span>
            <span class="rwho">${esc(playerName(game, r.winner_player_id))} — ${esc(r.hand)}</span>
            <span class="rpts">+${r.points}</span>
          </li>`).join("")}
      </ul>` : ""}
  `;

  document.getElementById("btn-back").onclick = () => navigate("#/");
}

route();
