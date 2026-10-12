// ====================================================================
// Rennticker — Teamduell der Saison: Wer schlägt seinen Teamkollegen öfter?
// Reine Funktionen (getestet in tests/f1.test.mjs). Die Ergebnisse je
// Session legt der Cron kompakt in f1_cache ab (k = "result/<Jahr>/<key>").
// ====================================================================
const RACE_PTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const SPRINT_PTS = [8, 7, 6, 5, 4, 3, 2, 1];
export const DUEL_SESSIONS = /^(Race|Sprint|Qualifying)$/;

// OpenF1 session + session_result + drivers → kleines Format
export function compactResult(s, results, drivers) {
  return {
    key: s.session_key, name: s.session_name, date: s.date_start,
    res: (results || []).map(r => ({ n: r.driver_number, pos: r.position ?? null, dnf: !!r.dnf, dns: !!r.dns, dsq: !!r.dsq, pts: typeof r.points === "number" ? r.points : null })),
    drv: (drivers || []).map(d => ({ n: d.driver_number, abbr: d.name_acronym, last: d.last_name || "", team: d.team_name || "", color: "#" + (d.team_colour || "888888") })),
  };
}

// Rangfolge im Rennen: gewertet vor Ausfall, Ausfall vor nicht gestartet
const raceRank = r => (r.dns || r.dsq ? 999 : r.dnf ? 500 + (r.pos || 0) : r.pos ?? 400);
const points = (s, r) => (!r ? 0 : r.pts != null ? r.pts : s.name === "Race" ? RACE_PTS[r.pos - 1] || 0 : s.name === "Sprint" ? SPRINT_PTS[r.pos - 1] || 0 : 0);

//   list = [compactResult…]  →  [{ team, color, a, b, quali: [a, b], race: [a, b], pts: [a, b], n: { quali, race }, others }]
export function teamDuel(list) {
  const sessions = (list || []).slice().sort((x, y) => String(x.date).localeCompare(String(y.date)));
  const info = new Map(), teams = new Map();
  for (const s of sessions) for (const d of s.drv) {
    info.set(d.n, d);
    if (!s.res.some(r => r.n === d.n)) continue;
    const t = teams.get(d.team) || { team: d.team, color: d.color, cnt: new Map() };
    t.color = d.color;
    t.cnt.set(d.n, (t.cnt.get(d.n) || 0) + 1);
    teams.set(d.team, t);
  }
  const out = [];
  for (const t of teams.values()) {
    // Die zwei Stammfahrer = die mit den meisten Einsätzen fürs Team
    const order = [...t.cnt.entries()].sort((x, y) => y[1] - x[1]).map(x => x[0]);
    const [a, b] = order;
    if (b == null) continue;
    const rec = { team: t.team, color: t.color, a: info.get(a), b: info.get(b), quali: [0, 0], race: [0, 0], pts: [0, 0], n: { quali: 0, race: 0 },
      others: order.slice(2).map(n => info.get(n)) };
    for (const s of sessions) {
      const team = n => (s.drv.find(d => d.n === n) || {}).team;
      const ra = s.res.find(r => r.n === a), rb = s.res.find(r => r.n === b);
      if (team(a) === t.team) rec.pts[0] += points(s, ra);
      if (team(b) === t.team) rec.pts[1] += points(s, rb);
      if (!ra || !rb || team(a) !== t.team || team(b) !== t.team) continue;
      if (s.name === "Qualifying") {
        const pa = ra.pos ?? 99, pb = rb.pos ?? 99;
        if (pa !== pb) { rec.quali[pa < pb ? 0 : 1]++; rec.n.quali++; }
      } else if (s.name === "Race") {
        const pa = raceRank(ra), pb = raceRank(rb);
        if (pa !== pb && !(pa >= 500 && pb >= 500)) { rec.race[pa < pb ? 0 : 1]++; rec.n.race++; }
      }
    }
    out.push(rec);
  }
  return out.sort((x, y) => (y.pts[0] + y.pts[1]) - (x.pts[0] + x.pts[1]));
}
