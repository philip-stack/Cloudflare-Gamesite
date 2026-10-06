// ====================================================================
// Rennticker — Rundenzeiten: kleines Diagramm auf der Lieblingsfahrer-Karte
// (Reifenabbau, Stopps). Stellt RT.lapSeries / RT.lapSvg auch der
// Duell-Ansicht zur Verfügung.
// ====================================================================
(function () {
  "use strict";
  const { S, $, esc, M } = window.RT;
  // Achsen-Beschriftung kurz: 1:47.0
  const short = v => `${Math.floor(v / 60)}:${(v % 60).toFixed(1).padStart(4, "0")}`;
  const TC = { SOFT: "var(--t-S)", MEDIUM: "var(--t-M)", HARD: "var(--t-H)", INTERMEDIATE: "var(--t-I)", WET: "var(--t-W)" };

  // Runden eines Fahrers bis zum aktuellen Stand: [{ lap, s, c, pitIn, pitOut, sc }]
  function lapSeries(n) {
    const race = S.race;
    if (!race) return [];
    const f = race.frames[S.frame];
    if (race.live) {
      const m = S.liveLaps.get(n);
      return m ? [...m.values()].sort((a, b) => a.lap - b.lap).map(x => ({ lap: x.lap, s: x.s, c: x.compound, pitIn: false, pitOut: false, sc: false })) : [];
    }
    if (!race.lapTimes) return [];
    const row = f.rows.find(r => r.n === n);
    const done = row ? row.laps : 0;
    // Runden unter Safety Car / VSC / Rot: Status des Frames am Rundenende
    const scLap = lap => { const fr = race.frames[lap]; return !!fr && /sc|vsc|red/.test(fr.status); };
    return (race.lapTimes.get(n) || []).filter(l => l.lap <= done && l.s != null)
      .map(l => ({ lap: l.lap, s: l.s, c: l.c, pitIn: l.pitIn, pitOut: l.pitOut, sc: scLap(l.lap) }));
  }
  // „Saubere“ Runden: keine Boxen-, SC- oder Startrunde, kein Ausreißer
  function clean(series) {
    const ok = series.filter(l => l.lap > 1 && !l.pitIn && !l.pitOut && !l.sc);
    if (!ok.length) return [];
    const med = ok.map(l => l.s).sort((a, b) => a - b)[Math.floor(ok.length / 2)];
    return ok.filter(l => l.s < med * 1.07);
  }
  // Abbau im laufenden Stint: Steigung (s pro Runde) über die sauberen Runden
  function trend(cl) {
    const last = cl[cl.length - 1];
    if (!last) return null;
    const st = [];
    for (let i = cl.length - 1; i >= 0 && cl[i].c === last.c && (st.length === 0 || st[0].lap - cl[i].lap <= 3); i--) st.unshift(cl[i]);
    if (st.length < 4) return null;
    const n = st.length, mx = st.reduce((a, l) => a + l.lap, 0) / n, my = st.reduce((a, l) => a + l.s, 0) / n;
    const num = st.reduce((a, l) => a + (l.lap - mx) * (l.s - my), 0), den = st.reduce((a, l) => a + (l.lap - mx) ** 2, 0);
    return den ? num / den : null;
  }

  // SVG: eine oder mehrere Reihen [{ series, color, dash }]; Linie je Stint in
  // Reifenfarbe, wenn nur eine Reihe (sonst Teamfarbe)
  function lapSvg(rows, opts) {
    const W = opts.width, H = opts.height || 96, L = 34, R = 6, T = 6, B = 16;
    const all = rows.flatMap(r => clean(r.series));
    if (all.length < 2) return "";
    const maxLap = Math.max(opts.maxLap || 0, ...rows.flatMap(r => r.series.map(l => l.lap)), 2);
    let lo = Math.min(...all.map(l => l.s)), hi = Math.max(...all.map(l => l.s));
    const pad = Math.max(0.2, (hi - lo) * 0.12); lo -= pad; hi += pad;
    const x = lap => L + (lap - 1) / Math.max(1, maxLap - 1) * (W - L - R);
    const y = s => T + (1 - (Math.min(Math.max(s, lo), hi) - lo) / (hi - lo)) * (H - T - B);
    let s = `<svg viewBox="0 0 ${W} ${H}" class="lapsvg" role="img" aria-label="${esc(opts.label || "Rundenzeiten")}">`;
    // Achsen: zwei Zeit-Marken, Runden-Marken alle 10
    for (const v of [lo + pad, hi - pad]) s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 4}" y="${y(v) + 3}" text-anchor="end">${short(v)}</text>`;
    for (let k = 10; k < maxLap; k += 10) s += `<text class="ax" x="${x(k)}" y="${H - 3}" text-anchor="middle">${k}</text>`;
    const single = rows.length === 1;
    for (const r of rows) {
      const cl = clean(r.series), set = new Set(cl);
      // Boxenstopps
      for (const l of r.series) if (l.pitIn) s += `<line class="pitline" x1="${x(l.lap + 0.5)}" x2="${x(l.lap + 0.5)}" y1="${T}" y2="${H - B}"${single ? "" : ` style="stroke:${esc(r.color)}"`}/>`;
      // Linie: je Stint ein Pfad (Lücken bei Box/SC)
      let seg = [], prev = null;
      const flush = () => {
        if (seg.length > 1) s += `<path class="lapln" d="M${seg.map(l => x(l.lap).toFixed(1) + "," + y(l.s).toFixed(1)).join("L")}" style="stroke:${single ? TC[seg[0].c] || "var(--muted)" : esc(r.color)}"${r.dash ? ' stroke-dasharray="5 3"' : ""}/>`;
        for (const l of seg) s += `<circle class="lapdot" cx="${x(l.lap).toFixed(1)}" cy="${y(l.s).toFixed(1)}" r="${single ? 2.2 : 1.8}" style="fill:${single ? TC[l.c] || "var(--muted)" : esc(r.color)}"/>`;
        seg = [];
      };
      for (const l of r.series) {
        if (!set.has(l)) { flush(); prev = null; continue; }
        if (prev && (l.c !== prev.c || l.lap - prev.lap > 1)) flush();
        seg.push(l); prev = l;
      }
      flush();
    }
    return s + "</svg>";
  }
  RT.lapSeries = lapSeries; RT.lapClean = clean; RT.lapSvg = lapSvg; RT.lapTrend = trend;

  // ---------- Diagramm auf der Lieblingsfahrer-Karte ----------
  RT.on("show", f => {
    const box = $("fav");
    if (box.hidden || !S.fav || f.timed) return;
    const series = lapSeries(S.fav);
    const cl = clean(series);
    const w = Math.max(260, box.clientWidth - 26);
    const svg = lapSvg([{ series }], { width: w, height: 96, maxLap: S.race.live ? 0 : S.race.laps, label: "Rundenzeiten" });
    const div = document.createElement("div");
    div.className = "fav-laps";
    if (!svg) {
      div.innerHTML = `<p class="fav-laps-empty">${S.race.live ? "Rundenzeiten sammeln sich ab jetzt." : "Noch zu wenige Runden für ein Diagramm."}</p>`;
    } else {
      const t = trend(cl), last5 = cl.slice(-5);
      const avg = last5.length ? last5.reduce((a, l) => a + l.s, 0) / last5.length : null;
      div.innerHTML = `<div class="fav-laps-head"><span>Rundenzeiten</span>
          <small>${avg ? `Ø letzte ${last5.length}: <b>${M.lapTime(avg)}</b>` : ""}${t != null ? ` · Abbau <b class="${t > 0.05 ? "tr-out" : t < -0.05 ? "tr-in" : ""}">${t >= 0 ? "+" : "−"}${Math.abs(t).toFixed(2)} s/Rd.</b>` : ""}</small></div>${svg}`;
    }
    box.appendChild(div);
  });
})();
