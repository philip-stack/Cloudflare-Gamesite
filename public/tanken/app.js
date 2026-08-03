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
  let curAvg = null;     // Durchschnittspreis der aktuellen Ansicht (für Ersparnis)
  let map = null, layer = null;

  // ---- Einstellungen / gespeicherte Listen (localStorage) ----
  const liters = () => Math.max(1, Math.min(200, parseInt(LS.get("sprit_liters", "50"), 10) || 50));
  const jget = (k, d) => { try { const v = JSON.parse(LS.get(k, "")); return v == null ? d : v; } catch (_) { return d; } };
  const jset = (k, v) => LS.set(k, JSON.stringify(v));
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
    const oh = s.open ? `<span class="oh open">${s.till ? "offen bis " + esc(s.till) : "offen"}</span>` : `<span class="oh closed">geschlossen</span>`;
    const meta = [extra, oh].filter(Boolean).join(" · ");
    let save = "";
    if (curAvg && s.price < curAvg) {
      const cpl = Math.round((curAvg - s.price) * 100);
      const e = (curAvg - s.price) * liters();
      if (cpl >= 1) save = `<div class="save">−${cpl} ¢/l · ~${e.toFixed(2).replace(".", ",")} € / Tankfüllung</div>`;
    }
    const fav = isFav(s.id);
    return `<div class="card${best ? " top" : ""}">
      <div class="price">${esc(eur(s.price))}</div>
      <div class="mid">
        <div class="name">${esc(s.name)}${best ? ' <span class="tag best">günstigste</span>' : ""}</div>
        <div class="addr">${esc(addr)}</div>
        <div class="meta">${meta}</div>
        ${save}
      </div>
      <div class="actions">
        <button class="fav${fav ? " on" : ""}" title="Favorit" aria-label="Favorit"
          data-id="${esc(s.id)}" data-name="${esc(s.name)}" data-lat="${s.lat}" data-lng="${s.lng}" data-addr="${esc(addr)}">★</button>
        <a class="nav" href="${navUrl(s.lat, s.lng)}" target="_blank" rel="noopener">Navi ▸</a>
      </div>
    </div>`;
  }
  const shortLabel = l => String(l || "").split(",").slice(0, 2).join(",").trim();
  function renderNear(d) {
    nearData = d; curAvg = d.avgPrice || null;
    ensureMap(); layer.clearLayers(); renderQuickNear();
    let st = (d.stations || []).slice();
    const radius = +LS.get("sprit_radius", "0");
    if (radius) st = st.filter(s => s.dist == null || s.dist <= radius);
    const minPrice = st.reduce((m, s) => Math.min(m, s.price), Infinity);
    if (LS.get("sprit_sort", "price") === "dist") st.sort((a, b) => (a.dist == null ? 1e9 : a.dist) - (b.dist == null ? 1e9 : b.dist));
    else st.sort((a, b) => a.price - b.price);

    if (!st.length) {
      setMsg((d.stations && d.stations.length) ? "Keine Tankstelle im gewählten Radius." : "Keine Tankstellen mit " + d.fuelLabel + " in der Nähe gefunden.", "warn");
      $("#results").innerHTML = "";
    } else {
      setMsg("");
      $("#results").innerHTML = st.map(s => stationCard(s, s.price === minPrice, s.dist != null ? "📍 " + km(s.dist) : "")).join("");
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
  const detourTxt = s => (s.detourMin != null ? "↩ Umweg +" + s.detourMin + " min" : "↩ Umweg ca. " + km(s.offKm));
  function renderRoute(d) {
    routeData = d; curAvg = d.avgPrice || null;
    const st = d.stations || [];
    ensureMap(); layer.clearLayers(); renderQuickRoute();
    if (d.route && d.route.geometry) L.polyline(d.route.geometry, { color: "#2f7bff", weight: 5, opacity: 0.75 }).addTo(layer);
    if (d.from) L.marker([d.from.lat, d.from.lng], { icon: dot("#35d07f") }).addTo(layer).bindPopup("Start");
    if (d.to) L.marker([d.to.lat, d.to.lng], { icon: dot("#ff3b30") }).addTo(layer).bindPopup("Ziel");
    const head = d.route ? `<div class="rinfo">Strecke ${d.route.distanceKm} km · ${d.route.durationMin} min · ${d.checked} Tankstellen am Weg geprüft</div>` : "";
    if (!st.length) { setMsg("Keine Tankstelle mit " + d.fuelLabel + " nah genug an der Route (Umweg ≤ " + d.off + " km).", "warn"); $("#results").innerHTML = head; }
    else {
      setMsg("");
      $("#results").innerHTML = head + st.map((s, i) => stationCard(s, i === 0, detourTxt(s))).join("");
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
    parts.push(home() ? `<button class="chip home" data-act="home">🏠 Heim</button>` : `<button class="chip" data-act="sethome">🏠 Heim setzen</button>`);
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
  async function fetchRoute(from, to) {
    if (!$("#results").children.length) setMsg("Route und Preise werden berechnet…", "load");
    try {
      const d = await (await fetch(`/api/sprit/route?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&fuel=${fuel}`)).json();
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
  function setMode(m) {
    mode = m; LS.set("sprit_mode", m);
    $("#tab-near").classList.toggle("on", m === "near"); $("#tab-near").setAttribute("aria-selected", String(m === "near"));
    $("#tab-route").classList.toggle("on", m === "route"); $("#tab-route").setAttribute("aria-selected", String(m === "route"));
    $("#panel-near").hidden = m !== "near"; $("#panel-route").hidden = m !== "route";
    // Ansicht (Liste + Karte) auf den gewählten Modus umstellen.
    ac.hide(); setMsg(""); $("#results").innerHTML = "";
    if (m === "near") renderQuickNear(); else renderQuickRoute();
    if (map && layer) layer.clearLayers();
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

  document.querySelectorAll(".fuel").forEach(b => b.addEventListener("click", () => {
    fuel = b.dataset.fuel; LS.set("sprit_fuel", fuel);
    document.querySelectorAll(".fuel").forEach(x => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-selected", String(on)); });
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

  // Favoriten-Stern in den Ergebniskarten
  $("#results").addEventListener("click", e => {
    const b = e.target.closest(".fav"); if (!b) return;
    toggleFav({ id: b.dataset.id, name: b.dataset.name, lat: +b.dataset.lat, lng: +b.dataset.lng, addr: b.dataset.addr });
    b.classList.toggle("on"); renderQuickNear();
  });

  // Schnellzugriff-Chips (Umkreis)
  $("#q-near").addEventListener("click", e => {
    const b = e.target.closest(".chip"); if (!b) return;
    const act = b.dataset.act;
    if (act === "home") { const h = home(); if (h) fetchNear({ lat: h.lat, lng: h.lng }); }
    else if (act === "sethome") {
      const c = nearData && nearData.center;
      if (c) { jset("sprit_home", { lat: c.lat, lng: c.lng }); renderQuickNear(); setMsg("Heimatort gespeichert.", ""); }
      else locate((lat, lng) => { jset("sprit_home", { lat, lng }); renderQuickNear(); fetchNear({ lat, lng }); });
    }
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
  $("#opt-liters").value = liters();
  $("#opt-radius").value = LS.get("sprit_radius", "0");
  $("#opt-sort").value = LS.get("sprit_sort", "price");
  $("#opt-liters").addEventListener("change", e => { LS.set("sprit_liters", String(Math.max(1, Math.min(200, parseInt(e.target.value, 10) || 50)))); e.target.value = liters(); rerender(); });
  $("#opt-radius").addEventListener("change", e => { LS.set("sprit_radius", e.target.value); rerender(); });
  $("#opt-sort").addEventListener("change", e => { LS.set("sprit_sort", e.target.value); rerender(); });

  // Spar-Tipp (einmalig ausblendbar)
  function showTip() {
    const el = $("#tip"); if (!el) return;
    if (LS.get("sprit_tip", "") === "x") { el.hidden = true; return; }
    el.innerHTML = `💡 In Österreich dürfen Spritpreise nur um <b>12:00</b> steigen, sonst nur fallen – vormittags tanken ist meist günstiger. <button id="tip-x" class="tip-x" aria-label="Ausblenden">✕</button>`;
    el.hidden = false;
    $("#tip-x").addEventListener("click", () => { LS.set("sprit_tip", "x"); el.hidden = true; });
  }

  // ---- Start ----
  applyThemeUI();
  document.querySelectorAll(".fuel").forEach(b => { const on = b.dataset.fuel === fuel; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); });
  $("#rt-from").value = LS.get("sprit_from", ""); $("#rt-to").value = LS.get("sprit_to", "");
  showTip(); renderQuickNear(); renderQuickRoute();
  setMode(mode);
  ensureMap();
  // Im Umkreis-Modus direkt den aktuellen Standort laden (wie Button-Druck).
  if (mode === "near" && !nearData) locate((lat, lng) => fetchNear({ lat, lng }));
})();
