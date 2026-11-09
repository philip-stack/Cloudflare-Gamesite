// ====================================================================
// Rennticker — Live-Karte ohne GPS: Eichung der Strecke. Reine Funktionen
// (Browser: window.F1Track, Worker/Tests: import/require).
//
// Idee: Die Zeitmessung meldet je Auto jeden der ~25 Mini-Sektoren einer
// Runde (der Reihe nach, nach der Ziellinie wieder von vorn). Live wird jedes
// Auto an seine letzte Grenze gesetzt und gleitet mit der typischen Dauer zur
// nächsten. Dafür braucht es die Strecke und wo die Grenzen liegen:
//  · Spur einer schnellen Runde aus OpenF1 (location + laps, openf1Lap; der
//    Cron legt sie vor jedem Wochenende an). OpenF1 zählt die Mini-Sektoren
//    nur → innerhalb jedes Sektors gleichmäßig in der Zeit verteilt
//    (approx; Singapur: Median ~50 m daneben).
//  · Live misst das DO die echten Grenz-Zeiten jeder sauberen Runde
//    (lapRecStep) und schärft nach (refineCal): Anteil der Zeit im Sektor →
//    Ort über das Tempoprofil der Spur (Singapur: Median ~6 m).
//
//   cal = { pts: [[x,y]…], cum: [m…], len, segF: [0..1…], segDur: [s…], counts: [8,8,8], lap,
//           approx, prof: [[s, Anteil]…], sec: [S1, S1+S2, Runde], refined }
// ====================================================================
(function (root) {
  "use strict";
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
    // Genähert: Tempoprofil (Zeit → Anteil, ~0,5 s) und Sektorgrenzen fürs Nachschärfen
    const extra = {};
    if (lap.approx) {
      const prof = [];
      for (let t = lap.t0; t < lap.t1; t += 0.5) prof.push([+(t - lap.t0).toFixed(2), +at(t).toFixed(5)]);
      prof.push([+lap.time.toFixed(2), 1]);
      Object.assign(extra, { approx: true, prof, sec: lap.sec });
    }
    // Ausdünnen (≥ 3 m), ganzzahlig
    const pts = [], cumT = [];
    let lastI = -1;
    P.forEach((p, i) => { if (lastI < 0 || cum[i] - cum[lastI] >= 30 || i === P.length - 1) { pts.push([Math.round(p.x), Math.round(p.y)]); cumT.push(Math.round(cum[i])); lastI = i; } });
    return { pts, cum: cumT, len: Math.round(len), segF: segF.map(f => +f.toFixed(4)), segDur, counts: lap.counts, lap: +lap.time.toFixed(3), ...extra };
  }

  // OpenF1: Runde (laps-Zeile) + GPS-Punkte (location-Zeilen) → Eingaben für
  // buildCal. Mini-Sektoren je Sektor gleichmäßig in der Zeit verteilt.
  function openf1Lap(lap, loc) {
    const dur = lap && lap.lap_duration, s1 = lap && lap.duration_sector_1, s2 = lap && lap.duration_sector_2;
    const counts = [lap && lap.segments_sector_1, lap && lap.segments_sector_2, lap && lap.segments_sector_3].map(a => (Array.isArray(a) ? a.length : 0));
    if (!(dur > 40 && s1 > 0 && s2 > 0 && dur > s1 + s2) || counts.some(c => !c)) return null;
    const t00 = Date.parse(lap.date_start);
    const track = (loc || []).filter(p => p && (p.x || p.y)).map(p => ({ t: (Date.parse(p.date) - t00) / 1000, x: p.x, y: p.y })).sort((a, b) => a.t - b.t);
    const bounds = [0, s1, s1 + s2, dur], seg = [];
    counts.forEach((n, j) => { for (let k = 1; k <= n; k++) seg.push(bounds[j] + k / n * (bounds[j + 1] - bounds[j])); });
    return { track, lap: { t0: 0, t1: dur, time: dur, seg, counts, approx: true, sec: [+s1.toFixed(3), +(s1 + s2).toFixed(3), +dur.toFixed(3)] } };
  }

  // Live: eine Runde je Auto aus den gemeldeten Mini-Sektoren mitschreiben.
  //   rec = { last, t0, seg: { g: t }, bad }   g = durchlaufene Grenze (0..N-1), t in s
  //   → { rec, lap } — lap = { t0, seg: [t…] } wenn eine saubere Runde fertig ist
  function lapRecStep(rec, g, t, N, pit) {
    rec = rec || { last: -1, t0: null, seg: {}, bad: true };
    let lap = null;
    if (g === rec.last) return { rec, lap };
    if (g === 0 || g < rec.last) {
      // Neue Runde; Ziellinie (Grenze N-1) war ihr Start. Erste Grenze verpasst → nicht verwertbar
      const t0 = rec.last === N - 1 && rec.seg[N - 1] != null ? rec.seg[N - 1] : null;
      rec = { last: g, t0, seg: { [g]: t }, bad: g !== 0 || t0 == null || !!pit };
    } else {
      if (g !== rec.last + 1) rec.bad = true;        // Grenze verpasst / Feed-Lücke
      rec.seg[g] = t; rec.last = g;
      if (pit) rec.bad = true;
      if (g === N - 1 && !rec.bad && rec.t0 != null) {
        const seg = [...Array(N).keys()].map(k => rec.seg[k]);
        if (seg.every((x, i) => x != null && x > (i ? seg[i - 1] : rec.t0))) lap = { t0: rec.t0, seg };
      }
    }
    return { rec, lap };
  }

  // Anteil der Strecke zur Zeit t der Eichrunde (Tempoprofil prof)
  function profAt(P, t) {
    let i = P.findIndex(p => p[0] >= t);
    if (i <= 0) return i === 0 ? P[0][1] : 1;
    const a = P[i - 1], b = P[i];
    return a[1] + (b[1] - a[1]) * (t - a[0]) / ((b[0] - a[0]) || 1);
  }
  // Andere Mini-Sektor-Aufteilung als in der Eichrunde (z. B. Vorjahr): neu
  // verteilen, wieder gleichmäßig in der Zeit je Sektor
  function resegCal(cal, counts) {
    if (!cal || !cal.prof || !cal.sec || !counts || counts.length !== cal.sec.length) return null;
    const ref = [0, ...cal.sec], segT = [];
    counts.forEach((n, j) => { for (let k = 1; k <= n; k++) segT.push(ref[j] + k / n * (ref[j + 1] - ref[j])); });
    return { ...cal, counts: counts.slice(), segF: segT.map(t => +profAt(cal.prof, t).toFixed(4)), segDur: segT.map((t, i) => +(t - (i ? segT[i - 1] : 0)).toFixed(2)), refined: 0 };
  }

  // Genäherte Eichung mit gemessenen Runden nachschärfen (Median je Grenze).
  // Nur Runden ≤ 107 % der schnellsten (keine SC-/Aus-/Einfahrrunden).
  // counts = Aufteilung laut Feed; weicht sie ab, erst neu verteilen.
  //   → neue Eichung | null (nichts zu ändern)
  function refineCal(cal, laps, counts) {
    if (!cal || !cal.prof || !cal.sec) return null;
    const moved = counts && String(counts) !== String(cal.counts);
    if (moved) cal = resegCal(cal, counts);
    if (!cal) return null;
    const N = cal.segF.length;
    counts = cal.counts;
    const base = counts.map((_, i) => counts.slice(0, i).reduce((a, b) => a + b, 0));
    const ok0 = (laps || []).filter(l => l && l.seg && l.seg.length === N);
    const best = ok0.length ? Math.min(...ok0.map(l => l.seg[N - 1] - l.t0)) : 0;
    const ok = ok0.filter(l => l.seg[N - 1] - l.t0 <= best * 1.07);
    if (ok.length < 3) return moved ? cal : null;
    const P = cal.prof, ref = [0, ...cal.sec];
    const fAt = t => profAt(P, t);
    const med = xs => { const s = xs.slice().sort((a, b) => a - b); return s[s.length >> 1]; };
    const segF = [], segDur = [];
    for (let j = 0; j < counts.length; j++) for (let k = 0; k < counts[j]; k++) {
      const g = base[j] + k, end = base[j] + counts[j] - 1;
      const fr = [], du = [];
      for (const l of ok) {
        const a = j ? l.seg[base[j] - 1] : l.t0, b = l.seg[end];
        fr.push(fAt(ref[j] + (l.seg[g] - a) / ((b - a) || 1) * (ref[j + 1] - ref[j])));
        du.push((l.seg[g] - (g ? l.seg[g - 1] : l.t0)) * cal.lap / (l.seg[N - 1] - l.t0));
      }
      segF.push(+med(fr).toFixed(4)); segDur.push(+med(du).toFixed(2));
    }
    return { ...cal, segF, segDur, refined: ok.length };
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

  const api = { resegCal, buildCal, pointAt, fracOf, follow, speedAt, openf1Lap, lapRecStep, refineCal };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.F1Track = api;
})(typeof window !== "undefined" ? window : globalThis);
