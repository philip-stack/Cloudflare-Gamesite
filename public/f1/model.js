// ====================================================================
// Rennticker — Rechenkern: macht aus den OpenF1-Rohdaten einer Session
// einen Stand je Runde („Frames"). Reine Funktionen, kein DOM, kein Netz —
// läuft im Browser (window.F1Model, für app.js) und in den Tests
// (tests/f1.test.mjs, per require). Klassisches Skript statt ES-Modul, damit
// scripts/bump-assets.mjs es per ?v= mit-busten kann.
//
//   buildRace(raw) → { drivers, laps, frames: [{ lap, t, status, rows, msgs }] }
//
// Frame 0 = Startaufstellung, Frame k = Moment, in dem der Führende Runde k
// beendet, letzter Frame = offizielles Ergebnis (session_result).
// ====================================================================

(function (root) {
  "use strict";
  const ts = d => (d ? Date.parse(d) : NaN);
  const num = v => (typeof v === "number" && isFinite(v) ? v : null);

  // Letzter Eintrag mit time ≤ t (Liste nach time sortiert).
  function lastBefore(list, t) {
    let lo = 0, hi = list.length - 1, best = null;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].time <= t) { best = list[mid]; lo = mid + 1; } else hi = mid - 1;
    }
    return best;
  }

  const byDriver = (rows, timeOf) => {
    const m = new Map();
    for (const r of rows || []) {
      const time = timeOf(r);
      if (!isFinite(time)) continue;
      if (!m.has(r.driver_number)) m.set(r.driver_number, []);
      m.get(r.driver_number).push({ ...r, time });
    }
    for (const l of m.values()) l.sort((a, b) => a.time - b.time);
    return m;
  };

  // Abstand-Werte: Zahl (Sekunden) oder Text wie "+1 LAP".
  function gapText(v) {
    if (v == null) return "";
    if (typeof v === "string") {
      const m = /^\+?(\d+)\s*LAPS?$/i.exec(v.trim());
      return m ? `+${m[1]} Rd.` : v;
    }
    return "+" + v.toFixed(3);
  }

  function lapTime(s) {
    if (s == null) return "–";
    const m = Math.floor(s / 60), r = s - m * 60;
    return `${m}:${r.toFixed(3).padStart(6, "0")}`;
  }

  // --- Rennleitung: Streckenstatus + die wenigen Meldungen, die zählen ---------

  function trackStatus(rc, t, raceStart) {
    if (isFinite(raceStart) && t < raceStart) return "pre";
    let s = "green";
    for (const r of rc) {
      if (r.time > t) break;
      const m = (r.message || "").toUpperCase();
      if (r.category === "SafetyCar") {
        if (/VSC ENDING|VIRTUAL SAFETY CAR ENDING/.test(m)) s = "vsc-end";
        else if (/VSC|VIRTUAL/.test(m)) s = "vsc";
        else if (/IN THIS LAP/.test(m)) s = "sc-end";
        else if (/DEPLOYED/.test(m)) s = "sc";
      } else if (r.category === "Flag" && r.scope === "Track") {
        if (r.flag === "RED") s = "red";
        else if (r.flag === "CHEQUERED") s = "fin";
        else if (r.flag === "GREEN" || r.flag === "CLEAR") s = s === "fin" ? s : "green";
      }
    }
    return s;
  }

  const RELEVANT = /PENALTY|INVESTIGAT|STEWARDS|NOTED|RED FLAG|DELAYED|SUSPENDED|RESUME|RACE START|STANDING START|DRS ENABLED|DRS DISABLED/;
  const NOISE = /TRACK LIMITS|DELETED/;

  // Kurze deutsche Fassung der häufigen Meldungen, sonst das Original.
  function msgText(r) {
    const m = (r.message || "").trim();
    const U = m.toUpperCase();
    const car = /CARS? (\d+) \(([A-Z]{3})\)/.exec(U);
    const who = car ? car[2] : "";
    let x;
    if (r.category === "SafetyCar") {
      if (/VSC ENDING/.test(U)) return "VSC endet";
      if (/VSC|VIRTUAL/.test(U)) return "Virtuelles Safety Car";
      if (/IN THIS LAP/.test(U)) return "Safety Car kommt diese Runde rein";
      if (/DEPLOYED/.test(U)) return "Safety Car auf der Strecke";
    }
    if (r.category === "Flag") {
      if (r.flag === "CHEQUERED") return "Zielflagge";
      if (r.flag === "RED") return "Rote Flagge – Rennen unterbrochen";
      if (r.flag === "CLEAR" || r.flag === "GREEN") return "Strecke frei";
    }
    if (/PENALTY SERVED/.test(U)) return `${who}: Strafe abgesessen`;
    if ((x = /(\d+) SECOND (TIME|STOP\/GO) PENALTY/.exec(U))) {
      return `${who}: ${x[1]}-Sekunden-${x[2] === "TIME" ? "Zeitstrafe" : "Stop-and-Go"}` + reason(U);
    }
    if (/DRIVE THROUGH/.test(U)) return `${who}: Durchfahrtsstrafe` + reason(U);
    if (/NO FURTHER (ACTION|INVESTIGATION)/.test(U)) return `${incident(U)}: keine Strafe` + reason(U);
    if (/AFTER THE RACE/.test(U)) return `${incident(U)}: Untersuchung nach dem Rennen` + reason(U);
    if (/UNDER INVESTIGATION/.test(U)) return `${incident(U)}: wird untersucht` + reason(U);
    if (/NOTED/.test(U)) return `${incident(U)}: notiert` + reason(U);
    if (/^RACE START/.test(U)) return "Rennstart";
    if (/STANDING START/.test(U)) return "Stehender Start";
    if (/DELAYED START/.test(U)) return "Start verschoben";
    if (/SUSPENDED/.test(U)) return "Startvorgang unterbrochen";
    return m.charAt(0) + m.slice(1).toLowerCase();
  }
  function incident(U) {
    const cars = [...U.matchAll(/\(([A-Z]{3})\)/g)].map(c => c[1]);
    return cars.length ? cars.join(" & ") : "Vorfall";
  }
  function reason(U) {
    const R = { "CAUSING A COLLISION": "Kollision verursacht", "UNSAFE RELEASE": "unsicherer Boxenstopp",
      "FALSE START": "Frühstart", "DRIVING ERRATICALLY": "unberechenbares Fahren", "LEAVING THE TRACK": "Strecke verlassen",
      "SPEEDING IN THE PIT LANE": "zu schnell in der Boxengasse", "FORCING ANOTHER DRIVER OFF THE TRACK": "von der Strecke gedrängt" };
    for (const k in R) if (U.includes(k)) return ` (${R[k]})`;
    return "";
  }
  const isRelevantMsg = r =>
    r.category === "SafetyCar" ||
    (r.category === "Flag" && r.scope === "Track" && r.flag !== "GREEN") ||
    (r.category === "Other" && RELEVANT.test((r.message || "").toUpperCase()) && !NOISE.test((r.message || "").toUpperCase()));

  // Reifenplan eines Fahrers: Die Grenzen der Stints kommen aus den
  // Boxenstopps (verlässlich), die Mischungen der Reihe nach aus dem
  // F1-Archiv (TimingAppData) bzw. ersatzweise aus OpenF1. OpenF1 führt die
  // Runden-Spannen der Stints teils verschoben (Kuala Lumpur 2026: VER I1 S1
  // S7 S46 statt I9 S24 S10 S12), die Reihenfolge der Mischungen stimmt aber.
  //   → [{ c, from, to, age0 }] mit Runden from..to (to = Ziel/Ausfall)
  function tyrePlan(pitLaps, totalLaps, src) {
    const stops = [...new Set(pitLaps)].filter(l => l > 0 && l < totalLaps).sort((a, b) => a - b);
    const segs = [];
    let from = 1;
    for (const l of stops.concat(totalLaps)) { segs.push({ from, to: Math.max(from - 1, l) }); from = l + 1; }
    segs.forEach((g, i) => {
      const t = src[Math.min(i, src.length - 1)];
      g.c = t ? t.c : null;
      g.age0 = t && i < src.length ? t.age0 || 0 : 0;
    });
    return segs;
  }
  // Archiv-Stints (F1 TimingAppData.Lines[n].Stints) → [{ c, age0 }]
  const archiveSrc = line => (line && line.Stints ? (Array.isArray(line.Stints) ? line.Stints : Object.values(line.Stints)) : [])
    .filter(x => x && x.Compound && x.Compound !== "UNKNOWN")
    .map(x => ({ c: x.Compound, age0: x.New === "false" || x.New === false ? x.StartLaps || 0 : 0 }));

  // --- Hauptfunktion ----------------------------------------------------------

  function buildRace(raw) {
    const drivers = new Map();
    for (const d of raw.drivers || []) {
      drivers.set(d.driver_number, {
        n: d.driver_number, abbr: d.name_acronym || String(d.driver_number),
        first: d.first_name || "", last: d.last_name || d.broadcast_name || "",
        team: d.team_name || "", color: "#" + (d.team_colour || "888888"),
      });
    }

    const laps = byDriver(raw.laps, r => ts(r.date_start));
    for (const l of laps.values()) {
      l.forEach((lap, i) => {
        const next = l[i + 1];
        lap.end = num(lap.lap_duration) != null ? lap.time + lap.lap_duration * 1000 : next ? next.time : NaN;
      });
    }
    const pos = byDriver(raw.position, r => ts(r.date));
    const ivl = byDriver(raw.intervals, r => ts(r.date));
    const pits = byDriver(raw.pit, r => ts(r.date));
    const openSrc = new Map();
    for (const st of (raw.stints || []).slice().sort((a, b) => a.stint_number - b.stint_number)) {
      if (!openSrc.has(st.driver_number)) openSrc.set(st.driver_number, []);
      // Nur die Reihenfolge zählt; überzählige Stücke am Ende fallen in tyrePlan weg
      openSrc.get(st.driver_number).push({ c: st.compound, age0: st.tyre_age_at_start || 0 });
    }
    const arch = (raw.tyres && raw.tyres.Lines) || null;
    const rc = (raw.race_control || []).map(r => ({ ...r, time: ts(r.date) })).filter(r => isFinite(r.time)).sort((a, b) => a.time - b.time);
    const result = new Map((raw.session_result || []).map(r => [r.driver_number, r]));

    // Rennstart: erster Rundenbeginn (bei verschobenem Start liegen die
    // Positionsdaten der Aufstellung weit davor).
    let raceStart = Infinity;
    for (const l of laps.values()) if (l[0] && l[0].time < raceStart) raceStart = l[0].time;
    const startMsg = rc.find(r => r.category === "SessionStatus" && /STARTED/i.test(r.message || ""));
    if (startMsg && startMsg.time < raceStart) raceStart = startMsg.time;

    let total = 0;
    for (const r of result.values()) total = Math.max(total, r.number_of_laps || 0);
    for (const l of laps.values()) total = Math.max(total, l.length);

    // Frame-Zeitpunkte: wann der Erste die Runde k beendet.
    const times = [isFinite(raceStart) ? raceStart - 1000 : 0];
    for (let k = 1; k <= total; k++) {
      let first = Infinity;
      for (const l of laps.values()) { const e = l[k - 1] && l[k - 1].end; if (isFinite(e) && e < first) first = e; }
      if (!isFinite(first)) break;
      times.push(first + 500);   // kurz danach, damit Abstände schon aktualisiert sind
    }
    // Ergebnis-Frame: erst wenn alle (auch Überrundete) im Ziel sind
    if (result.size > 0 && times.length > 1) {
      let lastEnd = times[times.length - 1];
      for (const l of laps.values()) for (const x of l) if (isFinite(x.end) && x.end + 500 > lastEnd) lastEnd = x.end + 500;
      times[times.length - 1] = lastEnd;
    }

    // Reifenplan je Fahrer (einmal fürs ganze Rennen)
    const plans = new Map();
    for (const d of drivers.values()) {
      const res = result.get(d.n);
      const driven = Math.max(res && res.number_of_laps || 0, (laps.get(d.n) || []).length);
      const a = arch ? archiveSrc(arch[d.n] || arch[String(d.n)]) : [];
      plans.set(d.n, tyrePlan((raw.pit || []).filter(x => x.driver_number === d.n).map(x => x.lap_number),
        Math.max(driven, 1), a.length ? a : openSrc.get(d.n) || []));
    }

    let fastest = null;   // { s, n } schnellste Runde bis zum jeweiligen Frame
    const frames = [];
    const final = result.size > 0;
    times.forEach((t, k) => {
      const prevT = k > 0 ? times[k - 1] : -Infinity;
      const isLast = final && k === times.length - 1;
      const rows = [];
      for (const d of drivers.values()) {
        const L = laps.get(d.n) || [];
        const done = L.filter(l => isFinite(l.end) && l.end <= t);
        const last = done[done.length - 1];
        let best = null;
        for (const l of done) if (num(l.lap_duration) != null && (best == null || l.lap_duration < best)) best = l.lap_duration;
        for (const l of done) {
          if (num(l.lap_duration) != null && (!fastest || l.lap_duration < fastest.s) && l.end <= t) fastest = { s: l.lap_duration, n: d.n };
        }
        const p = lastBefore(pos.get(d.n) || [], t);
        const iv = k === 0 ? null : lastBefore(ivl.get(d.n) || [], t);
        const P = (pits.get(d.n) || []).filter(x => x.time <= t);
        // Aktueller Satz = so viele Stopps wie bisher gemacht (am Rundenende
        // ist der Wagen oft erst auf dem Weg in die Box → noch alter Reifen)
        const plan = plans.get(d.n) || [];
        const si = Math.min(P.length, plan.length - 1);
        const st = plan[si];
        const n = done.length;
        const res = result.get(d.n);
        // Ausfall: ab ein paar Minuten nach dem letzten Lebenszeichen (Rundenbeginn)
        const lastSeen = L.length ? Math.max(L[L.length - 1].time, isFinite(L[L.length - 1].end) ? L[L.length - 1].end : 0) : -Infinity;
        const out = !!res && (res.dnf || res.dns || res.dsq) && (isLast || res.dns || t > lastSeen + 240000);
        let position = p ? p.position : null, gap = iv ? iv.gap_to_leader : null, interval = iv ? iv.interval : null;
        if (out) { gap = null; interval = null; }
        if (isLast && res) {
          position = res.position;
          gap = Array.isArray(res.gap_to_leader) ? res.gap_to_leader.at(-1) : res.gap_to_leader;
          interval = null;
        }
        rows.push({
          n: d.n, pos: position, gap, interval,
          laps: done.length,
          last: last ? num(last.lap_duration) : null,
          best,
          compound: st ? st.c : null,
          tyreAge: st ? st.age0 + Math.max(0, n - st.from + 1) : null,
          stints: plan.slice(0, si + 1).map((g, i) => ({ c: g.c, from: g.from, laps: i < si ? g.to - g.from + 1 : Math.max(0, Math.min(n, g.to) - g.from + 1) })),
          pits: P.length,
          pitNow: P.some(x => x.time > prevT),
          out, status: res ? (res.dsq ? "DSQ" : res.dns ? "DNS" : res.dnf ? "DNF" : "") : "",
          points: isLast && res ? res.points || 0 : null,
        });
      }
      // Ergebnis-/Zwischenstand: Platz, Ausgefallene ans Ende (nach Runden)
      rows.sort((a, b) => (a.out - b.out) || ((a.pos ?? 99) - (b.pos ?? 99)) || (b.laps - a.laps));
      if (isLast) rows.forEach((r, i) => { if (r.pos == null) r.pos = i + 1; });
      // Intervall im Ergebnis: Abstand zum Vordermann aus der Gesamtlücke
      if (isLast) rows.forEach((r, i) => {
        const a = rows[i - 1];
        r.interval = i === 0 ? 0 : (typeof r.gap === "number" && a && typeof a.gap === "number") ? +(r.gap - a.gap).toFixed(3) : r.gap;
      });
      for (const r of rows) {
        r.fastest = !!fastest && fastest.n === r.n && r.best === fastest.s;
        r.lastPurple = !!fastest && r.last != null && r.last === fastest.s && fastest.n === r.n;
        r.lastPB = r.last != null && r.last === r.best;
      }
      const msgs = rc.filter(r => r.time <= t + 1000 && isRelevantMsg(r))
        .map(r => ({ time: r.time, lap: r.lap_number, text: msgText(r), driver: r.driver_number }));
      frames.push({
        lap: k, t, final: isLast,
        status: isLast ? "fin" : trackStatus(rc, t, raceStart),
        rows, msgs,
      });
    });

    // Rundenzeiten je Fahrer (Diagramm „Rundenzeiten“, Duell, Streckenkarte):
    // [{ lap, s, t, end, pitIn, pitOut, c }] — t/end = Beginn/Ende in ms
    const lapTimes = new Map();
    for (const d of drivers.values()) {
      const plan = plans.get(d.n) || [];
      const inLaps = new Set((raw.pit || []).filter(x => x.driver_number === d.n).map(x => x.lap_number));
      lapTimes.set(d.n, (laps.get(d.n) || []).map(l => {
        const g = plan.find(x => l.lap_number >= x.from && l.lap_number <= x.to);
        return { lap: l.lap_number, s: num(l.lap_duration), t: l.time, end: l.end, pitIn: inLaps.has(l.lap_number), pitOut: !!l.is_pit_out_lap, c: g ? g.c : null };
      }));
    }

    return { drivers, laps: total, frames, raceStart, plans, lapTimes };
  }

  // Reifenmischung → Kürzel
  const TYRE = { SOFT: "S", MEDIUM: "M", HARD: "H", INTERMEDIATE: "I", WET: "W" };

  // --- Live: offizieller F1-Feed (SignalR, über das DO F1Live) ---------------
  // Der Feed schickt zuerst den Gesamtstand je Thema, danach nur Änderungen.
  // Änderungen an Listen kommen als Objekt mit Index-Schlüsseln ({"3": {…}}),
  // gelöschte Schlüssel als {"_deleted": [...]}.
  function mergeFeed(target, src) {
    if (src === null || typeof src !== "object") return src;
    if (target === null || typeof target !== "object") target = Array.isArray(src) ? [] : {};
    if (Array.isArray(src) && Array.isArray(target)) {
      src.forEach((v, i) => { target[i] = mergeFeed(target[i], v); });
      return target;
    }
    for (const k of Object.keys(src)) {
      if (k === "_deleted") {
        for (const d of [].concat(src[k])) { if (Array.isArray(target)) target.splice(+d, 1); else delete target[d]; }
        continue;
      }
      target[k] = mergeFeed(target[k], src[k]);
    }
    return target;
  }

  // "1:38.220" / "38.220" → Sekunden
  function parseTime(v) {
    const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(String(v == null ? "" : v).trim());
    return m ? (m[1] ? +m[1] * 60 : 0) + +m[2] : null;
  }
  // "+13.993" → 13.993, "+1 LAP"/"2L" → "+1 LAP", "LAP 12"/"" → null (Führender)
  function parseGap(v) {
    const s = String(v == null ? "" : v).trim();
    if (!s || /^LAP\s/i.test(s)) return null;
    const lap = /^\+?(\d+)\s*L(APS?)?$/i.exec(s);
    if (lap) return `+${lap[1]} LAP`;
    const n = parseFloat(s.replace("+", ""));
    return isFinite(n) ? n : null;
  }
  const list = v => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.keys(v).sort((a, b) => a - b).map(k => v[k]) : []);

  const LIVE_TRACK = { "1": "green", "2": "green", "3": "green", "4": "sc", "5": "red", "6": "vsc", "7": "vsc-end" };
  const SESSION_DE = { Race: "Rennen", Sprint: "Sprint", Qualifying: "Qualifying", "Sprint Qualifying": "Sprint-Qualifying",
    "Sprint Shootout": "Sprint-Qualifying", "Practice 1": "1. Training", "Practice 2": "2. Training", "Practice 3": "3. Training" };

  // Live-Stints → [{ c, from, laps }] (Startrunde fortlaufend gezählt)
  function liveStints(stints) {
    let from = 1;
    return stints.filter(x => x && x.Compound && x.Compound !== "UNKNOWN").map(x => {
      const laps = Math.max(0, (x.TotalLaps || 0) - (x.StartLaps || 0));
      const g = { c: x.Compound, from, laps };
      from += laps;
      return g;
    });
  }

  // Gesamtstand des Feeds → { session, drivers: [...], frame } im selben
  // Format wie buildRace — damit die Oberfläche beides gleich zeichnet.
  function fromLive(st) {
    st = st || {};
    const info = st.SessionInfo || {}, meet = info.Meeting || {};
    const td = (st.TimingData || {}).Lines || {}, ta = (st.TimingAppData || {}).Lines || {};
    const dl = st.DriverList || {};
    const isRace = /race|sprint$/i.test(info.Type || "") || /^(Race|Sprint)$/.test(info.Name || "");
    const isQuali = !isRace && (/qualifying|shootout/i.test(info.Type || "") || /qualifying|shootout/i.test(info.Name || ""));
    const drivers = [];
    for (const k of Object.keys(dl)) {
      const d = dl[k];
      if (!d || typeof d !== "object" || !d.RacingNumber) continue;
      drivers.push({ n: +d.RacingNumber, abbr: d.Tla || d.RacingNumber, first: d.FirstName || "", last: d.LastName || "",
        team: d.TeamName || "", color: "#" + (d.TeamColour || "888888") });
    }
    let rows = [];
    for (const k of Object.keys(td)) {
      const t = td[k] || {};
      const stints = list((ta[k] || {}).Stints);
      const cur = stints[stints.length - 1];
      const last = t.LastLapTime || {};
      rows.push({
        n: +k, pos: t.Position ? +t.Position : null,
        gap: parseGap(t.GapToLeader), interval: parseGap((t.IntervalToPositionAhead || {}).Value),
        laps: t.NumberOfLaps || 0,
        last: parseTime(last.Value), lastPurple: !!last.OverallFastest, lastPB: !!last.PersonalFastest,
        best: parseTime((t.BestLapTime || {}).Value),
        compound: cur && cur.Compound && cur.Compound !== "UNKNOWN" ? cur.Compound : null,
        tyreAge: cur ? cur.TotalLaps ?? null : null,
        stints: liveStints(stints),
        qtimes: isQuali ? list(t.BestLapTimes).map(x => parseTime(x && x.Value)) : null,
        pits: t.NumberOfPitStops || 0,
        pitNow: !!(t.InPit || t.PitOut),
        // Im Qualifying bleiben Ausgeschiedene sichtbar (mit ihrer Zeit), nur markiert
        out: !!(t.Retired || t.Stopped || (t.KnockedOut && !isQuali)),
        knocked: !!(isQuali && t.KnockedOut),
        status: t.Retired ? "DNF" : t.KnockedOut ? "Raus" : t.Stopped ? "Aus" : "",
        points: null,
      });
    }
    rows.sort((a, b) => (a.out - b.out) || ((a.pos ?? 99) - (b.pos ?? 99)));
    const bestAll = rows.reduce((m, r) => (r.best != null && (m == null || r.best < m) ? r.best : m), null);
    for (const r of rows) r.fastest = r.best != null && r.best === bestAll;
    // Qualifying: Zeit des letzten erreichten Abschnitts, Rückstand auf den
    // Schnellsten DIESES Abschnitts (ein Q1-Aus wird mit Q1 verglichen, nicht mit der Pole)
    // (ohne Abschnittszeiten im Feed → wie Training über die Bestzeit)
    if (isQuali && rows.some(r => (r.qtimes || []).some(v => v != null))) {
      const fastestIn = [];
      for (const r of rows) (r.qtimes || []).forEach((v, i) => { if (v != null && (fastestIn[i] == null || v < fastestIn[i])) fastestIn[i] = v; });
      rows.forEach((r, i) => {
        let q = -1;
        (r.qtimes || []).forEach((v, j) => { if (v != null) q = j; });
        r.qpart = q + 1;
        r.best = q >= 0 ? r.qtimes[q] : null;
        if (r.knocked) r.status = (/sprint/i.test(info.Name || "") ? "SQ" : "Q") + (q + 1);
        r.fastest = q >= 0 && r.best === fastestIn[q];
        r.gap = q >= 0 && !r.fastest ? +(r.best - fastestIn[q]).toFixed(3) : null;
        const a = rows[i - 1];
        r.interval = a && a.qpart === r.qpart && a.best != null && r.best != null ? +(r.best - a.best).toFixed(3) : r.gap;
      });
    } else if (!isRace) {
      // Training: kein Rennabstand → Rückstand der Bestzeit auf P1
      const p1 = rows.find(r => r.best != null);
      rows.forEach((r, i) => {
        const a = rows[i - 1];
        r.gap = r.best != null && p1 && r !== p1 ? +(r.best - p1.best).toFixed(3) : null;
        r.interval = r.best != null && a && a.best != null ? +(r.best - a.best).toFixed(3) : r.gap;
      });
    }
    const ss = ((st.SessionStatus || {}).Status || "");
    let status = LIVE_TRACK[(st.TrackStatus || {}).Status] || "green";
    if (/^(Inactive)$/i.test(ss)) status = "pre";
    if (/^(Finished|Finalised|Ends)$/i.test(ss)) status = "fin";
    const msgs = list((st.RaceControlMessages || {}).Messages)
      .map(m => ({ category: m.Category, flag: m.Flag, scope: m.Scope, message: m.Message, lap_number: m.Lap, driver_number: m.RacingNumber ? +m.RacingNumber : null, time: Date.parse((m.Utc || "") + "Z") }))
      .filter(isRelevantMsg)
      .map(r => ({ time: r.time, lap: r.lap_number, text: msgText(r), driver: r.driver_number }));
    const lc = st.LapCount || {};
    // WM-Hochrechnung (nur im Rennen/Sprint): Stand vorher + wenn jetzt Schluss wäre
    const cp = st.ChampionshipPrediction || {};
    const wmD = Object.values(cp.Drivers || {}).filter(x => x && x.RacingNumber).map(x => ({
      n: +x.RacingNumber, pos0: x.CurrentPosition ?? null, pos: x.PredictedPosition ?? null, pts0: x.CurrentPoints ?? 0, pts: x.PredictedPoints ?? 0 }));
    const wmT = Object.values(cp.Teams || {}).filter(x => x && x.TeamName).map(x => ({
      team: x.TeamName, pos0: x.CurrentPosition ?? null, pos: x.PredictedPosition ?? null, pts0: x.CurrentPoints ?? 0, pts: x.PredictedPoints ?? 0 }));
    const wm = isRace && wmD.length ? { live: true, drivers: wmD.sort((a, b) => a.pos - b.pos), teams: wmT.sort((a, b) => a.pos - b.pos) } : null;
    // Qualifying: Teil (Q1–Q3) und wie viele weiterkommen (NoEntries = Autos je Teil)
    const tdAll = st.TimingData || {};
    const qp = !isRace && +tdAll.SessionPart || 0;
    const entries = list(tdAll.NoEntries).map(Number);
    const sprintQ = /sprint/i.test(info.Name || "") || /sprint/i.test(info.Type || "");
    const part = qp ? (sprintQ ? "SQ" : "Q") + qp : null;
    const cut = qp && status !== "fin" && entries[qp] > 0 ? entries[qp] : null;
    return {
      session: {
        key: info.Key || null, name: SESSION_DE[info.Name] || info.Name || "", type: info.Type || "", race: isRace, quali: isQuali,
        circuit: (meet.Circuit || {}).Key || null, path: info.Path || null,
        meeting: (meet.Name || "").replace(/ Grand Prix$/i, " GP"), location: meet.Location || "",
        state: ss, start: info.StartDate || null,
      },
      drivers, wm,
      // Boxenfunk: die letzten Clips (Datei relativ zum Session-Pfad im F1-Archiv)
      radio: list((st.TeamRadio || {}).Captures).filter(c => c && c.Path).slice(-60)
        .map(c => ({ n: +c.RacingNumber, utc: c.Utc, file: String(c.Path).replace(/^TeamRadio\//, "") })),
      frame: { lap: lc.CurrentLap || 0, total: lc.TotalLaps || 0, final: status === "fin", live: true, timed: !isRace, status, part, cut, rows, msgs },
    };
  }

  const api = { gapText, lapTime, trackStatus, msgText, isRelevantMsg, buildRace, tyrePlan, TYRE, mergeFeed, parseGap, parseTime, fromLive };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.F1Model = api;
})(typeof window !== "undefined" ? window : globalThis);
