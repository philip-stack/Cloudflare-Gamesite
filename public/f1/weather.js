// ====================================================================
// Rennticker — Wetter unter der Statusleiste: Luft, Strecke, Feuchte, Wind,
// Regen. Live aus dem F1-Feed (WeatherData), Nachschau Rennen aus OpenF1
// (je Minute, passend zur gewählten Runde), Training/Qualifying aus dem
// F1-Archiv (Stand am Ende). Live dazu ein Regenradar für die nächsten 2 h
// an der Strecke (/f1data/rain, Open-Meteo), alle 10 min neu.
// ====================================================================
(function () {
  "use strict";
  const { S, $, esc } = window.RT;
  const n1 = v => v.toLocaleString("de-AT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const deg = v => Math.round(v) + "°";
  let rain = { key: "", at: 0, data: null };

  async function loadRain(ses) {
    const key = (ses.location || "") + "|" + (ses.country || "");
    if (!ses.location || (rain.key === key && Date.now() - rain.at < 10 * 60000)) return;
    rain = { key, at: Date.now(), data: rain.key === key ? rain.data : null };
    try { rain.data = await RT.get("rain", { place: ses.location, ...(ses.country ? { country: ses.country } : {}) }); RT.show(); }
    catch (_) { /* ohne Prognose */ }
  }
  // Prognose → ein Chip: „Regen in ~20 min · 70 %“, „Regenrisiko 45 %“, „trocken ab ~15 min“
  function rainChip(slots, wetNow) {
    const now = Date.now(), next = (slots || []).filter(x => x.t + 15 * 60000 > now);
    if (!next.length) return "";
    const mins = t => Math.max(0, Math.round((t - now) / 60000 / 5) * 5);
    if (wetNow) {
      const dry = next.find(x => x.mm < 0.1);
      return dry ? `<span class="wx-c fc"><small>Prognose</small><b>trocken ab ~${mins(dry.t)} min</b></span>` : `<span class="wx-c fc wet"><small>Prognose</small><b>Regen hält an</b></span>`;
    }
    const wet = next.find(x => x.mm >= 0.1);
    if (wet) return `<span class="wx-c fc wet" title="${wet.mm.toFixed(1)} mm in 15 min"><small>Prognose</small><b>${mins(wet.t) <= 5 ? "Regen jetzt" : `Regen in ~${mins(wet.t)} min`} · ${Math.round(wet.p)} %</b></span>`;
    const p = Math.max(...next.map(x => x.p));
    return p >= 40 ? `<span class="wx-c fc"><small>Prognose</small><b>Regenrisiko ${Math.round(p)} %</b></span>` : `<span class="wx-c fc"><small>Prognose</small><b>kein Regen (2 h)</b></span>`;
  }

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
    if (S.race && S.race.live) loadRain(S.race.session || {});
    const fc = S.race && S.race.live && rain.data && rain.key === ((S.race.session || {}).location || "") + "|" + ((S.race.session || {}).country || "") ? rainChip(rain.data.slots, w && w.rain) : "";
    if (!w && !fc) { box.hidden = true; return; }
    if (!w) { box.hidden = false; box.innerHTML = fc; return; }
    box.hidden = false;
    const tt = w.trackTrend != null && Math.abs(w.trackTrend) >= 1
      ? `<i class="${w.trackTrend > 0 ? "wx-up" : "wx-down"}" title="${w.trackTrend > 0 ? "wärmer" : "kühler"} als vor 10 Minuten">${w.trackTrend > 0 ? "↑" : "↓"}</i>` : "";
    // Pfeil zeigt, wohin der Wind weht (Angabe = woher)
    const arrow = w.dir != null ? `<svg viewBox="0 0 12 12" class="wx-dir" style="transform:rotate(${(w.dir + 180) % 360}deg)" aria-hidden="true"><path d="M6 1v10M6 1L3 4.5M6 1l3 3.5"/></svg>` : "";
    box.innerHTML = [
      w.rain ? `<span class="wx-c rain"><b>Regen</b></span>` : "",
      fc,
      w.air != null ? `<span class="wx-c"><small>Luft</small><b>${deg(w.air)}</b></span>` : "",
      w.track != null ? `<span class="wx-c"><small>Strecke</small><b>${deg(w.track)}${tt}</b></span>` : "",
      w.hum != null ? `<span class="wx-c"><small>Feuchte</small><b>${Math.round(w.hum)} %</b></span>` : "",
      w.wind != null ? `<span class="wx-c"><small>Wind</small><b>${arrow}${esc(n1(w.wind))} m/s</b></span>` : "",
    ].join("");
  });
  RT.on("loading", () => { $("wx").hidden = true; });
})();
