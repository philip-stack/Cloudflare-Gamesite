// ====================================================================
// Rennticker — Oberfläche. Lädt eine Session über den Proxy /f1data/
// (OpenF1), rechnet mit F1Model (model.js) einen Stand je Runde und zeigt
// eine schlanke Handy-Zeitenliste. Merkt sich lokal: Theme, Lieblings-
// fahrer, Abstandsmodus.
// ====================================================================
(function () {
  "use strict";
  const M = window.F1Model;
  const $ = id => document.getElementById(id);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
  };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  // ---------- Theme ----------
  const SUN = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>';
  const MOON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>';
  function applyTheme(t) {
    document.documentElement.dataset.theme = t;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = t === "light" ? "#f3f3f6" : "#101017";
    const b = $("theme");
    b.innerHTML = t === "light" ? MOON : SUN;
    b.title = t === "light" ? "Dunkelmodus" : "Hellmodus";
    b.setAttribute("aria-label", b.title);
  }
  applyTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
  $("theme").addEventListener("click", () => {
    const t = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    store.set("f1_theme", t);
    applyTheme(t);
  });

  // ---------- Player-Icons ----------
  const ICON = {
    prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true" class="fill"><path d="M8 5v14l11-7z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true" class="fill"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/></svg>',
    end: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5l7 7-7 7M17 5v14"/></svg>',
  };
  $("prev").innerHTML = ICON.prev; $("next").innerHTML = ICON.next;
  $("play").innerHTML = ICON.play; $("end").innerHTML = ICON.end;

  // ---------- Daten ----------
  async function get(ep, q) {
    const res = await fetch(`/f1data/${ep}?${new URLSearchParams(q)}`);
    if (!res.ok) {
      const e = new Error("HTTP " + res.status); e.status = res.status; throw e;
    }
    return res.json();
  }

  const DONE_AFTER = 30 * 60 * 1000;     // OpenF1 gratis: ab ~30 min nach Sessionende
  let sessions = [], race = null, frame = 0, timer = null;
  let fav = +store.get("f1_fav") || null;
  let gapMode = store.get("f1_gapmode") === "leader" ? "leader" : "interval";
  let showAll = false;
  let liveTimer = null, liveLap = -1, liveBase = new Map(), lastPos = new Map();
  let mode = "";          // "live" | "race" (OpenF1-Nachschau) | "archive" (Training/Qualifying)
  let meetings = [];      // [{ key, name, sessions: [...] }] neueste zuerst
  const LIVE_EVERY = 3000;

  const fmtDate = d => new Intl.DateTimeFormat("de-AT", { day: "numeric", month: "short", timeZone: "Europe/Vienna" }).format(new Date(d));
  const fmtClock = d => new Intl.DateTimeFormat("de-AT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Vienna" }).format(new Date(d));
  const gpName = m => (m && m.meeting_name ? m.meeting_name.replace(/ Grand Prix$/i, " GP") : "");

  const SESSION_DE = { Race: "Rennen", Sprint: "Sprint", Qualifying: "Qualifying", "Sprint Qualifying": "Sprint-Qualifying",
    "Sprint Shootout": "Sprint-Qualifying", "Practice 1": "1. Training", "Practice 2": "2. Training", "Practice 3": "3. Training" };
  const sessName = s => SESSION_DE[s.session_name] || s.session_name;
  const SHORT = { "Practice 1": "FP1", "Practice 2": "FP2", "Practice 3": "FP3", Qualifying: "Quali", "Sprint Qualifying": "SQ", "Sprint Shootout": "SQ" };
  const fmtDay = d => new Intl.DateTimeFormat("de-AT", { weekday: "short", day: "numeric", month: "short", timeZone: "Europe/Vienna" }).format(new Date(d));

  async function loadCalendar() {
    const now = Date.now();
    const year = new Date().getFullYear();
    let all = [];
    for (const y of [year, year - 1]) {
      const [ss, ms] = await Promise.all([get("sessions", { year: y }), get("meetings", { year: y })]);
      const mm = new Map(ms.map(m => [m.meeting_key, m]));
      ss.forEach(s => { s.meeting = mm.get(s.meeting_key); });
      all = all.concat(ss.filter(s => !s.is_cancelled));
      if (all.some(s => Date.parse(s.date_end) + DONE_AFTER < now)) break;
    }
    // Live-Fenster: eine Stunde vor bis eine Stunde nach jeder Session — dann
    // hängt sich die Seite an den F1-Feed.
    const live = all.find(s => Date.parse(s.date_start) - 3600e3 <= now && Date.parse(s.date_end) + 3600e3 > now);
    // ?live erzwingt den Live-Modus (z. B. bei stark verspätetem Start)
    const force = !live && new URLSearchParams(location.search).has("live");
    const next = all.filter(s => Date.parse(s.date_start) > now).sort((a, b) => Date.parse(a.date_start) - Date.parse(b.date_start))[0];
    sessions = all.filter(s => Date.parse(s.date_end) + DONE_AFTER < now);
    // Nach Wochenende gruppieren (neueste zuerst), Sessions darin chronologisch
    const byM = new Map();
    for (const s of sessions) {
      if (!byM.has(s.meeting_key)) byM.set(s.meeting_key, { key: s.meeting_key, name: gpName(s.meeting) || s.location, sessions: [] });
      byM.get(s.meeting_key).sessions.push(s);
    }
    meetings = [...byM.values()];
    meetings.forEach(m => m.sessions.sort((a, b) => Date.parse(a.date_start) - Date.parse(b.date_start)));
    meetings.sort((a, b) => Date.parse(b.sessions[0].date_start) - Date.parse(a.sessions[0].date_start));
    $("meeting").innerHTML = (live ? `<option value="live">● LIVE · ${esc(gpName(live.meeting) || live.location)} · ${esc(sessName(live))}</option>`
      : force ? `<option value="live">● LIVE · F1-Live-Timing</option>` : "") +
      meetings.map(m => `<option value="${m.key}">${esc(m.name)} · ${fmtDate(m.sessions[m.sessions.length - 1].date_start)}</option>`).join("");
    if (!live && next) note(`Nächstes: <b>${esc(gpName(next.meeting) || next.location)}</b> · ${esc(sessName(next))} am ${fmtDay(next.date_start)} um ${fmtClock(next.date_start)} Uhr`, "soft");
    if (live || force) { $("meeting").value = "live"; fillSessions(); return startLive(); }
    // Zuletzt angesehene Session, sonst die neueste
    const want = +store.get("f1_session");
    const m = meetings.find(x => x.sessions.some(s => s.session_key === want)) || meetings[0];
    if (!m) return;
    $("meeting").value = String(m.key);
    const s = m.sessions.find(x => x.session_key === want) || m.sessions[m.sessions.length - 1];
    fillSessions(s.session_key);
    await openSession(s.session_key);
  }

  function fillSessions(key) {
    const sel = $("session");
    const m = meetings.find(x => String(x.key) === $("meeting").value);
    sel.hidden = !m;
    if (!m) return;
    sel.innerHTML = m.sessions.map(s => `<option value="${s.session_key}">${esc(sessName(s))} · ${fmtDay(s.date_start)}</option>`).join("");
    if (key) sel.value = String(key);
  }

  // Rennen/Sprint: OpenF1 Runde für Runde; Training/Qualifying: Endstand aus dem F1-Archiv
  function openSession(key) {
    const s = sessions.find(x => x.session_key === key);
    if (!s) return;
    store.set("f1_session", String(key));
    return s.session_type === "Race" ? loadSession(key) : loadArchive(s);
  }

  // ---------- Live (F1-Feed über /api/f1-live) ----------
  function startLive() {
    stop(); stopLive();
    mode = "live";
    race = null; liveLap = -1; liveBase = new Map(); lastPos = new Map();
    document.body.classList.add("is-live");
    $("note").hidden = true;
    $("rows").innerHTML = `<li class="loading"><span class="spinner"></span><span>Verbinde mit dem Live-Timing …</span></li>`;
    $("fav").hidden = true; $("msgs").innerHTML = ""; $("more").hidden = true;
    pollLive();
  }
  function stopLive() {
    clearTimeout(liveTimer); liveTimer = null;
    document.body.classList.remove("is-live", "single");
  }
  async function pollLive() {
    clearTimeout(liveTimer);
    if (mode !== "live") return;
    try {
      const res = await fetch("/api/f1-live", { cache: "no-store" });
      const d = await res.json();
      if (!d.ok) throw new Error(d.error || "offline");
      if (mode !== "live") return;
      const f = d.frame;
      // Pfeile ▲▼: Veränderung seit Beginn der laufenden Runde
      if (f.lap !== liveLap) { liveBase = lastPos; liveLap = f.lap; }
      lastPos = new Map(f.rows.map(r => [r.n, r]));
      race = { live: true, session: d.session, drivers: new Map(d.drivers.map(x => [x.n, x])), laps: f.total, frames: [f] };
      if (Date.now() - d.updated > 60000) note("Der Live-Feed ist seit über einer Minute still – vermutlich Pause oder Session vorbei.", "soft");
      else $("note").hidden = true;
      show(0);
    } catch (e) {
      if (!race) $("rows").innerHTML = `<li class="loading err">Live-Timing gerade nicht erreichbar – neuer Versuch läuft …</li>`;
      else note("Verbindung zum Live-Timing unterbrochen – neuer Versuch läuft …");
    }
    if (mode === "live") liveTimer = setTimeout(pollLive, document.hidden ? 15000 : LIVE_EVERY);
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden && mode === "live") pollLive(); });

  function note(html, kind) {
    const n = $("note");
    n.innerHTML = html; n.hidden = false; n.className = "note" + (kind ? " " + kind : "");
  }

  const PARTS = [["drivers", "Fahrer"], ["session_result", "Ergebnis"], ["laps", "Runden"], ["position", "Positionen"],
    ["intervals", "Abstände"], ["stints", "Reifen"], ["pit", "Boxenstopps"], ["race_control", "Rennleitung"]];

  function loading(text) {
    stop(); stopLive();
    race = null;
    $("rows").innerHTML = `<li class="loading"><span class="spinner"></span><span id="prog">${esc(text)}</span></li>`;
    $("tyre-rows").innerHTML = ""; $("tyre-info").textContent = "";
    $("fav").hidden = true; $("msgs").innerHTML = ""; $("more").hidden = true;
  }

  async function loadSession(key) {
    loading("Lade Daten …");
    mode = "race";
    const raw = {};
    try {
      // Nacheinander: OpenF1 erlaubt gratis nur 3 Anfragen pro Sekunde
      for (let i = 0; i < PARTS.length; i++) {
        const [ep, label] = PARTS[i];
        const p = $("prog"); if (p) p.textContent = `Lade ${label} … (${i + 1}/${PARTS.length})`;
        try { raw[ep] = await get(ep, { session_key: key }); }
        catch (e) { if (e.status === 404) raw[ep] = []; else throw e; }
      }
    } catch (e) {
      $("rows").innerHTML = `<li class="loading err">Daten gerade nicht verfügbar${e.status === 403 ? " (Live-Session – nur für OpenF1-Sponsoren)" : ""}. Bitte später nochmal probieren.</li>`;
      return;
    }
    // Reifen aus dem offiziellen F1-Archiv (OpenF1-Stints sind teils verschoben);
    // fehlt es, rechnet das Modell mit OpenF1 weiter.
    const sess = sessions.find(s => s.session_key === key);
    const p = $("prog"); if (p) p.textContent = "Lade Reifendaten …";
    try { raw.tyres = await get("archive", { year: new Date(sess ? sess.date_start : Date.now()).getFullYear(), session_key: key }); }
    catch (_) { raw.tyres = null; }
    if (+$("session").value !== key || mode !== "race") return;     // inzwischen anderes gewählt
    race = M.buildRace(raw);
    race.session = { name: sess ? sessName(sess) : "Rennen", race: true };
    if (!race.frames.length) { $("rows").innerHTML = `<li class="loading err">Für diese Session gibt es noch keine Daten.</li>`; return; }
    const sl = $("slider");
    sl.max = String(race.frames.length - 1);
    show(race.frames.length - 1);
  }

  // Training/Qualifying: Endstand aus dem offiziellen F1-Archiv — dasselbe
  // Format wie der Live-Feed, darum rechnet F1Model.fromLive auch hier.
  const ARCHIVE_TOPICS = ["DriverList", "TimingData", "TimingAppData", "SessionInfo", "SessionStatus", "TrackStatus", "RaceControlMessages"];
  async function loadArchive(s) {
    loading(`Lade ${sessName(s)} …`);
    mode = "archive";
    const key = s.session_key, year = new Date(s.date_start).getFullYear();
    const st = {};
    try {
      await Promise.all(ARCHIVE_TOPICS.map(async t => {
        try { st[t] = await get("archive", { year, session_key: key, topic: t }); }
        catch (e) { if (t === "TimingData" || t === "DriverList") throw e; }
      }));
    } catch (e) {
      $("rows").innerHTML = `<li class="loading err">Für ${esc(sessName(s))} gibt es (noch) keine Daten im F1-Archiv.</li>`;
      return;
    }
    if (+$("session").value !== key || mode !== "archive") return;
    const L = M.fromLive(st);
    L.frame.live = false; L.frame.final = true;
    // Endstand: wer nach der Session in der Box steht, ist nicht „gerade in der Box“
    L.frame.rows.forEach(r => { r.pitNow = false; });
    L.session.name = sessName(s);
    L.session.short = SHORT[s.session_name] || "";
    race = { archive: true, session: L.session, drivers: new Map(L.drivers.map(x => [x.n, x])), laps: 0, frames: [L.frame] };
    document.body.classList.add("single");     // ein Endstand → keine Abspielleiste
    show(0);
  }

  // ---------- Darstellung ----------
  const STATUS = {
    pre: "Vor dem Start", green: "Grün", sc: "Safety Car", "sc-end": "SC kommt rein",
    vsc: "Virtuelles SC", "vsc-end": "VSC endet", red: "Rote Flagge", fin: "Zielflagge",
  };

  // Vergleichszeilen: Nachschau = Vorrunde, live = Stand zu Beginn der Runde
  function baseRows() {
    const f = race.frames[frame], prev = race.frames[frame - 1];
    return f.live ? liveBase : new Map(prev ? prev.rows.map(r => [r.n, r]) : []);
  }
  const isTimed = () => !!race.frames[frame].timed;   // Training/Qualifying
  // Veränderung eines Abstands seit der Vorrunde (Sekunden, negativ = kleiner)
  function delta(r, key) {
    const f = race.frames[frame];
    if (f.final || isTimed() || r.out || r.pitNow) return null;
    const b = baseRows().get(r.n);
    if (!b || b.pitNow || typeof r[key] !== "number" || typeof b[key] !== "number") return null;
    return r[key] - b[key];
  }
  const TREND_MIN = 0.2;

  function gapCell(r, i) {
    if (r.out) return `<span class="dnf">${r.status || "Aus"}</span>`;
    const f = race.frames[frame];
    if (!f.live && !f.timed && f.lap === 0) return `<span class="muted">–</span>`;
    const timed = !!f.timed;          // Training/Qualifying
    if (i === 0 || (timed && r.fastest)) return `<span class="lead">${timed ? "Bestzeit" : f.final ? "Sieger" : "Führt"}</span>`;
    const v = gapMode === "leader" ? r.gap : r.interval;
    const txt = M.gapText(v);
    const close = !race.frames[frame].final && !isTimed() && gapMode === "interval" && typeof v === "number" && v < 1;   // DRS-Fenster
    const d = delta(r, gapMode === "leader" ? "gap" : "interval");
    const tr = d == null || Math.abs(d) < TREND_MIN ? "" : d < 0
      ? `<i class="tr tr-in" title="${Math.abs(d).toFixed(1)} s näher als letzte Runde">↓</i>`
      : `<i class="tr tr-out" title="${d.toFixed(1)} s weiter weg als letzte Runde">↑</i>`;
    return txt ? `${tr}<span class="${close ? "drs" : ""}">${txt}</span>` : `<span class="muted">–</span>`;
  }

  function tyre(c, age) {
    if (!c) return `<span class="tyre none">?</span>`;
    const k = M.TYRE[c] || "?";
    return `<span class="tyre t-${k}" title="${esc(c)}">${k}</span>` + (age === undefined ? "" : `<span class="age">${age ?? ""}</span>`);
  }

  function show(k) {
    if (!race) return;
    frame = Math.max(0, Math.min(race.frames.length - 1, k));
    const f = race.frames[frame], prev = race.frames[frame - 1];
    $("slider").value = String(frame);
    $("slider").style.setProperty("--p", (race.frames.length > 1 ? frame / (race.frames.length - 1) * 100 : 0) + "%");
    const noLaps = f.timed || (f.live && !race.laps);      // Training/Qualifying: keine Rundenzahl
    $("lapbox").classList.toggle("is-live", !!f.live);
    $("lbl").textContent = noLaps ? (f.live ? race.session.name || "Session" : "Session") : "Runde";
    $("lap").textContent = noLaps ? (f.live && f.part) || race.session.short || "Live" : f.lap === 0 ? "Start" : String(f.lap);
    $("laps").textContent = noLaps || f.lap === 0 ? "" : "/" + race.laps;
    const fl = $("flag"); fl.dataset.s = f.status; fl.textContent = f.final ? (f.timed ? "Endstand" : "Ergebnis") : STATUS[f.status] || "";
    $("gapmode").textContent = gapMode === "leader" ? "Zum 1." : "Int.";
    $("gapmode").title = gapMode === "leader" ? "Abstand zum Führenden – tippen für Intervall" : "Abstand zum Vordermann – tippen für Abstand zum Führenden";

    const before = baseRows();
    const timed = isTimed();
    $("lasthead").textContent = timed ? "Beste" : "Letzte";
    $("rows").innerHTML = f.rows.map((r, i) => {
      const d = race.drivers.get(r.n);
      const was = (before.get(r.n) || {}).pos;
      const delta = !r.out && was && r.pos ? was - r.pos : 0;
      const move = delta > 0 ? `<i class="up">▲${delta}</i>` : delta < 0 ? `<i class="down">▼${-delta}</i>` : "";
      // Training/Qualifying: Bestzeit statt letzter Runde (Ein-/Ausfahrrunden sind Rauschen)
      const t = timed ? r.best : r.last;
      const last = t == null ? "–" : M.lapTime(t);
      const lastCls = timed ? (r.fastest ? "purple" : "") : r.lastPurple ? "purple" : r.lastPB ? "pb" : "";
      const zone = f.cut && !r.out && r.pos > f.cut ? " in-danger" : "";
      const line = f.cut && r.pos === f.cut ? " cutline" : "";
      return `<li class="row${r.n === fav ? " is-fav" : ""}${r.out ? " is-out" : ""}${r.knocked ? " is-knocked" : ""}${zone}${line}" style="--team:${esc(d.color)}" data-n="${r.n}" tabindex="0" role="button" aria-pressed="${r.n === fav}" aria-label="${esc(d.first + " " + d.last)}, Platz ${r.pos ?? "–"}">
        <span class="c-pos"><b>${r.pos ?? "–"}</b>${move}</span>
        <span class="c-drv"><span class="bar"></span><b>${esc(d.abbr)}</b>${r.fastest ? '<i class="fl" title="Schnellste Runde"></i>' : ""}${f.final && r.points ? `<i class="pts">+${r.points}</i>` : ""}${r.knocked ? `<i class="qtag" title="ausgeschieden in ${esc(r.status)}">${esc(r.status)}</i>` : ""}<small>${esc(d.team)}</small></span>
        <span class="c-gap">${r.pitNow && !r.out ? '<span class="box">BOX</span>' : gapCell(r, i)}</span>
        <span class="c-tyre">${tyre(r.compound, r.tyreAge)}</span>
        <span class="c-stops">${r.pits}</span>
        <span class="c-last ${lastCls}">${last}</span>
      </li>`;
    }).join("");
    $("hint").hidden = !!fav;
    renderTyres(f);
    renderFav(f);
    renderMsgs(f);
  }

  // ---------- Reifen aller Fahrer ----------
  const TYRE_DE = { SOFT: "Soft", MEDIUM: "Medium", HARD: "Hard", INTERMEDIATE: "Intermediate", WET: "Regen" };
  let view = store.get("f1_view") === "tyres" ? "tyres" : "times";
  let tyreInfo = null;   // { n, i } angetippter Abschnitt

  function setView(v) {
    view = v; store.set("f1_view", v);
    document.querySelectorAll(".tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.view === v)));
    $("board").hidden = v !== "times";
    $("tyres").hidden = v !== "tyres";
    if (race) show(frame);
  }

  function renderTyres(f) {
    if (view !== "tyres") return;
    // Skala: Renndistanz (live notfalls die längste bisherige Fahrt)
    let total = race.laps || 0;
    for (const r of f.rows) for (const g of r.stints || []) total = Math.max(total, g.from + g.laps - 1);
    total = Math.max(total, 1);
    const now = f.live ? f.lap : f.final ? total : f.lap;
    const pct = x => (x / total * 100).toFixed(3) + "%";
    const ticks = [1];
    for (let k = 10; k < total; k += 10) ticks.push(k);
    if (total > 1) ticks.push(total);
    $("tyre-axis").innerHTML = ticks.map(k => `<span style="left:${pct(k - 0.5)}">${k}</span>`).join("");
    $("tyre-rows").innerHTML = f.rows.map(r => {
      const d = race.drivers.get(r.n);
      const segs = (r.stints || []).map((g, i) => {
        const k = M.TYRE[g.c] || "?";
        const w = Math.max(g.laps, 0.35);     // frisch aufgezogen: schmaler Strich statt nichts
        const sel = tyreInfo && tyreInfo.n === r.n && tyreInfo.i === i ? " sel" : "";
        return `<button type="button" class="seg t-${k}${sel}" data-n="${r.n}" data-i="${i}" style="left:${pct(g.from - 1)};width:calc(${pct(w)} - 2px)" title="${esc(d.abbr)} · ${esc(TYRE_DE[g.c] || g.c)} · Runde ${g.from}–${g.from + Math.max(g.laps, 1) - 1}" aria-label="${esc(d.abbr)} ${esc(TYRE_DE[g.c] || g.c)}, ${g.laps} Runden">${g.laps >= 3 ? k : ""}${g.laps >= 7 ? `<small>${g.laps}</small>` : ""}</button>`;
      }).join("");
      return `<li class="trow${r.n === fav ? " is-fav" : ""}${r.out ? " is-out" : ""}" style="--team:${esc(d.color)}">
        <span class="t-pos">${r.pos ?? "–"}</span><span class="bar"></span><b class="t-abbr">${esc(d.abbr)}</b>
        <span class="track">${segs}${now > 0 && now < total ? `<i class="now" style="left:${pct(now)}"></i>` : ""}</span>
      </li>`;
    }).join("");
    // Info zum angetippten Abschnitt
    const box = $("tyre-info");
    const r = tyreInfo && f.rows.find(x => x.n === tyreInfo.n);
    const g = r && (r.stints || [])[tyreInfo.i];
    if (!g) { box.textContent = "Tipp auf einen Abschnitt für Details."; box.classList.remove("on"); return; }
    const d = race.drivers.get(r.n), to = g.from + Math.max(g.laps, 1) - 1;
    box.classList.add("on");
    box.innerHTML = `<span class="tyre t-${M.TYRE[g.c] || "?"}">${M.TYRE[g.c] || "?"}</span>
      <b>${esc(d.abbr)}</b> · ${esc(TYRE_DE[g.c] || g.c)} · ${g.laps ? `Runde ${g.from}–${to} · ${g.laps} ${g.laps === 1 ? "Runde" : "Runden"}` : `ab Runde ${g.from}`}
      · ${tyreInfo.i === 0 ? "Startreifen" : `nach Stopp ${tyreInfo.i}`}`;
  }

  function renderFav(f) {
    const box = $("fav");
    const i = f.rows.findIndex(r => r.n === fav);
    if (i < 0) { box.hidden = true; return; }
    const r = f.rows[i], d = race.drivers.get(r.n);
    const ahead = f.rows[i - 1], behind = f.rows[i + 1];
    const gapTo = (a, b) => (!a || !b || a.out || b.out || (f.lap === 0 && !f.timed)) ? null :
      (typeof b.interval === "number" ? b.interval : typeof a.gap === "number" && typeof b.gap === "number" ? b.gap - a.gap : null);
    const gA = gapTo(ahead, r), gB = gapTo(r, behind);
    // Trend je Runde: vorne kleiner = gut, hinten kleiner = Druck
    const dA = delta(r, "interval"), dB = behind ? delta(behind, "interval") : null;
    const trend = (d, good) => d == null || Math.abs(d) < TREND_MIN ? "" :
      `<i class="tr ${(d < 0) === good ? "tr-in" : "tr-out"}">${d < 0 ? "↓" : "↑"}${Math.abs(d).toFixed(1)}</i>`;
    const segs = (r.stints || []).filter(x => x.laps > 0 || x === r.stints[r.stints.length - 1]);
    const sum = segs.reduce((a, x) => a + Math.max(x.laps, 1), 0);
    const bar = segs.length ? `<div class="fav-stints" aria-label="Reifenverlauf">${segs.map(x => {
      const k = M.TYRE[x.c] || "?";
      return `<span class="seg t-${k}" style="flex:${Math.max(x.laps, 1) / sum}" title="${esc(x.c)}: ${x.laps} Runden">${k}<small>${x.laps}</small></span>`;
    }).join("")}</div>` : "";
    const nm = x => race.drivers.get(x.n).abbr;
    box.hidden = false;
    box.style.setProperty("--team", d.color);
    box.innerHTML = `
      <div class="fav-top">
        <div class="fav-pos"><small>P</small>${r.pos ?? "–"}</div>
        <div class="fav-name"><span>${esc(d.first)}</span><b>${esc(d.last)}</b><small>${esc(d.team)}</small></div>
        <button class="unfav" type="button" title="Nicht mehr verfolgen" aria-label="Nicht mehr verfolgen">✕</button>
      </div>
      <div class="fav-grid">
        <div><span>Vordermann</span><b>${ahead && gA != null ? "−" + gA.toFixed(1) + " s" : "–"}${trend(dA, true)}</b><small>${ahead ? nm(ahead) : ""}</small></div>
        <div><span>Hintermann</span><b>${behind && gB != null ? "+" + gB.toFixed(1) + " s" : "–"}${trend(dB, false)}</b><small>${behind ? nm(behind) : ""}</small></div>
        <div><span>Reifen</span><b class="fav-tyre">${tyre(r.compound)} ${r.tyreAge ?? "–"} Rd.</b><small>${r.pits} ${r.pits === 1 ? "Stopp" : "Stopps"}</small></div>
        ${f.timed
          ? `<div><span>Bestzeit</span><b class="${r.fastest ? "purple" : ""}">${M.lapTime(r.best)}</b><small>${r.laps} Runden${r.knocked ? " · raus in " + esc(r.status) : ""}</small></div>`
          : `<div><span>Letzte / Beste</span><b class="${r.lastPurple ? "purple" : r.lastPB ? "pb" : ""}">${M.lapTime(r.last)}</b><small>${M.lapTime(r.best)}</small></div>`}
      </div>${bar}`;
    box.querySelector(".unfav").addEventListener("click", () => setFav(null));
  }

  function renderMsgs(f) {
    const all = f.msgs.slice().reverse();
    const list = showAll ? all : all.slice(0, 4);
    $("msgs").innerHTML = list.length ? list.map(m =>
      `<li class="${m.driver && m.driver === fav ? "mine" : ""}"><span class="rl">${m.lap ? "R" + m.lap : isFinite(m.time) ? fmtClock(m.time) : "–"}</span>${esc(m.text)}</li>`).join("")
      : `<li class="muted">Noch keine Meldungen.</li>`;
    $("more").hidden = all.length <= 4;
    $("more").textContent = showAll ? "Weniger anzeigen" : `Alle ${all.length} Meldungen`;
  }

  function setFav(n) {
    fav = n;
    store.set("f1_fav", n ? String(n) : "");
    show(frame);
    if (n) window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ---------- Abspielen ----------
  function stop() { clearInterval(timer); timer = null; $("play").innerHTML = ICON.play; $("play").title = "Abspielen"; }
  function play() {
    if (!race) return;
    if (frame >= race.frames.length - 1) show(0);
    $("play").innerHTML = ICON.pause; $("play").title = "Anhalten";
    timer = setInterval(() => { if (frame >= race.frames.length - 1) stop(); else show(frame + 1); }, 1200);
  }

  // ---------- Ereignisse ----------
  $("meeting").addEventListener("change", e => {
    if (e.target.value === "live") { fillSessions(); return startLive(); }
    fillSessions();
    const m = meetings.find(x => String(x.key) === e.target.value);
    // Neues Wochenende: das Rennen (sonst die letzte Session) vorwählen
    const s = m && ([...m.sessions].reverse().find(x => x.session_name === "Race") || m.sessions[m.sessions.length - 1]);
    if (s) { $("session").value = String(s.session_key); openSession(s.session_key); }
  });
  $("session").addEventListener("change", e => openSession(+e.target.value));
  $("slider").addEventListener("input", e => { stop(); show(+e.target.value); });
  $("prev").addEventListener("click", () => { stop(); show(frame - 1); });
  $("next").addEventListener("click", () => { stop(); show(frame + 1); });
  $("end").addEventListener("click", () => { stop(); if (race) show(race.frames.length - 1); });
  $("play").addEventListener("click", () => (timer ? stop() : play()));
  $("gapmode").addEventListener("click", () => {
    gapMode = gapMode === "leader" ? "interval" : "leader";
    store.set("f1_gapmode", gapMode);
    show(frame);
  });
  $("more").addEventListener("click", () => { showAll = !showAll; if (race) renderMsgs(race.frames[frame]); });
  const pickRow = e => {
    const li = e.target.closest(".row");
    if (!li) return;
    const n = +li.dataset.n;
    setFav(fav === n ? null : n);
  };
  $("rows").addEventListener("click", pickRow);
  document.querySelectorAll(".tabs button").forEach(b => b.addEventListener("click", () => setView(b.dataset.view)));
  $("tyre-rows").addEventListener("click", e => {
    const s = e.target.closest(".seg");
    if (!s) return;
    const n = +s.dataset.n, i = +s.dataset.i;
    tyreInfo = tyreInfo && tyreInfo.n === n && tyreInfo.i === i ? null : { n, i };
    if (race) renderTyres(race.frames[frame]);
  });
  setView(view);
  $("rows").addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickRow(e); } });

  loadCalendar().catch(() => {
    $("meeting").innerHTML = "<option>Kalender nicht erreichbar</option>";
    $("rows").innerHTML = `<li class="loading err">OpenF1 ist gerade nicht erreichbar. Bitte später nochmal probieren.</li>`;
  });
})();
