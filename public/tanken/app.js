"use strict";
(function () {
  const $ = s => document.querySelector(s);
  const LS = {
    get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} },
  };
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  let fuel = LS.get("sprit_fuel", "DIE") === "SUP" ? "SUP" : "DIE";
  let mode = LS.get("sprit_mode", "near") === "route" ? "route" : "near";
  let lastNear = null;   // {lat,lng} | {q}
  let nearData = null, routeData = null;   // letztes Ergebnis je Modus (für Umschalten)
  let map = null, layer = null;

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
  function stationCard(s, i, extra) {
    const badge = s.open ? "" : `<span class="tag closed">geschlossen</span>`;
    const best = i === 0 ? `<span class="tag best">günstigste</span>` : "";
    return `<div class="card${i === 0 ? " top" : ""}">
      <div class="price">${esc(eur(s.price))}</div>
      <div class="mid">
        <div class="name">${esc(s.name)} ${best}${badge}</div>
        <div class="addr">${esc([s.addr, (s.plz + " " + s.city).trim()].filter(Boolean).join(", "))}</div>
        <div class="meta">${extra || ""}</div>
      </div>
      <a class="nav" href="${navUrl(s.lat, s.lng)}" target="_blank" rel="noopener">Navi ▸</a>
    </div>`;
  }
  function renderNear(d) {
    nearData = d;
    const st = d.stations || [];
    ensureMap(); layer.clearLayers();
    if (!st.length) { setMsg("Keine Tankstellen mit " + d.fuelLabel + " in der Nähe gefunden.", "warn"); $("#results").innerHTML = ""; return; }
    setMsg("");
    $("#results").innerHTML = st.map((s, i) => stationCard(s, i, s.dist != null ? "📍 " + km(s.dist) + " entfernt" : "")).join("");
    const pts = [];
    if (d.center) { L.marker([d.center.lat, d.center.lng], { icon: dot("#2f7bff") }).addTo(layer); pts.push([d.center.lat, d.center.lng]); }
    st.forEach((s, i) => {
      L.marker([s.lat, s.lng], { icon: pin(i === 0 ? "#e8b100" : "#1f9d5c", eur(s.price)) })
        .addTo(layer).bindPopup(`<b>${esc(s.name)}</b><br>${esc(eur(s.price))}`);
      pts.push([s.lat, s.lng]);
    });
    fit(pts);
  }
  function renderRoute(d) {
    routeData = d;
    const st = d.stations || [];
    ensureMap(); layer.clearLayers();
    if (d.route && d.route.geometry) L.polyline(d.route.geometry, { color: "#2f7bff", weight: 5, opacity: 0.75 }).addTo(layer);
    if (d.from) L.marker([d.from.lat, d.from.lng], { icon: dot("#35d07f") }).addTo(layer).bindPopup("Start");
    if (d.to) L.marker([d.to.lat, d.to.lng], { icon: dot("#ff3b30") }).addTo(layer).bindPopup("Ziel");
    const head = d.route ? `<div class="rinfo">Strecke ${d.route.distanceKm} km · ${d.route.durationMin} min · ${d.checked} Tankstellen am Weg geprüft</div>` : "";
    if (!st.length) { setMsg("Keine Tankstelle mit " + d.fuelLabel + " nah genug an der Route (Umweg ≤ " + d.off + " km).", "warn"); $("#results").innerHTML = head; }
    else {
      setMsg("");
      $("#results").innerHTML = head + st.map((s, i) => stationCard(s, i, "↩ Umweg ca. " + km(s.offKm))).join("");
    }
    const pts = (d.route && d.route.geometry ? d.route.geometry.slice() : []);
    st.forEach((s, i) => {
      L.marker([s.lat, s.lng], { icon: pin(i === 0 ? "#e8b100" : "#1f9d5c", eur(s.price)) })
        .addTo(layer).bindPopup(`<b>${esc(s.name)}</b><br>${esc(eur(s.price))} · Umweg ca. ${esc(km(s.offKm))}`);
      pts.push([s.lat, s.lng]);
    });
    fit(pts);
  }
  function fit(pts) {
    if (!pts.length) return;
    try { map.fitBounds(L.latLngBounds(pts).pad(0.15)); } catch (_) {}
    setTimeout(() => map.invalidateSize(), 60);
  }

  // ---- Laden ----
  async function fetchNear(where) {
    lastNear = where;
    setMsg("Suche günstigste Tankstellen…", "load"); $("#results").innerHTML = "";
    const qs = ("lat" in where) ? `lat=${where.lat}&lng=${where.lng}` : `q=${encodeURIComponent(where.q)}`;
    try {
      const d = await (await fetch(`/api/sprit/near?${qs}&fuel=${fuel}`)).json();
      if (d.error && !d.stations) { setMsg(d.error, "warn"); return; }
      renderNear(d);
    } catch (_) { setMsg("Abfrage fehlgeschlagen. Nochmal versuchen.", "warn"); }
  }
  async function fetchRoute(from, to) {
    setMsg("Route und Preise werden berechnet…", "load"); $("#results").innerHTML = "";
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

  // ---- Start ----
  applyThemeUI();
  document.querySelectorAll(".fuel").forEach(b => { const on = b.dataset.fuel === fuel; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); });
  setMode(mode);
  $("#rt-from").value = LS.get("sprit_from", ""); $("#rt-to").value = LS.get("sprit_to", "");
  ensureMap();
})();
