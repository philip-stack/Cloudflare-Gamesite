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
    if (meta) meta.content = "#101017";     // Kopfleiste ist in beiden Modi dunkel
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

  // ---------- Benachrichtigungen (eigener Service Worker, Scope /f1/) ----------
  const BELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z"/><path d="M10 20a2 2 0 0 0 4 0"/></svg>';
  $("bell").innerHTML = BELL;
  const canPush = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  let pushPrefs = (() => { try { return JSON.parse(store.get("f1_push") || "null"); } catch (_) { return null; } })() || { on: false, start: true, flags: true, fia: true };
  const b64ToU8 = k => {
    const pad = "=".repeat((4 - k.length % 4) % 4), raw = atob((k + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, c => c.charCodeAt(0));
  };
  async function getSub(create) {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub && create) {
      const { key } = await (await fetch("/api/push")).json();
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(key) });
    }
    return sub;
  }
  const alertApi = async body => {
    const r = await fetch("/api/f1/alert", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || "Fehler " + r.status);
    return d;
  };
  function pushNote(t, err) { const n = $("push-note"); n.textContent = t || ""; n.classList.toggle("err", !!err); }
  function renderPush() {
    $("push-on").checked = !!pushPrefs.on;
    $("push-start").checked = pushPrefs.start; $("push-flags").checked = pushPrefs.flags; $("push-fia").checked = pushPrefs.fia;
    $("push-opts").disabled = !pushPrefs.on;
    $("push-test").hidden = !pushPrefs.on;
    $("push-state").textContent = pushPrefs.on ? "an" : "aus";
    const d = fav && race && race.drivers.get(fav);
    $("push-fia-sub").textContent = d ? `Strafen und Vorladungen zu ${d.first} ${d.last}` : "Tipp zuerst in der Liste auf deinen Fahrer";
    $("bell").classList.toggle("on", !!pushPrefs.on);
  }
  async function savePush(on) {
    pushNote("");
    try {
      if (on) {
        if (!canPush) throw new Error(/iPhone|iPad/.test(navigator.userAgent) ? "Am iPhone: zuerst „Zum Home-Bildschirm“ hinzufügen und von dort öffnen." : "Dieser Browser kann keine Benachrichtigungen.");
        if (await Notification.requestPermission() !== "granted") throw new Error("Benachrichtigungen sind für diese Seite blockiert (Browser-Einstellungen).");
        const sub = await getSub(true);
        await alertApi({ action: "subscribe", subscription: sub.toJSON(), fav: fav || null, start: pushPrefs.start, flags: pushPrefs.flags, fia: pushPrefs.fia });
      } else {
        const sub = canPush ? await getSub(false) : null;
        if (sub) await alertApi({ action: "unsubscribe", endpoint: sub.endpoint });
      }
      pushPrefs.on = on;
      store.set("f1_push", JSON.stringify(pushPrefs));
      if (on) pushNote("Gespeichert.");
    } catch (e) {
      pushPrefs.on = false; store.set("f1_push", JSON.stringify(pushPrefs));
      pushNote(e.message || "Hat nicht geklappt.", true);
    }
    renderPush();
  }
  // Abgleich beim Öffnen: Server kennt das Abo noch? (z. B. nach Neuinstallation)
  // Erst nach dem Start-Durchlauf (race/fav sind weiter unten deklariert).
  setTimeout(async () => {
    if (!canPush || !pushPrefs.on) return renderPush();
    try {
      const sub = await getSub(false);
      const d = sub ? await alertApi({ action: "get", endpoint: sub.endpoint }) : { on: false };
      if (!d.on) pushPrefs.on = false; else Object.assign(pushPrefs, { start: d.start, flags: d.flags, fia: d.fia });
      store.set("f1_push", JSON.stringify(pushPrefs));
    } catch (_) {}
    renderPush();
  }, 0);
  $("bell").addEventListener("click", () => { renderPush(); pushNote(""); $("pushsheet").hidden = false; });
  $("push-close").addEventListener("click", () => { $("pushsheet").hidden = true; });
  $("pushsheet").addEventListener("click", e => { if (e.target.id === "pushsheet") $("pushsheet").hidden = true; });
  $("push-on").addEventListener("change", e => savePush(e.target.checked));
  for (const k of ["start", "flags", "fia"]) $("push-" + k).addEventListener("change", e => { pushPrefs[k] = e.target.checked; savePush(true); });
  $("push-test").addEventListener("click", async () => {
    try {
      const sub = await getSub(false);
      const r = await fetch("/api/push", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "test", endpoint: sub.endpoint }) });
      pushNote(r.ok ? "Testmeldung ist unterwegs." : "Test fehlgeschlagen.", !r.ok);
    } catch (_) { pushNote("Test fehlgeschlagen.", true); }
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
  let liveTimer = null, liveLap = -1, liveBase = new Map(), lastPos = new Map(), liveHist = new Map();
  let mode = "";          // "live" | "race" (OpenF1-Nachschau) | "archive" (Training/Qualifying)
  let meetings = [];      // [{ key, name, sessions: [...] }] neueste zuerst
  let liveMeeting = null; // OpenF1-Session, die gerade live ist
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
    // Zeitplan: Wochenende der nächsten (oder gerade laufenden) Session
    const anchor = live || next;
    planSessions = anchor ? all.filter(s => s.meeting_key === anchor.meeting_key).sort((a, b) => Date.parse(a.date_start) - Date.parse(b.date_start)) : [];
    renderPlan();
    if (live) setDocTarget(live.meeting && live.meeting.meeting_name, live.date_start);
    else if (force && meetings[0]) setDocTarget(meetings[0].sessions[0].meeting && meetings[0].sessions[0].meeting.meeting_name, meetings[0].sessions[0].date_start);
    liveMeeting = live;
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
    setDocTarget(s.meeting && s.meeting.meeting_name, s.date_start);
    store.set("f1_session", String(key));
    return s.session_type === "Race" ? loadSession(key) : loadArchive(s);
  }

  // ---------- Live (F1-Feed über /api/f1-live) ----------
  function startLive() {
    stop(); stopLive();
    mode = "live";
    race = null; liveLap = -1; liveBase = new Map(); lastPos = new Map(); liveHist = new Map();
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
      race = { live: true, session: d.session, wm: d.wm, drivers: new Map(d.drivers.map(x => [x.n, x])), laps: f.total, frames: [f] };
      if (d.session.race && f.lap > 0) liveHist.set(f.lap, { lap: f.lap, status: f.status, rows: f.rows.map(r => ({ n: r.n, pos: r.pos, pits: r.pits, out: r.out })) });
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

  // ---------- Zeitplan mit Countdown ----------
  let planSessions = [];
  function countdown(ms) {
    const m = Math.max(0, Math.round(ms / 60000)), d = Math.floor(m / 1440), h = Math.floor(m % 1440 / 60), mi = m % 60;
    return d ? `in ${d} T ${h} Std` : h ? `in ${h} Std ${mi} Min` : `in ${mi} Min`;
  }
  function renderPlan() {
    const box = $("plan");
    if (!planSessions.length) { box.hidden = true; return; }
    const now = Date.now();
    const state = s => Date.parse(s.date_end) < now ? "done" : Date.parse(s.date_start) <= now ? "live" : "next";
    const nextS = planSessions.find(s => state(s) !== "done");
    if (!nextS) { box.hidden = true; return; }
    box.hidden = false;
    const st = state(nextS);
    $("plan-sum").innerHTML = `<span class="plan-gp">${esc(gpName(nextS.meeting) || nextS.location)}</span>
      <span class="plan-next">${esc(sessName(nextS))} · ${st === "live" ? '<b class="plan-live">läuft</b>' : `${esc(fmtDay(nextS.date_start))} ${fmtClock(nextS.date_start)} · <b>${countdown(Date.parse(nextS.date_start) - now)}</b>`}</span>`;
    $("plan-list").innerHTML = planSessions.map(s => {
      const k = state(s);
      return `<li class="p-${k}${s === nextS ? " p-cur" : ""}"><span class="p-name">${esc(sessName(s))}</span>
        <span class="p-when">${esc(fmtDay(s.date_start))} · ${fmtClock(s.date_start)}–${fmtClock(s.date_end)}</span>
        <span class="p-cd">${k === "done" ? "vorbei" : k === "live" ? "läuft" : countdown(Date.parse(s.date_start) - now)}</span></li>`;
    }).join("");
  }
  setInterval(renderPlan, 30000);

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
    renderChart(f);
    renderWM();
    if (view === "docs" && !docsTagged) { docsTagged = true; renderDocs(); }   // Fahrerkürzel nachtragen
    renderFav(f);
    renderMsgs(f);
  }

  // ---------- Reifen aller Fahrer ----------
  const TYRE_DE = { SOFT: "Soft", MEDIUM: "Medium", HARD: "Hard", INTERMEDIATE: "Intermediate", WET: "Regen" };
  let view = ["tyres", "chart", "wm", "docs"].includes(store.get("f1_view")) ? store.get("f1_view") : "times";
  let tyreInfo = null;   // { n, i } angetippter Abschnitt

  function setView(v) {
    view = v; store.set("f1_view", v);
    document.querySelectorAll(".tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.view === v)));
    $("board").hidden = v !== "times";
    $("tyres").hidden = v !== "tyres";
    $("docs").hidden = v !== "docs";
    $("chart").hidden = v !== "chart";
    $("wm").hidden = v !== "wm";
    document.body.classList.toggle("view-docs", v === "docs" || v === "wm");
    if (v === "docs") loadDocs();
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

  // ---------- Positionsverlauf (Platz je Runde) ----------
  let chartSel = new Set((() => { try { return JSON.parse(store.get("f1_chartsel") || "[]"); } catch (_) { return []; } })());
  let chartHover = null;   // Runde unter dem Finger/Mauszeiger
  const SVGNS = "http://www.w3.org/2000/svg";

  function chartFrames(f) {
    if (race.live) return [...liveHist.values()].sort((a, b) => a.lap - b.lap);
    return race.frames.slice(0, frame + 1);
  }
  function renderChart(f) {
    if (view !== "chart") return;
    const box = $("chart-box");
    const isRace = race.live ? race.session && race.session.race : !f.timed;
    if (!isRace) { box.innerHTML = `<p class="chart-empty">Den Positionsverlauf gibt es für Rennen und Sprint.</p>`; $("chart-info").textContent = ""; return; }
    const frames = chartFrames(f);
    if (frames.length < 2) { box.innerHTML = `<p class="chart-empty">${race.live ? "Der Verlauf füllt sich ab jetzt Runde für Runde." : "Noch keine Runde gefahren."}</p>`; $("chart-info").textContent = ""; return; }
    const drivers = [...race.drivers.values()];
    const n = Math.max(drivers.length, ...frames.flatMap(x => x.rows.map(r => r.pos || 0)));
    const maxLap = Math.max(race.laps || 0, frames[frames.length - 1].lap, 1);
    const W = Math.max(300, box.clientWidth - 8), rowH = 15, L = 22, R = 46, T = 16, B = 6;
    const H = T + n * rowH + B, pw = W - L - R;
    const x = lap => L + (lap / maxLap) * pw, y = pos => T + (pos - 0.5) * rowH;
    const hi = new Set([...chartSel, ...(fav ? [fav] : [])]);
    // Teamkollegen: zweiter Fahrer eines Teams gestrichelt
    const seenTeam = new Set(), dashed = new Set();
    for (const d of drivers) { if (!hi.has(d.n)) continue; if (seenTeam.has(d.color)) dashed.add(d.n); seenTeam.add(d.color); }
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Platzierung je Runde">`;
    // SC/VSC/Rot als Hintergrundbänder
    for (let i = 1; i < frames.length; i++) {
      const st = frames[i].status, cls = st === "red" ? "band-red" : /sc|vsc/.test(st) ? "band-sc" : "";
      if (cls) s += `<rect class="${cls}" x="${x(frames[i - 1].lap)}" y="${T}" width="${Math.max(1, x(frames[i].lap) - x(frames[i - 1].lap))}" height="${n * rowH}"/>`;
    }
    // Raster: Plätze 1, 5, 10 … und Runden alle 10
    for (let p = 1; p <= n; p++) if (p === 1 || p % 5 === 0) s += `<text class="ax" x="${L - 5}" y="${y(p) + 3.5}" text-anchor="end">${p}</text>`;
    for (let k = 10; k < maxLap - 4; k += 10) s += `<line class="grid" x1="${x(k)}" x2="${x(k)}" y1="${T}" y2="${T + n * rowH}"/><text class="ax" x="${x(k)}" y="${T - 5}" text-anchor="middle">${k}</text>`;
    s += `<text class="ax" x="${x(maxLap)}" y="${T - 5}" text-anchor="end">${maxLap}</text>`;
    // Linien: erst die gedämpften, dann die hervorgehobenen obenauf
    const lines = drivers.map(d => {
      const pts = [], pits = [];
      let prevPits = null;
      for (const fr of frames) {
        const r = fr.rows.find(q => q.n === d.n);
        if (!r || r.pos == null || (r.out && fr.lap > 0 && pts.length)) continue;
        pts.push([x(fr.lap), y(r.pos)]);
        if (prevPits != null && r.pits > prevPits) pits.push([x(fr.lap), y(r.pos)]);
        prevPits = r.pits;
      }
      return { d, pts, pits };
    });
    for (const pass of [false, true]) for (const { d, pts, pits } of lines) {
      if (hi.has(d.n) !== pass || pts.length < 2) continue;
      const path = "M" + pts.map(p => p[0].toFixed(1) + "," + p[1].toFixed(1)).join("L");
      s += `<path class="ln${pass ? " hi" : ""}" d="${path}"${pass ? ` style="stroke:${esc(d.color)}"${dashed.has(d.n) ? ' stroke-dasharray="6 3"' : ""}` : ""}/>`;
      if (pass) for (const p of pits) s += `<circle class="pit" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3.5" style="stroke:${esc(d.color)}"/>`;
    }
    // Aktuelle Runde (Nachschau mitten im Rennen)
    if (!race.live && frame < race.frames.length - 1) s += `<line class="now" x1="${x(f.lap)}" x2="${x(f.lap)}" y1="${T}" y2="${T + n * rowH}"/>`;
    if (chartHover != null) s += `<line class="cross" x1="${x(chartHover)}" x2="${x(chartHover)}" y1="${T}" y2="${T + n * rowH}"/>`;
    // Kürzel rechts in der Reihenfolge des aktuellen Stands (zum Antippen)
    f.rows.forEach((r, i) => {
      const d = race.drivers.get(r.n); if (!d) return;
      const on = hi.has(r.n), yy = y(i + 1);
      s += `<g class="lbl${on ? " hi" : ""}" data-n="${r.n}"><rect x="${W - R + 2}" y="${yy - rowH / 2}" width="${R - 2}" height="${rowH}" fill="transparent"/>
        <circle class="dot" cx="${W - R + 7}" cy="${yy}" r="3" style="fill:${esc(d.color)}"/><text x="${W - R + 13}" y="${yy + 3.5}">${esc(d.abbr)}</text></g>`;
    });
    box.innerHTML = s + "</svg>";
    box.dataset.geo = JSON.stringify({ W, L, pw, maxLap });
    // Info-Zeile: Runde unter dem Finger, sonst aktueller Stand der Hervorgehobenen
    const lap = chartHover != null ? chartHover : frames[frames.length - 1].lap;
    const fr = frames.reduce((a, b) => (Math.abs(b.lap - lap) < Math.abs(a.lap - lap) ? b : a));
    const sel = [...hi].map(nn => { const r = fr.rows.find(q => q.n === nn), d = race.drivers.get(nn); return r && d ? `<b>${esc(d.abbr)}</b> P${r.pos ?? "–"}` : ""; }).filter(Boolean);
    $("chart-info").innerHTML = `Runde ${fr.lap}${sel.length ? " · " + sel.join(" · ") : ""}`;
    $("chart-hint").hidden = hi.size > 0;
  }
  function chartPointer(e) {
    const box = $("chart-box"), svg = box.querySelector("svg");
    if (!svg || !box.dataset.geo) return;
    const g = JSON.parse(box.dataset.geo), rect = svg.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (g.W / rect.width);
    if (px < g.L || px > g.L + g.pw) { if (chartHover != null) { chartHover = null; renderChart(race.frames[frame]); } return; }
    const lap = Math.round((px - g.L) / g.pw * g.maxLap);
    if (lap !== chartHover) { chartHover = lap; renderChart(race.frames[frame]); }
  }

  // ---------- WM-Stand ----------
  let wmMode = store.get("f1_wmmode") === "teams" ? "teams" : "drivers";
  const wmCache = new Map();   // session_key → Promise<{ drivers, teams, names }>
  function wmSession() {
    // Rennen/Sprint, das zum gewählten Stand passt: die gewählte Session selbst
    // oder das letzte Rennen davor
    const cur = sessions.find(s => s.session_key === +$("session").value);
    const until = cur ? Date.parse(cur.date_end) : Date.now();
    return sessions.filter(s => s.session_type === "Race" && Date.parse(s.date_end) <= until)
      .sort((a, b) => Date.parse(b.date_start) - Date.parse(a.date_start))[0] || null;
  }
  function loadWM(key) {
    if (!wmCache.has(key)) wmCache.set(key, (async () => {
      const [dr, tm, names] = await Promise.all([get("championship_drivers", { session_key: key }), get("championship_teams", { session_key: key }), get("drivers", { session_key: key })]);
      const norm = (x, id) => ({ ...id, pos0: x.position_start, pos: x.position_current, pts0: x.points_start ?? 0, pts: x.points_current ?? 0 });
      return {
        drivers: dr.map(x => norm(x, { n: x.driver_number })).sort((a, b) => a.pos - b.pos),
        teams: tm.map(x => norm(x, { team: x.team_name })).sort((a, b) => a.pos - b.pos),
        names: new Map(names.map(d => [d.driver_number, { n: d.driver_number, abbr: d.name_acronym, first: d.first_name, last: d.last_name, team: d.team_name, color: "#" + (d.team_colour || "888888") }])),
      };
    })().catch(e => { wmCache.delete(key); throw e; }));
    return wmCache.get(key);
  }
  let wmRun = 0;
  async function renderWM() {
    if (view !== "wm") return;
    document.querySelectorAll(".seg2 button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.wm === wmMode)));
    const list = $("wm-list"), cap = $("wm-cap");
    const run = ++wmRun;
    let data, names = race ? race.drivers : new Map();
    if (race && race.live && race.wm) {
      data = race.wm;
      cap.innerHTML = `<b>Live</b> · Hochrechnung, wenn jetzt Schluss wäre`;
    } else {
      const s = wmSession();
      if (!s) { list.innerHTML = `<li class="doc-empty">Noch kein Rennen in dieser Saison.</li>`; cap.textContent = ""; return; }
      cap.textContent = `Nach: ${gpName(s.meeting) || s.location} · ${sessName(s)}`;
      if (!list.children.length || list.dataset.key !== String(s.session_key)) list.innerHTML = `<li class="doc-empty"><span class="spinner"></span></li>`;
      try { data = await loadWM(s.session_key); } catch (_) { if (run === wmRun) list.innerHTML = `<li class="doc-empty">WM-Stand gerade nicht verfügbar.</li>`; return; }
      if (run !== wmRun) return;
      list.dataset.key = String(s.session_key);
      names = data.names;
    }
    const teamColor = new Map([...names.values()].map(d => [d.team, d.color]));
    const favTeam = fav && names.get(fav) ? names.get(fav).team : null;
    const rows = wmMode === "teams" ? data.teams : data.drivers;
    list.innerHTML = rows.map(x => {
      const d = wmMode === "drivers" ? names.get(x.n) : null;
      const color = d ? d.color : teamColor.get(x.team) || "#888";
      const mv = x.pos0 && x.pos ? x.pos0 - x.pos : 0;
      const gain = Math.round((x.pts - x.pts0) * 10) / 10;
      const mine = wmMode === "drivers" ? x.n === fav : x.team === favTeam;
      return `<li class="wm-row${mine ? " is-fav" : ""}" style="--team:${esc(color)}">
        <span class="wm-pos"><b>${x.pos ?? "–"}</b>${mv > 0 ? `<i class="up">▲${mv}</i>` : mv < 0 ? `<i class="down">▼${-mv}</i>` : ""}</span>
        <span class="bar"></span>
        <span class="wm-name"><b>${esc(d ? d.last || d.abbr : x.team)}</b><small>${esc(d ? d.team : "")}</small></span>
        <span class="wm-gain${gain ? "" : " zero"}">${gain ? "+" + gain : "±0"}</span>
        <span class="wm-pts">${Math.round(x.pts * 10) / 10}</span>
      </li>`;
    }).join("") || `<li class="doc-empty">Keine Daten.</li>`;
  }

  // ---------- FIA-Dokumente des Wochenendes ----------
  const PDFJS = "./vendor/pdfjs-4.10.38/";
  const fmtDocDay = new Intl.DateTimeFormat("de-AT", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  let docTarget = null, docsTagged = false;   // { year, name } — Grand Prix, dessen Dokumente gezeigt werden
  let docs = { key: "", list: null, error: false };
  const fiaEvents = new Map();   // Jahr → Promise<[Namen]>
  const docClass = t => /infringement|offence|decision|summons|penalt|reprimand|investigation|protest|appeal/i.test(t) ? "dec"
    : /classification|starting grid|championship points|lap chart|fastest laps/i.test(t) ? "res" : "";

  function setDocTarget(meetingName, date) {
    if (!meetingName) return;
    docTarget = { name: meetingName, year: new Date(date || Date.now()).getFullYear() };
    if (view === "docs") loadDocs();
  }
  // OpenF1-Name ↔ FIA-Event: meist identisch, sonst über gemeinsame Wörter
  function matchEvent(events, name) {
    const norm = s => s.toLowerCase().replace(/grand prix|\bgp\b|formula 1|\bthe\b|\bof\b/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const exact = events.find(e => e.toLowerCase() === name.toLowerCase());
    if (exact) return exact;
    const want = new Set(norm(name).split(" ").filter(Boolean));
    let best = null, score = 0;
    for (const e of events) {
      const sc = norm(e).split(" ").filter(w => want.has(w)).length;
      if (sc > score) { best = e; score = sc; }
    }
    return best;
  }
  async function loadDocs(force) {
    if (!docTarget) { renderDocs(); return; }
    const key = docTarget.year + "|" + docTarget.name;
    if (!force && docs.key === key && (docs.list || docs.error)) { renderDocs(); return; }
    docs = { key, list: null, error: false };
    $("doc-list").innerHTML = `<li class="doc-empty"><span class="spinner"></span></li>`;
    try {
      if (!fiaEvents.has(docTarget.year)) fiaEvents.set(docTarget.year, get("fia", { year: docTarget.year }).then(d => d.events || []));
      const ev = matchEvent(await fiaEvents.get(docTarget.year), docTarget.name);
      const list = ev ? (await get("fia", { year: docTarget.year, event: ev })).docs || [] : [];
      if (docs.key === key) docs.list = list;
    } catch (_) {
      fiaEvents.delete(docTarget.year);
      if (docs.key === key) docs.error = true;
    }
    renderDocs();
  }
  // „Car 5“ → „Car 5 BOR“ (Kürzel aus der geladenen Session)
  const carTags = t => race ? t.replace(/\bCars? ([\d, and]+)/g, (m, nums) =>
    m + nums.split(/\D+/).filter(Boolean).map(n => race.drivers.get(+n)).filter(Boolean).map(d => ` <i class="doc-car">${esc(d.abbr)}</i>`).join("")) : t;
  function renderDocs() {
    if (view !== "docs") return;
    docsTagged = !!race;
    const box = $("doc-list");
    if (!docTarget) { box.innerHTML = `<li class="doc-empty">Kein Wochenende gewählt.</li>`; return; }
    if (docs.error) { box.innerHTML = `<li class="doc-empty">fia.com ist gerade nicht erreichbar.</li>`; return; }
    if (!docs.list) return;
    const q = $("doc-q").value.trim().toLowerCase();
    const onlyDec = $("doc-dec").getAttribute("aria-pressed") === "true";
    const list = docs.list.filter(d => (!onlyDec || docClass(d.title) === "dec") &&
      (!q || d.title.toLowerCase().includes(q) || String(d.no) === q));
    if (!docs.list.length) { box.innerHTML = `<li class="doc-empty">Für ${esc(docTarget.name)} gibt es (noch) keine FIA-Dokumente.</li>`; return; }
    if (!list.length) { box.innerHTML = `<li class="doc-empty">Nichts gefunden.</li>`; return; }
    const fresh = Date.now() - 3 * 3600e3;
    box.innerHTML = list.map(d => {
      const c = docClass(d.title);
      // FIA-Zeit ist Ortszeit Mitteleuropa → so anzeigen, wie sie dasteht
      const when = d.date ? `${fmtDocDay.format(new Date(d.date + "Z"))} · ${d.date.slice(11, 16)}` : "";
      const isNew = d.date && Date.parse(d.date) > fresh;
      return `<li><button type="button" class="doc${isNew ? " doc-new" : ""}" data-path="${esc(d.path)}" data-title="${esc(d.title)}" data-no="${d.no ?? ""}">
        <span class="doc-no">${d.no ?? "–"}</span>
        <span class="doc-t"><b>${carTags(esc(d.title))}</b><small>${c ? `<span class="doc-tag ${c}">${c === "dec" ? "Entscheidung" : "Ergebnis"}</span>` : ""}${esc(when)}</small></span>
        <span class="doc-go" aria-hidden="true">›</span>
      </button></li>`;
    }).join("");
  }

  // PDF-Betrachter: pdf.js (selbst gehostet), PDF same-origin über /f1data/fia-pdf
  let pdfjs = null, pdfDoc = null, pdfZoom = 1, pdfRun = 0;
  async function openPdf(path, title, no) {
    const v = $("pdfview");
    $("pdf-title").textContent = title;
    $("pdf-sub").textContent = (no ? `Dokument ${no} · ` : "") + (docTarget ? docTarget.name : "");
    $("pdf-pages").innerHTML = `<div class="loading"><span class="spinner"></span><span>Lade PDF …</span></div>`;
    v.hidden = false; document.body.classList.add("pdf-open");
    if (!history.state || !history.state.pdf) history.pushState({ pdf: true }, "");   // Zurück-Taste schließt
    pdfZoom = 1;
    const run = ++pdfRun;
    try {
      if (!pdfjs) {
        pdfjs = await import(PDFJS + "pdf.min.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(PDFJS + "pdf.worker.min.mjs", location.href).href;
      }
      if (pdfDoc) { pdfDoc.destroy(); pdfDoc = null; }
      const doc = await pdfjs.getDocument({
        url: "/f1data/fia-pdf?path=" + encodeURIComponent(path),
        isEvalSupported: false,
        standardFontDataUrl: new URL(PDFJS + "standard_fonts/", location.href).href,
      }).promise;
      if (run !== pdfRun) { doc.destroy(); return; }
      pdfDoc = doc;
      await renderPdf(run);
    } catch (e) {
      if (run === pdfRun) $("pdf-pages").innerHTML = `<div class="loading err">PDF konnte nicht geladen werden.</div>`;
    }
  }
  async function renderPdf(run) {
    const box = $("pdf-pages");
    box.classList.toggle("fit", pdfZoom === 1);
    const width = Math.min(box.clientWidth - 30, 900) * pdfZoom;     // 2 × 12 px Rand + Luft für Scrollbalken
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const canvases = [];
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      if (run !== pdfRun) return;
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: width / base.width * dpr });
      const c = document.createElement("canvas");
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      c.style.width = Math.floor(vp.width / dpr) + "px";
      c.setAttribute("aria-label", `Seite ${i} von ${pdfDoc.numPages}`);
      await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      if (run !== pdfRun) return;
      if (i === 1) box.innerHTML = "";
      box.appendChild(c); canvases.push(c);
    }
  }
  function closePdf(fromHistory) {
    if ($("pdfview").hidden) return;
    pdfRun++;
    $("pdfview").hidden = true; document.body.classList.remove("pdf-open");
    $("pdf-pages").innerHTML = "";
    if (pdfDoc) { pdfDoc.destroy(); pdfDoc = null; }
    if (!fromHistory && history.state && history.state.pdf) history.back();
  }
  function zoomPdf(f) {
    if (!pdfDoc) return;
    pdfZoom = Math.max(1, Math.min(3, +(pdfZoom * f).toFixed(2)));
    renderPdf(++pdfRun);
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
    if (pushPrefs.on && canPush) getSub(false).then(sub => sub && alertApi({ action: "subscribe", subscription: sub.toJSON(), fav: fav || null, start: pushPrefs.start, flags: pushPrefs.flags, fia: pushPrefs.fia })).catch(() => {});
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
    if (e.target.value === "live") {
      if (liveMeeting) setDocTarget(liveMeeting.meeting && liveMeeting.meeting.meeting_name, liveMeeting.date_start);
      fillSessions(); return startLive();
    }
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
  $("chart-box").addEventListener("click", e => {
    const g = e.target.closest(".lbl");
    if (g) {
      const n = +g.dataset.n;
      if (chartSel.has(n)) chartSel.delete(n); else chartSel.add(n);
      store.set("f1_chartsel", JSON.stringify([...chartSel]));
      if (race) renderChart(race.frames[frame]);
      return;
    }
    chartPointer(e);
  });
  $("chart-box").addEventListener("pointermove", e => { if (e.pointerType === "mouse") chartPointer(e); });
  $("chart-box").addEventListener("pointerleave", () => { if (chartHover != null && race) { chartHover = null; renderChart(race.frames[frame]); } });
  document.querySelectorAll(".seg2 button").forEach(b => b.addEventListener("click", () => {
    wmMode = b.dataset.wm; store.set("f1_wmmode", wmMode); renderWM();
  }));
  window.addEventListener("resize", () => { if (race && view === "chart") renderChart(race.frames[frame]); });
  $("doc-q").addEventListener("input", renderDocs);
  $("doc-dec").addEventListener("click", e => {
    const b = e.currentTarget; b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true")); renderDocs();
  });
  $("doc-list").addEventListener("click", e => {
    const b = e.target.closest(".doc");
    if (b) openPdf(b.dataset.path, b.dataset.title, b.dataset.no);
  });
  $("pdf-close").addEventListener("click", () => closePdf());
  $("pdf-in").addEventListener("click", () => zoomPdf(1.5));
  $("pdf-out").addEventListener("click", () => zoomPdf(1 / 1.5));
  window.addEventListener("popstate", () => closePdf(true));
  document.addEventListener("keydown", e => { if (e.key === "Escape") closePdf(); });
  setView(view);
  $("rows").addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pickRow(e); } });

  const deepDoc = /^#doc=(.+)$/.exec(location.hash);
  if (deepDoc) {
    history.replaceState(null, "", location.pathname + location.search);
    const p = decodeURIComponent(deepDoc[1]);
    const t = p.split("/").pop().replace(/\.pdf$/i, "").replace(/^\d{4}_[^-]+-_/, "").replace(/_/g, " ");
    setView("docs");
    openPdf(p, t, null);
  }
  loadCalendar().catch(() => {
    $("meeting").innerHTML = "<option>Kalender nicht erreichbar</option>";
    $("rows").innerHTML = `<li class="loading err">OpenF1 ist gerade nicht erreichbar. Bitte später nochmal probieren.</li>`;
  });
})();
