// ====================================================================
// Feuerwehr NÖ – Einsätze live (Client).
// Liste + Karte, Bezirks-Push-Alarm, Auto-Refresh, progressives Geocoding.
// ====================================================================
(function () {
  "use strict";

  // Bezirkscode → Name (offizielle Wastl-Zuordnung).
  const BEZIRK = {
    "01": "Amstetten", "02": "Baden", "03": "Bruck/Leitha", "04": "Gänserndorf",
    "05": "Gmünd", "061": "Klosterneuburg", "062": "St. Pölten (Land)", "063": "Bruck/Leitha",
    "07": "Hollabrunn", "08": "Horn", "09": "Korneuburg", "10": "Krems/Donau",
    "11": "Lilienfeld", "12": "Melk", "13": "Mistelbach", "14": "Mödling",
    "15": "Neunkirchen", "17": "St. Pölten", "18": "Scheibbs", "19": "Tulln",
    "20": "Waidhofen/Thaya", "21": "Wr. Neustadt", "22": "Zwettl",
  };
  // Für das Alarm-Raster: Name → alle Codes mit diesem Namen (Duplikate bündeln).
  const NAME_CODES = (() => {
    const m = {};
    for (const [code, name] of Object.entries(BEZIRK)) (m[name] ||= []).push(code);
    return m;
  })();

  const REFRESH_MS = 30000;
  const FRESH_MS = 10 * 60 * 1000;
  const KIND_COLOR = { B: "#ff3b30", T: "#3b9bff", S: "#35d07f", X: "#9aa3b4" };

  const $ = s => document.querySelector(s);
  const listEl = $("#list"), mapEl = $("#map"), standEl = $("#stand"), dotEl = $("#live-dot");
  const statsEl = $("#stats"), bezirkSel = $("#bezirk"), searchEl = $("#search");

  const LS = {
    get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} },
  };

  let all = [];
  let filterKind = LS.get("fire_kind", "all");
  let view = LS.get("fire_view", "list");
  let feed = LS.get("fire_feed", "active");     // "active" | "recent" (beendet)
  let prevNums = null;              // null = erster Ladevorgang (kein Alarm)
  let newFlash = 0;
  let shownIds = new Set();         // schon eingeblendete Karten (keine Re-Animation)

  // Exakte Bounding-Box von Niederösterreich (für „auf Karte zentrieren").
  const NOE_BOUNDS = [[47.42, 14.44], [49.02, 17.07]];

  // ---- Hell/Dunkel ----
  const curTheme = () => document.documentElement.dataset.theme === "light" ? "light" : "dark";
  const tileUrl = () => "/fire/tiles/" + curTheme() + "/{z}/{x}/{y}{r}.png";
  function applyThemeUI() {
    const t = curTheme();
    const btn = $("#theme-btn"); if (btn) btn.textContent = t === "light" ? "☀️" : "🌙";
    const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = t === "light" ? "#eef1f7" : "#0d0e12";
  }
  function toggleTheme() {
    const t = curTheme() === "light" ? "dark" : "light";
    document.documentElement.dataset.theme = t; LS.set("fire_theme", t);
    applyThemeUI();
    if (tileLayer) tileLayer.setUrl(tileUrl());
  }

  // ---- Helfer ----
  function classify(a) {
    const s = String(a || "").trim().toUpperCase();
    const kind = "BTS".includes(s[0]) ? s[0] : "X";
    const stufe = (s.match(/\d+/) || [""])[0];
    return { kind, stufe, label: { B: "Brand", T: "Technisch", S: "Schadstoff", X: "Einsatz" }[kind] };
  }
  function parseWhen(d, t) {
    const md = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(d || ""));
    const mt = /^(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(t || ""));
    if (!md) return null;
    const date = new Date(+md[3], +md[2] - 1, +md[1], mt ? +mt[1] : 0, mt ? +mt[2] : 0, mt ? +(mt[3] || 0) : 0);
    return isNaN(date.getTime()) ? null : date;
  }
  function ago(date) {
    if (!date) return "";
    const min = Math.floor((Date.now() - date.getTime()) / 60000);
    if (min < 1) return "gerade eben";
    if (min < 60) return "vor " + min + " min";
    const h = Math.floor(min / 60);
    if (h < 24) return "vor " + h + " h";
    return "vor " + Math.floor(h / 24) + " Tg.";
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  const normKey = o => String(o || "").toLowerCase().trim().replace(/\s+/g, " ");
  const PIN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M12 21s7-5.5 7-11a7 7 0 10-14 0c0 5.5 7 11 7 11z" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="10" r="2.4" fill="currentColor"/></svg>';

  // ---- Geocoding-Cache (Client) ----
  const geo = (() => {
    let store = {};
    try { store = JSON.parse(LS.get("fire_geo", "{}")) || {}; } catch (_) {}
    return {
      get: o => store[normKey(o)],                 // [lat,lng] | 0 (miss) | undefined
      set: (o, v) => { store[normKey(o)] = v; try { LS.set("fire_geo", JSON.stringify(store)); } catch (_) {} },
    };
  })();
  let geoBusy = false;
  function coordsOf(e) {
    if (typeof e.lat === "number" && typeof e.lng === "number") return [e.lat, e.lng];
    const g = geo.get(e.o);
    return (Array.isArray(g)) ? g : null;
  }
  // Fehlende Orte gedrosselt auflösen (schont Nominatim). Max. einige pro Runde.
  async function fillGeocodes() {
    if (geoBusy) return;
    const need = [];
    const seen = new Set();
    for (const e of all) {
      const k = normKey(e.o);
      if (!e.o || seen.has(k)) continue;
      seen.add(k);
      if (coordsOf(e)) continue;
      if (geo.get(e.o) === 0) continue;            // bekannter Fehltreffer
      need.push(e);
    }
    if (!need.length) return;
    geoBusy = true;
    for (const e of need.slice(0, 12)) {
      try {
        const r = await fetch("/api/fire/geo?q=" + encodeURIComponent(e.o) + (e.p ? "&plz=" + encodeURIComponent(e.p) : ""));
        const d = await r.json();
        if (d && typeof d.lat === "number") { geo.set(e.o, [d.lat, d.lng]); if (view === "map") addMarkers(); }
        else if (d && d.miss) geo.set(e.o, 0);
      } catch (_) {}
      await new Promise(res => setTimeout(res, 850));   // Rate-Limit-freundlich
    }
    geoBusy = false;
  }

  // ---- Laden ----
  const parseUTC = s => { const d = new Date(String(s || "").replace(" ", "T") + "Z"); return isNaN(d.getTime()) ? null : d; };
  async function load() {
    const recent = feed === "recent";
    try {
      const res = await fetch("/api/fire/noe" + (recent ? "?recent=1" : ""), { headers: { "Accept": "application/json" } });
      const data = await res.json();
      const list = Array.isArray(data.einsatz) ? data.einsatz : [];
      all = list.map(e => Object.assign({}, e, {
        _c: classify(e.a),
        _when: recent ? parseUTC(e.ended_at) : parseWhen(e.d, e.t),
        _bez: BEZIRK[String(e.b)] || (e.b ? "Bezirk " + e.b : ""),
        _ended: recent,
        _key: recent ? "r:" + e.n : e.i,
      }));
      if (!recent) detectNew(list);
      setStatus(data.error ? "err" : "ok");
      render();
      fillGeocodes();
    } catch (_) {
      setStatus("err");
      if (!all.length) render();
    }
  }

  function detectNew(list) {
    const nums = new Set(list.map(e => String(e.n)).filter(Boolean));
    if (prevNums) {
      let fresh = 0;
      nums.forEach(n => { if (!prevNums.has(n)) fresh++; });
      if (fresh > 0) {
        try { navigator.vibrate && navigator.vibrate([70, 40, 70]); } catch (_) {}
        newFlash += fresh;
        flashTitle();
        toast(fresh === 1 ? "Neuer Einsatz gemeldet" : fresh + " neue Einsätze");
      }
    }
    prevNums = nums;
  }

  function setStatus(state) {
    const time = new Date().toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
    dotEl.className = "live" + (state === "err" ? " err" : (feed === "recent" ? " stale" : ""));
    standEl.textContent = state === "err" ? "Quelle nicht erreichbar"
      : (feed === "recent" ? "Beendet · letzte 24 h" : "Stand " + time);
  }

  // ---- Titel-Blink & Toast bei neuen Einsätzen ----
  const baseTitle = document.title;
  function flashTitle() { if (document.hidden) document.title = "🔴 (" + newFlash + ") neue Einsätze"; }
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { newFlash = 0; document.title = baseTitle; load(); }
  });
  let toastT = null;
  function toast(msg) {
    let el = $("#toast");
    if (!el) { el = document.createElement("div"); el.id = "toast"; document.body.appendChild(el); }
    el.textContent = "🚒 " + msg; el.classList.add("show");
    clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove("show"), 4000);
  }

  // ---- Filter ----
  function fillBezirke() {
    const cur = bezirkSel.value || LS.get("fire_bezirk", "");
    const names = [...new Set(all.map(e => e._bez).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de"));
    bezirkSel.innerHTML = '<option value="">Alle Bezirke</option>' + names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join("");
    if (names.includes(cur)) bezirkSel.value = cur;
  }
  function filtered() {
    const q = searchEl.value.trim().toLowerCase(), bez = bezirkSel.value;
    return all.filter(e => {
      if (filterKind !== "all" && e._c.kind !== filterKind) return false;
      if (bez && e._bez !== bez) return false;
      if (q && !((e.m || "").toLowerCase().includes(q) || (e.o || "").toLowerCase().includes(q) || (e._bez || "").toLowerCase().includes(q))) return false;
      return true;
    }).sort((a, b) => (b._when ? b._when.getTime() : 0) - (a._when ? a._when.getTime() : 0));
  }

  function renderStats() {
    const c = { B: 0, T: 0, S: 0 };
    all.forEach(e => { if (c[e._c.kind] != null) c[e._c.kind]++; });
    statsEl.innerHTML =
      `<div class="stat"><b>${all.length}</b><span>aktiv</span></div>` +
      `<div class="stat b"><b>${c.B}</b><span>Brand</span></div>` +
      `<div class="stat t"><b>${c.T}</b><span>Technisch</span></div>` +
      `<div class="stat s"><b>${c.S}</b><span>Schadstoff</span></div>`;
  }

  // ---- Karten ----
  function render() {
    fillBezirke();
    renderStats();
    if (view === "map") { addMarkers(); return; }
    const items = filtered();

    // Lade-Platzhalter immer wegräumen (sonst bleiben sie neben den Karten stehen).
    listEl.querySelectorAll(".skeleton").forEach(s => s.remove());

    // Leerzustand
    const emptyEl = listEl.querySelector(".empty");
    if (!items.length) {
      const msg = all.length
        ? `<div class="empty"><div class="big">🔍</div>Keine Einsätze für diesen Filter.</div>`
        : (feed === "recent"
          ? `<div class="empty"><div class="big">✅</div>In den letzten 24&nbsp;Stunden wurden keine Einsätze beendet.</div>`
          : `<div class="empty"><div class="big">🌙</div>Aktuell keine gemeldeten Einsätze in Niederösterreich.</div>`);
      if (listEl.innerHTML !== msg) listEl.innerHTML = msg;
      return;
    }
    if (emptyEl) emptyEl.remove();

    // Differenziell aktualisieren: vorhandene Karten wiederverwenden (kein
    // Flackern/„Pochen" beim Refresh), nur wirklich neue blenden ein.
    const have = new Map();
    listEl.querySelectorAll(".card").forEach(c => have.set(c.dataset.key, c));

    let entering = 0;
    items.forEach(e => {
      let card = have.get(e._key);
      if (card) {
        have.delete(e._key);
        updateCard(card, e);
      } else {
        card = buildCard(e, !shownIds.has(e._key), entering++);
      }
      listEl.appendChild(card);   // schiebt bestehende Knoten nur in die richtige Reihenfolge
      shownIds.add(e._key);
    });
    // Verschwundene Einsätze entfernen
    have.forEach(c => c.remove());
  }

  const whenText = e => e._ended ? ("beendet " + ago(e._when)) : ago(e._when);
  function cardMarkup(e) {
    const k = e._c.kind;
    const fresh = !e._ended && e._when && (Date.now() - e._when.getTime()) < FRESH_MS;
    const badge = `${e._c.label}${e._c.stufe ? ' <span class="stufe">St. ' + esc(e._c.stufe) + "</span>" : ""}`;
    return `<div class="row1"><span class="badge k-${k}">${badge}</span>${fresh ? '<span class="fresh-tag">neu</span>' : ""}<span class="when">${esc(whenText(e))}</span></div>
        <h3>${esc(e.m || "Einsatz")}</h3>
        <div class="loc">${PIN}<span>${esc(e.o || "Unbekannt")}${e.o2 ? " · " + esc(e.o2) : ""}</span></div>
        ${e._bez ? `<div class="bez">Bezirk ${esc(e._bez)}</div>` : ""}`;
  }
  function buildCard(e, isNew, order) {
    const k = e._c.kind;
    const fresh = !e._ended && e._when && (Date.now() - e._when.getTime()) < FRESH_MS;
    const card = document.createElement("button");
    card.className = "card k-" + k + (fresh ? " fresh" : "") + (e._ended ? " ended" : "") + (isNew ? " enter" : "");
    card.dataset.key = e._key;
    if (e.i) card.dataset.id = e.i;                 // nur aktive haben Detail
    card.dataset.when = e._when ? e._when.getTime() : 0;
    if (isNew) card.style.animationDelay = Math.min(order * 25, 300) + "ms";
    card.innerHTML = cardMarkup(e);
    return card;
  }
  function updateCard(card, e) {
    const k = e._c.kind;
    const fresh = !e._ended && e._when && (Date.now() - e._when.getTime()) < FRESH_MS;
    const cls = "card k-" + k + (fresh ? " fresh" : "") + (e._ended ? " ended" : "");
    if (card.className !== cls) card.className = cls;
    const w = card.querySelector(".when");
    if (w) { const t = whenText(e); if (w.textContent !== t) w.textContent = t; }
  }

  // ---- Leaflet-Karte ----
  let map = null, markers = null, tileLayer = null;
  function initMap() {
    if (map) return;
    map = L.map(mapEl, { zoomControl: true, attributionControl: true, minZoom: 7, maxZoom: 18 });
    map.fitBounds(NOE_BOUNDS);
    map.setMaxBounds([[46.9, 13.8], [49.4, 17.7]]);
    tileLayer = L.tileLayer(tileUrl(), {
      detectRetina: true, maxZoom: 18,
      attribution: '© OpenStreetMap · CARTO',
    }).addTo(map);
    markers = L.layerGroup().addTo(map);
    addLegend();
  }
  function addLegend() {
    if ($("#map-legend")) return;
    const el = document.createElement("div");
    el.id = "map-legend";
    el.innerHTML =
      '<div class="lg"><i style="background:' + KIND_COLOR.B + '"></i>Brand</div>' +
      '<div class="lg"><i style="background:' + KIND_COLOR.T + '"></i>Technisch</div>' +
      '<div class="lg"><i style="background:' + KIND_COLOR.S + '"></i>Schadstoff</div>';
    mapEl.appendChild(el);
  }
  function addMarkers() {
    if (!map) return;
    markers.clearLayers();
    const items = filtered();

    // Nach Koordinate gruppieren: die Geokodierung ist ortsgenau, daher liegen
    // mehrere Einsätze desselben Orts exakt aufeinander → als ein Marker mit
    // Anzahl bündeln (Popup listet alle).
    const groups = new Map();
    let coded = 0;
    for (const e of items) {
      const c = coordsOf(e);
      if (!c) continue;
      coded++;
      const key = c[0].toFixed(4) + "," + c[1].toFixed(4);
      (groups.get(key) || groups.set(key, { c, items: [] }).get(key)).items.push(e);
    }

    groups.forEach(g => {
      const lead = g.items[0];
      const col = KIND_COLOR[lead._c.kind] || KIND_COLOR.X;
      const anyFresh = g.items.some(e => !e._ended && e._when && (Date.now() - e._when.getTime()) < FRESH_MS);
      const n = g.items.length;
      const m = L.circleMarker(g.c, {
        radius: n > 1 ? 12 : (anyFresh ? 10 : 7), color: "#0b0c10", weight: 1.5,
        fillColor: col, fillOpacity: lead._ended ? 0.6 : 0.95,
      });
      if (n > 1) m.bindTooltip(String(n), { permanent: true, direction: "center", className: "cluster-badge" });
      const body = g.items.map(e => {
        const cc = KIND_COLOR[e._c.kind] || KIND_COLOR.X;
        return `<div class="pop-item"><span class="pop-badge" style="background:${cc}22;color:${cc}">${esc(e._c.label)}${e._c.stufe ? " · St. " + esc(e._c.stufe) : ""}</span>` +
          `<b>${esc(e.m || "Einsatz")}</b><span class="pop-when">${esc(whenText(e))}</span>` +
          (e.i ? `<button class="pop-more" data-id="${esc(e.i)}">Details →</button>` : "") + `</div>`;
      }).join("");
      m.bindPopup(`<div class="pop"><div class="pop-loc">${esc(lead.o || "")}${lead._bez ? " · " + esc(lead._bez) : ""}</div>${body}</div>`);
      m.addTo(markers);
    });

    setMapNote(items.length, coded, items.length - coded);
  }

  // Karte auf die aktuell gefilterten (verorteten) Einsätze zoomen; sonst NÖ.
  function fitToFiltered() {
    if (!map) return;
    const pts = filtered().map(coordsOf).filter(Boolean);
    if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 12 });
    else map.fitBounds(NOE_BOUNDS, { padding: [24, 24] });
  }
  function setMapNote(total, shown, missing) {
    let n = $("#map-note");
    if (!n) { n = document.createElement("div"); n.id = "map-note"; mapEl.appendChild(n); }
    if (!total) { n.textContent = "Keine Einsätze."; n.hidden = false; }
    else if (missing > 0) { n.textContent = shown + "/" + total + " verortet · Rest wird geladen…"; n.hidden = false; }
    else n.hidden = true;
  }

  // ---- Ansicht umschalten ----
  function setView(v) {
    view = v; LS.set("fire_view", v);
    const isMap = v === "map";
    listEl.hidden = isMap; mapEl.hidden = !isMap;
    $("#view-list").classList.toggle("on", !isMap); $("#view-list").setAttribute("aria-selected", String(!isMap));
    $("#view-map").classList.toggle("on", isMap); $("#view-map").setAttribute("aria-selected", String(isMap));
    if (isMap) { initMap(); setTimeout(() => { map.invalidateSize(); map.fitBounds(NOE_BOUNDS, { padding: [24, 24] }); addMarkers(); }, 60); }
    else render();
  }

  // ---- Detail-Overlay ----
  const overlay = $("#detail"), dBody = $("#d-body");
  function openDetail(id) {
    const base = all.find(e => e.i === id);
    overlay.hidden = false; document.body.style.overflow = "hidden";
    dBody.innerHTML = detailShell(base) + `<div class="d-loading">Lade Details…</div>`;
    detailMiniMap(base);
    fetch("/api/fire/noe?id=" + encodeURIComponent(id)).then(r => r.json())
      .then(d => { dBody.innerHTML = detailShell(base, d) + renderUnits(d); detailMiniMap(base); })
      .catch(() => { dBody.innerHTML = detailShell(base) + `<div class="d-loading">Details nicht verfügbar.</div>`; detailMiniMap(base); });
  }
  // Mini-Karte im Detail (falls Koordinaten bekannt).
  let dMap = null;
  function detailMiniMap(base) {
    if (dMap) { try { dMap.remove(); } catch (_) {} dMap = null; }
    const c = base && coordsOf(base);
    if (!c || typeof L === "undefined") return;
    const host = document.createElement("div");
    host.id = "d-map";
    dBody.appendChild(host);
    dMap = L.map(host, { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, touchZoom: false, keyboard: false })
      .setView(c, 12);
    L.tileLayer(tileUrl(), { detectRetina: true, maxZoom: 16 }).addTo(dMap);
    const col = KIND_COLOR[(base._c && base._c.kind) || "X"] || KIND_COLOR.X;
    L.circleMarker(c, { radius: 9, color: "#0b0c10", weight: 1.5, fillColor: col, fillOpacity: 0.95 }).addTo(dMap);
    setTimeout(() => { try { dMap.invalidateSize(); } catch (_) {} }, 80);
  }
  function detailShell(base, d) {
    const src = d || base || {};
    const c = classify(src.a || (base && base.a));
    const when = parseWhen(src.d || (base && base.d), src.t || (base && base.t));
    const bez = base ? base._bez : "";
    const whenStr = when ? when.toLocaleString("de-AT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) + " Uhr" : ((src.d || "") + " " + (src.t || "")).trim();
    return `<div class="d-head"><span class="badge k-${c.kind}">${esc(c.label)}${c.stufe ? " · Stufe " + esc(c.stufe) : ""}</span></div>
      <h2 id="d-title">${esc(src.m || "Einsatz")}</h2>
      <div class="d-loc">${esc(src.o || "")}${src.o2 ? " · " + esc(src.o2) : ""}${src.p ? " · " + esc(src.p) : ""}${bez ? ` <span class="bz">· Bezirk ${esc(bez)}</span>` : ""}</div>
      <div class="d-meta">
        <div><span>Alarmiert</span><b>${esc(ago(when))}</b></div>
        <div><span>Zeitpunkt</span><b>${esc(whenStr)}</b></div>
        <div><span>Einsatznr.</span><b>${esc(src.n || (base && base.n) || "—")}</b></div>
        <div><span>Alarmstufe</span><b>${esc(String(src.a || (base && base.a) || "—"))}</b></div>
      </div>`;
  }
  function hhmm(s) { const m = /(\d{2}):(\d{2})/.exec(String(s || "")); return m ? m[1] + ":" + m[2] : ""; }
  // Österr. FMS-Funkstatus → Klartext + Farbe.
  const FMS = {
    "0": ["dringend", "#ff3b30"], "1": ["einsatzbereit", "#8a93a3"], "2": ["einsatzbereit", "#8a93a3"],
    "3": ["ausgerückt", "#ffb020"], "4": ["am Einsatzort", "#35d07f"], "5": ["Sprechwunsch", "#3b9bff"],
    "6": ["nicht bereit", "#8a93a3"],
  };
  function renderUnits(d) {
    const units = Array.isArray(d && d.Dispo) ? d.Dispo : [];
    if (!units.length) return `<div class="d-units"><h4>Alarmierte Wehren</h4><div class="d-loading">Noch keine Wehren gelistet.</div></div>`;
    return `<div class="d-units"><h4>Alarmierte Wehren (${units.length})</h4>` + units.map(u => {
      const st = FMS[String(u.s)] || ["alarmiert", "#8a93a3"];
      const t = hhmm(u.dt);
      return `<div class="unit"><span class="u-dot" style="background:${st[1]}"></span><span class="u-name">${esc(u.n || "Feuerwehr")}</span>` +
        `<span class="u-status" style="color:${st[1]}">${esc(st[0])}</span>${t ? `<span class="u-time">${esc(t)}</span>` : ""}</div>`;
    }).join("") + `</div>`;
  }
  function closeDetail() { overlay.hidden = true; document.body.style.overflow = ""; if (dMap) { try { dMap.remove(); } catch (_) {} dMap = null; } }

  // ---- Alarm-Overlay (Bezirks-Push) ----
  const alarmOvl = $("#alarm"), aGrid = $("#a-grid"), aAll = $("#a-all-cb"), aStatus = $("#a-status");
  function buildAlarmGrid(selected) {
    const sel = new Set(selected || []);
    const names = Object.keys(NAME_CODES).sort((a, b) => a.localeCompare(b, "de"));
    aGrid.innerHTML = names.map(name => {
      const codes = NAME_CODES[name];
      const on = codes.some(c => sel.has(c));
      return `<label class="a-item${on ? " on" : ""}"><input type="checkbox" data-codes="${codes.join(",")}" ${on ? "checked" : ""}/> ${esc(name)}</label>`;
    }).join("");
  }
  function setAStatus(msg, cls) { aStatus.hidden = !msg; aStatus.textContent = msg || ""; aStatus.className = "a-status" + (cls ? " " + cls : ""); }

  function b64ToU8(k) {
    const pad = "=".repeat((4 - k.length % 4) % 4);
    const s = (k + pad).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(s); const u = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) u[i] = raw.charCodeAt(i);
    return u;
  }
  async function getSub(create) {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub && create) {
      const key = (await (await fetch("/api/push")).json()).key;
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) });
    }
    return sub;
  }
  function chosenCodes() {
    if (aAll.checked) return ["*"];
    const codes = [];
    aGrid.querySelectorAll('input[type="checkbox"]:checked').forEach(cb => codes.push(...cb.dataset.codes.split(",")));
    return [...new Set(codes)];
  }
  async function openAlarm() {
    alarmOvl.hidden = false; document.body.style.overflow = "hidden";
    setAStatus("", "");
    if (!("Notification" in window) || !("serviceWorker" in navigator) || !("PushManager" in window)) {
      buildAlarmGrid([]); setAStatus("Dieser Browser unterstützt keine Push-Benachrichtigungen.", "err"); return;
    }
    buildAlarmGrid([]);
    try {
      const sub = await getSub(false);
      if (sub) {
        const d = await (await fetch("/api/fire/alert", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "get", endpoint: sub.endpoint }) })).json();
        const bez = d.bezirke || [];
        if (bez.length) {
          aAll.checked = bez.includes("*");
          buildAlarmGrid(bez);
          $("#a-off").hidden = false;
          $("#a-save").textContent = "Auswahl speichern";
          setAStatus("Alarm ist aktiv.", "ok");
        }
      }
    } catch (_) {}
    syncAllToggle();
  }
  function closeAlarm() { alarmOvl.hidden = true; document.body.style.overflow = ""; }
  function syncAllToggle() {
    aGrid.classList.toggle("dim", aAll.checked);
    aGrid.querySelectorAll("input").forEach(i => i.disabled = aAll.checked);
  }
  async function saveAlarm() {
    const codes = chosenCodes();
    if (!codes.length) { setAStatus("Bitte mindestens einen Bezirk wählen.", "err"); return; }
    setAStatus("Wird eingerichtet…", "");
    try {
      if (Notification.permission !== "granted") {
        const p = await Notification.requestPermission();
        if (p !== "granted") { setAStatus("Benachrichtigungen wurden nicht erlaubt.", "err"); return; }
      }
      const sub = await getSub(true);
      const r = await fetch("/api/fire/alert", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "subscribe", subscription: sub.toJSON(), bezirke: codes }) });
      if (!r.ok) throw new Error("save");
      LS.set("fire_alert_on", "1");
      $("#a-off").hidden = false; $("#a-save").textContent = "Auswahl speichern";
      setAStatus("Alarm aktiv! Du wirst bei neuen Einsätzen benachrichtigt.", "ok");
    } catch (_) { setAStatus("Konnte nicht aktivieren — später erneut versuchen.", "err"); }
  }
  async function offAlarm() {
    try { const sub = await getSub(false); if (sub) await fetch("/api/fire/alert", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "unsubscribe", endpoint: sub.endpoint }) }); } catch (_) {}
    LS.set("fire_alert_on", "0");
    aAll.checked = false; buildAlarmGrid([]); syncAllToggle();
    $("#a-off").hidden = true; $("#a-save").textContent = "Alarm aktivieren";
    setAStatus("Alarm ausgeschaltet.", "");
  }

  // ---- Statistik-Overlay ----
  const statsOvl = $("#stats-ovl"), sBody = $("#s-body");
  function openStats() {
    statsOvl.hidden = false; document.body.style.overflow = "hidden";
    sBody.innerHTML = `<div class="d-loading">Lade…</div>`;
    fetch("/api/fire/stats").then(r => r.json()).then(renderStatsOverlay)
      .catch(() => { sBody.innerHTML = `<div class="d-loading">Statistik nicht verfügbar.</div>`; });
  }
  function closeStats() { statsOvl.hidden = true; document.body.style.overflow = ""; }
  function renderStatsOverlay(s) {
    const k = s.byKind || { B: 0, T: 0, S: 0, X: 0 };
    const total = (k.B + k.T + k.S + k.X) || 1;
    const dur = s.avgMin == null ? "—" : (s.avgMin >= 60 ? Math.floor(s.avgMin / 60) + " h " + (s.avgMin % 60) + " min" : s.avgMin + " min");
    const hmax = Math.max(1, ...(s.byHour || [0]));
    const bars = (s.byHour || []).map((v, h) =>
      `<div class="hbar" title="${h}:00 – ${v} Einsätze"><i style="height:${Math.round(v / hmax * 100)}%"></i><em${h % 6 ? ' class="vh"' : ""}>${h}</em></div>`).join("");
    const kindRow = (label, val, cls) => {
      const pct = Math.round(val / total * 100);
      return `<div class="kbar"><span>${label}</span><div class="ktrack"><i class="k-${cls}" style="width:${pct}%"></i></div><b>${val}</b></div>`;
    };
    sBody.innerHTML =
      `<div class="s-tiles">
        <div class="stat"><b>${s.active || 0}</b><span>aktiv jetzt</span></div>
        <div class="stat"><b>${s.last24 || 0}</b><span>letzte 24 h</span></div>
        <div class="stat"><b>${dur}</b><span>Ø Dauer</span></div>
        <div class="stat"><b>${s.topBezirk ? esc(s.topBezirk.name) : "—"}</b><span>aktivster Bezirk${s.topBezirk ? " (" + s.topBezirk.count + ")" : ""}</span></div>
      </div>
      <h4 class="s-h">Nach Art</h4>
      ${kindRow("Brand", k.B, "B")}${kindRow("Technisch", k.T, "T")}${kindRow("Schadstoff", k.S, "S")}${k.X ? kindRow("Sonstige", k.X, "X") : ""}
      <h4 class="s-h">Einsätze nach Tagesstunde</h4>
      <div class="hchart">${bars}</div>`;
  }

  // ---- Events ----
  listEl.addEventListener("click", e => { const c = e.target.closest(".card"); if (c && c.dataset.id) openDetail(c.dataset.id); });
  mapEl.addEventListener("click", e => { const b = e.target.closest(".pop-more"); if (b && b.dataset.id) { closePopup(); openDetail(b.dataset.id); } });
  function closePopup() { if (map) map.closePopup(); }
  $("#d-close").addEventListener("click", closeDetail);
  overlay.addEventListener("click", e => { if (e.target === overlay) closeDetail(); });
  $("#a-close").addEventListener("click", closeAlarm);
  alarmOvl.addEventListener("click", e => { if (e.target === alarmOvl) closeAlarm(); });
  $("#stats-btn").addEventListener("click", openStats);
  $("#s-close").addEventListener("click", closeStats);
  statsOvl.addEventListener("click", e => { if (e.target === statsOvl) closeStats(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") { if (!overlay.hidden) closeDetail(); else if (!alarmOvl.hidden) closeAlarm(); else if (!statsOvl.hidden) closeStats(); } });
  $("#theme-btn").addEventListener("click", toggleTheme);
  $("#alarm-btn").addEventListener("click", openAlarm);
  $("#a-save").addEventListener("click", saveAlarm);
  $("#a-off").addEventListener("click", offAlarm);
  aAll.addEventListener("change", syncAllToggle);
  aGrid.addEventListener("change", e => { const l = e.target.closest(".a-item"); if (l) l.classList.toggle("on", e.target.checked); });

  $("#kind-chips").addEventListener("click", e => {
    const chip = e.target.closest(".chip"); if (!chip) return;
    filterKind = chip.dataset.kind; LS.set("fire_kind", filterKind);
    document.querySelectorAll(".chip").forEach(c => { const on = c === chip; c.classList.toggle("on", on); c.setAttribute("aria-selected", String(on)); });
    render();
  });
  bezirkSel.addEventListener("change", () => { LS.set("fire_bezirk", bezirkSel.value); render(); if (view === "map") fitToFiltered(); });
  searchEl.addEventListener("input", render);
  $("#view-list").addEventListener("click", () => setView("list"));
  $("#view-map").addEventListener("click", () => setView("map"));

  function setFeed(f) {
    if (feed === f) return;
    feed = f; LS.set("fire_feed", f);
    $("#feed-active").classList.toggle("on", f === "active"); $("#feed-active").setAttribute("aria-selected", String(f === "active"));
    $("#feed-recent").classList.toggle("on", f === "recent"); $("#feed-recent").setAttribute("aria-selected", String(f === "recent"));
    all = []; prevNums = null;
    if (view === "list") listEl.innerHTML = `<div class="skeleton"></div><div class="skeleton"></div>`;
    load();
  }
  $("#feed-active").addEventListener("click", () => setFeed("active"));
  $("#feed-recent").addEventListener("click", () => setFeed("recent"));

  // Gespeicherten Filter/Chip auf UI anwenden
  document.querySelectorAll(".chip").forEach(c => { const on = c.dataset.kind === filterKind; c.classList.toggle("on", on); c.setAttribute("aria-selected", String(on)); });

  // ---- Pull-to-refresh (nur oben, nur Touch) ----
  (function ptr() {
    const el = $("#ptr"); let startY = 0, pulling = false, dist = 0;
    const TH = 70;
    window.addEventListener("touchstart", e => {
      if (!overlay.hidden || !alarmOvl.hidden) return;
      if (window.scrollY > 0 || view === "map") { pulling = false; return; }
      startY = e.touches[0].clientY; pulling = true; dist = 0;
    }, { passive: true });
    window.addEventListener("touchmove", e => {
      if (!pulling) return;
      dist = e.touches[0].clientY - startY;
      if (dist > 0) { el.style.transform = "translateX(-50%) translateY(" + Math.min(dist, TH + 30) + "px)"; el.classList.toggle("ready", dist > TH); }
    }, { passive: true });
    window.addEventListener("touchend", () => {
      if (!pulling) return; pulling = false;
      if (dist > TH) { el.classList.add("spin"); load().finally(() => setTimeout(() => { el.classList.remove("spin", "ready"); el.style.transform = ""; }, 400)); }
      else { el.classList.remove("ready"); el.style.transform = ""; }
    });
  })();

  // ---- Live-Zeiten ohne Neuladen aktualisieren ----
  setInterval(() => {
    if (view !== "list") return;
    const ended = feed === "recent";
    listEl.querySelectorAll(".card").forEach(card => {
      const w = Number(card.dataset.when) || 0; if (!w) return;
      const el = card.querySelector(".when"); if (el) el.textContent = (ended ? "beendet " : "") + ago(new Date(w));
    });
  }, 60000);

  // ---- Start ----
  applyThemeUI();
  if (feed === "recent") {
    $("#feed-active").classList.remove("on"); $("#feed-active").setAttribute("aria-selected", "false");
    $("#feed-recent").classList.add("on"); $("#feed-recent").setAttribute("aria-selected", "true");
  }
  listEl.innerHTML = `<div class="skeleton"></div><div class="skeleton"></div><div class="skeleton"></div>`;
  if (view === "map") setView("map"); else setView("list");
  load();
  setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
})();
