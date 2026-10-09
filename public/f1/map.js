// ====================================================================
// Rennticker — Reiter „Karte“: die Autos als Punkte auf der Strecke.
//  · Streckenverlauf: eine schnelle Runde aus OpenF1 /location (Nachschau)
//    und lokal je Strecke gemerkt (f1_track_<circuit>); live ohne gemerkten
//    Verlauf wächst er aus den Positionen der Autos mit.
//  · Positionen: Nachschau = OpenF1 /location zum Frame-Zeitpunkt,
//    live = Position.z aus dem F1-Feed (über /api/f1-live, alle 3 s).
//  · Gibt der Feed keine Positionen heraus: GESCHÄTZT aus der Zeitmessung —
//    letzter Mini-Sektor je Auto, Strecke und Lage der Mini-Sektoren aus einer
//    früheren Session (F1Track in trackcal.js, einmal je Strecke gemerkt).
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
  const T = window.F1Track;
  let cal = null, calFor = "", calState = "";   // Eichung der Strecke für die Schätzung
  let tick = null;

  // ---------- Geschätzte Live-Positionen ----------
  const calKey = c => "f1_trackcal_v1_" + c;
  async function inflate(b64) {
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    return new Response(new Blob([bin]).stream().pipeThrough(new DecompressionStream("deflate-raw"))).text();
  }
  async function ensureCal() {
    const ses = S.race.session || {};
    const circuit = ses.circuit || "x";
    if (calFor === circuit && (cal || calState === "load")) return;
    calFor = circuit; cal = null;
    try { const c = JSON.parse(store.get(calKey(circuit)) || "null"); if (c && c.pts && c.segF) { cal = c; return; } } catch (_) { /* neu bauen */ }
    if (!ses.path || typeof DecompressionStream === "undefined") { calState = "fail"; return; }
    calState = "load";
    try {
      const src = await get("tracksrc", { path: ses.path, ...(ses.circuit ? { circuit: ses.circuit } : {}) });
      for (const path of src.paths || []) {
        const td = await fetch("/f1data/stream?" + new URLSearchParams({ path, topic: "TimingData" }));
        if (!td.ok) continue;
        const lap = T.pickLap(T.timingLaps(await td.text()));
        if (!lap) continue;
        const ps = await fetch("/f1data/stream?" + new URLSearchParams({ path, topic: "Position.z" }));
        if (!ps.ok) continue;
        const c = T.buildCal(await T.trackOf(await ps.text(), String(lap.n), lap.t0, lap.t1, inflate), lap);
        if (!c) continue;
        c.from = path.split("/")[2] || "";
        cal = c;
        store.set(calKey(circuit), JSON.stringify(c));
        break;
      }
      calState = cal ? "" : "fail";
    } catch (_) { calState = "fail"; }
    if (S.view === "map") draw();
  }
  // Ohne Eichung: schematischer Kreis, Mini-Sektoren gleichmäßig verteilt
  function ringCal(counts) {
    counts = counts && counts.length ? counts : [8, 8, 8];
    const N = counts.reduce((a, b) => a + b, 0), R = 10000, pts = [], cum = [];
    for (let i = 0; i <= 180; i++) { const a = Math.PI / 2 - i / 180 * 2 * Math.PI; pts.push([Math.round(R * Math.cos(a)), Math.round(R * Math.sin(a))]); cum.push(Math.round(i / 180 * 2 * Math.PI * R)); }
    return { pts, cum, len: cum[cum.length - 1], segF: [...Array(N).keys()].map(g => (g + 1) / N), segDur: Array(N).fill(90 / N), counts, lap: 90, ring: true };
  }
  // { n: [x, y] } jetzt, + wer in der Box steht
  function estCars(c) {
    const race = S.race, f = race.frames[0], prog = race.prog || {}, cars = {}, box = [];
    const base = c.counts.map((_, i) => c.counts.slice(0, i).reduce((a, b) => a + b, 0));
    const since = (Date.now() - (race.progAt || Date.now())) / 1000;
    for (const r of f.rows) {
      const p = prog[r.n];
      if (r.out) continue;
      if (r.pitNow) { box.push(r.n); continue; }
      if (!p || p[0] >= c.counts.length) continue;
      const g = base[p[0]] + p[1];
      const pace = r.last && c.lap ? Math.max(0.9, Math.min(1.8, r.last / c.lap)) : 1;
      const fr = T.fracOf(c, g, p[2] / 1000 + since, pace);
      if (fr != null) cars[r.n] = T.pointAt(c, fr);
    }
    return { cars, box };
  }

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
    // Live ohne GPS aus dem Feed: aus der Zeitmessung schätzen
    let est = null;
    if (race.live && race.posFeed === false) {
      if (!race.prog || !T) { box.innerHTML = `<p class="chart-empty">Warte auf die Zeitmessung …</p>`; return; }
      if (!cal && calState !== "fail") {
        ensureCal();
        box.innerHTML = `<p class="chart-empty"><span class="spinner"></span><br>Strecke wird vorbereitet … (einmalig, aus einer früheren Session)</p>`;
        $("map-info").textContent = "";
        return;
      }
      const c = cal || ringCal(race.prog._n);
      track = { circuit: race.session.circuit, pts: c.pts, kind: "line" };
      est = { c, ...estCars(c) };
    }
    let cars = est ? est.cars : race.live ? (race.pos && race.pos.cars) || {} : framePositions();
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
      if (cars && Object.keys(cars).every(n => seen.has(n))) { info(cars, f, est); return; }
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
    box.classList.toggle("live", !!race.live && !est);
    box.classList.toggle("est", !!est);
    info(cars, f, est);
  }
  function info(cars, f, est) {
    const race = S.race;
    const n = cars ? Object.keys(cars).length : 0;
    if (est) {
      const nm = x => (race.drivers.get(x) || { abbr: "#" + x }).abbr;
      $("map-info").textContent = `${n} Autos auf der Strecke${est.box.length ? " · Box: " + est.box.map(nm).join(", ") : ""} · Positionen geschätzt aus der Zeitmessung${est.c.ring ? " (schematisch, Strecke noch unbekannt)" : ""}`;
      return;
    }
    $("map-info").textContent = race.live ? `${n} Autos auf der Strecke${track && track.kind === "dots" ? " · Streckenverlauf baut sich aus den Positionen auf" : ""}`
      : cars ? `Stand: Runde ${f.lap}${f.final ? " (Ziel)" : ""}` : "Lade Positionen …";
  }

  // Geschätzte Positionen gleiten: 4× pro Sekunde neu setzen, solange die Karte offen ist
  function syncTick() {
    const on = S.view === "map" && S.race && S.race.live && S.race.posFeed === false;
    if (on && !tick) tick = setInterval(() => { if (!document.hidden) draw(); }, 250);
    if (!on && tick) { clearInterval(tick); tick = null; }
  }
  RT.on("show", () => { render(); syncTick(); });
  RT.on("view", syncTick);
  RT.on("loading", () => { posCache.clear(); liveDots = new Map(); syncTick(); });
  window.addEventListener("resize", () => { if (S.view === "map") draw(); });
})();
