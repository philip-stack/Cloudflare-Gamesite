// ====================================================================
// Rennticker — Boxenstopp-Rechner auf der Lieblingsfahrer-Karte: Wo käme er
// raus, wenn er JETZT an die Box fährt? Abstand zum Führenden + Boxenverlust,
// eingeordnet zwischen die anderen (F1Model.pitRejoin).
//
// Boxenverlust: selbst eingestellt (je Strecke gemerkt) > aus den Stopps
// dieses Rennens > zuletzt gemessener Wert dieser Strecke > 22 s.
// Unter Safety Car / VSC kostet ein Stopp deutlich weniger.
// ====================================================================
(function () {
  "use strict";
  const { S, $, esc, store, M } = window.RT;
  const DEFAULT = 22;
  const SC_FACTOR = { sc: 0.55, "sc-end": 0.55, vsc: 0.65, "vsc-end": 0.75 };
  let est = { key: "", v: null };
  const circuit = () => ((S.race && S.race.session) || {}).circuit || "x";
  const SC = /sc|vsc|red/;

  // Boxenverlust aus den Runden dieses Rennens (Nachschau: ganzes Rennen, ist
  // eine Streckenkonstante; live: alle Stopps bisher, je Runde neu)
  function estimate() {
    const race = S.race;
    const key = race.session.key + ":" + (race.live ? race.frames[0].lap : "all");
    if (est.key === key) return est.v;
    let series;
    if (race.live) {
      series = new Map([...S.liveLaps.keys()].map(n => [n, RT.lapSeries(n)]));
    } else if (race.lapTimes) {
      series = new Map([...race.lapTimes].map(([n, L]) => [n, L.map(l => ({ ...l, sc: SC.test((race.frames[l.lap] || {}).status || "") }))]));
    }
    const v = series ? M.pitLoss(series) : null;
    if (v && v.stops >= 3) store.set("f1_pitloss_auto_" + circuit(), String(v.s));
    est = { key, v };
    return v;
  }
  function loss() {
    const manual = +store.get("f1_pitloss_" + circuit());
    if (manual > 0) return { s: manual, src: "eingestellt", manual: true };
    const e = estimate();
    if (e && e.stops >= 2) return { s: e.s, src: `gemessen, ${e.stops} Stopps` };
    const last = +store.get("f1_pitloss_auto_" + circuit());
    if (last > 0) return { s: last, src: "Wert dieser Strecke" };
    return { s: DEFAULT, src: "Schätzwert" };
  }

  RT.on("show", f => {
    const box = $("fav");
    const race = S.race;
    if (box.hidden || !S.fav || !race || f.timed || f.final || f.lap < 1 || f.status === "red" || f.status === "pre") return;
    const me = f.rows.find(r => r.n === S.fav);
    if (!me || me.out) return;
    const L = loss();
    const k = SC_FACTOR[f.status] || 1;
    const eff = +(L.s * k).toFixed(1);
    const div = document.createElement("div");
    div.className = "fav-pit";
    let body;
    if (me.pitNow) body = `<p class="fav-pit-r muted">Gerade in der Box.</p>`;
    else {
      const p = M.pitRejoin(f.rows, S.fav, eff);
      const nm = n => esc((race.drivers.get(n) || { abbr: "#" + n }).abbr);
      if (!p) body = `<p class="fav-pit-r muted">Noch keine Abstände.</p>`;
      else {
        const traffic = p.ahead && p.ahead.d < 1.5;
        const tag = traffic ? `<em class="pit-tag bad">im Verkehr</em>` : p.behind && p.behind.d < 1 ? `<em class="pit-tag warn">knapp</em>` : `<em class="pit-tag ok">freie Fahrt</em>`;
        body = `<p class="fav-pit-r">→ <b class="pit-pos">P${p.pos}</b>${p.ahead ? ` · ${p.ahead.d.toFixed(1)} s hinter <b>${nm(p.ahead.n)}</b>` : ""}${p.behind ? ` · ${p.behind.d.toFixed(1)} s vor <b>${nm(p.behind.n)}</b>` : ""} ${tag}</p>`;
      }
    }
    div.innerHTML = `<div class="fav-laps-head"><span>Boxenstopp jetzt</span>
        <small class="pit-loss">Verlust
          <button type="button" data-pitd="-1" aria-label="Boxenverlust verringern">−</button><b title="${esc(L.src)}">${eff.toFixed(1)} s</b><button type="button" data-pitd="1" aria-label="Boxenverlust erhöhen">+</button>
          ${L.manual ? `<button type="button" data-pitd="0" title="Wieder automatisch" aria-label="Boxenverlust automatisch">↺</button>` : ""}
        </small></div>
      ${body}
      <p class="pit-src">${k < 1 ? `${f.status.startsWith("vsc") ? "VSC" : "Safety Car"}: Stopp billiger (normal ${L.s.toFixed(1)} s) · ` : ""}${esc(L.src)}</p>`;
    box.appendChild(div);
  });

  $("fav").addEventListener("click", e => {
    const b = e.target.closest("button[data-pitd]");
    if (!b) return;
    const d = +b.dataset.pitd;
    const k = "f1_pitloss_" + circuit();
    if (d === 0) store.set(k, "");
    else store.set(k, String(Math.max(8, Math.min(45, Math.round(loss().s) + d))));
    RT.show();
  });
})();
