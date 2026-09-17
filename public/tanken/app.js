"use strict";
(function () {
  const $ = s => document.querySelector(s);
  const LS = {
    get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} },
  };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let fuel = ["SUP", "GAS"].includes(LS.get("sprit_fuel", "DIE")) ? LS.get("sprit_fuel", "DIE") : "DIE";
  let mode = LS.get("sprit_mode", "near") === "route" ? "route" : "near";
  let lastNear = null;   // {lat,lng} | {q}
  let nearData = null, routeData = null;   // letztes Ergebnis je Modus (für Umschalten)
  let map = null, layer = null;

  // ---- Einstellungen / gespeicherte Listen (localStorage) ----
  const jget = (k, d) => { try { const v = JSON.parse(LS.get(k, "")); return v == null ? d : v; } catch (_) { return d; } };
  const jset = (k, v) => LS.set(k, JSON.stringify(v));
  const openOnly = () => LS.get("sprit_open", "0") === "1";   // Filter „nur offene"
  // Vorgaben fuer „lohnt sich der Umweg?" — die Formel steht in umweg.js.
  const VG = (window.Umweg && window.Umweg.VORGABE) || { liter: 40, verbrauch: 7 };
  const umwegOpt = () => ({
    liter: +LS.get("sprit_liter", String(VG.liter)),
    verbrauch: +LS.get("sprit_verbrauch", String(VG.verbrauch)),
  });
  const favs = () => jget("sprit_favs", []);
  const isFav = id => favs().some(f => String(f.id) === String(id));
  function toggleFav(f) {
    const l = favs(); const i = l.findIndex(x => String(x.id) === String(f.id));
    if (i >= 0) l.splice(i, 1); else l.unshift(f);
    jset("sprit_favs", l.slice(0, 30));
  }
  const home = () => jget("sprit_home", null);
  function pushRecentNear(e) { const l = jget("sprit_rn", []).filter(x => x.label !== e.label); l.unshift(e); jset("sprit_rn", l.slice(0, 6)); }
  function pushRecentRoute(e) { const k = x => x.fromLabel + "→" + x.toLabel; const l = jget("sprit_rr", []).filter(x => k(x) !== k(e)); l.unshift(e); jset("sprit_rr", l.slice(0, 6)); }

  // ---- Theme ----
  const curTheme = () => document.documentElement.dataset.theme === "light" ? "light" : "dark";
  function applyThemeUI() {
    const b = $("#theme-btn"); if (b) b.textContent = curTheme() === "light" ? "☀️" : "🌙";
    const m = document.querySelector('meta[name="theme-color"]'); if (m) m.content = curTheme() === "light" ? "#eaf2ee" : "#0c1512";
  }
  $("#theme-btn").addEventListener("click", () => {
    document.documentElement.dataset.theme = curTheme() === "light" ? "dark" : "light";
    LS.set("sprit_theme", curTheme()); applyThemeUI();
    if (map) setTimeout(() => map.invalidateSize(), 60);
  });

  // Einmal je Sitzung: war jemand da? Anonym (nur Tag + Schluessel + Anzahl).
  try {
    if (!sessionStorage.getItem("sprit_visit")) {
      sessionStorage.setItem("sprit_visit", "1");
      navigator.sendBeacon("/api/stat", new Blob(
        [JSON.stringify({ ev: "visit", game: "tanken" })], { type: "application/json" }));
    }
  } catch (_) {}

  // ---- Preis/Format ----
  const eur = p => (typeof p === "number" ? p.toFixed(3).replace(".", ",") + " €" : "—");
  const km = d => d == null ? "" : (d < 1 ? Math.round(d * 1000) + " m" : (d < 10 ? d.toFixed(1) : Math.round(d)) + " km");
  const navUrl = (lat, lng) => "https://www.google.com/maps/dir/?api=1&destination=" + lat + "%2C" + lng + "&travelmode=driving";

  // ---- Karte ----
  function ensureMap() {
    if (map) return;
    map = L.map("map", { zoomControl: true, attributionControl: true }).setView([47.7, 14.3], 7);
    L.tileLayer("/sprit/tiles/{z}/{x}/{y}.png", {
      maxZoom: 19, attribution: "© OpenStreetMap-Mitwirkende",
    }).addTo(map);
    layer = L.layerGroup().addTo(map);
  }
  function pin(color, text) {
    return L.divIcon({
      className: "pin", html: `<span class="pin-b" style="background:${color}">${esc(text)}</span>`,
      iconSize: [1, 1], iconAnchor: [0, 0],
    });
  }
  function dot(color) {
    return L.divIcon({ className: "pin", html: `<span class="pin-dot" style="background:${color}"></span>`, iconSize: [1, 1], iconAnchor: [0, 0] });
  }

  // ---- Rendern ----
  function setMsg(text, kind) {
    const el = $("#msg");
    if (!text) { el.hidden = true; return; }
    el.className = "msg" + (kind ? " " + kind : ""); el.textContent = text; el.hidden = false;
  }
  function stationCard(s, best, extra) {
    const addr = [s.addr, (s.plz + " " + s.city).trim()].filter(Boolean).join(", ");
    const oh = `<span class="oh ${s.open ? "open" : "closed"}">${esc(s.openText || (s.open ? "offen" : "geschlossen"))}</span>`;
    const meta = [extra, oh].filter(Boolean).join(" · ");
    const fav = isFav(s.id);
    return `<div class="card${best ? " top" : ""}">
      <div class="price">${esc(eur(s.price))}</div>
      <div class="mid">
        <div class="name">${esc(s.name)}${best ? ' <span class="tag best">günstigste</span>' : ""}</div>
        <div class="addr">${esc(addr)}</div>
        <div class="meta">${meta}</div>
      </div>
      <div class="actions">
        <div class="act-row">
          <button class="fav${fav ? " on" : ""}" title="Favorit" aria-label="Favorit"
            data-id="${esc(s.id)}" data-name="${esc(s.name)}" data-lat="${s.lat}" data-lng="${s.lng}" data-addr="${esc(addr)}">★</button>
          <button class="share" title="Teilen" aria-label="Teilen"
            data-name="${esc(s.name)}" data-price="${esc(eur(s.price))}" data-addr="${esc(addr)}" data-lat="${s.lat}" data-lng="${s.lng}">⤴</button>
          <button class="alarm${isAlerted(s.id) ? " on" : ""}" title="Preis-Alarm" aria-label="Preis-Alarm"
            data-id="${esc(s.id)}" data-name="${esc(s.name)}" data-lat="${s.lat}" data-lng="${s.lng}" data-price="${s.price}">🔔</button>
        </div>
        <a class="nav" href="${navUrl(s.lat, s.lng)}" target="_blank" rel="noopener">Navi ▸</a>
      </div>
    </div>`;
  }
  const shortLabel = l => String(l || "").split(",").slice(0, 2).join(",").trim();
  function renderNear(d) {
    nearData = d;
    ensureMap(); layer.clearLayers(); renderQuickNear();
    let st = (d.stations || []).slice();
    const radius = +LS.get("sprit_radius", "0");
    if (radius) st = st.filter(s => s.dist == null || s.dist <= radius);
    if (openOnly()) st = st.filter(s => s.open);
    const minPrice = st.reduce((m, s) => Math.min(m, s.price), Infinity);
    if (LS.get("sprit_sort", "price") === "dist") st.sort((a, b) => (a.dist == null ? 1e9 : a.dist) - (b.dist == null ? 1e9 : b.dist));
    else st.sort((a, b) => a.price - b.price);

    if (!st.length) {
      // Drei verschiedene Gruende, drei verschiedene Saetze — vorher hiess es
      // immer „keine Tankstellen gefunden", auch wenn die Preisquelle stockte.
      let grund;
      if (d.stations && d.stations.length) grund = "Keine Tankstelle mit den aktuellen Filtern (Radius / nur offene).";
      else if (d.quelle === "keine-preise") grund = "Die Preisquelle (E-Control) liefert gerade keine Preise — meist rund um 12:00, wenn die Preise umgestellt werden. Gleich nochmal probieren.";
      else if (d.quelle === "quelle-down") grund = "Die Preisquelle (E-Control) antwortet gerade nicht. Später nochmal probieren.";
      else grund = "Keine Tankstellen mit " + d.fuelLabel + " in der Nähe gefunden.";
      setMsg(grund, "warn");
      $("#results").innerHTML = "";
    } else {
      setMsg("");
      // Bezugspunkt ist die naechstgelegene Station NACH den Filtern — wer
      // „nur offene" gesetzt hat, waere ja auch nicht zur geschlossenen gefahren.
      const bezug = st.reduce((b, x) => (x.dist != null && (!b || x.dist < b.dist) ? x : b), null);
      $("#results").innerHTML = st.map(s => {
        const uw = s === bezug ? "nächste Station" : umwegTxt(s, bezug);
        const teile = [s.dist != null ? "📍 " + km(s.dist) : "", uw].filter(Boolean);
        return stationCard(s, s.price === minPrice, teile.join(" · "));
      }).join("");
    }
    const pts = [];
    if (d.center) { L.marker([d.center.lat, d.center.lng], { icon: dot("#2f7bff") }).addTo(layer); pts.push([d.center.lat, d.center.lng]); }
    st.forEach(s => {
      L.marker([s.lat, s.lng], { icon: pin(s.price === minPrice ? "#e8b100" : "#1f9d5c", eur(s.price)) })
        .addTo(layer).bindPopup(`<b>${esc(s.name)}</b><br>${esc(eur(s.price))}`);
      pts.push([s.lat, s.lng]);
    });
    fit(pts);
  }
  const detourTxt = s => {
    if (s.detourMin != null) {
      // Minuten UND echte Kilometer, wenn die Routenabfrage beides lieferte.
      return "↩ Umweg +" + s.detourMin + " min" + (typeof s.detourKm === "number" ? " · " + km(s.detourKm) : "");
    }
    return "↩ Umweg ca. " + km(s.offKm);
  };

  // „lohnt sich der Umweg?" als kurzer Zusatz in der Kartenzeile.
  // bezug = Station, zu der man ohnehin fahren wuerde (naechste bzw. kleinster
  // Umweg). Fuer sie selbst steht dort nur, DASS sie der Bezugspunkt ist.
  const euroKurz = n => (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(2).replace(".", ",") + " €";
  // Unter einem halben Euro ist die Aussage im Rauschen der Schaetzung —
  // dann lieber schweigen, als Genauigkeit vorzutaeuschen.
  const UW_SCHWELLE = 0.5;
  function umwegTxt(st, bezug, extra) {
    if (!window.Umweg || !bezug) return "";
    const r = window.Umweg.netto(st, bezug, Object.assign({}, umwegOpt(), extra || {}));
    if (!r || r.mehrKm <= 0) return "";
    if (Math.abs(r.netto) < UW_SCHWELLE) return "";
    return r.netto >= 0
      ? `<span class="uw good">${euroKurz(r.netto)} gespart</span>`
      : `<span class="uw bad">lohnt nicht: ${euroKurz(r.netto)}</span>`;
  }
  function renderRoute(d) {
    routeData = d;
    let st = d.stations || [];
    const hadStations = st.length;
    if (openOnly()) st = st.filter(s => s.open);
    ensureMap(); layer.clearLayers(); renderQuickRoute();
    if (d.route && d.route.geometry) L.polyline(d.route.geometry, { color: "#2f7bff", weight: 5, opacity: 0.75 }).addTo(layer);
    if (d.from) L.marker([d.from.lat, d.from.lng], { icon: dot("#35d07f") }).addTo(layer).bindPopup("Start");
    if (d.to) L.marker([d.to.lat, d.to.lng], { icon: dot("#ff3b30") }).addTo(layer).bindPopup("Ziel");
    const head = d.route ? `<div class="rinfo">Strecke ${d.route.distanceKm} km · ${d.route.durationMin} min · ${d.checked} Tankstellen am Weg geprüft</div>` : "";
    if (!st.length) {
      setMsg(hadStations ? "Keine offene Tankstelle am Weg — Filter „nur offene“ ist aktiv." : "Keine Tankstelle mit " + d.fuelLabel + " nah genug an der Route (Umweg ≤ " + d.off + " km).", "warn");
      $("#results").innerHTML = head;
    }
    else {
      setMsg("");
      // An der Route zaehlt der Umweg einfach (man faehrt ohnehin vorbei).
      // detourKm sind ECHTE Strassenkilometer aus der Routenabfrage — dann
      // braucht es keinen Luftlinien-Faktor. Nur wenn die fehlen (OSRM hat
      // nicht geantwortet), wird auf offKm mit Faktor zurueckgefallen.
      const echt = st.every(s => typeof s.detourKm === "number");
      const mitDist = s => ({
        price: s.price,
        dist: echt ? s.detourKm : (typeof s.offKm === "number" ? s.offKm : null),
      });
      const uwOpt = { hinUndZurueck: false };
      if (echt) uwOpt.faktor = 1;
      const wert = s => (echt ? s.detourKm : s.offKm);
      const bezugI = st.reduce((b, x, i) => (typeof wert(x) === "number" && (b < 0 || wert(x) < wert(st[b])) ? i : b), -1);
      $("#results").innerHTML = head + st.map((s, i) => {
        const uw = bezugI < 0 ? "" : (i === bezugI ? "kleinster Umweg" : umwegTxt(mitDist(s), mitDist(st[bezugI]), uwOpt));
        return stationCard(s, i === 0, [detourTxt(s), uw].filter(Boolean).join(" · "));
      }).join("");
    }
    const pts = (d.route && d.route.geometry ? d.route.geometry.slice() : []);
    st.forEach((s, i) => {
      L.marker([s.lat, s.lng], { icon: pin(i === 0 ? "#e8b100" : "#1f9d5c", eur(s.price)) })
        .addTo(layer).bindPopup(`<b>${esc(s.name)}</b><br>${esc(eur(s.price))} · ${esc(detourTxt(s))}`);
      pts.push([s.lat, s.lng]);
    });
    fit(pts);
  }
  // ---- Schnellzugriff-Chips (Heim, zuletzt gesucht, Favoriten) ----
  function renderQuickNear() {
    const el = $("#q-near"); if (!el) return;
    const parts = [];
    // Mit Namen: ein versehentlich falscher Heimatort faellt so sofort auf,
    // statt still in jeder „nach hause"-Suche weiterzuwirken.
    const hl = homeLabel();
    parts.push(hl
      ? `<button class="chip home" data-act="home" title="Heimatort — ändern unter ⚙ Optionen">🏠 ${esc(hl)}</button>`
      : `<button class="chip" data-act="sethome">🏠 Heim setzen</button>`);
    jget("sprit_rn", []).forEach((r, i) => parts.push(`<button class="chip" data-act="rn" data-i="${i}">🕘 ${esc(r.label)}</button>`));
    favs().forEach((f, i) => parts.push(`<button class="chip fav" data-act="fav" data-i="${i}">★ ${esc(f.name)}</button>`));
    el.innerHTML = parts.join("");
  }
  function renderQuickRoute() {
    const el = $("#q-route"); if (!el) return;
    el.innerHTML = jget("sprit_rr", []).map((r, i) => `<button class="chip" data-act="rr" data-i="${i}">🕘 ${esc(r.fromLabel)} → ${esc(r.toLabel)}</button>`).join("");
  }
  function fit(pts) {
    if (!pts.length) return;
    try { map.fitBounds(L.latLngBounds(pts).pad(0.15)); } catch (_) {}
    setTimeout(() => map.invalidateSize(), 60);
  }

  // ---- Laden ----
  async function fetchNear(where) {
    lastNear = where;
    // Alte Liste stehen lassen, bis neue Daten sie ersetzen (kein Layout-Sprung/
    // „Aufblitzen" der Karte). Lade-Hinweis nur, wenn noch nichts angezeigt ist.
    if (!$("#results").children.length) setMsg("Suche günstigste Tankstellen…", "load");
    const qs = ("lat" in where) ? `lat=${where.lat}&lng=${where.lng}` : `q=${encodeURIComponent(where.q)}`;
    try {
      const d = await (await fetch(`/api/sprit/near?${qs}&fuel=${fuel}`)).json();
      if (d.error && !d.stations) { setMsg(d.error, "warn"); return; }
      renderNear(d);
      // „zuletzt gesucht" merken (Ortssuche mit Text; Standort ist selbsterklärend)
      if ("q" in where) pushRecentNear({ label: where.q, q: where.q });
      else if (d.center) pushRecentNear({ label: "📍 " + (d.center.label ? shortLabel(d.center.label) : "Mein Standort"), lat: where.lat, lng: where.lng });
      renderQuickNear();
    } catch (_) { setMsg("Abfrage fehlgeschlagen. Nochmal versuchen.", "warn"); }
  }
  async function fetchRoute(from, to, off) {
    if (!$("#results").children.length) setMsg("Route und Preise werden berechnet…", "load");
    const offQ = (typeof off === "number" && off > 0) ? `&off=${off}` : "";
    try {
      const d = await (await fetch(`/api/sprit/route?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&fuel=${fuel}${offQ}`)).json();
      if (d.error && !(d.stations && d.stations.length)) {
        if (d.route) renderRoute(d); else setMsg(d.error, "warn");
        return;
      }
      renderRoute(d);
    } catch (_) { setMsg("Abfrage fehlgeschlagen. Nochmal versuchen.", "warn"); }
  }
  function locate(cb) {
    if (!navigator.geolocation) { setMsg("Standort wird nicht unterstützt.", "warn"); return; }
    setMsg("Standort wird ermittelt…", "load");
    navigator.geolocation.getCurrentPosition(
      p => cb(p.coords.latitude, p.coords.longitude),
      e => setMsg(e && e.code === 1 ? "Standort-Freigabe verweigert." : "Standort nicht ermittelbar.", "warn"),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 });
  }

  // ---- Autocomplete (Adressvorschläge, Photon via /api/sprit/suggest) ----
  const ac = (() => {
    const box = document.createElement("div"); box.id = "ac"; box.hidden = true; document.body.appendChild(box);
    let items = [], sel = -1, curInput = null, curPick = null, t = null, seq = 0;
    const hide = () => { box.hidden = true; items = []; sel = -1; };
    function place(inp) {
      const r = inp.getBoundingClientRect();
      box.style.left = (r.left + scrollX) + "px";
      box.style.top = (r.bottom + scrollY + 4) + "px";
      box.style.width = r.width + "px";
    }
    function render() {
      if (!items.length) { hide(); return; }
      box.innerHTML = items.map((it, i) => `<div class="ac-item${i === sel ? " sel" : ""}" data-i="${i}">${esc(it.label)}</div>`).join("");
      box.hidden = false;
    }
    function choose(i) {
      const it = items[i]; if (!it || !curInput) return;
      curInput.value = it.label; curInput.dataset.lat = it.lat; curInput.dataset.lng = it.lng;
      const cb = curPick; hide(); if (cb) cb(it);
    }
    box.addEventListener("mousedown", e => { const el = e.target.closest(".ac-item"); if (el) { e.preventDefault(); choose(+el.dataset.i); } });
    async function query(inp) {
      const q = inp.value.trim(); place(inp);
      if (q.length < 3) { hide(); return; }
      const my = ++seq;
      try {
        const data = await (await fetch("/api/sprit/suggest?q=" + encodeURIComponent(q))).json();
        if (my !== seq || document.activeElement !== inp) return;
        items = Array.isArray(data) ? data : []; sel = -1; place(inp); render();
      } catch (_) { hide(); }
    }
    function attach(inp, onPick, onEnter) {
      inp.setAttribute("autocomplete", "off");
      inp.addEventListener("input", () => { delete inp.dataset.lat; delete inp.dataset.lng; curInput = inp; curPick = onPick; clearTimeout(t); t = setTimeout(() => query(inp), 220); });
      inp.addEventListener("focus", () => { curInput = inp; curPick = onPick; if (inp.value.trim().length >= 3) query(inp); });
      inp.addEventListener("keydown", e => {
        if (!box.hidden && items.length) {
          if (e.key === "ArrowDown") { e.preventDefault(); sel = (sel + 1) % items.length; render(); return; }
          if (e.key === "ArrowUp") { e.preventDefault(); sel = (sel - 1 + items.length) % items.length; render(); return; }
          if (e.key === "Enter" && sel >= 0) { e.preventDefault(); choose(sel); return; }
          if (e.key === "Escape") { hide(); return; }
        }
        if (e.key === "Enter" && onEnter) { e.preventDefault(); hide(); onEnter(); }
      });
      inp.addEventListener("blur", () => setTimeout(hide, 150));
    }
    addEventListener("resize", hide);
    return { attach, hide };
  })();
  // Wert eines Eingabefelds: gewählte Koordinate (aus Vorschlag) bevorzugt.
  const valOf = el => (el.dataset.lat ? el.dataset.lat + "," + el.dataset.lng : el.value.trim());
  function doNear() {
    const el = $("#near-q");
    if (el.dataset.lat) fetchNear({ lat: +el.dataset.lat, lng: +el.dataset.lng });
    else { const q = el.value.trim(); if (q) fetchNear({ q }); }
  }
  function doRoute() {
    const fromEl = $("#rt-from"), toEl = $("#rt-to");
    const from = valOf(fromEl), to = valOf(toEl);
    if (!from || !to) { setMsg("Bitte Start und Ziel angeben.", "warn"); return; }
    LS.set("sprit_from", fromEl.value); LS.set("sprit_to", toEl.value);
    pushRecentRoute({ fromLabel: fromEl.value, toLabel: toEl.value, from, to }); renderQuickRoute();
    fetchRoute(from, to);
  }

  // ---- UI-Events ----
  // Nur den Reiter umstellen (Anzeige, Panels, Karte leeren). Die
  // Freitext-Suche braucht genau das — ohne das automatische Wiederherstellen
  // unten, sonst lädt sie zweimal.
  function switchTab(m) {
    mode = m; LS.set("sprit_mode", m);
    $("#tab-near").classList.toggle("on", m === "near"); $("#tab-near").setAttribute("aria-selected", String(m === "near"));
    $("#tab-route").classList.toggle("on", m === "route"); $("#tab-route").setAttribute("aria-selected", String(m === "route"));
    $("#panel-near").hidden = m !== "near"; $("#panel-route").hidden = m !== "route";
    // Ansicht (Liste + Karte) auf den gewählten Modus umstellen.
    ac.hide(); setMsg(""); $("#results").innerHTML = "";
    if (m === "near") renderQuickNear(); else renderQuickRoute();
    if (map && layer) layer.clearLayers();
  }
  function setMode(m) {
    switchTab(m);
    if (m === "near") {
      if (nearData) renderNear(nearData);
      else if (lastNear) fetchNear(lastNear);
      else if (map) map.setView([47.7, 14.3], 7);
    } else {
      if (routeData) renderRoute(routeData);
      else if ($("#rt-from").value && $("#rt-to").value) doRoute();
      else if (map) map.setView([47.7, 14.3], 7);
    }
  }
  $("#tab-near").addEventListener("click", () => setMode("near"));
  $("#tab-route").addEventListener("click", () => setMode("route"));

  // Nur Zustand + Anzeige, ohne Abfrage — die Freitext-Suche setzt den
  // Treibstoff und laedt danach GENAU EINMAL selbst.
  function setFuelUI(f) {
    fuel = f; LS.set("sprit_fuel", f);
    document.querySelectorAll(".fuel").forEach(x => {
      const on = x.dataset.fuel === f;
      x.classList.toggle("on", on); x.setAttribute("aria-selected", String(on));
    });
  }
  document.querySelectorAll(".fuel").forEach(b => b.addEventListener("click", () => {
    setFuelUI(b.dataset.fuel);
    // Treibstoff geändert → beide zwischengespeicherten Ergebnisse sind veraltet;
    // aktuellen Modus sofort neu laden, den anderen beim nächsten Umschalten.
    nearData = null; routeData = null;
    if (mode === "near" && lastNear) fetchNear(lastNear);
    if (mode === "route" && $("#rt-from").value && $("#rt-to").value) fetchRoute(valOf($("#rt-from")), valOf($("#rt-to")));
  }));

  $("#loc-btn").addEventListener("click", () => locate((lat, lng) => fetchNear({ lat, lng })));
  $("#near-go").addEventListener("click", doNear);
  ac.attach($("#near-q"), it => fetchNear({ lat: it.lat, lng: it.lng }), doNear);

  $("#rt-from-loc").addEventListener("click", () => locate((lat, lng) => { const el = $("#rt-from"); el.value = "Mein Standort"; el.dataset.lat = lat; el.dataset.lng = lng; setMsg("Start = dein Standort gesetzt.", ""); }));
  $("#rt-go").addEventListener("click", doRoute);
  ac.attach($("#rt-from"), () => {}, null);
  ac.attach($("#rt-to"), () => {}, doRoute);

  // ---- Freitext-Suche ----------------------------------------------------
  // /api/sprit/ask liefert NUR die verstandene Anfrage, nie Preise. Geladen
  // wird danach über denselben Weg wie bei Eingabe von Hand — ein Pfad für
  // Ergebnisse, und das Modell kann keinen Preis anfassen.
  const askEcho = $("#ask-echo");
  function zeigeEcho(text, ki) {
    if (!askEcho) return;
    askEcho.innerHTML = `<span>verstanden: ${esc(text)}${ki ? ' <span class="ask-ki">per KI gedeutet</span>' : ""}</span><button type="button" id="ask-x" aria-label="Ausblenden">✕</button>`;
    askEcho.hidden = false;
    $("#ask-x").addEventListener("click", () => { askEcho.hidden = true; });
  }
  function echoText(v) {
    const t = [];
    if (v.fuel) t.push(FUEL_LABEL[v.fuel] || v.fuel);
    if (v.mode === "route") t.push("Route " + (v.from ? v.from + " → " : "→ ") + v.to);
    else if (v.home) t.push("Umkreis: Heimatort");
    else t.push(v.here ? "Umkreis: mein Standort" : "Umkreis: " + v.q);
    if (v.off) t.push("max " + String(v.off).replace(".", ",") + " km Umweg");
    if (v.radius) t.push("Umkreis " + v.radius + " km");
    if (v.open) t.push("nur offene");
    return t.join(" · ");
  }
  function applyIntent(v) {
    if (v.fuel && v.fuel !== fuel) setFuelUI(v.fuel);
    if (v.open) { LS.set("sprit_open", "1"); $("#opt-open").checked = true; }
    // Zwischengespeicherte Ergebnisse passen nach einer neuen Anfrage nicht mehr.
    nearData = null; routeData = null;

    if (v.mode === "route") {
      const toEl = $("#rt-to"), fromEl = $("#rt-from");
      toEl.value = v.to; delete toEl.dataset.lat; delete toEl.dataset.lng;
      if (v.from) { fromEl.value = v.from; delete fromEl.dataset.lat; delete fromEl.dataset.lng; }
      switchTab("route"); renderQuickRoute();
      const from = valOf(fromEl);
      if (!from) { setMsg("Start fehlt — bitte eintragen oder auf „Start“ tippen.", "warn"); return; }
      LS.set("sprit_from", fromEl.value); LS.set("sprit_to", toEl.value);
      fetchRoute(from, valOf(toEl), v.off);
    } else {
      if (v.radius) { LS.set("sprit_radius", String(v.radius)); $("#opt-radius").value = String(v.radius); }
      switchTab("near"); renderQuickNear();
      if (v.home) {
        const h = home();
        if (h) { fetchNear({ lat: h.lat, lng: h.lng }); return; }
        setMsg("Kein Heimatort gespeichert — unten auf „Heim setzen“ tippen.", "warn");
        return;
      }
      if (v.here) { locate((lat, lng) => fetchNear({ lat, lng })); return; }
      const el = $("#near-q");
      el.value = v.q; delete el.dataset.lat; delete el.dataset.lng;
      fetchNear({ q: v.q });
    }
  }
  // Namen der eigenen Orte — damit das Modell „zur Shell in Stammersdorf"
  // zuordnen kann. Nur Namen, keine Koordinaten: aufloesen tut die App.
  function bekannteOrte() {
    const l = [];
    const hl = homeLabel(); if (hl && !/^\d/.test(hl)) l.push(hl);
    favs().forEach(f => { if (f && f.name) l.push(f.name); });
    jget("sprit_rn", []).forEach(r => { if (r && r.label) l.push(String(r.label).replace(/^📍\s*/, "")); });
    return [...new Set(l)].slice(0, 8);
  }

  // Wer direkt nach einer Deutung von Hand nachbessert, sagt uns damit: falsch
  // verstanden. Genau einmal je Deutung zaehlen, nicht bei jedem Tastendruck.
  let deutungAb = 0, korrekturGemeldet = false;
  function meldeKorrektur() {
    if (!deutungAb || korrekturGemeldet) return;
    if (Date.now() - deutungAb > 90000) return;
    korrekturGemeldet = true;
    try {
      navigator.sendBeacon("/api/stat", new Blob(
        [JSON.stringify({ ev: "ask", game: "korrigiert" })], { type: "application/json" }));
    } catch (_) {}
  }
  ["#near-q", "#rt-from", "#rt-to", "#opt-radius", "#opt-open"].forEach(sel => {
    const el = $(sel); if (el) el.addEventListener("change", meldeKorrektur);
  });
  document.querySelectorAll(".fuel").forEach(b => b.addEventListener("click", meldeKorrektur));

  const BEISPIELE = ["billig diesel richtung graz", "super in der nähe", "nur offene in linz"];
  function renderBeispiele() {
    const el = $("#ask-bsp"); if (!el) return;
    if (LS.get("sprit_ask_benutzt", "") === "1") { el.hidden = true; return; }
    el.innerHTML = BEISPIELE.map(b => `<button type="button" class="chip" data-b="${esc(b)}">${esc(b)}</button>`).join("");
    el.hidden = false;
  }
  $("#ask-bsp").addEventListener("click", e => {
    const b = e.target.closest("button[data-b]"); if (!b) return;
    $("#ask-q").value = b.dataset.b;
    $("#ask-form").dispatchEvent(new Event("submit", { cancelable: true }));
  });
  renderBeispiele();

  $("#ask-form").addEventListener("submit", async e => {
    e.preventDefault();
    const q = $("#ask-q").value.trim();
    if (q.length < 2) return;
    ac.hide();
    LS.set("sprit_ask_benutzt", "1"); renderBeispiele();
    setMsg("Frage wird verstanden…", "load");
    let d = null;
    try {
      d = await (await fetch("/api/sprit/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q, orte: bekannteOrte() }),
      })).json();
    } catch (_) {}
    if (!d || !d.mode) {
      // Nicht verstanden, Modell aus oder Kontingent leer: die App bleibt
      // vollständig bedienbar, nur eben über die Felder darunter.
      setMsg("Nicht verstanden — bitte die Felder darunter nutzen.", "warn");
      if (askEcho) askEcho.hidden = true;
      $("#opts").open = false;
      return;
    }
    deutungAb = Date.now(); korrekturGemeldet = false;
    zeigeEcho(echoText(d), d.via === "ki");
    applyIntent(d);
  });

  // Aktionen in den Ergebniskarten: Favorit-Stern + Teilen
  $("#results").addEventListener("click", e => {
    const b = e.target.closest(".fav");
    if (b) {
      toggleFav({ id: b.dataset.id, name: b.dataset.name, lat: +b.dataset.lat, lng: +b.dataset.lng, addr: b.dataset.addr });
      b.classList.toggle("on"); renderQuickNear(); return;
    }
    const sh = e.target.closest(".share");
    if (sh) { shareStation(sh.dataset); return; }
    const al = e.target.closest(".alarm");
    if (al) openAlarm({ id: al.dataset.id, name: al.dataset.name, lat: +al.dataset.lat, lng: +al.dataset.lng, price: +al.dataset.price });
  });
  const FUEL_LABEL = { DIE: "Diesel", SUP: "Super 95", GAS: "CNG" };
  function flashMsg(t) { setMsg(t, "load"); setTimeout(() => { if ($("#msg").textContent === t) setMsg(""); }, 2500); }
  async function shareStation(d) {
    const line = "⛽ " + (FUEL_LABEL[fuel] || "Sprit") + " " + d.price + " — " + d.name + (d.addr ? ", " + d.addr : "");
    const url = navUrl(+d.lat, +d.lng);
    try { if (navigator.share) { await navigator.share({ title: "Sprit-Radar", text: line, url }); return; } } catch (_) { return; }
    try { await navigator.clipboard.writeText(line + "\n" + url); flashMsg("Kopiert — zum Teilen einfügen."); }
    catch (_) { window.open("https://wa.me/?text=" + encodeURIComponent(line + "\n" + url), "_blank", "noopener"); }
  }

  // ---- Heimatort: setzen, sehen, aendern, loeschen ----------------------
  // Vorher eine Einbahnstrasse: war er einmal gesetzt, verschwand der Knopf
  // „Heim setzen" und es gab keinen Weg zurueck — ein Vertipper war endgueltig.
  // Gespeichert wird jetzt auch der NAME, sonst sieht man gar nicht, welche
  // Adresse drinsteht.
  function homeLabel() {
    const h = home();
    if (!h) return null;
    if (h.label) return h.label;
    // Aeltere Eintraege haben nur Koordinaten — dann wenigstens die zeigen.
    return (typeof h.lat === "number" && typeof h.lng === "number")
      ? h.lat.toFixed(4) + ", " + h.lng.toFixed(4) : null;
  }
  function renderHome() {
    const el = $("#home-txt"); if (!el) return;
    const l = homeLabel();
    el.textContent = l || "noch nicht gesetzt";
    const clr = $("#home-clear"); if (clr) clr.disabled = !l;
  }
  function saveHome(lat, lng, label) {
    jset("sprit_home", { lat, lng, label: label || "" });
    renderHome(); renderQuickNear();
    setMsg("Heimatort gespeichert: " + (label || "aktueller Standort"), "");
  }
  // „Aktueller Ort" = Mittelpunkt der letzten Umkreis-Suche, sonst GPS.
  function setHome() {
    const c = nearData && nearData.center;
    if (c) { saveHome(c.lat, c.lng, shortLabel(c.label || "") || ($("#near-q").value.trim() || "")); return; }
    locate((lat, lng) => { saveHome(lat, lng, "Mein Standort"); fetchNear({ lat, lng }); });
  }
  if ($("#home-set")) $("#home-set").addEventListener("click", setHome);
  if ($("#home-clear")) $("#home-clear").addEventListener("click", () => {
    try { localStorage.removeItem("sprit_home"); } catch (_) {}
    renderHome(); renderQuickNear();
    setMsg("Heimatort gelöscht.", "");
  });
  renderHome();

  // Schnellzugriff-Chips (Umkreis)
  $("#q-near").addEventListener("click", e => {
    const b = e.target.closest(".chip"); if (!b) return;
    const act = b.dataset.act;
    if (act === "home") { const h = home(); if (h) fetchNear({ lat: h.lat, lng: h.lng }); }
    else if (act === "sethome") setHome();
    else if (act === "rn") { const r = jget("sprit_rn", [])[+b.dataset.i]; if (r) fetchNear(r.lat != null ? { lat: r.lat, lng: r.lng } : { q: r.q || r.label }); }
    else if (act === "fav") { const f = favs()[+b.dataset.i]; if (f) fetchNear({ lat: f.lat, lng: f.lng }); }
  });
  // Schnellzugriff-Chips (Route)
  $("#q-route").addEventListener("click", e => {
    const b = e.target.closest(".chip"); if (!b) return;
    const r = jget("sprit_rr", [])[+b.dataset.i]; if (!r) return;
    const set = (el, label, val) => { el.value = label; const m = /^(-?\d+\.\d+),(-?\d+\.\d+)$/.exec(val || ""); if (m) { el.dataset.lat = m[1]; el.dataset.lng = m[2]; } else { delete el.dataset.lat; delete el.dataset.lng; } };
    set($("#rt-from"), r.fromLabel, r.from); set($("#rt-to"), r.toLabel, r.to);
    doRoute();
  });

  // Optionen (Tankfüllung, Radius, Sortierung)
  function rerender() { if (mode === "near" && nearData) renderNear(nearData); else if (mode === "route" && routeData) renderRoute(routeData); }
  $("#opt-radius").value = LS.get("sprit_radius", "0");
  $("#opt-sort").value = LS.get("sprit_sort", "price");
  $("#opt-open").checked = openOnly();
  $("#opt-radius").addEventListener("change", e => { LS.set("sprit_radius", e.target.value); rerender(); });
  $("#opt-sort").addEventListener("change", e => { LS.set("sprit_sort", e.target.value); rerender(); });
  $("#opt-open").addEventListener("change", e => { LS.set("sprit_open", e.target.checked ? "1" : "0"); rerender(); });
  // Tankmenge/Verbrauch ändern nur die Umweg-Rechnung — neu zeichnen genügt,
  // keine neue Abfrage.
  $("#opt-liter").value = LS.get("sprit_liter", String(VG.liter));
  $("#opt-verbrauch").value = LS.get("sprit_verbrauch", String(VG.verbrauch));
  $("#opt-liter").addEventListener("change", e => {
    const v = Math.min(120, Math.max(5, +e.target.value || VG.liter));
    e.target.value = v; LS.set("sprit_liter", String(v)); rerender();
  });
  $("#opt-verbrauch").addEventListener("change", e => {
    const v = Math.min(30, Math.max(2, +String(e.target.value).replace(",", ".") || VG.verbrauch));
    e.target.value = v; LS.set("sprit_verbrauch", String(v)); rerender();
  });

  // Tank-Timing: In Österreich dürfen Spritpreise nur um 12:00 steigen, sonst
  // nur fallen → tageszeitabhängige Empfehlung (lokale Uhrzeit).
  function timingAdvice() {
    const h = new Date().getHours();
    if (h < 11) return { cls: "good", t: "⏰ Gute Zeit zum Tanken – bis 12:00 dürfen die Preise nur fallen." };
    if (h < 12) return { cls: "good", t: "⏰ Kurz vor 12:00 ist es oft am günstigsten – jetzt tanken, ab Mittag darf der Preis steigen." };
    if (h < 17) return { cls: "warn", t: "⏰ Rund um Mittag steigen die Preise oft – im Lauf des Nachmittags/Abends fallen sie meist wieder." };
    return { cls: "good", t: "⏰ Abends ist es häufig günstig – bis morgen 12:00 dürfen die Preise nur fallen." };
  }
  function showTip() {
    const el = $("#tip"); if (!el) return;
    if (LS.get("sprit_tip2", "") === "x") { el.hidden = true; return; }
    const a = timingAdvice();
    el.className = "tip " + a.cls;
    el.innerHTML = `<span class="tip-t"><b>${esc(a.t)}</b><br><span class="tip-sub">In Österreich dürfen Spritpreise nur um 12:00 Uhr steigen, sonst nur fallen.</span></span><button id="tip-x" class="tip-x" aria-label="Ausblenden">✕</button>`;
    el.hidden = false;
    $("#tip-x").addEventListener("click", () => { LS.set("sprit_tip2", "x"); el.hidden = true; });
  }

  // ================= Preis-Alarm (Push) =================
  let alertIds = new Set();      // "stationId|fuel" mit aktivem Alarm (für 🔔-Status)
  let alarmCtx = null;           // aktueller Stations-Kontext im Formular
  const isAlerted = id => alertIds.has(id + "|" + fuel);

  function b64ToU8(k) {
    const pad = "=".repeat((4 - k.length % 4) % 4);
    const s = (k + pad).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(s); const u = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) u[i] = raw.charCodeAt(i);
    return u;
  }
  async function ensureSub(create) {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub && create) {
      const key = (await (await fetch("/api/push")).json()).key;
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) });
    }
    return sub;
  }
  const alertApi = body => fetch("/api/sprit/alert", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json());
  function setAlStatus(msg, kind) {
    const el = $("#al-status"); if (!el) return;
    if (!msg) { el.hidden = true; return; }
    el.className = "msg" + (kind ? " " + kind : ""); el.textContent = msg; el.hidden = false;
  }
  // Mini-Preisverlauf (fallend = grün, steigend = rot) aus den Tages-Tiefstpreisen.
  function sparkline(vals) {
    if (!Array.isArray(vals) || vals.length < 2) return "";
    const w = 88, h = 26, min = Math.min(...vals), max = Math.max(...vals), rng = (max - min) || 1;
    const pts = vals.map((v, i) => `${(i / (vals.length - 1) * (w - 4) + 2).toFixed(1)},${(h - 3 - (v - min) / rng * (h - 6)).toFixed(1)}`).join(" ");
    const col = vals[vals.length - 1] <= vals[0] ? "var(--accent2)" : "var(--danger)";
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${col}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }
  function renderAlarmList(list) {
    const el = $("#al-list"); if (!el) return;
    if (!list.length) { el.innerHTML = `<div class="al-empty">Noch keine Alarme. Tippe bei einer Tankstelle auf 🔔.</div>`; return; }
    el.innerHTML = list.map(a => {
      const last = a.hist && a.hist.length ? " · zuletzt " + eur(a.hist[a.hist.length - 1]) : "";
      return `<div class="al-item"><div class="al-i-txt"><b>${esc(a.name || "Tankstelle")}</b><span>${esc(FUEL_LABEL[a.fuel] || a.fuel)} · ≤ ${esc(eur(a.target))}${esc(last)}</span></div>` +
        sparkline(a.hist) +
        `<button class="al-del" data-id="${esc(a.id)}" data-fuel="${esc(a.fuel)}" aria-label="Entfernen">✕</button></div>`;
    }).join("");
  }
  function renderAlarmFavs() {
    const wrap = $("#al-favs-wrap"), el = $("#al-favs"); if (!wrap || !el) return;
    const l = favs();
    if (!l.length) { wrap.hidden = true; return; }
    wrap.hidden = false;
    el.innerHTML = l.map(f => `<button class="al-fav-btn" data-id="${esc(f.id)}" data-name="${esc(f.name)}" data-lat="${f.lat}" data-lng="${f.lng}">★ ${esc(f.name)}</button>`).join("");
  }
  function fillAddForm(ctx) {
    const add = $("#al-add");
    if (!ctx) { add.hidden = true; return; }
    add.hidden = false;
    $("#al-name").textContent = ctx.name || "Tankstelle";
    $("#al-fuel").textContent = FUEL_LABEL[fuel] || fuel;
    const inp = $("#al-target");
    if (ctx.price) { inp.value = Math.max(0.5, ctx.price - 0.01).toFixed(3); inp.placeholder = ""; }
    else { inp.value = ""; inp.placeholder = "z. B. 1,499"; }
  }
  async function refreshAlerts() {
    try {
      const sub = await ensureSub(false);
      if (!sub) { alertIds = new Set(); renderAlarmList([]); return; }
      const d = await alertApi({ action: "list", endpoint: sub.endpoint });
      const list = Array.isArray(d.alerts) ? d.alerts : [];
      alertIds = new Set(list.map(a => a.id + "|" + a.fuel));
      renderAlarmList(list);
    } catch (_) { renderAlarmList([]); }
  }
  function openAlarm(ctx) {
    alarmCtx = ctx || null;
    $("#alarm").hidden = false; document.body.style.overflow = "hidden";
    setAlStatus("", "");
    fillAddForm(alarmCtx);
    renderAlarmFavs();
    refreshAlerts();
  }
  function closeAlarm() { $("#alarm").hidden = true; document.body.style.overflow = ""; }
  async function saveAlarm() {
    if (!alarmCtx) return;
    const target = Math.round(parseFloat(String($("#al-target").value).replace(",", ".").trim()) * 1000) / 1000;
    if (!(target >= 0.5 && target <= 5)) { setAlStatus("Bitte einen Zielpreis zwischen 0,50 und 5,00 € eingeben.", "warn"); return; }
    setAlStatus("Wird eingerichtet…", "load");
    try {
      if (!("Notification" in window)) { setAlStatus("Dieser Browser unterstützt keine Benachrichtigungen.", "warn"); return; }
      if (Notification.permission !== "granted") {
        const p = await Notification.requestPermission();
        if (p !== "granted") { setAlStatus("Benachrichtigungen wurden nicht erlaubt.", "warn"); return; }
      }
      const sub = await ensureSub(true);
      if (!sub) { setAlStatus("Push wird hier nicht unterstützt.", "warn"); return; }
      const d = await alertApi({ action: "subscribe", subscription: sub.toJSON(), station: { id: alarmCtx.id, name: alarmCtx.name, lat: alarmCtx.lat, lng: alarmCtx.lng }, fuel, target });
      if (d.error) { setAlStatus(d.error, "warn"); return; }
      setAlStatus("Alarm aktiv — Meldung, sobald " + (FUEL_LABEL[fuel] || fuel) + " ≤ " + eur(target) + ".", "load");
      alarmCtx = null; $("#al-add").hidden = true;
      await refreshAlerts(); rerender();
    } catch (_) { setAlStatus("Konnte nicht aktivieren — später erneut versuchen.", "warn"); }
  }
  async function removeAlarm(id, f) {
    try { const sub = await ensureSub(false); if (sub) await alertApi({ action: "remove", endpoint: sub.endpoint, id, fuel: f }); } catch (_) {}
    await refreshAlerts(); rerender();
  }
  $("#alarm-btn").addEventListener("click", () => openAlarm(null));
  $("#al-close").addEventListener("click", closeAlarm);
  $("#alarm").addEventListener("click", e => { if (e.target.id === "alarm") closeAlarm(); });
  $("#al-save").addEventListener("click", saveAlarm);
  $("#al-list").addEventListener("click", e => { const b = e.target.closest(".al-del"); if (b) removeAlarm(b.dataset.id, b.dataset.fuel); });
  $("#al-favs").addEventListener("click", e => {
    const b = e.target.closest(".al-fav-btn"); if (!b) return;
    alarmCtx = { id: b.dataset.id, name: b.dataset.name, lat: +b.dataset.lat, lng: +b.dataset.lng };
    setAlStatus("", ""); fillAddForm(alarmCtx);
    $("#al-add").scrollIntoView({ block: "nearest" });
  });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#alarm").hidden) closeAlarm(); });

  // ---- Start ----
  applyThemeUI();
  document.querySelectorAll(".fuel").forEach(b => { const on = b.dataset.fuel === fuel; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); });
  $("#rt-from").value = LS.get("sprit_from", ""); $("#rt-to").value = LS.get("sprit_to", "");
  showTip(); renderQuickNear(); renderQuickRoute();
  setMode(mode);
  ensureMap();
  // Im Umkreis-Modus direkt den aktuellen Standort laden (wie Button-Druck).
  if (mode === "near" && !nearData) locate((lat, lng) => fetchNear({ lat, lng }));
  // Bestehende Alarme laden → 🔔-Status auf den Karten (best-effort).
  refreshAlerts().then(rerender).catch(() => {});
})();
