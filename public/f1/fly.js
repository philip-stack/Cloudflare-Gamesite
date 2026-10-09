// ====================================================================
// Rennticker — „Schnelle Runde“ im Qualifying/Training (live): Unter der
// Zeile eines Autos auf schneller Runde die Mini-Sektoren wie im TV (gelb /
// grün / lila) und die Hochrechnung: auf Kurs für welchen Platz, Abstand zur
// eigenen Bestzeit, reicht es fürs Weiterkommen. Rechnung: F1Model.flyingLap.
// ====================================================================
(function () {
  "use strict";
  const { S, $, esc, M } = window.RT;
  const SEG = { 2048: "y", 2049: "g", 2051: "p", 2064: "b" };
  const dfmt = d => (d < 0 ? "−" : "+") + Math.abs(d).toFixed(3);

  RT.on("show", f => {
    const race = S.race;
    if (!race || !race.live || !f.timed || !race.prog) return;
    const part = f.part ? +String(f.part).replace(/\D/g, "") || 0 : 0;
    const ctx = { rows: f.rows, part, cut: f.cut };
    for (const li of $("rows").querySelectorAll(".row")) {
      const r = f.rows.find(x => x.n === +li.dataset.n);
      const fl = r && M.flyingLap(r, race.prog[r.n], ctx);
      if (!fl) continue;
      li.classList.add("flying");
      const bar = (r.segs || []).map(st => `<i class="sg sg-${SEG[st] || "o"}"></i>`).join("");
      const cutTxt = fl.inCut == null ? "" : fl.inCut
        ? (r.pos > f.cut ? ' · <b class="tr-in">kommt weiter</b>' : "")
        : ' · <b class="tr-out">reicht nicht</b>';
      const d = fl.delta == null ? "" : ` · <b class="${fl.delta < 0 ? "tr-in" : "tr-out"}">${dfmt(fl.delta)}</b>`;
      const div = document.createElement("div");
      div.className = "fly";
      div.innerHTML = `<span class="fly-segs" aria-hidden="true">${bar}</span>
        <span class="fly-t"><b class="fly-tag">Schnelle Runde</b> auf Kurs für <b>P${fl.rank}</b>${d}${cutTxt} <small>≈ ${esc(M.lapTime(fl.proj))}</small></span>`;
      li.appendChild(div);
    }
  });
})();
