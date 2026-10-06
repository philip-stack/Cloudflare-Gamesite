// ====================================================================
// Rennticker — Reiter „Duell“: zwei Fahrer direkt vergleichen (Abstand über
// die Runden, Rundenzeiten, Reifen). Training/Qualifying: Bestzeiten.
// ====================================================================
(function () {
  "use strict";
  const { S, $, esc, store, M } = window.RT;
  RT.view("duel", { title: "Duell" });
  let pair = (() => { try { return JSON.parse(store.get("f1_duel") || "null"); } catch (_) { return null; } })() || [];

  // Standard: Lieblingsfahrer gegen den Vordermann (als Führender: Hintermann)
  function pick(f) {
    const has = n => f.rows.some(r => r.n === n);
    let [a, b] = pair;
    if (!has(a)) a = S.fav && has(S.fav) ? S.fav : f.rows[0] && f.rows[0].n;
    if (!has(b) || b === a) {
      const i = f.rows.findIndex(r => r.n === a);
      const o = f.rows[i > 0 ? i - 1 : i + 1];
      b = o ? o.n : null;
    }
    return [a, b];
  }
  function save(a, b) { pair = [a, b]; store.set("f1_duel", JSON.stringify(pair)); }

  // Abstand A→B je Runde (positiv = A liegt vorne), aus dem Rennverlauf
  function gapSeries(a, b) {
    const race = S.race;
    const frames = race.live ? [...S.liveHist.values()].sort((x, y) => x.lap - y.lap) : race.frames.slice(1, S.frame + 1);
    const out = [];
    for (const fr of frames) {
      const ra = fr.rows.find(r => r.n === a), rb = fr.rows.find(r => r.n === b);
      if (!ra || !rb || ra.out || rb.out) continue;
      const ga = ra.pos === 1 ? 0 : ra.gap, gb = rb.pos === 1 ? 0 : rb.gap;
      if (typeof ga === "number" && typeof gb === "number") out.push({ lap: fr.lap, d: +(gb - ga).toFixed(3), sc: /sc|vsc|red/.test(fr.status) });
    }
    return out;
  }
  function gapSvg(series, ca, cb, W, maxLap) {
    if (series.length < 2) return "";
    const H = 120, L = 34, R = 6, T = 8, B = 16;
    // Skala robust: 90-%-Wert der Abstände (Boxenstopp-/Startausreißer werden am Rand gekappt)
    const absd = series.map(p => Math.abs(p.d)).sort((a, b) => a - b);
    const m = Math.max(2, absd[Math.floor((absd.length - 1) * 0.9)]) * 1.15;
    const x = lap => L + (lap - 1) / Math.max(1, maxLap - 1) * (W - L - R);
    const y = d => T + (1 - (Math.max(-m, Math.min(m, d)) + m) / (2 * m)) * (H - T - B);
    let s = `<svg viewBox="0 0 ${W} ${H}" class="lapsvg" role="img" aria-label="Abstand je Runde">`;
    // SC-Runden als Band
    for (const p of series) if (p.sc) s += `<rect class="band-sc" x="${x(p.lap - 0.5)}" y="${T}" width="${Math.max(1, x(p.lap + 0.5) - x(p.lap - 0.5))}" height="${H - T - B}"/>`;
    const pts = series.map(p => `${x(p.lap).toFixed(1)},${y(p.d).toFixed(1)}`);
    const y0 = y(0);
    s += `<clipPath id="du-a"><rect x="0" y="0" width="${W}" height="${y0}"/></clipPath><clipPath id="du-b"><rect x="0" y="${y0}" width="${W}" height="${H}"/></clipPath>`;
    const area = `M${x(series[0].lap).toFixed(1)},${y0}L${pts.join("L")}L${x(series[series.length - 1].lap).toFixed(1)},${y0}Z`;
    s += `<path d="${area}" clip-path="url(#du-a)" style="fill:${esc(ca)};opacity:.22"/><path d="${area}" clip-path="url(#du-b)" style="fill:${esc(cb)};opacity:.22"/>`;
    s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y0}" y2="${y0}" style="stroke:var(--muted)"/>`;
    s += `<path class="lapln" d="M${pts.join("L")}" style="stroke:var(--text)"/>`;
    for (const v of [m / 1.1, -m / 1.1]) s += `<text class="ax" x="${L - 4}" y="${y(v) + 3}" text-anchor="end">${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}</text>`;
    s += `<text class="ax" x="${L - 4}" y="${y0 + 3}" text-anchor="end">0</text>`;
    for (let k = 10; k < maxLap; k += 10) s += `<text class="ax" x="${x(k)}" y="${H - 3}" text-anchor="middle">${k}</text>`;
    return s + "</svg>";
  }
  function stintBar(r) {
    const segs = (r.stints || []).filter((x, i, a) => x.laps > 0 || i === a.length - 1);
    const sum = segs.reduce((a, x) => a + Math.max(x.laps, 1), 0);
    return segs.length ? `<div class="fav-stints du-st">${segs.map(x => { const k = M.TYRE[x.c] || "?"; return `<span class="seg t-${k}" style="flex:${Math.max(x.laps, 1) / sum}">${k}<small>${x.laps}</small></span>`; }).join("")}</div>` : "";
  }

  function render(f) {
    if (S.view !== "duel" || !S.race) return;
    const race = S.race, box = $("duel-body");
    const [a, b] = pick(f);
    const opts = f.rows.map(r => { const d = race.drivers.get(r.n); return d ? `<option value="${r.n}">P${r.pos ?? "–"} · ${esc(d.abbr)} · ${esc(d.last)}</option>` : ""; }).join("");
    for (const [id, v] of [["duel-a", a], ["duel-b", b]]) { const el = $(id); if (el.dataset.opts !== opts) { el.innerHTML = opts; el.dataset.opts = opts; } el.value = String(v); }
    const ra = f.rows.find(r => r.n === a), rb = f.rows.find(r => r.n === b);
    const da = race.drivers.get(a), db = race.drivers.get(b);
    if (!ra || !rb || !da || !db) { box.innerHTML = `<p class="chart-empty">Zwei Fahrer wählen.</p>`; return; }
    const sameTeam = da.color === db.color;
    const timed = !!f.timed;
    // Abstand jetzt
    let now = "";
    if (timed) {
      if (ra.best != null && rb.best != null) { const d = rb.best - ra.best; now = `${esc(d >= 0 ? da.abbr : db.abbr)} ist <b>${Math.abs(d).toFixed(3)} s</b> schneller`; }
    } else {
      const ga = ra.pos === 1 ? 0 : ra.gap, gb = rb.pos === 1 ? 0 : rb.gap;
      if (typeof ga === "number" && typeof gb === "number") { const d = gb - ga; now = `${esc(d >= 0 ? da.abbr : db.abbr)} liegt <b>${Math.abs(d).toFixed(1)} s</b> vorne`; }
      else if (ra.pos && rb.pos) now = `${esc(ra.pos < rb.pos ? da.abbr : db.abbr)} liegt vorne (überrundet)`;
    }
    const card = (r, d) => `<div class="du-card" style="--team:${esc(d.color)}">
        <div class="du-top"><span class="bar"></span><b>${esc(d.abbr)}</b><span class="du-pos">P${r.pos ?? "–"}</span></div>
        <small>${esc(d.first)} ${esc(d.last)}</small>
        <dl>
          <dt>Reifen</dt><dd>${RT.tyre(r.compound)} ${r.tyreAge ?? "–"} Rd.</dd>
          <dt>Stopps</dt><dd>${r.pits}</dd>
          ${timed ? "" : `<dt>Letzte</dt><dd class="${r.lastPurple ? "purple" : r.lastPB ? "pb" : ""}">${M.lapTime(r.last)}</dd>`}
          <dt>Beste</dt><dd class="${r.fastest ? "purple" : ""}">${M.lapTime(r.best)}</dd>
        </dl>
        ${stintBar(r)}
      </div>`;
    const W = Math.max(280, box.clientWidth || 340);
    const maxLap = race.live ? 0 : race.laps;
    let charts = "";
    if (!timed) {
      const gs = gapSeries(a, b);
      const gsvg = gapSvg(gs, da.color, db.color, W, Math.max(maxLap, ...gs.map(p => p.lap), 2));
      const lsvg = RT.lapSvg([{ series: RT.lapSeries(a), color: da.color }, { series: RT.lapSeries(b), color: db.color, dash: sameTeam }], { width: W, height: 130, maxLap, label: "Rundenzeiten beider Fahrer" });
      charts = `<h3>Abstand <small>oben = ${esc(da.abbr)} vorne · unten = ${esc(db.abbr)} vorne</small></h3>${gsvg || `<p class="chart-empty">${race.live ? "Füllt sich ab jetzt Runde für Runde." : "Noch keine Runden."}</p>`}
        <h3>Rundenzeiten <small><i class="du-key" style="background:${esc(da.color)}"></i>${esc(da.abbr)} <i class="du-key${sameTeam ? " dash" : ""}" style="background:${esc(db.color)}"></i>${esc(db.abbr)}</small></h3>${lsvg || `<p class="chart-empty">Noch zu wenige Runden.</p>`}`;
    }
    box.innerHTML = `<p class="du-now">${now || "–"}</p><div class="du-cards">${card(ra, da)}${card(rb, db)}</div>${charts}`;
  }

  RT.on("show", render);
  $("duel-a").addEventListener("change", e => { const a = +e.target.value; save(a, pair[1] === a ? null : pair[1]); RT.show(); });
  $("duel-b").addEventListener("change", e => { save(pair[0] || +$("duel-a").value, +e.target.value); RT.show(); });
  $("duel-swap").addEventListener("click", () => { save(+$("duel-b").value, +$("duel-a").value); RT.show(); });
})();
