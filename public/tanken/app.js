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

  // ---- UI-Events ----
  function setMode(m) {
    mode = m; LS.set("sprit_mode", m);
    $("#tab-near").classList.toggle("on", m === "near"); $("#tab-near").setAttribute("aria-selected", String(m === "near"));
    $("#tab-route").classList.toggle("on", m === "route"); $("#tab-route").setAttribute("aria-selected", String(m === "route"));
    $("#panel-near").hidden = m !== "near"; $("#panel-route").hidden = m !== "route";
  }
  $("#tab-near").addEventListener("click", () => setMode("near"));
  $("#tab-route").addEventListener("click", () => setMode("route"));

  document.querySelectorAll(".fuel").forEach(b => b.addEventListener("click", () => {
    fuel = b.dataset.fuel; LS.set("sprit_fuel", fuel);
    document.querySelectorAll(".fuel").forEach(x => { const on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-selected", String(on)); });
    // Aktuelle Ansicht mit neuem Treibstoff neu laden
    if (mode === "near" && lastNear) fetchNear(lastNear);
    if (mode === "route" && $("#rt-from").value && $("#rt-to").value) fetchRoute($("#rt-from").value.trim(), $("#rt-to").value.trim());
  }));

  $("#loc-btn").addEventListener("click", () => locate((lat, lng) => fetchNear({ lat, lng })));
  $("#near-go").addEventListener("click", () => { const q = $("#near-q").value.trim(); if (q) fetchNear({ q }); });
  $("#near-q").addEventListener("keydown", e => { if (e.key === "Enter") { const q = e.target.value.trim(); if (q) fetchNear({ q }); } });

  $("#rt-from-loc").addEventListener("click", () => locate((lat, lng) => { $("#rt-from").value = lat.toFixed(5) + "," + lng.toFixed(5); setMsg("Start = dein Standort gesetzt.", ""); }));
  $("#rt-go").addEventListener("click", () => {
    const from = $("#rt-from").value.trim(), to = $("#rt-to").value.trim();
    if (!from || !to) { setMsg("Bitte Start und Ziel angeben.", "warn"); return; }
    LS.set("sprit_from", from); LS.set("sprit_to", to);
    fetchRoute(from, to);
  });
  $("#rt-to").addEventListener("keydown", e => { if (e.key === "Enter") $("#rt-go").click(); });

  // ---- Start ----
  applyThemeUI();
  document.querySelectorAll(".fuel").forEach(b => { const on = b.dataset.fuel === fuel; b.classList.toggle("on", on); b.setAttribute("aria-selected", String(on)); });
  setMode(mode);
  $("#rt-from").value = LS.get("sprit_from", ""); $("#rt-to").value = LS.get("sprit_to", "");
  ensureMap();
})();
