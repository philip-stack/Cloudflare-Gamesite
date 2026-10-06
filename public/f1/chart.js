// ====================================================================
// Rennticker — Reiter „Verlauf“: Platz je Runde
// ====================================================================
(function () {
  "use strict";
  const { S, $, esc, store, get, M } = window.RT;
  RT.view("chart");
  let chartSel = new Set((() => { try { return JSON.parse(store.get("f1_chartsel") || "[]"); } catch (_) { return []; } })());
  let chartHover = null;   // Runde unter dem Finger/Mauszeiger
  const SVGNS = "http://www.w3.org/2000/svg";

  function chartFrames(f) {
    if (S.race.live) return [...S.liveHist.values()].sort((a, b) => a.lap - b.lap);
    return S.race.frames.slice(0, S.frame + 1);
  }
  function renderChart(f) {
    if (S.view !== "chart") return;
    const box = $("chart-box");
    const isRace = S.race.live ? S.race.session && S.race.session.race : !f.timed;
    if (!isRace) { box.innerHTML = `<p class="chart-empty">Den Positionsverlauf gibt es für Rennen und Sprint.</p>`; $("chart-info").textContent = ""; return; }
    const frames = chartFrames(f);
    if (frames.length < 2) { box.innerHTML = `<p class="chart-empty">${S.race.live ? "Der Verlauf füllt sich ab jetzt Runde für Runde." : "Noch keine Runde gefahren."}</p>`; $("chart-info").textContent = ""; return; }
    const drivers = [...S.race.drivers.values()];
    const n = Math.max(drivers.length, ...frames.flatMap(x => x.rows.map(r => r.pos || 0)));
    const maxLap = Math.max(S.race.laps || 0, frames[frames.length - 1].lap, 1);
    const W = Math.max(300, box.clientWidth - 8), rowH = 15, L = 22, R = 46, T = 16, B = 6;
    const H = T + n * rowH + B, pw = W - L - R;
    const x = lap => L + (lap / maxLap) * pw, y = pos => T + (pos - 0.5) * rowH;
    const hi = new Set([...chartSel, ...(S.fav ? [S.fav] : [])]);
    // Teamkollegen: zweiter Fahrer eines Teams gestrichelt
    const seenTeam = new Set(), dashed = new Set();
    for (const d of drivers) { if (!hi.has(d.n)) continue; if (seenTeam.has(d.color)) dashed.add(d.n); seenTeam.add(d.color); }
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Platzierung je Runde">`;
    // SC/VSC/Rot als Hintergrundbänder
    for (let i = 1; i < frames.length; i++) {
      const st = frames[i].status, cls = st === "red" ? "band-red" : /sc|vsc/.test(st) ? "band-sc" : "";
      if (cls) s += `<rect class="${cls}" x="${x(frames[i - 1].lap)}" y="${T}" width="${Math.max(1, x(frames[i].lap) - x(frames[i - 1].lap))}" height="${n * rowH}"/>`;
    }
    // Raster: Plätze 1, 5, 10 … und Runden alle 10
    for (let p = 1; p <= n; p++) if (p === 1 || p % 5 === 0) s += `<text class="ax" x="${L - 5}" y="${y(p) + 3.5}" text-anchor="end">${p}</text>`;
    for (let k = 10; k < maxLap - 4; k += 10) s += `<line class="grid" x1="${x(k)}" x2="${x(k)}" y1="${T}" y2="${T + n * rowH}"/><text class="ax" x="${x(k)}" y="${T - 5}" text-anchor="middle">${k}</text>`;
    s += `<text class="ax" x="${x(maxLap)}" y="${T - 5}" text-anchor="end">${maxLap}</text>`;
    // Linien: erst die gedämpften, dann die hervorgehobenen obenauf
    const lines = drivers.map(d => {
      const pts = [], pits = [];
      let prevPits = null;
      for (const fr of frames) {
        const r = fr.rows.find(q => q.n === d.n);
        if (!r || r.pos == null || (r.out && fr.lap > 0 && pts.length)) continue;
        pts.push([x(fr.lap), y(r.pos)]);
        if (prevPits != null && r.pits > prevPits) pits.push([x(fr.lap), y(r.pos)]);
        prevPits = r.pits;
      }
      return { d, pts, pits };
    });
    for (const pass of [false, true]) for (const { d, pts, pits } of lines) {
      if (hi.has(d.n) !== pass || pts.length < 2) continue;
      const path = "M" + pts.map(p => p[0].toFixed(1) + "," + p[1].toFixed(1)).join("L");
      s += `<path class="ln${pass ? " hi" : ""}" d="${path}"${pass ? ` style="stroke:${esc(d.color)}"${dashed.has(d.n) ? ' stroke-dasharray="6 3"' : ""}` : ""}/>`;
      if (pass) for (const p of pits) s += `<circle class="pit" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.5" style="stroke:${esc(d.color)}"/>`;
    }
    // Aktuelle Runde (Nachschau mitten im Rennen)
    if (!S.race.live && S.frame < S.race.frames.length - 1) s += `<line class="now" x1="${x(f.lap)}" x2="${x(f.lap)}" y1="${T}" y2="${T + n * rowH}"/>`;
    if (chartHover != null) s += `<line class="cross" x1="${x(chartHover)}" x2="${x(chartHover)}" y1="${T}" y2="${T + n * rowH}"/>`;
    // Kürzel rechts in der Reihenfolge des aktuellen Stands (zum Antippen)
    f.rows.forEach((r, i) => {
      const d = S.race.drivers.get(r.n); if (!d) return;
      const on = hi.has(r.n), yy = y(i + 1);
      s += `<g class="lbl${on ? " hi" : ""}" data-n="${r.n}"><rect x="${W - R + 2}" y="${yy - rowH / 2}" width="${R - 2}" height="${rowH}" fill="transparent"/>
        <circle class="dot" cx="${W - R + 7}" cy="${yy}" r="3" style="fill:${esc(d.color)}"/><text x="${W - R + 13}" y="${yy + 3.5}">${esc(d.abbr)}</text></g>`;
    });
    box.innerHTML = s + "</svg>";
    box.dataset.geo = JSON.stringify({ W, L, pw, maxLap });
    // Info-Zeile: Runde unter dem Finger, sonst aktueller Stand der Hervorgehobenen
    const lap = chartHover != null ? chartHover : frames[frames.length - 1].lap;
    const fr = frames.reduce((a, b) => (Math.abs(b.lap - lap) < Math.abs(a.lap - lap) ? b : a));
    const sel = [...hi].map(nn => { const r = fr.rows.find(q => q.n === nn), d = S.race.drivers.get(nn); return r && d ? `<b>${esc(d.abbr)}</b> P${r.pos ?? "–"}` : ""; }).filter(Boolean);
    $("chart-info").innerHTML = `Runde ${fr.lap}${sel.length ? " · " + sel.join(" · ") : ""}`;
    $("chart-hint").hidden = hi.size > 0;
  }
  function chartPointer(e) {
    const box = $("chart-box"), svg = box.querySelector("svg");
    if (!svg || !box.dataset.geo) return;
    const g = JSON.parse(box.dataset.geo), rect = svg.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (g.W / rect.width);
    if (px < g.L || px > g.L + g.pw) { if (chartHover != null) { chartHover = null; renderChart(S.race.frames[S.frame]); } return; }
    const lap = Math.round((px - g.L) / g.pw * g.maxLap);
    if (lap !== chartHover) { chartHover = lap; renderChart(S.race.frames[S.frame]); }
  }
  RT.on("show", renderChart);
  $("chart-box").addEventListener("click", e => {
    const g = e.target.closest(".lbl");
    if (g) {
      const n = +g.dataset.n;
      if (chartSel.has(n)) chartSel.delete(n); else chartSel.add(n);
      store.set("f1_chartsel", JSON.stringify([...chartSel]));
      if (S.race) renderChart(S.race.frames[S.frame]);
      return;
    }
    chartPointer(e);
  });
  $("chart-box").addEventListener("pointermove", e => { if (e.pointerType === "mouse") chartPointer(e); });
  $("chart-box").addEventListener("pointerleave", () => { if (chartHover != null && S.race) { chartHover = null; renderChart(S.race.frames[S.frame]); } });
  window.addEventListener("resize", () => { if (S.race && S.view === "chart") renderChart(S.race.frames[S.frame]); });
})();
