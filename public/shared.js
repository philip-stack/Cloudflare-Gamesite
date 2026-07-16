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
  async function runToken(game) {
    try {
      const r = await fetch(`/api/scores/${game}?token=1&device=${encodeURIComponent(deviceId())}`);
      const d = await r.json().catch(() => ({}));
      return d.token || null;
    } catch { return null; }
  }

  async function submitScore(game, score, opts = {}) {
    const name = getName();
    if (!name || !(score > 0)) return null;
    try {
      const token = await runToken(game);
      const res = await fetch(`/api/scores/${game}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, score, device: deviceId(), token,
          meta: opts.meta || undefined,
          daily: !!opts.daily,
          weekly: !!opts.weekly,
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
  function scoreFlow(container, rankEl, { game, score, meta, daily, weekly, onName }) {
    let submitted = false;

    const showResult = resp => {
      if (!resp) { rankEl.textContent = "Score konnte nicht übertragen werden"; return; }
      if (resp.error) {
        rankEl.textContent = resp.error;
        if (resp.nameTaken) { submitted = false; askName(true); }
        return;
      }
      const extra = resp.best > score ? ` · dein Rekord: ${resp.best}` : "";
      const scope = weekly ? "Diese Woche" : daily ? "Heute" : "Weltweit";
      rankEl.innerHTML = `${scope} <b>Platz ${resp.rank}</b> als ${esc(getName())}${extra}`;
    };

    const send = async () => {
      if (submitted) return;
      submitted = true;
      rankEl.textContent = "Übertrage …";
      showResult(await submitScore(game, score, { meta, daily, weekly }));
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
  async function showLeaderboard({ game, title = "Bestenliste", sub = "Die 50 Besten weltweit", daily = false, weekly = false }) {
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
      const res = await fetch(`/api/scores/${game}${weekly ? "?weekly=1" : daily ? "?daily=1" : ""}`);
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

  // ---------- Skins (über Meilensteine freispielbar) ----------
  const skinDefs = {};
  const skins = {
    // defs: [{ id, name, req, swatch:[farben], colors:{...} }]
    //   req: 0/undefined = von Anfang an frei; Zahl N = ab N Abzeichen;
    //        { badge:"id" } = ab einem bestimmten Abzeichen.
    define(game, defs) { skinDefs[game] = defs; },
    unlocked(game, def) {
      if (!def.req) return true;
      if (typeof def.req === "number") return badges.earnedCount(game) >= def.req;
      if (def.req.badge) return !!(badgeState(game).earned || {})[def.req.badge];
      return true;
    },
    list(game) {
      return (skinDefs[game] || []).map(d => ({ ...d, unlocked: this.unlocked(game, d) }));
    },
    currentId(game) {
      const defs = skinDefs[game] || [];
      const saved = localStorage.getItem("gs_skin_" + game);
      const found = defs.find(d => d.id === saved && this.unlocked(game, d));
      return found ? found.id : (defs[0] && defs[0].id) || null;
    },
    get(game) {
      const defs = skinDefs[game] || [];
      const id = this.currentId(game);
      return ((defs.find(d => d.id === id) || defs[0] || {}).colors) || {};
    },
    set(game, id) {
      const def = (skinDefs[game] || []).find(d => d.id === id);
      if (def && this.unlocked(game, def)) { localStorage.setItem("gs_skin_" + game, id); return true; }
      return false;
    },
    reqLabel(def) {
      if (!def.req) return "";
      if (typeof def.req === "number") return `🔒 ${def.req} Abzeichen`;
      return "🔒 gesperrt";
    },
    picker(game, { title = "Skins", onChange } = {}) {
      const overlay = document.createElement("div");
      overlay.className = "overlay";
      const render = () => {
        const cur = this.currentId(game);
        overlay.innerHTML = `
          <div class="panel">
            <h2><span class="foil">${esc(title)}</span></h2>
            <p class="sub">Durch Meilensteine freischalten</p>
            <div class="gs-skin-grid">${this.list(game).map(d => `
              <button class="gs-skin ${d.id === cur ? "sel" : ""} ${d.unlocked ? "" : "locked"}"
                      data-id="${esc(d.id)}" ${d.unlocked ? "" : "disabled"}>
                <span class="gs-skin-sw">${(d.swatch || []).map(c => `<i style="background:${c}"></i>`).join("")}</span>
                <span class="gs-skin-name">${esc(d.name)}</span>
                <span class="gs-skin-lock">${d.unlocked ? (d.id === cur ? "✔ Aktiv" : "Auswählen") : this.reqLabel(d)}</span>
              </button>`).join("")}</div>
            <button class="btn-secondary gs-close">Schließen</button>`;
        overlay.querySelectorAll(".gs-skin:not(.locked)").forEach(b => {
          b.onclick = () => { if (this.set(game, b.dataset.id)) { onChange && onChange(this.get(game)); render(); } };
        });
        overlay.querySelector(".gs-close").onclick = () => overlay.remove();
      };
      render();
      overlay.onclick = e => { if (e.target === overlay) overlay.remove(); };
      document.body.appendChild(overlay);
    },
  };

  // ---------- Sound & Haptik (gemeinsam, abschaltbar) ----------
  let actx = null;
  const soundOn = () => localStorage.getItem("gs_sound_off") !== "1";
  const sound = {
    on: soundOn,
    toggle() { const off = !soundOn(); localStorage.setItem("gs_sound_off", off ? "1" : "0"); return !off; },
    ctx() {
      try {
        if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
        if (actx.state === "suspended") actx.resume().catch(() => {});
        return actx;
      } catch { return null; }
    },
    tone(freq, dur = 0.12, { type = "sine", gain = 0.13, slideTo = null, delay = 0 } = {}) {
      if (!soundOn()) return;
      const c = this.ctx(); if (!c) return;
      const t0 = c.currentTime + delay;
      const o = c.createOscillator(), g = c.createGain();
      o.type = type; o.frequency.setValueAtTime(freq, t0);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(c.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    },
    click() { this.tone(300, 0.05, { type: "triangle", gain: 0.07 }); },
    good() { this.tone(620, 0.09, { type: "triangle" }); this.tone(930, 0.11, { type: "triangle", delay: 0.05 }); },
    great() { [660, 880, 1180].forEach((f, i) => this.tone(f, 0.12, { type: "triangle", delay: i * 0.05 })); },
    win() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.18, { type: "triangle", delay: i * 0.09, gain: 0.14 })); },
    lose() { this.tone(300, 0.4, { type: "sawtooth", gain: 0.1, slideTo: 90 }); },
    roll() { this.tone(180 + Math.floor((soundOn() ? Math.random() : 0) * 60), 0.06, { type: "square", gain: 0.05 }); },
  };
  const haptic = (ms = 12) => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };

  // ---------- Onboarding (einmaliger Hinweis beim ersten Start) ----------
  function onboard(game, { title = "So geht's", steps = [], force = false } = {}) {
    const key = "gs_onboard_" + game;
    if (!force && localStorage.getItem(key)) return;
    const overlay = document.createElement("div");
    overlay.className = "overlay";
    overlay.innerHTML = `
      <div class="panel">
        <h2><span class="foil">${esc(title)}</span></h2>
        <ul class="gs-steps">${steps.map(s => `
          <li><span class="gs-step-ic">${s.icon || "•"}</span><span>${esc(s.text)}</span></li>`).join("")}</ul>
        <button class="btn-secondary gs-close">Los geht's!</button>`;
    overlay.querySelector(".gs-close").onclick = () => { localStorage.setItem(key, "1"); overlay.remove(); };
    document.body.appendChild(overlay);
  }

  // ---------- Teilen (Web-Share mit Zwischenablage-Fallback) ----------
  async function share({ title = "Spieleabend", text = "", url = location.origin } = {}) {
    try {
      if (navigator.share) { await navigator.share({ title, text, url }); return "shared"; }
    } catch { return "cancelled"; }
    try { await navigator.clipboard.writeText(`${text} ${url}`.trim()); return "copied"; } catch { return "failed"; }
  }

  // ---------- Zuletzt gespieltes Spiel (für die Landing Page) ----------
  function markPlayed(game) {
    try { localStorage.setItem("gs_last_game", game); } catch {}
  }

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
    .gs-skin-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 6px 0 16px; }
    .gs-skin {
      display: flex; flex-direction: column; align-items: center; gap: 7px;
      padding: 12px 8px; border-radius: 14px; cursor: pointer;
      background: var(--card, rgba(255,255,255,0.05)); color: var(--ink, inherit);
      border: 0; box-shadow: 0 0 0 1px var(--edge-soft, rgba(255,255,255,0.1)) inset;
      font-family: inherit; transition: transform 0.1s;
    }
    .gs-skin:active { transform: scale(0.96); }
    .gs-skin.sel { box-shadow: 0 0 0 2px var(--gold, #e8c15a) inset; }
    .gs-skin.locked { opacity: 0.5; filter: saturate(0.3); cursor: not-allowed; }
    .gs-skin-sw { display: flex; gap: 4px; }
    .gs-skin-sw i { width: 16px; height: 16px; border-radius: 50%; box-shadow: 0 0 0 1px rgba(0,0,0,0.25) inset; }
    .gs-skin-name { font-weight: 700; font-size: 0.95rem; }
    .gs-skin-lock { font-size: 0.72rem; color: var(--muted, #999); }
    .gs-skin.sel .gs-skin-lock { color: var(--gold, #e8c15a); }
    .gs-steps { list-style: none; text-align: left; margin: 8px 0 18px; display: flex; flex-direction: column; gap: 12px; }
    .gs-steps li { display: flex; align-items: flex-start; gap: 12px; line-height: 1.35; }
    .gs-steps .gs-step-ic { font-size: 1.5rem; flex-shrink: 0; width: 30px; text-align: center; }
  `;
  document.head.appendChild(style);

  window.GS = {
    esc, deviceId, getName, setName, submitScore, scoreFlow, showLeaderboard,
    badges, skins, sound, haptic, onboard, share, markPlayed,
  };
})();
