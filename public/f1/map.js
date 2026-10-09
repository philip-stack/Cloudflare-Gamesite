// ====================================================================
// Rennticker — Reiter „Karte“: die Autos als Punkte auf der Strecke.
//  · Streckenverlauf: eine schnelle Runde aus OpenF1 /location (Nachschau)
//    und lokal je Strecke gemerkt (f1_track_<circuit>); live ohne gemerkten
//    Verlauf wächst er aus den Positionen der Autos mit.
//  · Positionen: Nachschau = OpenF1 /location zum Frame-Zeitpunkt,
//    live = Position.z aus dem F1-Feed (über /api/f1-live, alle 3 s).
// Koordinaten wie im F1-Feed (1/10 m), y zeigt nach oben → im SVG gespiegelt.
// ====================================================================
(function () {
  "use strict";
  const { S, $, esc, store, get } = window.RT;
  RT.view("map", { title: "Karte" });
  const iso = ms => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
  let track = null;        // { circuit, pts: [[x,y]…], kind: "line"|"dots" }
  let trackLoading = "";
  const posCache = new Map();   // "<key>|<frame>" → { n: [x,y] }
  let posRun = 0, posTimer = null;
  let liveDots = new Map();     // Raster-Zelle → [x,y] (Live-Aufbau des Verlaufs)

  const trackKey = c => "f1_track_" + c;
  function loadStored(circuit) {
    try { const t = JSON.parse(store.get(trackKey(circuit)) || "null"); return t && t.pts && t.pts.length > 50 ? { circuit, ...t } : null; } catch (_) { return null; }
  }
  // Punkte ausdünnen (Abstand ≥ 40 = 4 m), ganzzahlig speichern
  function thin(pts, minD) {
    const out = [];
    for (const p of pts) { const q = out[out.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) >= minD) out.push([Math.round(p[0]), Math.round(p[1])]); }
    return out;
  }

  // Streckenverlauf für die aktuelle Session besorgen
  async function ensureTrack() {
    const race = S.race, ses = race && race.session;
    if (!ses || !ses.circuit) return;
    if (track && track.circuit === ses.circuit && track.kind === "line") return;
    const stored = loadStored(ses.circuit);
    if (stored && (stored.kind === "line" || race.live)) { track = stored; return; }
    if (race.live || !race.lapTimes || trackLoading === ses.key + "") { if (stored) track = stored; return; }
    // Schnellste saubere Runde des Siegers (bzw. eines beliebigen Fahrers)
    trackLoading = ses.key + "";
    try {
      let best = null;
      for (const [n, laps] of race.lapTimes) for (const l of laps) {
        if (l.s != null && !l.pitIn && !l.pitOut && l.lap > 1 && isFinite(l.t) && isFinite(l.end) && (!best || l.s < best.l.s)) best = { n, l };
      }
      if (!best) return;
      const rows = await get("location", { session_key: ses.key, driver_number: best.n, from: iso(best.l.t), to: iso(best.l.end + 500) });
      const pts = thin(rows.filter(r => r.x || r.y).map(r => [r.x, r.y]), 40);
      if (pts.length > 50) {
        track = { circuit: ses.circuit, pts, kind: "line" };
        store.set(trackKey(ses.circuit), JSON.stringify({ pts, kind: "line" }));
      }
    } catch (_) { /* ohne Verlauf: nur Punkte */ }
    finally { trackLoading = ""; }
  }

  // Positionen zum aktuellen Frame (Nachschau)
  function framePositions() {
    const race = S.race, f = race.frames[S.frame];
    const key = race.session.key + "|" + S.frame;
    if (posCache.has(key)) return posCache.get(key);
    if (!f.t) return null;
    clearTimeout(posTimer);
    const run = ++posRun;
    posTimer = setTimeout(async () => {
      try {
        const rows = await get("location", { session_key: race.session.key, from: iso(f.t - 1500), to: iso(f.t) });
        const cars = {};
        for (const r of rows) if (r.x || r.y) cars[r.driver_number] = [r.x, r.y];   // zeitlich sortiert → letzter gewinnt
        posCache.set(key, cars);
        if (run === posRun && S.view === "map") render();
      } catch (_) { posCache.set(key, {}); }
    }, 250);
    return null;
  }

  function render() {
    if (S.view !== "map" || !S.race) return;
    const race = S.race, f = race.frames[S.frame], box = $("map-box");
    if (!race.session || !race.session.circuit) { box.innerHTML = `<p class="chart-empty">Für diese Session gibt es keine Streckendaten.</p>`; return; }
    ensureTrack().then(() => { if (S.view === "map") draw(); });
    draw();
  }

  function draw() {
    const race = S.race, f = race.frames[S.frame], box = $("map-box");
    if (race.live && race.posFeed === false) {
      box.innerHTML = `<p class="chart-empty">Live-Positionen der Autos gibt die Formel 1 im freien Feed derzeit nicht heraus (nur mit F1-TV-Anmeldung).<br>Nach der Session ist die Karte in der Nachschau Runde für Runde verfügbar.</p>`;
      $("map-info").textContent = "";
      return;
    }
    let cars = race.live ? (race.pos && race.pos.cars) || {} : framePositions();
    // Live ohne gemerkten Verlauf: aus den Autopositionen mitwachsen lassen
    if (race.live && cars && (!track || track.kind !== "line")) {
      for (const p of Object.values(cars)) liveDots.set(Math.round(p[0] / 60) + ":" + Math.round(p[1] / 60), p);
      if (liveDots.size > 80) {
        track = { circuit: race.session.circuit, pts: [...liveDots.values()], kind: "dots" };
        if (liveDots.size % 50 === 0) store.set(trackKey(race.session.circuit), JSON.stringify({ pts: thin(track.pts, 1), kind: "dots" }));
      }
    }
    const pts = (track && track.pts) || [];
    const all = pts.concat(Object.values(cars || {}));
    if (all.length < 2) {
      box.innerHTML = `<p class="chart-empty">${race.live ? "Warte auf Positionen der Autos …" : "Lade Strecke …"}</p>`;
      return;
    }
    // Rahmen aus dem Streckenverlauf (bleibt stabil, damit Autos gleiten können)
    const frame = pts.length > 50 ? pts : all;
    const xs = frame.map(p => p[0]), ys = frame.map(p => p[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const span = Math.max(maxX - minX, maxY - minY) || 1, pad = span * 0.06;
    const vb = [minX - pad, -(maxY + pad), maxX - minX + 2 * pad, maxY - minY + 2 * pad];
    const r = span * 0.016, fs = span * 0.03;
    const hi = new Set([S.fav, ...f.rows.slice(0, 3).map(x => x.n)]);
    const sig = vb.map(v => v.toFixed(0)).join(" ") + "|" + (track ? track.kind + pts.length : "") + "|" + [...hi].join(",");
    // Gleiche Strecke & Hervorhebung → nur die Autos verschieben (CSS-Übergang)
    const old = box.querySelector("svg.mapsvg");
    if (old && old.dataset.sig === sig) {
      const seen = new Set();
      for (const g of old.querySelectorAll("g.car")) {
        const p = cars && cars[g.dataset.n];
        g.style.opacity = p ? "" : "0";
        if (p) g.style.transform = `translate(${p[0]}px,${-p[1]}px)`;
        seen.add(g.dataset.n);
      }
      if (cars && Object.keys(cars).every(n => seen.has(n))) { info(cars, f); return; }
    }
    let s = `<svg viewBox="${vb.map(v => v.toFixed(0)).join(" ")}" class="mapsvg" data-sig="${sig}" role="img" aria-label="Streckenkarte">`;
    if (track && track.kind === "line") s += `<path class="trk" d="M${pts.map(p => p[0] + "," + -p[1]).join("L")}Z" style="stroke-width:${(span * 0.022).toFixed(0)}"/><path class="trk-in" d="M${pts.map(p => p[0] + "," + -p[1]).join("L")}Z" style="stroke-width:${(span * 0.008).toFixed(0)}"/>`;
    else for (const p of pts) s += `<circle class="trk-dot" cx="${p[0]}" cy="${-p[1]}" r="${(span * 0.006).toFixed(0)}"/>`;
    // Autos: erst die anderen, dann Lieblingsfahrer & Top 3 obenauf
    const order = f.rows.slice().sort((a, b) => hi.has(a.n) - hi.has(b.n));
    for (const row of order) {
      const p = cars && cars[row.n]; const d = race.drivers.get(row.n);
      if (!p || !d) continue;
      const big = hi.has(row.n);
      s += `<g class="car${big ? " hi" : ""}${row.n === S.fav ? " fav" : ""}" data-n="${row.n}" style="transform:translate(${p[0]}px,${-p[1]}px)">
        <circle r="${(big ? r * 1.35 : r).toFixed(0)}" style="fill:${esc(d.color)}"/>
        ${big ? `<text y="${(-r * 1.9).toFixed(0)}" style="font-size:${fs.toFixed(0)}px">${esc(d.abbr)}</text>` : ""}</g>`;
    }
    box.innerHTML = s + "</svg>";
    box.classList.toggle("live", !!race.live);
    info(cars, f);
  }
  function info(cars, f) {
    const race = S.race;
    const n = cars ? Object.keys(cars).length : 0;
    $("map-info").textContent = race.live ? `${n} Autos auf der Strecke${track && track.kind === "dots" ? " · Streckenverlauf baut sich aus den Positionen auf" : ""}`
      : cars ? `Stand: Runde ${f.lap}${f.final ? " (Ziel)" : ""}` : "Lade Positionen …";
  }

  RT.on("show", render);
  RT.on("loading", () => { posCache.clear(); liveDots = new Map(); });
  window.addEventListener("resize", () => { if (S.view === "map") draw(); });
})();
