// ====================================================================
// Feuerwehr NÖ – Einsätze live (Client).
// Holt die aktiven Einsätze über den eigenen Proxy /api/fire/noe,
// zeigt sie als Karten, filtert nach Art/Bezirk/Suche und lädt bei
// Klick die Details (ausgerückte Wehren) nach. Auto-Refresh alle 30 s.
// ====================================================================
(function () {
  "use strict";

  // Bezirkscode → Name (aus der offiziellen Wastl-Zuordnung).
  const BEZIRK = {
    "01": "Amstetten", "02": "Baden", "03": "Bruck/Leitha", "04": "Gänserndorf",
    "05": "Gmünd", "061": "Klosterneuburg", "062": "St. Pölten (Land)", "063": "Bruck/Leitha",
    "07": "Hollabrunn", "08": "Horn", "09": "Korneuburg", "10": "Krems/Donau",
    "11": "Lilienfeld", "12": "Melk", "13": "Mistelbach", "14": "Mödling",
    "15": "Neunkirchen", "17": "St. Pölten", "18": "Scheibbs", "19": "Tulln",
    "20": "Waidhofen/Thaya", "21": "Wr. Neustadt", "22": "Zwettl",
  };

  const REFRESH_MS = 30000;
  const FRESH_MS = 10 * 60 * 1000;   // „neu": jünger als 10 min

  const $ = s => document.querySelector(s);
  const listEl = $("#list");
  const standEl = $("#stand");
  const dotEl = $("#live-dot");
  const statsEl = $("#stats");
  const bezirkSel = $("#bezirk");
  const searchEl = $("#search");

  let all = [];          // aktuelle Einsätze (roh + angereichert)
  let filterKind = "all";
  let timer = null;

  // ---- Alarmstufe/Art deuten (T…technisch, B…Brand, S…Schadstoff) ----
  function classify(a) {
    const s = String(a || "").trim().toUpperCase();
    const kind = "BTS".includes(s[0]) ? s[0] : "X";
    const stufe = (s.match(/\d+/) || [""])[0];
    const label = { B: "Brand", T: "Technisch", S: "Schadstoff", X: "Einsatz" }[kind];
    return { kind, stufe, label };
  }

  // ---- Zeit „24.07.2026" + „16:51:41" → Date (Ortszeit) ----
  function parseWhen(d, t) {
    const md = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(d || ""));
    const mt = /^(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(t || ""));
    if (!md) return null;
    const [, dd, mm, yy] = md;
    const hh = mt ? mt[1] : "00", mi = mt ? mt[2] : "00", ss = mt ? (mt[3] || "00") : "00";
    const date = new Date(+yy, +mm - 1, +dd, +hh, +mi, +ss);
    return isNaN(date.getTime()) ? null : date;
  }

  function ago(date) {
    if (!date) return "";
    const min = Math.floor((Date.now() - date.getTime()) / 60000);
    if (min < 0) return "gerade";
    if (min < 1) return "gerade eben";
    if (min < 60) return "vor " + min + " min";
    const h = Math.floor(min / 60);
    if (h < 24) return "vor " + h + " h";
    const days = Math.floor(h / 24);
    return "vor " + days + " Tg.";
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  const PIN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 21s7-5.5 7-11a7 7 0 10-14 0c0 5.5 7 11 7 11z" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="10" r="2.4" fill="currentColor"/></svg>';

  // ---- Laden ----
  async function load() {
    try {
      const res = await fetch("/api/fire/noe", { headers: { "Accept": "application/json" } });
      const data = await res.json();
      const list = Array.isArray(data.einsatz) ? data.einsatz : [];
      all = list.map(e => {
        const when = parseWhen(e.d, e.t);
        return Object.assign({}, e, {
          _c: classify(e.a),
          _when: when,
          _bez: BEZIRK[String(e.b)] || (e.b ? "Bezirk " + e.b : ""),
        });
      });
      setStatus(data.error ? "err" : "ok");
      render();
    } catch (_) {
      setStatus("err");
      if (!all.length) render();  // sonst letzte Anzeige behalten
    }
  }

  function setStatus(state) {
    const time = new Date().toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
    dotEl.className = "live" + (state === "err" ? " err" : "");
    standEl.textContent = state === "err"
      ? "Quelle nicht erreichbar"
      : "Stand " + time + " · alle 30 s";
  }

  // ---- Bezirk-Dropdown befüllen (nur vorkommende Bezirke) ----
  function fillBezirke() {
    const cur = bezirkSel.value;
    const names = [...new Set(all.map(e => e._bez).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de"));
    bezirkSel.innerHTML = '<option value="">Alle Bezirke</option>' +
      names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join("");
    if (names.includes(cur)) bezirkSel.value = cur;
  }

  function filtered() {
    const q = searchEl.value.trim().toLowerCase();
    const bez = bezirkSel.value;
    return all.filter(e => {
      if (filterKind !== "all" && e._c.kind !== filterKind) return false;
      if (bez && e._bez !== bez) return false;
      if (q && !((e.m || "").toLowerCase().includes(q) ||
                 (e.o || "").toLowerCase().includes(q) ||
                 (e._bez || "").toLowerCase().includes(q))) return false;
      return true;
    });
  }

  // ---- Statistik ----
  function renderStats() {
    const c = { B: 0, T: 0, S: 0 };
    all.forEach(e => { if (c[e._c.kind] != null) c[e._c.kind]++; });
    statsEl.innerHTML = `
      <div class="stat"><b>${all.length}</b><span>Einsätze aktiv</span></div>
      <div class="stat b"><b>${c.B}</b><span>Brand</span></div>
      <div class="stat t"><b>${c.T}</b><span>Technisch</span></div>
      <div class="stat s"><b>${c.S}</b><span>Schadstoff</span></div>`;
  }

  // ---- Karten ----
  function render() {
    fillBezirke();
    renderStats();
    const items = filtered();

    if (!items.length) {
      listEl.innerHTML = all.length
        ? `<div class="empty"><div class="big">🔍</div>Keine Einsätze für diesen Filter.</div>`
        : `<div class="empty"><div class="big">🌙</div>Aktuell keine gemeldeten Einsätze in Niederösterreich.</div>`;
      return;
    }

    // neueste zuerst
    items.sort((a, b) => (b._when ? b._when.getTime() : 0) - (a._when ? a._when.getTime() : 0));

    listEl.innerHTML = items.map((e, idx) => {
      const k = e._c.kind;
      const fresh = e._when && (Date.now() - e._when.getTime()) < FRESH_MS;
      const badge = `${e._c.label}${e._c.stufe ? ' <span class="stufe">St. ' + esc(e._c.stufe) + "</span>" : ""}`;
      const bezLine = e._bez ? `<div class="bez">Bezirk ${esc(e._bez)}</div>` : "";
      return `
        <button class="card k-${k}${fresh ? " fresh" : ""}" data-id="${esc(e.i)}" style="animation-delay:${Math.min(idx * 25, 300)}ms">
          <div class="row1">
            <span class="badge k-${k}">${badge}</span>
            ${fresh ? '<span class="fresh-tag">neu</span>' : ""}
            <span class="when">${esc(ago(e._when))}</span>
          </div>
          <h3>${esc(e.m || "Einsatz")}</h3>
          <div class="loc">${PIN}<span>${esc(e.o || "Unbekannt")}${e.o2 ? " · " + esc(e.o2) : ""}</span></div>
          ${bezLine}
        </button>`;
    }).join("");
  }

  // ---- Detail-Overlay ----
  const overlay = $("#detail");
  const dBody = $("#d-body");

  function openDetail(id) {
    const base = all.find(e => e.i === id);
    overlay.hidden = false;
    document.body.style.overflow = "hidden";
    dBody.innerHTML = detailShell(base) + `<div class="d-loading">Lade Details…</div>`;
    fetch("/api/fire/noe?id=" + encodeURIComponent(id))
      .then(r => r.json())
      .then(d => { dBody.innerHTML = detailShell(base, d) + renderUnits(d); })
      .catch(() => { dBody.innerHTML = detailShell(base) + `<div class="d-loading">Details nicht verfügbar.</div>`; });
  }

  function detailShell(base, d) {
    const src = d || base || {};
    const c = classify(src.a || (base && base.a));
    const when = parseWhen(src.d || (base && base.d), src.t || (base && base.t));
    const bez = base ? base._bez : "";
    const whenStr = when
      ? when.toLocaleString("de-AT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) + " Uhr"
      : ((src.d || "") + " " + (src.t || "")).trim();
    return `
      <div class="d-head"><span class="badge k-${c.kind}">${esc(c.label)}${c.stufe ? " · Stufe " + esc(c.stufe) : ""}</span></div>
      <h2 id="d-title">${esc(src.m || "Einsatz")}</h2>
      <div class="d-loc">${esc(src.o || "")}${src.o2 ? " · " + esc(src.o2) : ""}${bez ? ` <span class="bz">· Bezirk ${esc(bez)}</span>` : ""}</div>
      <div class="d-meta">
        <div><span>Alarmiert</span><b>${esc(ago(when))}</b></div>
        <div><span>Zeitpunkt</span><b>${esc(whenStr)}</b></div>
        <div><span>Einsatznr.</span><b>${esc(src.n || (base && base.n) || "—")}</b></div>
        <div><span>Alarmstufe</span><b>${esc(String(src.a || (base && base.a) || "—"))}</b></div>
      </div>`;
  }

  function renderUnits(d) {
    const units = Array.isArray(d && d.Dispo) ? d.Dispo : [];
    if (!units.length) return `<div class="d-units"><h4>Alarmierte Wehren</h4><div class="d-loading">Noch keine Wehren gelistet.</div></div>`;
    return `<div class="d-units"><h4>Alarmierte Wehren (${units.length})</h4>` +
      units.map(u => {
        const t = (u.at || u.dt || "").replace(/^\d{2}\.\d{2}\.\d{4}\s*/, "");
        return `<div class="unit"><span class="u-dot"></span><span class="u-name">${esc(u.n || "Feuerwehr")}</span>${t ? `<span class="u-time">${esc(t)}</span>` : ""}</div>`;
      }).join("") + `</div>`;
  }

  function closeDetail() {
    overlay.hidden = true;
    document.body.style.overflow = "";
  }

  // ---- Events ----
  listEl.addEventListener("click", e => {
    const card = e.target.closest(".card");
    if (card && card.dataset.id) openDetail(card.dataset.id);
  });
  $("#d-close").addEventListener("click", closeDetail);
  overlay.addEventListener("click", e => { if (e.target === overlay) closeDetail(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !overlay.hidden) closeDetail(); });

  $("#kind-chips").addEventListener("click", e => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    filterKind = chip.dataset.kind;
    document.querySelectorAll(".chip").forEach(c => {
      const on = c === chip;
      c.classList.toggle("on", on);
      c.setAttribute("aria-selected", on ? "true" : "false");
    });
    render();
  });
  bezirkSel.addEventListener("change", render);
  searchEl.addEventListener("input", render);

  // Beim Wiederkommen (Tab/PWA) sofort aktualisieren.
  document.addEventListener("visibilitychange", () => { if (!document.hidden) load(); });

  // ---- Start ----
  listEl.innerHTML = `<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>`;
  load();
  timer = setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
})();
