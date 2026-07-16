// ====================================================================
// Gemeinsame Spiele-Schicht der Gamesite (window.GS).
//
// Bündelt, was vorher in jedem Spiel kopiert war:
//  - Spielername (ein Name für alle Spiele) + Geräte-Token
//  - Score-Einsendung an /api/scores/<spiel> (mit Statistik fürs
//    Plausibilitäts-Checking und Namensschutz-Fehlerbehandlung)
//  - Bestenlisten-Overlay (nutzt die .overlay/.panel/.lb-*-Styles,
//    die jedes Spiel mitbringt)
//  - Meilensteine (Abzeichen): pro Spiel definierbar, lokal gespeichert
// ====================================================================
(function () {
  const esc = s => String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);

  // ---------- Identität ----------
  function deviceId() {
    let d = localStorage.getItem("gs_device");
    if (!d) {
      const a = new Uint8Array(18);
      crypto.getRandomValues(a);
      d = [...a].map(b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
      localStorage.setItem("gs_device", d);
    }
    return d;
  }
  const getName = () => (localStorage.getItem("bb_name") || "").trim();
  const setName = v => localStorage.setItem("bb_name", String(v).trim().slice(0, 16));

  // ---------- Score-Einsendung ----------
  // → {rank, best} | {error, nameTaken} | null (kein Name / Netzfehler)
  async function submitScore(game, score, opts = {}) {
    const name = getName();
    if (!name || !(score > 0)) return null;
    try {
      const res = await fetch(`/api/scores/${game}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, score, device: deviceId(),
          meta: opts.meta || undefined,
          daily: !!opts.daily,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409) return { error: data.error || "Name vergeben", nameTaken: true };
      if (!res.ok) return { error: data.error || "Fehler" };
      return data;
    } catch {
      return null;
    }
  }

  // Kompletter Ranglisten-Block im Game-Over-Panel: fragt bei Bedarf
  // nach dem Namen, sendet ein, zeigt Platzierung; bei vergebenem
  // Namen darf man direkt einen neuen wählen.
  function scoreFlow(container, rankEl, { game, score, meta, daily, onName }) {
    let submitted = false;

    const showResult = resp => {
      if (!resp) { rankEl.textContent = "Score konnte nicht übertragen werden"; return; }
      if (resp.error) {
        rankEl.textContent = resp.error;
        if (resp.nameTaken) { submitted = false; askName(true); }
        return;
      }
      const extra = resp.best > score ? ` · dein Rekord: ${resp.best}` : "";
      rankEl.innerHTML = `${daily ? "Heute" : "Weltweit"} <b>Platz ${resp.rank}</b> als ${esc(getName())}${extra}`;
    };

    const send = async () => {
      if (submitted) return;
      submitted = true;
      rankEl.textContent = "Übertrage …";
      showResult(await submitScore(game, score, { meta, daily }));
    };

    function askName(retry) {
      container.innerHTML = `
        ${retry ? "" : `<p class="sub">Wie sollen wir dich in der Bestenliste nennen?</p>`}
        <input type="text" class="gs-name" maxlength="16" placeholder="Dein Name" autocomplete="off"
               value="${retry ? "" : esc(getName())}">
        <button class="btn-secondary gs-save" style="margin-bottom:10px">Score eintragen</button>`;
      container.querySelector(".gs-save").onclick = () => {
        const v = container.querySelector(".gs-name").value.trim().slice(0, 16);
        if (!v) return;
        setName(v);
        if (onName) onName();
        container.innerHTML = "";
        send();
      };
    }

    if (score <= 0) return;
    if (!getName()) askName(false);
    else send();
  }

  // ---------- Bestenlisten-Overlay ----------
  async function showLeaderboard({ game, title = "Bestenliste", sub = "Die 50 Besten weltweit", daily = false }) {
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = `
      <div class="panel">
        <h2><span class="foil">${esc(title)}</span></h2>
        <p class="sub">${esc(sub)}</p>
        <div class="gs-lb"><p class="lb-empty">Lade …</p></div>
        <button class="btn-secondary gs-close">Schließen</button>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.onclick = e => { if (e.target === overlay) close(); };
    overlay.querySelector(".gs-close").onclick = close;

    try {
      const res = await fetch(`/api/scores/${game}${daily ? "?daily=1" : ""}`);
      const data = await res.json();
      const me = getName().toLowerCase();
      const medals = ["🥇", "🥈", "🥉"];
      const box = overlay.querySelector(".gs-lb");
      if (!data.top?.length) {
        box.innerHTML = `<p class="lb-empty">Noch keine Einträge — sei die/der Erste!</p>`;
        return;
      }
      box.innerHTML = `<ol class="lb-list">${data.top.map((row, i) => `
        <li class="${row.name.toLowerCase() === me ? "me" : ""}">
          <span class="lb-rank">${medals[i] || i + 1}</span>
          <span class="lb-name">${esc(row.name)}</span>
          <span class="lb-score">${row.score}</span>
        </li>`).join("")}</ol>`;
    } catch {
      overlay.querySelector(".gs-lb").innerHTML = `<p class="lb-empty">Bestenliste nicht erreichbar</p>`;
    }
  }

  // ---------- Meilensteine (Abzeichen) ----------
  const badgeDefs = {};
  function badgeState(game) {
    try { return JSON.parse(localStorage.getItem("gs_badges_" + game) || "{}"); }
    catch { return {}; }
  }
  const badges = {
    // defs: [{ id, icon, name, desc, test(stats, totals) }]
    define(game, defs) { badgeDefs[game] = defs; },

    // Nach jedem Run aufrufen: Statistik verbuchen, neue Abzeichen zurückgeben
    record(game, stats) {
      const st = badgeState(game);
      st.earned ||= {};
      st.totals ||= { runs: 0 };
      st.totals.runs++;
      for (const [k, v] of Object.entries(stats)) {
        if (typeof v !== "number" || !isFinite(v)) continue;
        st.totals["sum_" + k] = (st.totals["sum_" + k] || 0) + v;
        st.totals["max_" + k] = Math.max(st.totals["max_" + k] || 0, v);
      }
      const newly = [];
      for (const def of badgeDefs[game] || []) {
        if (st.earned[def.id]) continue;
        let ok = false;
        try { ok = !!def.test(stats, st.totals); } catch { /* def-Fehler nie fatal */ }
        if (ok) { st.earned[def.id] = new Date().toISOString(); newly.push(def); }
      }
      localStorage.setItem("gs_badges_" + game, JSON.stringify(st));
      return newly;
    },

    earnedCount(game) { return Object.keys(badgeState(game).earned || {}).length; },

    // Kleine Chips fürs Game-Over-Panel
    chipsHtml(newly) {
      if (!newly.length) return "";
      return `<div class="gs-badges-new">${newly.map(d =>
        `<span class="gs-badge-chip">🏅 ${d.icon} ${esc(d.name)}</span>`).join("")}</div>`;
    },

    // Übersicht aller Meilensteine
    show(game, title = "Meilensteine") {
      const defs = badgeDefs[game] || [];
      const earned = badgeState(game).earned || {};
      const overlay = document.createElement("div");
      overlay.className = "overlay";
      overlay.innerHTML = `
        <div class="panel">
          <h2><span class="foil">${esc(title)}</span></h2>
          <p class="sub">${Object.keys(earned).filter(id => defs.some(d => d.id === id)).length} von ${defs.length} geschafft</p>
          <div class="gs-badge-list">
            ${defs.map(d => `
              <div class="gs-badge ${earned[d.id] ? "earned" : "locked"}">
                <span class="gb-icon">${d.icon}</span>
                <span class="gb-info">
                  <span class="gb-name">${esc(d.name)}</span>
                  <span class="gb-desc">${esc(d.desc)}</span>
                </span>
                <span class="gb-check">${earned[d.id] ? "✔" : ""}</span>
              </div>`).join("")}
          </div>
          <button class="btn-secondary gs-close">Schließen</button>
        </div>`;
      document.body.appendChild(overlay);
      const close = () => overlay.remove();
      overlay.onclick = e => { if (e.target === overlay) close(); };
      overlay.querySelector(".gs-close").onclick = close;
    },
  };

  // ---------- Gemeinsame Styles (nutzen die CSS-Variablen der App) ----------
  const style = document.createElement("style");
  style.textContent = `
    .panel input.gs-name {
      font-family: inherit; font-size: 1.15rem; text-align: center;
      width: 100%; padding: 14px; border: 1px solid var(--edge-soft, rgba(255,255,255,0.1));
      border-radius: 14px; background: var(--card, rgba(255,255,255,0.05));
      color: var(--ink, inherit); margin-bottom: 14px;
    }
    .panel input.gs-name:focus { outline: none; border-color: var(--gold, #e8c15a); }
    .gs-badges-new { display: flex; flex-wrap: wrap; gap: 6px; justify-content: center; margin: 4px 0 10px; }
    .gs-badge-chip {
      font-size: 0.8rem; font-weight: 700; padding: 5px 12px; border-radius: 999px;
      background: rgba(232, 193, 90, 0.14); color: var(--gold, #e8c15a);
      box-shadow: 0 0 0 1px rgba(232,193,90,0.3) inset;
      animation: gs-chip-in 0.4s cubic-bezier(0.34, 1.4, 0.5, 1);
    }
    @keyframes gs-chip-in { from { transform: scale(0.6); opacity: 0; } }
    .gs-badge-list { display: flex; flex-direction: column; gap: 8px; margin: 6px 0 16px; text-align: left; }
    .gs-badge {
      display: flex; align-items: center; gap: 12px; padding: 10px 12px;
      border-radius: 14px; background: var(--card, rgba(255,255,255,0.05));
      box-shadow: 0 0 0 1px var(--edge-soft, rgba(255,255,255,0.1)) inset;
    }
    .gs-badge.locked { opacity: 0.45; filter: saturate(0.4); }
    .gs-badge .gb-icon { font-size: 1.4rem; flex-shrink: 0; }
    .gs-badge .gb-name { font-weight: 700; display: block; }
    .gs-badge .gb-desc { color: var(--muted, #999); font-size: 0.8rem; display: block; margin-top: 1px; }
    .gs-badge .gb-check { margin-left: auto; color: var(--gold, #e8c15a); font-weight: 700; }
  `;
  document.head.appendChild(style);

  window.GS = { esc, deviceId, getName, setName, submitScore, scoreFlow, showLeaderboard, badges };
})();
