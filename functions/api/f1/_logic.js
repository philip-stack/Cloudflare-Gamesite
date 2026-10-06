// ====================================================================
// Entscheidungslogik der Rennticker-Meldungen (reine Funktionen, ohne DB/Netz
// — getestet in tests/f1.test.mjs). Benutzt von /api/f1/cron.
// ====================================================================

export const SESSION_DE = { Race: "Rennen", Sprint: "Sprint", Qualifying: "Qualifying", "Sprint Qualifying": "Sprint-Qualifying",
  "Sprint Shootout": "Sprint-Qualifying", "Practice 1": "1. Training", "Practice 2": "2. Training", "Practice 3": "3. Training" };
export const gpShort = name => String(name || "").replace(/ Grand Prix$/i, " GP");
export const START_LEAD_MS = 15 * 60 * 1000;

// Sessions, die in den nächsten 15 Minuten beginnen und noch nicht gemeldet sind
export function dueStarts(sessions, now, sent) {
  return (sessions || []).filter(s => {
    const t = Date.parse(s.date_start);
    return !s.is_cancelled && t > now && t - now <= START_LEAD_MS && !(sent || []).includes(s.session_key);
  });
}

// Session, die gerade läuft (mit Vorlauf/Nachlauf für Verzögerungen)
export function liveSession(sessions, now) {
  return (sessions || []).find(s => !s.is_cancelled &&
    Date.parse(s.date_start) - 10 * 60e3 <= now && Date.parse(s.date_end) + 60 * 60e3 >= now) || null;
}

// Rennwochenende rund um jetzt (2 Tage vor der ersten bis 12 h nach der letzten Session)
export function currentMeeting(sessions, now) {
  const by = new Map();
  for (const s of sessions || []) {
    if (s.is_cancelled) continue;
    const m = by.get(s.meeting_key) || { key: s.meeting_key, from: Infinity, to: -Infinity };
    m.from = Math.min(m.from, Date.parse(s.date_start)); m.to = Math.max(m.to, Date.parse(s.date_end));
    by.set(s.meeting_key, m);
  }
  return [...by.values()].find(m => m.from - 2 * 864e5 <= now && m.to + 12 * 3600e3 >= now) || null;
}

// Flaggenwechsel → Meldung (nur beim Wechsel IN einen meldenswerten Zustand)
const FLAG_MSG = {
  sc: ["🟡 Safety Car", "Das Safety Car ist auf der Strecke."],
  vsc: ["🟡 Virtuelles Safety Car", "VSC ausgerufen."],
  red: ["🔴 Rote Flagge", "Die Session ist unterbrochen."],
};
export function flagEvent(prev, cur, session) {
  if (!prev || prev === cur) return null;
  if (FLAG_MSG[cur] && !(cur === "sc" && prev === "sc-end")) {
    const [title, body] = FLAG_MSG[cur];
    return { title, body: `${session.label}: ${body}` };
  }
  if (cur === "fin" && session.winner) {
    return session.race
      ? { title: `🏁 ${session.label}: ${session.winner} gewinnt`, body: "Zielflagge – Ergebnis im Rennticker." }
      : session.quali ? { title: `🏁 ${session.label}: Pole für ${session.winner}`, body: "Qualifying vorbei – Startaufstellung im Rennticker." } : null;
  }
  return null;
}

// Startnummern im FIA-Titel: „Car 5 - …“, „Cars 23 and 81 - …“, „… with Car 55“
export function carNumbers(title) {
  const out = new Set();
  for (const m of String(title || "").matchAll(/\bCars?\s+((?:\d{1,2}(?:\s*(?:,|and|&)\s*)?)+)/gi)) {
    for (const n of m[1].match(/\d{1,2}/g) || []) out.add(+n);
  }
  return [...out];
}

// Neue Dokumente seit dem letzten Lauf. Beim ersten Blick auf ein Wochenende
// wird nur gemerkt (kein Schwall alter Dokumente).
export function newDocs(state, event, docs) {
  const paths = (docs || []).map(d => d.path);
  if (!state || state.event !== event) return { fresh: [], seen: paths };
  const known = new Set(state.seen || []);
  return { fresh: (docs || []).filter(d => !known.has(d.path)), seen: [...new Set([...(state.seen || []), ...paths])].slice(-300) };
}

// OpenF1-Name ↔ FIA-Event (wie im Client): exakt, sonst meiste gemeinsame Wörter
export function matchEvent(events, name) {
  const norm = s => String(s).toLowerCase().replace(/grand prix|\bgp\b|formula 1|\bthe\b|\bof\b/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const exact = (events || []).find(e => e.toLowerCase() === String(name).toLowerCase());
  if (exact) return exact;
  const want = new Set(norm(name).split(" ").filter(Boolean));
  let best = null, score = 0;
  for (const e of events || []) {
    const sc = norm(e).split(" ").filter(w => want.has(w)).length;
    if (sc > score) { best = e; score = sc; }
  }
  return best;
}
