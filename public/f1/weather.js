// ====================================================================
// Rennticker — Wetter unter der Statusleiste: Luft, Strecke, Feuchte, Wind,
// Regen. Live aus dem F1-Feed (WeatherData), Nachschau Rennen aus OpenF1
// (je Minute, passend zur gewählten Runde), Training/Qualifying Stand am
// Ende. Live dazu eine Regenprognose für die nächsten 2 h an der Strecke
// (/f1data/rain, Open-Meteo), alle 10 min neu.
//
// Antippen öffnet das Wetter-Fenster (#wxsheet):
//  · Verlauf der Session: Luft/Strecke, Regen schraffiert — in der Nachschau
//    nur bis zur gewählten Runde. Quelle: Rennen race.wx, Training/Quali
//    OpenF1 /weather, live der Verlauf des DO (je Minute) + eigene Abfragen.
//  · live: Prognose 2 h (15-min-Balken) und Regenradar (RainViewer, letzte
//    2 h als Film) auf einer Karte um die Strecke.
// ====================================================================
(function () {
  "use strict";
  const { S, $, esc, store, fmtClock } = window.RT;
  const n1 = v => v.toLocaleString("de-AT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const deg = v => Math.round(v) + "°";
  let rain = { key: "", at: 0, data: null };
  let liveWx = { key: "", list: [] };          // live: Wetter je Minute
  let sesWx = { key: "", list: null, err: false };   // Training/Qualifying: OpenF1 /weather
  let hover = null;                            // Zeitpunkt unter dem Finger (Verlauf)

  const rainKey = ses => (ses.location || "") + "|" + (ses.country || "");
  async function loadRain(ses) {
    const key = rainKey(ses);
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
  const rainNow = () => {
    const ses = (S.race && S.race.session) || {};
    return S.race && S.race.live && rain.data && rain.key === rainKey(ses) ? rain.data : null;
  };

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

  // Verlauf bis zum aktuellen Stand → [{ t, air, track, hum, rain, wind, dir }] | null (lädt noch)
  function series() {
    const race = S.race, f = race.frames[S.frame];
    if (race.live) return liveWx.list;
    if (race.archive) {
      const key = String((race.session || {}).key);
      if (sesWx.key !== key) loadSesWx(key);
      return sesWx.err ? [] : sesWx.list;
    }
    const wx = race.wx || [];
    return f.final || !f.t ? wx : wx.filter(x => x.t <= f.t);
  }
  async function loadSesWx(key) {
    sesWx = { key, list: null, err: false };
    try {
      const raw = await RT.get("weather", { session_key: key });
      if (sesWx.key !== key) return;
      sesWx.list = (raw || []).map(w => ({ t: Date.parse(w.date), ...RT.M.weather(w) })).filter(w => isFinite(w.t) && w.air != null).sort((a, b) => a.t - b.t);
    } catch (_) { if (sesWx.key === key) sesWx.err = true; }
    renderSheet();
  }

  // ---------- Wetter-Fenster ----------
  const SVG_W = 340;
  // Messausreißer (OpenF1: Streckentemperatur springt kurz auf 0° oder +12°)
  // → durch den Median der Nachbarn ersetzen
  function despike(list) {
    const med = xs => { const s = xs.slice().sort((a, b) => a - b); return s[s.length >> 1]; };
    return list.map((p, i) => {
      const q = { ...p };
      for (const k of ["air", "track"]) {
        const win = list.slice(Math.max(0, i - 2), i + 3).map(x => x[k]).filter(v => v != null);
        if (p[k] != null && win.length >= 3) { const m = med(win); if (Math.abs(p[k] - m) > 4) q[k] = m; }
      }
      return q;
    });
  }
  function chartSvg(list, W) {
    list = despike(list);
    const L = 30, R = 64, T = 10, B = 22, H = 170, pw = W - L - R, ph = H - T - B;
    const t0 = list[0].t, t1 = Math.max(list[list.length - 1].t, t0 + 60000);
    const vals = list.flatMap(x => [x.air, x.track]).filter(v => v != null);
    const lo = Math.floor((Math.min(...vals) - 1) / 5) * 5, hi = Math.ceil((Math.max(...vals) + 1) / 5) * 5;
    const x = t => L + (t - t0) / (t1 - t0) * pw, y = v => T + (hi - v) / ((hi - lo) || 1) * ph;
    let s = `<svg viewBox="0 0 ${W} ${H}" class="wxsvg" role="img" aria-label="Temperaturverlauf der Session"><defs><pattern id="wx-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" class="hatch"/></pattern></defs>`;
    // Regen: schraffierte Bänder (eigene Textur statt dritter Farbe)
    for (let i = 0; i < list.length; i++) {
      if (!list[i].rain) continue;
      let j = i; while (j + 1 < list.length && list[j + 1].rain) j++;
      const a = x(list[i].t), b = j + 1 < list.length ? x(list[j + 1].t) : x(list[j].t) + 2;
      s += `<rect class="wx-rain" x="${a.toFixed(1)}" y="${T}" width="${Math.max(2, b - a).toFixed(1)}" height="${ph}"/>`;
      i = j;
    }
    // Raster: °C alle 5, Uhrzeit etwa alle 30 min
    for (let v = lo; v <= hi; v += 5) s += `<line class="grid" x1="${L}" x2="${L + pw}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 5}" y="${y(v) + 3.5}" text-anchor="end">${v}°</text>`;
    const step = (t1 - t0) > 3 * 3600e3 ? 3600e3 : (t1 - t0) > 70 * 60000 ? 30 * 60000 : 15 * 60000;
    for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) s += `<text class="ax" x="${x(t)}" y="${H - 6}" text-anchor="middle">${fmtClock(t)}</text>`;
    // Linien + Beschriftung am Ende (Wert in Textfarbe, Linie trägt die Farbe)
    const lines = [["track", "Strecke"], ["air", "Luft"]].map(([k, name]) => {
      const pts = list.filter(p => p[k] != null).map(p => [x(p.t), y(p[k])]);
      return { k, name, pts, last: list.filter(p => p[k] != null).pop() };
    });
    const labY = lines.map(l => (l.pts.length ? l.pts[l.pts.length - 1][1] : 0));
    if (Math.abs(labY[0] - labY[1]) < 13) { const m = (labY[0] + labY[1]) / 2, up = labY[0] <= labY[1] ? 0 : 1; labY[up] = m - 6.5; labY[1 - up] = m + 6.5; }
    lines.forEach((l, i) => {
      if (l.pts.length < 2) return;
      s += `<path class="wx-ln ${l.k}" d="M${l.pts.map(p => p[0].toFixed(1) + "," + p[1].toFixed(1)).join("L")}"/>`;
      const e = l.pts[l.pts.length - 1];
      s += `<circle class="wx-end ${l.k}" cx="${e[0].toFixed(1)}" cy="${e[1].toFixed(1)}" r="3"/><text class="wx-lab" x="${(e[0] + 6).toFixed(1)}" y="${(labY[i] + 3.5).toFixed(1)}">${l.name} ${deg(l.last[l.k])}</text>`;
    });
    if (hover != null) {
      const p = nearest(list, hover);
      s += `<line class="cross" x1="${x(p.t)}" x2="${x(p.t)}" y1="${T}" y2="${T + ph}"/>`;
      for (const k of ["track", "air"]) if (p[k] != null) s += `<circle class="wx-end ${k}" cx="${x(p.t).toFixed(1)}" cy="${y(p[k]).toFixed(1)}" r="4"/>`;
    }
    return { svg: s + "</svg>", geo: { W, L, pw, t0, t1 } };
  }
  const nearest = (list, t) => list.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
  const wxLine = w => [
    `<b>${fmtClock(w.t)}</b>`,
    w.track != null ? `Strecke ${deg(w.track)}` : "", w.air != null ? `Luft ${deg(w.air)}` : "",
    w.hum != null ? `Feuchte ${Math.round(w.hum)} %` : "", w.wind != null ? `Wind ${n1(w.wind)} m/s` : "",
    w.rain ? `<span class="wx-r">Regen</span>` : "trocken",
  ].filter(Boolean).join(" · ");

  // Prognose 2 h: Balken = Regenwahrscheinlichkeit je 15 min
  function forecastHtml(slots) {
    const now = Date.now(), next = (slots || []).filter(x => x.t + 15 * 60000 > now).slice(0, 8);
    if (!next.length) return "";
    const W = SVG_W, H = 96, T = 14, B = 18, L = 4, bw = (W - L * 2) / next.length, ph = H - T - B;
    let s = `<svg viewBox="0 0 ${W} ${H}" class="wxsvg fcsvg" role="img" aria-label="Regenwahrscheinlichkeit der nächsten 2 Stunden">`;
    s += `<line class="grid" x1="${L}" x2="${W - L}" y1="${T + ph}" y2="${T + ph}"/>`;
    next.forEach((x, i) => {
      const h = Math.max(1.5, x.p / 100 * ph), bx = L + i * bw + 1;
      s += `<rect class="fc-bar${x.mm >= 0.1 ? " wet" : ""}" x="${bx.toFixed(1)}" y="${(T + ph - h).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="3"><title>${fmtClock(x.t)}: ${Math.round(x.p)} % · ${x.mm.toFixed(1)} mm</title></rect>`;
      if (x.p >= 20) s += `<text class="fc-val" x="${(bx + bw / 2 - 1).toFixed(1)}" y="${(T + ph - h - 3).toFixed(1)}" text-anchor="middle">${Math.round(x.p)} %</text>`;
      if (i % 2 === 0) s += `<text class="ax" x="${(bx + bw / 2 - 1).toFixed(1)}" y="${H - 5}" text-anchor="middle">${fmtClock(x.t)}</text>`;
    });
    return s + "</svg>";
  }

  // ---------- Regenradar-Karte ----------
  // Kacheln (Web-Mercator, Zoom 7 ≈ 1 km/Pixel) um die Strecke; Radarbilder
  // der letzten 2 h übereinander, eines sichtbar → als Film abgespielt.
  const Z = 7;
  let radar = { at: 0, frames: null, err: false }, rIdx = -1, rTimer = null, rPlay = true;
  async function loadRadar() {
    if (radar.frames && Date.now() - radar.at < 5 * 60000) return;
    try { const d = await RT.get("radar", {}); radar = { at: Date.now(), frames: d.frames || [], err: false }; rIdx = -1; }
    catch (_) { radar = { at: Date.now(), frames: radar.frames, err: !radar.frames }; }
    renderSheet();
  }
  const tilePos = (lat, lon) => {
    const n = 2 ** Z, r = lat * Math.PI / 180;
    return [(lon + 180) / 360 * n * 256, (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n * 256];
  };
  function radarHtml(geo, W) {
    const H = Math.round(Math.min(W, 360) * 0.86);
    const [cx, cy] = tilePos(geo.lat, geo.lon), ox = cx - W / 2, oy = cy - H / 2;
    const tiles = [];
    for (let tx = Math.floor(ox / 256); tx <= Math.floor((ox + W) / 256); tx++)
      for (let ty = Math.floor(oy / 256); ty <= Math.floor((oy + H) / 256); ty++) tiles.push([tx, ty]);
    const img = (q, tx, ty) => `<img alt="" src="/f1data/tile?${new URLSearchParams({ ...q, z: Z, x: tx, y: ty })}" style="left:${Math.round(tx * 256 - ox)}px;top:${Math.round(ty * 256 - oy)}px" loading="lazy" decoding="async">`;
    let s = `<div class="radar" style="height:${H}px">`;
    s += `<div class="r-base">${tiles.map(([tx, ty]) => img({ k: "base" }, tx, ty)).join("")}</div>`;
    (radar.frames || []).forEach((f, i) => { s += `<div class="r-frame" data-i="${i}">${tiles.map(([tx, ty]) => img({ k: "radar", id: f.id }, tx, ty)).join("")}</div>`; });
    // Ringe 25/50/100 km um die Strecke
    const mpp = 156543.03392 * Math.cos(geo.lat * Math.PI / 180) / 2 ** Z;
    s += `<svg class="r-rings" viewBox="0 0 ${W} ${H}" aria-hidden="true">${[25, 50, 100].map(km => {
      const r = km * 1000 / mpp;
      return `<circle cx="${W / 2}" cy="${H / 2}" r="${r.toFixed(1)}"/><text x="${(W / 2 + r * 0.71 + 3).toFixed(1)}" y="${(H / 2 - r * 0.71 - 3).toFixed(1)}">${km} km</text>`;
    }).join("")}<circle class="r-me" cx="${W / 2}" cy="${H / 2}" r="5"/></svg>`;
    s += `<div class="r-bar"><button type="button" class="icon-btn" id="r-play" aria-label="${rPlay ? "Anhalten" : "Abspielen"}">${rPlay ? "❚❚" : "▶"}</button><span id="r-time"></span></div>`;
    return s + `</div><p class="sheet-note r-src">Radar der letzten 2 h: RainViewer · Karte © OpenStreetMap-Mitwirkende</p>`;
  }
  function showFrame(i) {
    const fr = radar.frames || [];
    if (!fr.length) return;
    rIdx = (i + fr.length) % fr.length;
    document.querySelectorAll("#wxsheet .r-frame").forEach(el => el.classList.toggle("on", +el.dataset.i === rIdx));
    const t = fr[rIdx].t, ago = Math.round((Date.now() - t) / 60000);
    const lbl = $("r-time");
    if (lbl) lbl.textContent = `${fmtClock(t)} · ${ago <= 10 ? "jüngstes Bild" : `vor ${ago} min`}`;
  }
  function radarLoop() {
    clearTimeout(rTimer);
    if ($("wxsheet").hidden || !rPlay || !(radar.frames || []).length) return;
    const last = rIdx === radar.frames.length - 1;
    showFrame(rIdx + 1);
    rTimer = setTimeout(radarLoop, rIdx === radar.frames.length - 1 ? 1600 : last ? 400 : 450);
  }

  function renderSheet() {
    const sheet = $("wxsheet");
    if (sheet.hidden || !S.race) return;
    const race = S.race, ses = race.session || {}, live = !!race.live;
    const f = race.frames[S.frame];
    const m = (S.meetings || []).find(x => x.sessions.some(y => y.session_key === ses.key));
    $("wx-sub").textContent = [ses.meeting || (m && m.name) || "", ses.name || ""].filter(Boolean).join(" · ") + (!live && !f.final && f.lap ? ` · bis Runde ${f.lap}` : "");
    // Verlauf
    const list = series(), box = $("wx-chart");
    const W = Math.max(280, Math.min(560, box.clientWidth || SVG_W));
    if (list == null) box.innerHTML = `<p class="chart-empty"><span class="spinner"></span></p>`;
    else if (list.length < 2) box.innerHTML = `<p class="chart-empty">${live ? "Der Verlauf füllt sich ab jetzt Minute für Minute." : "Für diese Session gibt es keinen Wetterverlauf."}</p>`;
    else { const c = chartSvg(list, W); box.innerHTML = c.svg; box.dataset.geo = JSON.stringify(c.geo); }
    const shown = list && list.length ? despike(list) : null;
    $("wx-info").innerHTML = shown ? wxLine(hover != null ? nearest(shown, hover) : shown[shown.length - 1]) : "";
    // Prognose + Radar nur live (für vergangene Sessions gibt es kein Radar mehr)
    const rn = rainNow();
    $("wx-live").hidden = !live;
    if (!live) return;
    if (!ses.location) { $("wx-fc").innerHTML = `<p class="chart-empty">Ort der Strecke unbekannt – keine Prognose.</p>`; $("wx-radar").innerHTML = ""; return; }
    $("wx-fc").innerHTML = rn ? forecastHtml(rn.slots) || `<p class="chart-empty">Keine Prognose verfügbar.</p>` : `<p class="chart-empty"><span class="spinner"></span></p>`;
    const rb = $("wx-radar");
    if (!rn || rn.lat == null) { rb.innerHTML = `<p class="chart-empty">${rn ? "Ort der Strecke unbekannt." : ""}</p>`; return; }
    if (!radar.frames) { rb.innerHTML = radar.err ? `<p class="chart-empty">Radar gerade nicht erreichbar.</p>` : `<p class="chart-empty"><span class="spinner"></span></p>`; return; }
    const RW = Math.max(280, Math.min(560, rb.clientWidth || SVG_W));
    const sig = [rn.lat, rn.lon, RW, document.documentElement.dataset.theme, radar.frames.map(x => x.id).join()].join("|");
    if (rb.dataset.sig !== sig) {
      rb.dataset.sig = sig; rb.innerHTML = radarHtml(rn, RW);
      showFrame(rIdx < 0 ? radar.frames.length - 1 : rIdx);
      radarLoop();
    }
  }
  function openSheet() {
    if (!S.race) return;
    hover = null;
    $("wxsheet").hidden = false;
    $("wx-radar").dataset.sig = "";
    if (S.race.live) { loadRain(S.race.session || {}); loadRadar(); }
    renderSheet();
  }
  function closeSheet() { $("wxsheet").hidden = true; clearTimeout(rTimer); }
  function pointer(e) {
    const box = $("wx-chart"), svg = box.querySelector("svg");
    if (!svg || !box.dataset.geo) return;
    const g = JSON.parse(box.dataset.geo), r = svg.getBoundingClientRect();
    const px = (e.clientX - r.left) * (g.W / r.width);
    hover = px < g.L || px > g.L + g.pw ? null : g.t0 + (px - g.L) / g.pw * (g.t1 - g.t0);
    renderSheet();
  }

  RT.on("show", f => {
    const box = $("wx");
    const w = S.race ? current(f) : null;
    if (S.race && S.race.live) {
      loadRain(S.race.session || {});
      // eigener Verlauf je Minute (ergänzt den des DO)
      const key = String((S.race.session || {}).path || (S.race.session || {}).key || "");
      if (liveWx.key !== key) liveWx = { key, list: [] };
      const last = liveWx.list[liveWx.list.length - 1];
      if (w && (!last || Date.now() - last.t >= 60000)) liveWx.list.push({ t: Date.now(), ...w });
    }
    const rn = rainNow();
    const fc = rn ? rainChip(rn.slots, w && w.rain) : "";
    if (!w && !fc) { box.hidden = true; return; }
    box.hidden = false;
    if (!w) { box.innerHTML = fc + `<span class="wx-more" aria-hidden="true">Wetter ›</span>`; return; }
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
      `<span class="wx-more" aria-hidden="true">Verlauf ›</span>`,
    ].join("");
    if (!$("wxsheet").hidden) renderSheet();
  });
  // Verlauf vom Server (live, ganze Session) einmischen
  RT.on("livehist", h => {
    if (!h || !h.wx || !h.wx.length) return;
    const key = h.key || liveWx.key;
    const have = liveWx.key === key ? liveWx.list : [];
    const known = new Set(h.wx.map(x => Math.round(x.t / 60000)));
    liveWx = { key, list: h.wx.concat(have.filter(x => !known.has(Math.round(x.t / 60000)))).sort((a, b) => a.t - b.t) };
    renderSheet();
  });
  RT.on("loading", () => { $("wx").hidden = true; closeSheet(); });

  $("wx").addEventListener("click", openSheet);
  $("wx").addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openSheet(); } });
  $("wx-close").addEventListener("click", closeSheet);
  $("wxsheet").addEventListener("click", e => {
    if (e.target.id === "wxsheet") { closeSheet(); return; }
    const b = e.target.closest("#r-play");
    if (b) { rPlay = !rPlay; b.textContent = rPlay ? "❚❚" : "▶"; b.setAttribute("aria-label", rPlay ? "Anhalten" : "Abspielen"); radarLoop(); return; }
    if (e.target.closest(".radar") && !rPlay) showFrame(rIdx + 1);   // angehalten: Tippen = nächstes Bild
  });
  $("wx-chart").addEventListener("click", pointer);
  $("wx-chart").addEventListener("pointermove", e => { if (e.pointerType === "mouse") pointer(e); });
  $("wx-chart").addEventListener("pointerleave", () => { if (hover != null) { hover = null; renderSheet(); } });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("wxsheet").hidden) closeSheet(); });
  window.addEventListener("resize", () => { if (!$("wxsheet").hidden) renderSheet(); });
})();
