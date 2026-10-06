// ====================================================================
// Rennticker — Wetter unter der Statusleiste: Luft, Strecke, Feuchte, Wind,
// Regen. Live aus dem F1-Feed (WeatherData), Nachschau Rennen aus OpenF1
// (je Minute, passend zur gewählten Runde), Training/Qualifying aus dem
// F1-Archiv (Stand am Ende).
// ====================================================================
(function () {
  "use strict";
  const { S, $, esc } = window.RT;
  const n1 = v => v.toLocaleString("de-AT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const deg = v => Math.round(v) + "°";

  // Wetter zum Stand: Nachschau Rennen = letzter Messwert vor dem Frame
  function current(f) {
    const race = S.race;
    if (race.live || race.archive) return race.weather || null;
    const wx = race.wx || [];
    if (!wx.length) return null;
    let w = wx[0];
    for (const x of wx) { if (x.t <= f.t) w = x; else break; }
    // Trend Streckentemperatur: Vergleich mit ~10 Minuten davor
    const before = wx.filter(x => x.t <= w.t - 9.5 * 60000).pop();
    return { ...w, trackTrend: before && before.track != null && w.track != null ? w.track - before.track : null };
  }

  RT.on("show", f => {
    const box = $("wx");
    const w = S.race ? current(f) : null;
    if (!w) { box.hidden = true; return; }
    box.hidden = false;
    const tt = w.trackTrend != null && Math.abs(w.trackTrend) >= 1
      ? `<i class="${w.trackTrend > 0 ? "wx-up" : "wx-down"}" title="${w.trackTrend > 0 ? "wärmer" : "kühler"} als vor 10 Minuten">${w.trackTrend > 0 ? "↑" : "↓"}</i>` : "";
    // Pfeil zeigt, wohin der Wind weht (Angabe = woher)
    const arrow = w.dir != null ? `<svg viewBox="0 0 12 12" class="wx-dir" style="transform:rotate(${(w.dir + 180) % 360}deg)" aria-hidden="true"><path d="M6 1v10M6 1L3 4.5M6 1l3 3.5"/></svg>` : "";
    box.innerHTML = [
      w.rain ? `<span class="wx-c rain"><b>Regen</b></span>` : "",
      w.air != null ? `<span class="wx-c"><small>Luft</small><b>${deg(w.air)}</b></span>` : "",
      w.track != null ? `<span class="wx-c"><small>Strecke</small><b>${deg(w.track)}${tt}</b></span>` : "",
      w.hum != null ? `<span class="wx-c"><small>Feuchte</small><b>${Math.round(w.hum)} %</b></span>` : "",
      w.wind != null ? `<span class="wx-c"><small>Wind</small><b>${arrow}${esc(n1(w.wind))} m/s</b></span>` : "",
    ].join("");
  });
  RT.on("loading", () => { $("wx").hidden = true; });
})();
