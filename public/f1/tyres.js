// ====================================================================
// Rennticker — Reiter „Reifen“: Reifenverlauf aller Fahrer
// ====================================================================
(function () {
  "use strict";
  const { S, $, esc, store, get, M } = window.RT;
  const TYRE_DE = { SOFT: "Soft", MEDIUM: "Medium", HARD: "Hard", INTERMEDIATE: "Intermediate", WET: "Regen" };
  RT.TYRE_DE = TYRE_DE;
  let tyreInfo = null;   // { n, i } angetippter Abschnitt
  RT.view("tyres", { title: "Reifen" });
  function renderTyres(f) {
    if (S.view !== "tyres") return;
    // Skala: Renndistanz (live notfalls die längste bisherige Fahrt)
    let total = S.race.laps || 0;
    for (const r of f.rows) for (const g of r.stints || []) total = Math.max(total, g.from + g.laps - 1);
    total = Math.max(total, 1);
    const now = f.live ? f.lap : f.final ? total : f.lap;
    const pct = x => (x / total * 100).toFixed(3) + "%";
    const ticks = [1];
    for (let k = 10; k < total; k += 10) ticks.push(k);
    if (total > 1) ticks.push(total);
    $("tyre-axis").innerHTML = ticks.map(k => `<span style="left:${pct(k - 0.5)}">${k}</span>`).join("");
    $("tyre-rows").innerHTML = f.rows.map(r => {
      const d = S.race.drivers.get(r.n);
      const segs = (r.stints || []).map((g, i) => {
        const k = M.TYRE[g.c] || "?";
        const w = Math.max(g.laps, 0.35);     // frisch aufgezogen: schmaler Strich statt nichts
        const sel = tyreInfo && tyreInfo.n === r.n && tyreInfo.i === i ? " sel" : "";
        return `<button type="button" class="seg t-${k}${sel}" data-n="${r.n}" data-i="${i}" style="left:${pct(g.from - 1)};width:calc(${pct(w)} - 2px)" title="${esc(d.abbr)} · ${esc(TYRE_DE[g.c] || g.c)} · Runde ${g.from}–${g.from + Math.max(g.laps, 1) - 1}" aria-label="${esc(d.abbr)} ${esc(TYRE_DE[g.c] || g.c)}, ${g.laps} Runden">${g.laps >= 3 ? k : ""}${g.laps >= 7 ? `<small>${g.laps}</small>` : ""}</button>`;
      }).join("");
      return `<li class="trow${r.n === S.fav ? " is-S.fav" : ""}${r.out ? " is-out" : ""}" style="--team:${esc(d.color)}">
        <span class="t-pos">${r.pos ?? "–"}</span><span class="bar"></span><b class="t-abbr">${esc(d.abbr)}</b>
        <span class="track">${segs}${now > 0 && now < total ? `<i class="now" style="left:${pct(now)}"></i>` : ""}</span>
      </li>`;
    }).join("");
    // Info zum angetippten Abschnitt
    const box = $("tyre-info");
    const r = tyreInfo && f.rows.find(x => x.n === tyreInfo.n);
    const g = r && (r.stints || [])[tyreInfo.i];
    if (!g) { box.textContent = "Tipp auf einen Abschnitt für Details."; box.classList.remove("on"); return; }
    const d = S.race.drivers.get(r.n), to = g.from + Math.max(g.laps, 1) - 1;
    box.classList.add("on");
    box.innerHTML = `<span class="tyre t-${M.TYRE[g.c] || "?"}">${M.TYRE[g.c] || "?"}</span>
      <b>${esc(d.abbr)}</b> · ${esc(TYRE_DE[g.c] || g.c)} · ${g.laps ? `Runde ${g.from}–${to} · ${g.laps} ${g.laps === 1 ? "Runde" : "Runden"}` : `ab Runde ${g.from}`}
      · ${tyreInfo.i === 0 ? "Startreifen" : `nach Stopp ${tyreInfo.i}`}`;
  }
  RT.on("show", renderTyres);
  RT.on("loading", () => { $("tyre-rows").innerHTML = ""; $("tyre-info").textContent = ""; });
  $("tyre-rows").addEventListener("click", e => {
    const s = e.target.closest(".seg");
    if (!s) return;
    const n = +s.dataset.n, i = +s.dataset.i;
    tyreInfo = tyreInfo && tyreInfo.n === n && tyreInfo.i === i ? null : { n, i };
    if (S.race) renderTyres(S.race.frames[S.frame]);
  });
})();
