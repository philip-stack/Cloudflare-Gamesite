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
      // Persönlicher Rekord? Für ein kleines Konfetti-Willkommen im Hub merken.
      const isRecord = !!(data && Number(data.best) > 0 && score >= Number(data.best));
      try { if (isRecord) localStorage.setItem("gs_celebrate", String(Date.now())); } catch {}
      // Fortschritt: XP + Tagesquests (zentral → gilt für alle Spiele)
      try {
        GSP.award(10, "score"); GSP.bump("score", { game });
        if (isRecord) { GSP.award(25, "record"); GSP.bump("record", { game }); }
      } catch {}
      // Läuft ein Spieleabend-Raum? Ergebnis zusätzlich dorthin melden.
      try {
        const pc = (localStorage.getItem("gs_party_code") || "").trim().toUpperCase();
        if (pc && /^[A-Z0-9]{6}$/.test(pc) && Number.isInteger(score)) {
          fetch("/api/party", {
            method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
            body: JSON.stringify({ action: "submit", code: pc, name, game, score, device: deviceId() }),
          }).catch(() => {});
        }
      } catch {}
      return data;
    } catch {
      return null;
    }
  }

  // Kompletter Ranglisten-Block im Game-Over-Panel: fragt bei Bedarf
  // nach dem Namen, sendet ein, zeigt Platzierung; bei vergebenem
  // Namen darf man direkt einen neuen wählen.
  function scoreFlow(container, rankEl, { game, score, meta, daily, weekly, onName, title, accent, icon }) {
    let submitted = false, shareAdded = false;

    // Teilen / Herausfordern — zentral, damit JEDES gewertete Spiel es bekommt.
    function addShare() {
      if (shareAdded || !container) return; shareAdded = true;
      const b = document.createElement("button");
      b.className = "btn-secondary gs-share-btn"; b.type = "button";
      b.style.marginTop = "10px";
      b.textContent = "📤 Teilen / Herausfordern";
      b.onclick = () => {
        const g = (window.GAMES_BYKEY || {})[game] || {};
        const gName = title || g.name || "Spieleabend";
        const nm = getName();
        shareCard({
          title: gName, big: score,
          subtitle: nm ? `${nm} · schlag mich!` : "schlag meinen Score!",
          accent: accent || g.accent || "#e8c15a",
          emoji: icon || g.icon || "🎲",
          url: duelLink(game, score),
          text: `${nm ? nm + " hat " : "Ich hab "}${score} Punkte in ${gName} — schlag mich!`,
        });
      };
      container.appendChild(b);
    }

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
      addShare();
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
      // Fortschritt: XP + Abzeichen-Quest je frisch verdientem Meilenstein
      try { for (const d of newly) { GSP.award(30, "badge:" + d.id); GSP.bump("badge", { game }); } } catch {}
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
  const skinBadgeKey = {};
  const skins = {
    // defs: [{ id, name, req, swatch:[farben], colors:{...} }]
    //   req: 0/undefined = von Anfang an frei; Zahl N = ab N Abzeichen;
    //        { badge:"id" } = ab einem bestimmten Abzeichen.
    // badgeGame: optionaler Abzeichen-Schlüssel für die Freischaltung
    //   (z. B. koppeln Einhorn-Skins an die "galopp"-Abzeichen).
    define(game, defs, badgeGame) { skinDefs[game] = defs; skinBadgeKey[game] = badgeGame || game; },
    unlocked(game, def) {
      if (!def.req) return true;
      const bk = skinBadgeKey[game] || game;
      if (typeof def.req === "number") return badges.earnedCount(bk) >= def.req;
      if (def.req.badge) return !!(badgeState(bk).earned || {})[def.req.badge];
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
    coin() { this.tone(880, 0.06, { type: "square", gain: 0.06 }); this.tone(1320, 0.09, { type: "square", gain: 0.05, delay: 0.05 }); },
    power() { [440, 660, 880].forEach((f, i) => this.tone(f, 0.1, { type: "sawtooth", gain: 0.07, delay: i * 0.04 })); },
    levelup() { [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.2, { type: "triangle", delay: i * 0.08, gain: 0.13 })); },
    roll() { this.tone(180 + Math.floor((soundOn() ? Math.random() : 0) * 60), 0.06, { type: "square", gain: 0.05 }); },
  };
  const haptic = (ms = 12) => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };

  // ---------- Effekte ("Juice"): Screenshake, Partikel, aufsteigender Text ----------
  // Nutzt die Web-Animations-API (kein CSS nötig) und respektiert reduce-motion.
  const reduceMotion = () => { try { return matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };
  const FX_COLS = ["#e8c15a", "#ff6f91", "#57e39b", "#5b9cff", "#b678ff", "#ffd23f"];
  const fx = {
    shake(el, px = 6, ms = 380) {
      if (!el || reduceMotion()) return;
      const k = [];
      for (let i = 0; i < 6; i++) k.push({ transform: `translate(${(Math.random() * 2 - 1) * px}px, ${(Math.random() * 2 - 1) * px}px)` });
      k.push({ transform: "translate(0,0)" });
      try { el.animate(k, { duration: ms, easing: "ease-out" }); } catch {}
    },
    burst(x, y, { colors = FX_COLS, count = 14 } = {}) {
      if (reduceMotion()) return;
      const layer = document.createElement("div");
      layer.style.cssText = "position:fixed;inset:0;z-index:70;pointer-events:none;overflow:hidden";
      document.body.appendChild(layer);
      for (let i = 0; i < count; i++) {
        const p = document.createElement("i");
        const size = 6 + Math.random() * 6;
        p.style.cssText = `position:fixed;left:${x}px;top:${y}px;width:${size}px;height:${size}px;border-radius:2px;background:${colors[i % colors.length]}`;
        layer.appendChild(p);
        const ang = Math.random() * Math.PI * 2, dist = 30 + Math.random() * 70;
        try {
          p.animate(
            [{ transform: "translate(-50%,-50%) scale(1)", opacity: 1 },
             { transform: `translate(${Math.cos(ang) * dist}px,${Math.sin(ang) * dist + 34}px) scale(0.3)`, opacity: 0 }],
            { duration: 600 + Math.random() * 350, easing: "cubic-bezier(.2,.7,.3,1)" });
        } catch {}
      }
      setTimeout(() => layer.remove(), 1050);
    },
    float(text, x, y, { color = "var(--gold, #e8c15a)", size = 1.4 } = {}) {
      const el = document.createElement("div");
      el.textContent = text;
      el.style.cssText = `position:fixed;left:${x}px;top:${y}px;z-index:70;pointer-events:none;font-weight:800;font-family:var(--font-display,Georgia,serif);font-size:${size}rem;color:${color};text-shadow:0 2px 10px rgba(0,0,0,0.45)`;
      document.body.appendChild(el);
      try {
        el.animate(
          [{ transform: "translate(-50%,-50%) scale(0.8)", opacity: 0 },
           { transform: "translate(-50%,-95%) scale(1)", opacity: 1, offset: 0.25 },
           { transform: "translate(-50%,-165%) scale(1)", opacity: 0 }],
          { duration: 1100, easing: "ease-out" });
      } catch {}
      setTimeout(() => el.remove(), 1150);
    },
    // Bequem: Effekt an der Mitte eines Elements auslösen
    burstAt(el, opts) { try { const r = el.getBoundingClientRect(); this.burst(r.left + r.width / 2, r.top + r.height / 2, opts); } catch {} },
  };

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
    // Nachricht UND Link zusammen ins Text-Feld — sonst zeigen viele
    // Ziel-Apps (WhatsApp, Signal …) nur die URL ohne die Score-Nachricht.
    const full = url ? `${text}\n${url}`.trim() : text;
    try {
      if (navigator.share) { await navigator.share({ title, text: full }); return "shared"; }
    } catch { return "cancelled"; }
    try { await navigator.clipboard.writeText(full); return "copied"; } catch { return "failed"; }
  }

  // ---------- Ergebnis-Bild (Canvas) + Duell-Link ----------
  function roundRect(x, X, Y, W, H, r) {
    if (x.roundRect) { x.beginPath(); x.roundRect(X, Y, W, H, r); return; }
    x.beginPath(); x.moveTo(X + r, Y);
    x.arcTo(X + W, Y, X + W, Y + H, r); x.arcTo(X + W, Y + H, X, Y + H, r);
    x.arcTo(X, Y + H, X, Y, r); x.arcTo(X, Y, X + W, Y, r); x.closePath();
  }
  // Teilbares Ergebnisbild im Midnight-Felt-Look; mobil als Datei geteilt,
  // sonst heruntergeladen + Text in die Zwischenablage.
  async function shareCard(opt = {}) {
    const { title = "Spieleabend", subtitle = "", big = "", accent = "#e8c15a", emoji = "🎲", url = location.origin, text = "" } = opt;
    let blob = null;
    try {
      const S = 1080, c = document.createElement("canvas"); c.width = S; c.height = S;
      const x = c.getContext("2d");
      try { await document.fonts.ready; } catch {}
      const g = x.createRadialGradient(S / 2, S * 0.1, 80, S / 2, S / 2, S * 0.95);
      g.addColorStop(0, "#1a2a1d"); g.addColorStop(0.5, "#0e1410"); g.addColorStop(1, "#0a0e0b");
      x.fillStyle = g; x.fillRect(0, 0, S, S);
      x.lineWidth = 6; x.strokeStyle = accent; x.globalAlpha = 0.55; roundRect(x, 42, 42, S - 84, S - 84, 46); x.stroke(); x.globalAlpha = 1;
      x.textAlign = "center";
      x.fillStyle = "#93a396"; x.font = "700 30px 'Outfit', system-ui, sans-serif";
      x.fillText("S P I E L E A B E N D", S / 2, 156);
      x.font = "140px 'Apple Color Emoji','Segoe UI Emoji', serif"; x.fillText(emoji, S / 2, 362);
      x.fillStyle = "#f4efe2"; x.font = "800 italic 62px 'Fraunces', Georgia, serif"; x.fillText(title, S / 2, 470);
      if (big !== "") { x.fillStyle = accent; x.font = "800 200px 'Fraunces', Georgia, serif"; x.fillText(String(big), S / 2, 702); }
      if (subtitle) { x.fillStyle = "#cbd8cd"; x.font = "500 40px 'Outfit', system-ui, sans-serif"; x.fillText(subtitle, S / 2, big !== "" ? 792 : 626); }
      x.fillStyle = "#7d8c80"; x.font = "600 32px 'Outfit', system-ui, sans-serif";
      x.fillText(String(url || "").replace(/^https?:\/\//, ""), S / 2, S - 82);
      blob = await new Promise(res => c.toBlob(res, "image/png"));
    } catch { blob = null; }

    const full = url ? `${text}\n${url}`.trim() : text;
    try {
      if (blob && navigator.canShare) {
        const file = new File([blob], "spieleabend.png", { type: "image/png" });
        if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text: full, title }); return "shared"; }
      }
    } catch { return "cancelled"; }
    try {
      if (blob) {
        const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "spieleabend.png";
        document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      }
    } catch {}
    try { await navigator.clipboard.writeText(full); return blob ? "downloaded" : "copied"; } catch { return blob ? "downloaded" : "failed"; }
  }

  // Duell-Link: führt auf den Hub, der eine „X fordert dich heraus"-Karte zeigt.
  function duelLink(game, score, opts = {}) {
    const name = String(opts.name || getName() || "").slice(0, 16);
    const base = opts.url || (location.origin + "/");
    const p = new URLSearchParams({ duel: String(game), by: name, sc: String(score | 0) });
    return base + "?" + p.toString();
  }

  // ---------- Zuletzt gespieltes Spiel (für die Landing Page) ----------
  function markPlayed(game) {
    try { localStorage.setItem("gs_last_game", game); } catch {}
    // Tages-Streak pflegen: einmal pro Kalendertag hochzählen (egal welches
    // Spiel). Gestern gespielt → +1, sonst zurück auf 1. Bester Streak wird
    // separat gemerkt. Rein lokal, wandert über den Cloud-Sync mit.
    try {
      const ymd = d => { const z = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()); };
      const today = ymd(new Date());
      const last = localStorage.getItem("gs_streak_last") || "";
      if (last !== today) {
        const y = new Date(); y.setDate(y.getDate() - 1);
        let cur = Number(localStorage.getItem("gs_streak") || 0);
        cur = (last === ymd(y)) ? cur + 1 : 1;
        localStorage.setItem("gs_streak", String(cur));
        localStorage.setItem("gs_streak_last", today);
        if (cur > Number(localStorage.getItem("gs_streak_best") || 0)) localStorage.setItem("gs_streak_best", String(cur));
      }
    } catch {}
    // Fortschritt: Play-Quests + Spiel-XP (max. 1×/Spiel/Tag, kein Farmen)
    try {
      const setKey = "gs_playxp_" + ymdOf(new Date());
      let seen = {}; try { seen = JSON.parse(localStorage.getItem(setKey) || "{}"); } catch {}
      if (!seen[game]) { seen[game] = 1; localStorage.setItem(setKey, JSON.stringify(seen)); GSP.award(12, "play"); }
      GSP.bump("play", { game });
    } catch {}
  }

  // Aktuellen Tages-Streak lesen — aber „abgelaufen" (weder heute noch gestern
  // gespielt) als 0 melden, ohne den Bestwert zu verändern.
  function streak() {
    try {
      const ymd = d => { const z = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()); };
      const last = localStorage.getItem("gs_streak_last") || "";
      const t = new Date(), y = new Date(); y.setDate(y.getDate() - 1);
      const cur = Number(localStorage.getItem("gs_streak") || 0);
      if (last === ymd(t) || last === ymd(y)) return cur;
      return 0;
    } catch { return 0; }
  }

  // ---------- Fortschritt: Spieleabend-Level (XP) & Tagesquests ----------
  // Zieht Spiele zusammen: ein einziges Level über ALLE Spiele, das über die
  // zentralen Durchlaufpunkte (Score einsenden, gespielt markieren, Abzeichen
  // verdienen) wächst — deshalb muss KEIN einzelnes Spiel angefasst werden.
  const ymdOf = d => { const z = n => String(n).padStart(2, "0"); return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()); };

  // EINE gemeinsame Level-Formel für Hub UND Profil (früher rechnete das Profil
  // sie separat → hier zentralisiert, damit beide dieselbe Zahl zeigen):
  //   Gesamt-XP = Abzeichen·100 + Rekorde·80 + gespielte Spiele·40 + Bonus (gs_xp)
  // Der Bonus kommt aus Quests/Score/Play/Abzeichen und macht Fortschritt fühlbar,
  // ohne die bestehenden Freischalt-Schwellen zu entwerten (nur großzügiger).
  const LEVEL_PER = 400;
  const bonusXp = () => Math.max(0, Number(localStorage.getItem("gs_xp") || 0));
  const LEVEL_TITLES = [[1, "Frischling"], [3, "Stammgast"], [5, "Kartenhai"], [8, "Würfelfuchs"], [12, "Spielmeister:in"], [16, "Abendlegende"], [22, "Großmeister:in"], [30, "Unantastbar"]];
  function titleForLevel(L) { let n = LEVEL_TITLES[0][1]; for (const [lv, nm] of LEVEL_TITLES) if (L >= lv) n = nm; return n; }
  function levelInfo(base) {
    const total = Math.max(0, base | 0) + bonusXp();
    const level = Math.floor(total / LEVEL_PER) + 1;
    const into = total - (level - 1) * LEVEL_PER;
    return { total, base: base | 0, bonus: bonusXp(), level, into, need: LEVEL_PER, per: LEVEL_PER, pct: Math.round((into / LEVEL_PER) * 100), title: titleForLevel(level) };
  }
  // Zählt Abzeichen/Rekorde/gespielt EXAKT wie das Profil (eine Wahrheit).
  function countsFromGames(GAMES) {
    const num = v => { const n = parseFloat(v); return isFinite(n) ? n : 0; };
    const badgesOf = key => { try { return Object.keys(JSON.parse(localStorage.getItem("gs_badges_" + key) || "{}").earned || {}).length; } catch { return 0; } };
    const played = g => (g.bestKey && num(localStorage.getItem(g.bestKey)) > 0) || (g.gsBadges && badgesOf(g.key) > 0) || !!localStorage.getItem("gs_onboard_" + g.key) || (g.key === "meeri" && !!localStorage.getItem("meeri_save_v1")) || (g.key === "wuerfelpoker" && !!localStorage.getItem("wp_local_games"));
    const list = Array.isArray(GAMES) ? GAMES : (window.GAMES || []);
    const badgeSum = list.filter(g => g.gsBadges).reduce((a, g) => a + badgesOf(g.key), 0);
    const recordCount = list.filter(g => g.bestKey && num(localStorage.getItem(g.bestKey)) > 0).length;
    const playedCount = list.filter(played).length;
    return { badgeSum, recordCount, playedCount, base: badgeSum * 100 + recordCount * 80 + playedCount * 40 };
  }

  // Tagesquests: 3 pro Tag, deterministisch aus dem Datum gewählt (alle Geräte
  // gleich). Fortschritt & erledigt werden pro Kalendertag lokal gehalten.
  const QUEST_POOL = [
    { id: "play2", type: "play", goal: 2, xp: 40, icon: "🎮", label: "Spiele 2 verschiedene Spiele" },
    { id: "play3", type: "play", goal: 3, xp: 70, icon: "🕹️", label: "Spiele 3 verschiedene Spiele" },
    { id: "score1", type: "score", goal: 1, xp: 30, icon: "📊", label: "Trag einen Score in eine Bestenliste ein" },
    { id: "record1", type: "record", goal: 1, xp: 60, icon: "🏅", label: "Stell einen persönlichen Rekord auf" },
    { id: "badge1", type: "badge", goal: 1, xp: 50, icon: "🎖️", label: "Verdien dir ein Abzeichen" },
    { id: "streak1", type: "play", goal: 1, xp: 20, icon: "🔥", label: "Halte deinen Tages-Streak am Leben" },
  ];

  const GSP = {
    // Bonus-XP gutschreiben. Level-Aufstieg wird gegen den zuletzt gesehenen
    // Basiswert (gs_level_base, von compute() aktuell gehalten) geprüft.
    award(n, reason) {
      n = Math.round(n); if (!(n > 0)) return null;
      const base = Number(localStorage.getItem("gs_level_base") || 0);
      const before = Math.floor((base + bonusXp()) / LEVEL_PER) + 1;
      const xp = bonusXp() + n;
      try { localStorage.setItem("gs_xp", String(xp)); } catch {}
      const after = Math.floor((base + xp) / LEVEL_PER) + 1;
      try { localStorage.setItem("gs_title_name", titleForLevel(after)); } catch {}
      if (after > before) { try { localStorage.setItem("gs_levelup", JSON.stringify({ level: after, title: titleForLevel(after), at: Date.now() })); } catch {} }
      return { leveledUp: after > before, level: after, gained: n };
    },
    questKey() { return "gs_quests_" + ymdOf(new Date()); },
    _pick() {
      let h = 0; const s = ymdOf(new Date());
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
      const ids = QUEST_POOL.map(q => q.id);
      for (let i = ids.length - 1; i > 0; i--) { h = (h * 1103515245 + 12345) & 0x7fffffff; const j = h % (i + 1); [ids[i], ids[j]] = [ids[j], ids[i]]; }
      const picks = [];
      for (const id of ids) {
        if (picks.length >= 3) break;
        if (id === "play2" && picks.includes("play3")) continue;   // keine redundanten Zwillinge
        if (id === "play3" && picks.includes("play2")) continue;
        picks.push(id);
      }
      return picks.slice(0, 3);
    },
    _state() {
      const key = this.questKey();
      let st = null; try { st = JSON.parse(localStorage.getItem(key) || "null"); } catch {}
      if (!st || !Array.isArray(st.picks)) st = { picks: this._pick(), prog: {}, done: {}, games: {} };
      st.prog ||= {}; st.done ||= {}; st.games ||= {};
      return st;
    },
    _save(st) { try { localStorage.setItem(this.questKey(), JSON.stringify(st)); } catch {} },
    today() {
      const st = this._state(); this._save(st);   // beim ersten Blick des Tages fixieren
      return st.picks.map(id => {
        const q = QUEST_POOL.find(x => x.id === id) || { id, goal: 1, xp: 0, label: id, icon: "•" };
        return { ...q, cur: Math.min(q.goal, st.prog[id] || 0), done: !!st.done[id] };
      });
    },
    // Ein Ereignis verbuchen; erfüllte Quests schalten XP frei + setzen Feier-Flag.
    bump(type, ctx = {}) {
      const st = this._state();
      if (type === "play" && ctx.game) st.games[ctx.game] = 1;
      const distinct = Object.keys(st.games).length;
      let done = null;
      for (const id of st.picks) {
        if (st.done[id]) continue;
        const q = QUEST_POOL.find(x => x.id === id);
        if (!q || q.type !== type) continue;
        const cur = type === "play" ? distinct : (st.prog[id] || 0) + 1;
        st.prog[id] = cur;
        if (cur >= q.goal) {
          st.done[id] = Date.now();
          this.award(q.xp, "quest:" + id);
          try { localStorage.setItem("gs_quest_done", JSON.stringify({ label: q.label, xp: q.xp, icon: q.icon, at: Date.now() })); } catch {}
          done = q;
        }
      }
      this._save(st);
      return done;
    },
  };

  // ---------- Cloud-Auto-Sync ----------
  // Sichert den localStorage-Schnappschuss automatisch, sobald ein
  // Sync-Code gesetzt ist (im Profil angelegt). Beim Verlassen der Seite
  // wird hochgeladen; beim Start wird ein NEUERER Stand von einem anderen
  // Gerät angeboten. Ohne Code passiert nichts.
  const cloud = {
    code() { return (localStorage.getItem("gs_sync_code") || "").trim().toUpperCase(); },
    // Gerätelokale Schreiber-Kennung (NIE im Backup enthalten): damit lässt
    // sich der eigene letzte Upload von dem eines anderen Geräts unterscheiden.
    writerId() {
      let w = localStorage.getItem("gs_cloud_writer");
      if (!w) {
        const a = new Uint8Array(12); crypto.getRandomValues(a);
        w = [...a].map(b => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
        try { localStorage.setItem("gs_cloud_writer", w); } catch {}
      }
      return w;
    },
    // Identitäts-/Sync-Bookkeeping gehört nicht ins geräteübergreifende Backup
    _skip(k) { return /^(gs_sync|gs_cloud)/.test(k) || k === "__gs_test__" || k === "__meeri_test__"; },
    snapshot() {
      const o = {};
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (!this._skip(k)) o[k] = localStorage.getItem(k); }
      return o;
    },
    // Zuverlässig beim Verlassen (kein await möglich) → sendBeacon
    pushBeacon() {
      const code = this.code(); if (!code) return;
      try {
        const body = JSON.stringify({ code, data: this.snapshot(), writer: this.writerId() });
        if (navigator.sendBeacon && navigator.sendBeacon("/api/cloud", new Blob([body], { type: "application/json" }))) {
          localStorage.setItem("gs_sync_local_at", String(Date.now()));
        }
      } catch {}
    },
    async push() {
      const code = this.code(); if (!code) return null;
      try {
        // base = zuletzt bekannter Cloud-Stand → optimistische Sperre serverseitig.
        const base = localStorage.getItem("gs_sync_at") || undefined;
        const res = await fetch("/api/cloud", {
          method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
          body: JSON.stringify({ code, data: this.snapshot(), writer: this.writerId(), base }),
        });
        // Konflikt: der Cloud-Stand ist neuer (anderes Gerät) → nicht klobbern,
        // sondern beim nächsten Laden abgleichen (syncOnLoad bietet das Laden an).
        if (res.status === 409) { try { this.syncOnLoad(); } catch {} return null; }
        const d = await res.json().catch(() => ({}));
        if (d.updated_at) { localStorage.setItem("gs_sync_at", d.updated_at); localStorage.setItem("gs_sync_local_at", String(Date.now())); }
        return d;
      } catch { return null; }
    },
    // Beim Start prüfen, ob der jüngste Cloud-Stand von einem ANDEREN
    // Gerät stammt — nur dann zum Laden anbieten (eigener Upload = still).
    async syncOnLoad() {
      const code = this.code(); if (!code) return;
      try {
        const res = await fetch("/api/cloud?code=" + encodeURIComponent(code));
        if (!res.ok) return;
        const d = await res.json();
        if (!d.updated_at) return;
        const me = this.writerId();
        if (d.writer && d.writer === me) { localStorage.setItem("gs_sync_seen", d.updated_at); return; }
        if (localStorage.getItem("gs_sync_seen") === d.updated_at) return;   // schon behandelt
        const data = typeof d.data === "string" ? JSON.parse(d.data) : (d.data || {});
        if (confirm("☁️ Auf einem anderen Gerät gibt es einen neueren Spielstand. Jetzt hier laden? (überschreibt den aktuellen Stand auf diesem Gerät)")) {
          for (const [k, v] of Object.entries(data)) { try { localStorage.setItem(k, v); } catch {} }
          localStorage.setItem("gs_sync_seen", d.updated_at);
          localStorage.setItem("gs_sync_at", d.updated_at);
          localStorage.setItem("gs_sync_local_at", String(Date.now()));
          location.reload();
        } else {
          localStorage.setItem("gs_sync_seen", d.updated_at);   // nicht erneut nachfragen
        }
      } catch {}
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

  const level = {
    // Signale direkt übergeben …
    compute(badgeSum, recordCount, playedCount) {
      const base = (badgeSum | 0) * 100 + (recordCount | 0) * 80 + (playedCount | 0) * 40;
      try { localStorage.setItem("gs_level_base", String(base)); } catch {}
      return levelInfo(base);
    },
    // … oder bequem aus der Spiele-Registry zählen (identisch zum Profil).
    computeFromGames(GAMES) {
      const c = countsFromGames(GAMES);
      try { localStorage.setItem("gs_level_base", String(c.base)); } catch {}
      return { ...levelInfo(c.base), ...c };
    },
    counts: countsFromGames,
    award: (n, r) => GSP.award(n, r),
    titleFor: titleForLevel,
  };
  const quests = { today: () => GSP.today(), bump: (t, c) => GSP.bump(t, c), pool: () => QUEST_POOL.slice() };

  window.GS = {
    esc, deviceId, getName, setName, submitScore, scoreFlow, showLeaderboard,
    badges, skins, sound, haptic, fx, onboard, share, shareCard, duelLink, markPlayed, streak, cloud,
    level, quests,
  };

  // Auto-Sync verdrahten (nur wenn ein Sync-Code existiert): beim Verlassen
  // automatisch sichern; beim Start einen neueren Stand eines ANDEREN Geraets
  // zum Laden anbieten (robust ueber die Schreiber-Kennung, kein Spam).
    try {
    if (cloud.code()) {
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "hidden") cloud.pushBeacon();
      });
      window.addEventListener("pagehide", () => cloud.pushBeacon());
      setTimeout(() => cloud.syncOnLoad(), 900);
    }
  } catch {}
})();
