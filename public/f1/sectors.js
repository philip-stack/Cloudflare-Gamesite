// ====================================================================
// Rennticker — Sektorzeiten auf der Lieblingsfahrer-Karte: In welchem
// Sektor verliert/gewinnt er gegenüber dem Vordermann?
//   Rennen:            letzte Runde (Nachschau: OpenF1-Runden, live: Feed)
//   Training/Quali:    beste Sektoren der Session + Idealrunde
// Lila = Bestwert aller, grün = persönlicher Bestwert.
// ====================================================================
(function () {
  "use strict";
  const { S, $, esc, M } = window.RT;
  const fmt = v => (v == null ? "–" : v.toFixed(3));
  const dfmt = d => (d > 0 ? "+" : d < 0 ? "−" : "±") + Math.abs(d).toFixed(3);

  // Nachschau Rennen: Sektoren der letzten vollen Runde je Fahrer + Bestwerte bis jetzt
  function replay(f) {
    const race = S.race;
    if (!race.lapTimes) return null;
    const best = [null, null, null], pbest = new Map(), last = new Map();
    for (const [n, L] of race.lapTimes) {
      const pb = [null, null, null];
      for (const l of L) {
        if (!isFinite(l.end) || l.end > f.t || !l.sec) continue;
        l.sec.forEach((v, i) => {
          if (v == null) return;
          if (best[i] == null || v < best[i]) best[i] = v;
          if (pb[i] == null || v < pb[i]) pb[i] = v;
        });
        if (l.sec.some(v => v != null)) last.set(n, l);
      }
      pbest.set(n, pb);
    }
    const cells = n => {
      const l = last.get(n);
      if (!l) return null;
      const pb = pbest.get(n);
      return l.sec.map((v, i) => (v == null ? null : { v, ob: v === best[i], pb: v === pb[i] }));
    };
    return { cells, lap: n => (last.get(n) || {}).lap };
  }

  RT.on("show", f => {
    const box = $("fav");
    const race = S.race;
    if (box.hidden || !S.fav || !race || (!f.live && !f.timed && f.lap < 2)) return;
    const i = f.rows.findIndex(r => r.n === S.fav);
    const me = f.rows[i];
    if (!me) return;
    // Vergleich: Vordermann, als Erster der Zweite
    const ref = f.rows[i - 1] || f.rows[i + 1];
    let mine, theirs, title, extra = "";
    if (f.timed) {
      const conv = r => (r && r.bsec && r.bsec.length ? r.bsec.map(x => (x.v == null ? null : { v: x.v, ob: x.rank === 1, pb: false })) : null);
      mine = conv(me); theirs = conv(ref);
      title = "Beste Sektoren";
      if (mine && mine.every(Boolean) && me.best != null) {
        const ideal = mine.reduce((a, x) => a + x.v, 0);
        const pot = me.best - ideal;
        extra = `<p class="sec-ideal">Idealrunde <b>${M.lapTime(ideal)}</b>${pot > 0.0005 ? ` · <b>${pot.toFixed(3)} s</b> liegen gelassen` : ""}</p>`;
      }
    } else if (f.live) {
      const conv = r => (r && r.sec && r.sec.length ? r.sec.map(x => (x && x.v != null ? x : null)) : null);
      mine = conv(me); theirs = conv(ref);
      title = "Sektoren";
    } else {
      const R = replay(f);
      if (!R) return;
      mine = R.cells(me.n); theirs = ref ? R.cells(ref.n) : null;
      title = `Sektoren Runde ${R.lap(me.n) || "–"}`;
    }
    if (!mine || !mine.some(Boolean)) return;
    const refAbbr = ref ? esc((race.drivers.get(ref.n) || {}).abbr || "") : "";
    const div = RT.favSlot("sec", "Sektoren");
    if (!div) return;
    div.classList.add("fav-sec");
    div.innerHTML = `<div class="fav-laps-head"><span>${title}</span>${ref && theirs ? `<small>vs. <b>${refAbbr}</b> (P${ref.pos ?? "–"})</small>` : ""}</div>
      <div class="secs">${[0, 1, 2].map(k => {
        const c = mine[k], o = theirs && theirs[k];
        const d = c && o ? c.v - o.v : null;
        const cls = c ? (c.ob ? "ob" : c.pb ? "pb" : "") : "";
        return `<div class="sec ${cls}"><span>S${k + 1}</span><b>${fmt(c && c.v)}</b>${d != null ? `<small class="${d > 0.0005 ? "tr-out" : d < -0.0005 ? "tr-in" : ""}">${dfmt(d)}</small>` : "<small>&nbsp;</small>"}</div>`;
      }).join("")}</div>${extra}`;
  });
})();
