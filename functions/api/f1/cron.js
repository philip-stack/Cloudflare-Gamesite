import { json, logError } from "../_util.js";
import { pushToEndpoint } from "../push.js";
import { fiaDocsFor } from "../../f1data/_fia.js";
import { F1_LIVE_NAME } from "../f1-live.js";
import { SESSION_DE, gpShort, dueStarts, liveSession, currentMeeting, flagEvent, carNumbers, newDocs, matchEvent } from "./_logic.js";

// ====================================================================
// Zeitgesteuerte Meldungen des Renntickers.
//   GET /api/f1/cron   (Header x-cron-key = CRON_TOKEN; vom worker-rt alle 2 min)
//
//  1. Session beginnt in ≤ 15 min           → alle mit „start“
//  2. Safety Car / VSC / Rote Flagge / Ende → alle mit „flags“ (Stand aus dem
//     Live-DO F1Live; der Cron hält es während der Session nebenbei verbunden)
//  3. Neues FIA-Dokument nennt die Startnummer des Lieblingsfahrers → „fia“
//
// Was schon gemeldet ist, steht in app_config (f1_push_state). Der Kalender
// (OpenF1, edge-gecacht) wird immer gelesen und in app_config.f1_calendar
// gemerkt; FIA nur mit passenden Abos.
// ====================================================================

const UA = "Rennticker/1.0 (+https://philip-stack.pages.dev/f1/; privat)";
const STATE_KEY = "f1_push_state";

function keyEq(got, want) {
  if (!want || got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}
const fetchJson = async (url, ttl) => {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" }, cf: { cacheTtl: ttl, cacheEverything: true } });
  return r.ok ? r.json() : null;
};
const clock = d => new Intl.DateTimeFormat("de-AT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Vienna" }).format(new Date(d));

export async function onRequestGet({ request, env }) {
  const got = request.headers.get("x-cron-key") || new URL(request.url).searchParams.get("key") || "";
  if (!keyEq(got, env.CRON_TOKEN)) return json({ error: "forbidden" }, 403);
  if (!env.DB) return json({ error: "nicht verfügbar" }, 503);

  // Auch ohne Abos weiterlaufen: während einer Session hält der Cron das DO
  // F1Live verbunden, damit es den Live-Verlauf vollständig mitschreibt
  // (Seite mitten im Rennen geöffnet → Diagramme ab Runde 1).
  const subs = (await env.DB.prepare("SELECT endpoint, fav, start, flags, fia FROM f1_alert").all()).results || [];

  const row = await env.DB.prepare("SELECT v FROM app_config WHERE k = ?").bind(STATE_KEY).first();
  let state = {};
  try { state = JSON.parse(row && row.v || "{}"); } catch (_) { state = {}; }
  const now = Date.now(), year = new Date(now).getUTCFullYear();
  const sent = { start: 0, flags: 0, fia: 0, gone: 0 };

  const send = async (who, msg, kind) => {
    for (const s of who) {
      const r = await pushToEndpoint(env, s.endpoint, { ...msg, url: msg.url || "/f1/" });
      if (r.ok) sent[kind]++;
      if (r.gone) {
        sent.gone++;
        await env.DB.batch([
          env.DB.prepare("DELETE FROM f1_alert WHERE endpoint = ?").bind(s.endpoint),
          env.DB.prepare("DELETE FROM push_queue WHERE endpoint = ?").bind(s.endpoint),
        ]);
      }
    }
  };

  try {
    let [sessions, meetings] = await Promise.all([
      fetchJson(`https://api.openf1.org/v1/sessions?year=${year}`, 1800),
      fetchJson(`https://api.openf1.org/v1/meetings?year=${year}`, 1800),
    ]);
    // OpenF1 sperrt während einer Live-Session alles für Gratis-Nutzer (401) —
    // genau dann braucht es den Kalender für die Flaggen. Darum den letzten
    // guten Stand in app_config merken und bei Sperre den nehmen.
    if (Array.isArray(sessions) && sessions.length && Array.isArray(meetings)) {
      const slim = {
        sessions: sessions.map(s => ({ session_key: s.session_key, session_name: s.session_name, date_start: s.date_start, date_end: s.date_end, meeting_key: s.meeting_key, location: s.location, is_cancelled: s.is_cancelled })),
        meetings: meetings.map(m => ({ meeting_key: m.meeting_key, meeting_name: m.meeting_name })),
      };
      await env.DB.prepare("INSERT INTO app_config (k, v) VALUES ('f1_calendar', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(JSON.stringify(slim)).run();
    } else {
      const c = await env.DB.prepare("SELECT v FROM app_config WHERE k = 'f1_calendar'").first();
      try { const j = JSON.parse(c && c.v || "null"); if (j) { sessions = j.sessions; meetings = j.meetings; } } catch (_) { /* kein Stand */ }
    }
    const mName = new Map((meetings || []).map(m => [m.meeting_key, m.meeting_name]));

    // 1. Session-Start
    const due = dueStarts(sessions, now, state.started);
    for (const s of due) {
      const mins = Math.max(1, Math.round((Date.parse(s.date_start) - now) / 60000));
      await send(subs.filter(x => x.start), {
        title: `⏱ ${gpShort(mName.get(s.meeting_key) || s.location)}: ${SESSION_DE[s.session_name] || s.session_name} um ${clock(s.date_start)}`,
        body: `Beginnt in ${mins} Minuten.`,
      }, "start");
    }
    state.started = [...(state.started || []), ...due.map(s => s.session_key)].slice(-40);

    // 2. Flaggen (und DO wachhalten) — nur während einer Session
    // Ganz ohne Kalender (Sperre und noch kein gemerkter Stand): trotzdem den
    // Live-Feed fragen — die Sperre heißt ja gerade, dass eine Session läuft
    const noCal = !Array.isArray(sessions) || !sessions.length;
    const live = liveSession(noCal ? [] : sessions, now) || (noCal ? { meeting_key: null } : null);
    if (live && env.F1_LIVE) {
      const res = await env.F1_LIVE.get(env.F1_LIVE.idFromName(F1_LIVE_NAME)).fetch("https://f1-live/state");
      const d = res.ok ? await res.json() : null;
      if (d && d.ok && d.session && d.frame) {
        const key = d.session.key, status = d.frame.status;
        const prev = state.flag && state.flag.key === key ? state.flag.status : null;
        const lead = d.frame.rows && d.frame.rows[0];
        const drv = lead && (d.drivers || []).find(x => x.n === lead.n);
        const evt = flagEvent(prev, status, {
          label: `${d.session.meeting || gpShort(mName.get(live.meeting_key))} · ${d.session.name}`,
          race: d.session.race, quali: d.session.quali, winner: drv ? drv.abbr : null,
        });
        if (evt) await send(subs.filter(x => x.flags), evt, "flags");
        state.flag = { key, status };
      }
    }

    // 3. FIA-Dokumente zum Lieblingsfahrer — nur rund ums Rennwochenende
    const fiaSubs = subs.filter(x => x.fia && x.fav);
    const meet = fiaSubs.length ? currentMeeting(sessions, now) : null;
    if (meet && mName.get(meet.key)) {
      const r = await fiaDocsFor(year, mName.get(meet.key), matchEvent);
      if (r) {
        const { fresh, seen } = newDocs(state.fia, r.event, r.docs);
        if (fresh.length) {
          const drivers = (await fetchJson(`https://api.openf1.org/v1/drivers?meeting_key=${meet.key}`, 3600)) || [];
          const abbr = n => (drivers.find(x => x.driver_number === n) || {}).name_acronym || `Auto ${n}`;
          for (const doc of fresh.slice(-10)) {
            const cars = carNumbers(doc.title);
            const who = fiaSubs.filter(x => cars.includes(x.fav));
            if (who.length) {
              await send(who, {
                title: `⚖️ FIA zu ${abbr(who[0].fav)}${doc.no ? ` · Dok. ${doc.no}` : ""}`,
                body: doc.title,
                url: "/f1/#doc=" + encodeURIComponent(doc.path),
              }, "fia");
            }
          }
        }
        state.fia = { event: r.event, seen };
      }
    }
  } catch (e) {
    await logError(env, "f1-cron: " + (e && e.message || e), "f1-cron");
  }

  await env.DB.prepare("INSERT INTO app_config (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v")
    .bind(STATE_KEY, JSON.stringify(state)).run();
  return json({ ok: true, subs: subs.length, sent });
}
