// ====================================================================
// Rennticker — Live-Karte ohne GPS: Eichung der Strecke. Reine Funktionen
// (Browser: window.F1Track, Tests/Node: require), entpacken wird von außen
// hineingereicht (Browser: DecompressionStream, Node: zlib).
//
// Idee: Die Zeitmessung meldet je Auto jeden der ~25 Mini-Sektoren einer
// Runde (Status ≠ 0, der Reihe nach, nach der Ziellinie alle wieder 0). Aus
// einer früheren Session derselben Strecke nehmen wir eine schnelle, saubere
// Runde: GPS-Spur dieser Runde = Streckenverlauf, und wo das Auto beim
// Melden jedes Mini-Sektors war = Lage der Mini-Sektor-Grenzen. Live wird
// jedes Auto dann an seine letzte Grenze gesetzt und gleitet mit der
// typischen Dauer zur nächsten.
//
//   cal = { pts: [[x,y]…], cum: [m…], len, segF: [0..1…], segDur: [s…], counts: [8,8,8], lap }
// ====================================================================
(function (root) {
  "use strict";
  const LINE = /^(\d\d):(\d\d):(\d\d(?:\.\d+)?)(.*)$/;
  const off = m => +m[1] * 3600 + +m[2] * 60 + +m[3];
  const arr = v => (Array.isArray(v) ? v.map((x, i) => [i, x]) : v && typeof v === "object" ? Object.entries(v) : []);

  // Zeitmessung (TimingData.jsonStream) → saubere Runden je Fahrer:
  //   [{ n, t0, t1, seg: [t…] (je Mini-Sektor, flach), counts }]
  function timingLaps(text) {
    // 1. Durchgang: Ereignisse sammeln, Mini-Sektoren je Sektor = höchste Nummer + 1
    const evs = [], max = [];
    for (const line of String(text).replace(/^﻿/, "").split(/\r?\n/)) {
      const m = LINE.exec(line);
      if (!m || m[4].charAt(0) !== "{") continue;
      let j; try { j = JSON.parse(m[4]); } catch (_) { continue; }
      const t = off(m);
      for (const [n, c] of Object.entries((j && j.Lines) || {})) {
        if (!c || typeof c !== "object") continue;
        const segs = [];
        for (const [si, sec] of arr(c.Sectors)) for (const [ki, sg] of arr(sec && sec.Segments)) {
          if (+si > 5 || +ki > 30) continue;
          max[+si] = Math.max(max[+si] ?? -1, +ki);
          if (sg && sg.Status) segs.push([+si, +ki]);
        }
        evs.push({ t, n, segs, lap: c.NumberOfLaps != null, pit: c.InPit });
      }
    }
    if (!max.length || max.some(x => x == null)) return [];
    const counts = max.map(x => x + 1);
    const base = counts.map((_, i) => counts.slice(0, i).reduce((a, b) => a + b, 0));
    // 2. Durchgang: Runden zusammensetzen
    const st = new Map();    // n → { lapT, seg: Map g→t, pit }
    const out = [];
    for (const e of evs) {
      const n = e.n, t = e.t;
      let s = st.get(n);
      if (!s) st.set(n, (s = { lapT: null, seg: new Map(), pit: false }));
      if (e.pit != null) s.pit = !!e.pit;
      // Kurz nach der Ziellinie kommen noch Nachzügler der alten Runde → nur den ersten Mini-Sektor zählen
      for (const [si, ki] of e.segs) {
        const g = base[si] + ki;
        if (s.lapT != null && t - s.lapT < 2.5 && g !== 0) continue;
        if (!s.seg.has(g)) s.seg.set(g, t);
      }
      {
        const lapDone = e.lap;
        if (lapDone) {
          const total = counts ? counts.reduce((a, b) => a + b, 0) : 0;
          // Runde fertig: alle Mini-Sektoren dabei, der Reihe nach?
          if (s.lapT != null && total && s.seg.size === total) {
            const seg = [...Array(total).keys()].map(g => s.seg.get(g));
            const mono = seg.every((x, i) => i === 0 || x >= seg[i - 1]);
            if (mono && seg[0] >= s.lapT && !s.pit) out.push({ n: +n, t0: s.lapT, t1: t, seg, counts });
          }
          s.lapT = t;
          s.seg = new Map();
        }
      }
    }
    return out.map(l => ({ ...l, time: l.t1 - l.t0 }));
  }

  // Schnellste glaubwürdige Runde (≤ 3 % über der Bestzeit der Session)
  function pickLap(laps) {
    const ok = laps.filter(l => l.time > 40 && l.time < 200);
    if (!ok.length) return null;
    const best = Math.min(...ok.map(l => l.time));
    return ok.filter(l => l.time <= best * 1.03).sort((a, b) => a.time - b.time)[0];
  }

  // GPS-Spur eines Autos im Zeitfenster aus Position.z.jsonStream.
  // inflate(base64) → Promise<string JSON>. Zeit je Eintrag: Offset der
  // Zeile minus Abstand zum jüngsten Zeitstempel in der Zeile.
  async function trackOf(text, n, t0, t1, inflate) {
    const pts = [];
    for (const line of String(text).replace(/^﻿/, "").split(/\r?\n/)) {
      const m = LINE.exec(line);
      if (!m) continue;
      const t = off(m);
      if (t < t0 - 2 || t > t1 + 3) continue;
      const b = /"([A-Za-z0-9+/=]+)"/.exec(m[4]);
      if (!b) continue;
      let j; try { j = JSON.parse(await inflate(b[1])); } catch (_) { continue; }
      const list = (j && j.Position) || [];
      const last = list.length ? Date.parse(list[list.length - 1].Timestamp) : NaN;
      for (const p of list) {
        const e = p.Entries && p.Entries[n];
        if (!e || (!e.X && !e.Y)) continue;
        pts.push({ t: t - (last - Date.parse(p.Timestamp)) / 1000, x: e.X, y: e.Y });
      }
    }
    return pts.sort((a, b) => a.t - b.t);
  }

  // Spur + Mini-Sektor-Zeiten → Eichung
  function buildCal(track, lap) {
    const P = track.filter(p => p.t >= lap.t0 && p.t <= lap.t1);
    if (P.length < 100) return null;
    const cum = [0];
    for (let i = 1; i < P.length; i++) cum.push(cum[i - 1] + Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y));
    const len = cum[cum.length - 1];
    // Strecke muss geschlossen sein (Start ≈ Ende) und plausibel lang (2–8 km, Einheit 1/10 m)
    const gap = Math.hypot(P[0].x - P[P.length - 1].x, P[0].y - P[P.length - 1].y);
    if (len < 20000 || len > 80000 || gap > len * 0.03) return null;
    const at = t => {        // Strecke (Anteil) zu einem Zeitpunkt
      let i = P.findIndex(p => p.t >= t);
      if (i <= 0) return i === 0 ? 0 : 1;
      const a = P[i - 1], b = P[i], k = (t - a.t) / ((b.t - a.t) || 1);
      return (cum[i - 1] + k * (cum[i] - cum[i - 1])) / len;
    };
    const segF = lap.seg.map(at);
    const segDur = lap.seg.map((t, i) => +(t - (i ? lap.seg[i - 1] : lap.t0)).toFixed(2));
    // Ausdünnen (≥ 3 m), ganzzahlig
    const pts = [], cumT = [];
    let lastI = -1;
    P.forEach((p, i) => { if (lastI < 0 || cum[i] - cum[lastI] >= 30 || i === P.length - 1) { pts.push([Math.round(p.x), Math.round(p.y)]); cumT.push(Math.round(cum[i])); lastI = i; } });
    return { pts, cum: cumT, len: Math.round(len), segF: segF.map(f => +f.toFixed(4)), segDur, counts: lap.counts, lap: +lap.time.toFixed(3) };
  }

  // Punkt bei Anteil f (0..1) der Runde
  function pointAt(cal, f) {
    f = ((f % 1) + 1) % 1;
    const d = f * cal.len, c = cal.cum;
    let lo = 0, hi = c.length - 1;
    while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (c[mid] <= d) lo = mid; else hi = mid; }
    const k = (d - c[lo]) / ((c[hi] - c[lo]) || 1);
    const a = cal.pts[lo], b = cal.pts[hi];
    return [a[0] + k * (b[0] - a[0]), a[1] + k * (b[1] - a[1])];
  }
  // Anteil der Runde: letzte gemeldete Grenze g, seit age Sekunden; gleitet
  // mit der typischen Dauer zur nächsten (bleibt kurz davor stehen, bis sie kommt)
  function fracOf(cal, g, age, pace) {
    const N = cal.segF.length;
    if (!(g >= 0 && g < N)) return null;
    const a = cal.segF[g], nx = (g + 1) % N;
    let b = cal.segF[nx];
    if (b < a) b += 1;
    const dur = cal.segDur[nx] * (pace || 1);
    const k = Math.max(0, Math.min(0.97, (age || 0) / (dur || 1)));
    return (a + k * (b - a)) % 1;
  }

  // Weiche Nachführung für die Anzeige (läuft je Bild): Das Auto fährt mit
  // seinem geschätzten Tempo weiter und wird sanft zur Schätzung gezogen —
  // kein Stehenbleiben an der Grenze, nie rückwärts. Nur bei großem Abstand
  // (Box, Neustart) wird gesprungen.  st = { f } (Anteil 0..1), speed = Anteil/s
  const wrapD = d => ((d % 1) + 1.5) % 1 - 0.5;
  function follow(st, target, speed, dt) {
    if (target == null) return st;
    if (!st || Math.abs(wrapD(target - st.f)) > 0.12) return { f: target };
    const pred = st.f + speed * dt;
    let corr = wrapD(target - pred) * Math.min(1, dt * 1.2);
    if (corr < -speed * dt) corr = -speed * dt;            // höchstens stehen bleiben
    return { f: (((pred + corr) % 1) + 1) % 1 };
  }
  // Tempo zwischen Grenze g und der nächsten (Anteil/s)
  function speedAt(cal, g, pace) {
    const N = cal.segF.length, nx = (g + 1) % N;
    let d = cal.segF[nx] - cal.segF[g];
    if (d < 0) d += 1;
    return d / ((cal.segDur[nx] || 1) * (pace || 1));
  }

  const api = { timingLaps, pickLap, trackOf, buildCal, pointAt, fracOf, follow, speedAt };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.F1Track = api;
})(typeof window !== "undefined" ? window : globalThis);
