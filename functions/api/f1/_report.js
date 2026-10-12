// ====================================================================
// Rennticker — KI-Rennbericht: reine Helfer (getestet in tests/f1.test.mjs).
// Das Faktenblatt entsteht ohne KI aus dem Rennmodell (F1Model.buildRace);
// das Sprachmodell formuliert nur daraus — es soll nichts dazuerfinden.
// ====================================================================

const TYRE = { SOFT: "Soft", MEDIUM: "Medium", HARD: "Hard", INTERMEDIATE: "Intermediate", WET: "Regenreifen" };
const pts = p => `${p} ${p === 1 ? "Punkt" : "Punkte"}`;
const lapTime = s => (s == null ? "–" : `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, "0")}`);
const PEN = /Strafe|Stop-and-Go|Durchfahrt|Untersuchung nach dem Rennen/;

// Läufe gleicher Werte über die Runden: [{ v, from, to }]
function runs(values) {
  const out = [];
  values.forEach((v, i) => {
    const lap = i + 1, last = out[out.length - 1];
    if (last && last.v === v && last.to === lap - 1) last.to = lap; else out.push({ v, from: lap, to: lap });
  });
  return out;
}

//   race = buildRace(...), meta = { title, laps }, radios = [{ n, lap, en, de }]
//   → { text, drivers: Map n → Zeilen zum Fahrer }
export function reportFacts(race, meta, radios) {
  const D = n => race.drivers.get(n) || { abbr: "#" + n, first: "", last: "", team: "" };
  const fin = race.frames[race.frames.length - 1], grid = race.frames[0];
  const laps = race.frames.filter(f => !f.final);
  const gridPos = new Map(grid.rows.filter(r => r.pos != null).map(r => [r.n, r.pos]));
  const L = [];
  L.push(`Rennen: ${meta.title} · ${race.laps} Runden`);
  // Ergebnis
  const cls = fin.rows.filter(r => !r.out).slice(0, 10).map(r => `${r.pos}. ${D(r.n).abbr} (${D(r.n).first} ${D(r.n).last}, ${D(r.n).team})${r.pos > 1 && typeof r.gap === "number" ? ` +${r.gap.toFixed(1)} s` : r.pos > 1 && r.gap ? " " + r.gap : ""}${r.points ? `, ${pts(r.points)}` : ""}`);
  L.push("Ergebnis: " + cls.join(" · "));
  const outs = fin.rows.filter(r => r.out).map(r => `${D(r.n).abbr} (${r.status || "Ausfall"}, ${r.laps} Runden)`);
  if (outs.length) L.push("Nicht im Ziel: " + outs.join(", "));
  // Start → Ziel
  const moves = fin.rows.filter(r => !r.out && gridPos.has(r.n) && r.pos != null).map(r => ({ n: r.n, g: gridPos.get(r.n), p: r.pos, d: gridPos.get(r.n) - r.pos }));
  const up = moves.filter(m => m.d >= 3).sort((a, b) => b.d - a.d).slice(0, 3), dn = moves.filter(m => m.d <= -3).sort((a, b) => a.d - b.d).slice(0, 3);
  if (up.length) L.push("Größte Gewinner (Startplatz → Ziel): " + up.map(m => `${D(m.n).abbr} ${m.g} → ${m.p}`).join(", "));
  if (dn.length) L.push("Größte Verlierer (Startplatz → Ziel): " + dn.map(m => `${D(m.n).abbr} ${m.g} → ${m.p}`).join(", "));
  const pole = grid.rows.find(r => r.pos === 1);
  if (pole) L.push(`Von der Pole gestartet: ${D(pole.n).abbr}`);
  // Führung
  const lead = runs(laps.slice(1).map(f => (f.rows.find(r => r.pos === 1) || {}).n));
  // Die letzte Runde steckt im Ergebnis-Frame: Führung des Siegers bis zur Zielflagge
  const win = fin.rows.find(r => r.pos === 1), lastRun = lead[lead.length - 1];
  if (win && lastRun && lastRun.v === win.n) lastRun.to = race.laps;
  if (lead.length) L.push("Führung: " + lead.filter(x => x.v != null).map(x => `${D(x.v).abbr} Runde ${x.from}–${x.to}`).join(", "));
  // Safety Car / VSC / Rot
  const phase = runs(laps.slice(1).map(f => (/^sc/.test(f.status) ? "Safety Car" : /^vsc/.test(f.status) ? "VSC" : f.status === "red" ? "Rote Flagge" : null)))
    .filter(x => x.v);
  L.push(phase.length ? "Neutralisierungen: " + phase.map(x => `${x.v} Runde ${x.from}${x.to > x.from ? "–" + x.to : ""}`).join(", ") : "Neutralisierungen: keine");
  // Schnellste Runde
  let fl = null;
  for (const [n, list] of race.lapTimes || []) for (const l of list) if (l.s != null && (!fl || l.s < fl.s)) fl = { n, s: l.s, lap: l.lap };
  if (fl) L.push(`Schnellste Runde: ${D(fl.n).abbr} ${lapTime(fl.s)} (Runde ${fl.lap})`);
  // Strategie der Top 5
  const strat = n => (race.plans.get(n) || []).map(g => `${TYRE[g.c] || g.c || "?"} Runde ${g.from}–${g.to}`).join(", ");
  L.push("Strategie Top 5: " + fin.rows.filter(r => !r.out).slice(0, 5).map(r => `${D(r.n).abbr}: ${strat(r.n)}`).join(" | "));
  // Strafen und Untersuchungen
  const pens = fin.msgs.filter(m => PEN.test(m.text) && !/keine Strafe|abgesessen/.test(m.text)).map(m => m.text);
  if (pens.length) L.push("Strafen/Untersuchungen: " + [...new Set(pens)].slice(0, 6).join("; "));
  // Funk (wörtlich)
  const quotes = (radios || []).filter(x => x.de || x.en).slice(0, 8).map(x => `${D(x.n).abbr}${x.lap ? ` (Runde ${x.lap})` : ""}: „${x.de || x.en}“`);
  if (quotes.length) L.push("Funksprüche (wörtlich, übersetzt): " + quotes.join(" · "));

  // Zeilen je Fahrer (für die Sicht des Lieblingsfahrers)
  const drivers = new Map();
  for (const r of fin.rows) {
    const d = D(r.n), own = [];
    own.push(`${d.first} ${d.last} (${d.abbr}, ${d.team}): Start P${gridPos.get(r.n) ?? "?"}, Ziel ${r.out ? `${r.status || "Ausfall"} nach ${r.laps} Runden` : "P" + r.pos}${r.points ? `, ${pts(r.points)}` : ""}`);
    own.push(`Strategie: ${strat(r.n)} (${r.pits} ${r.pits === 1 ? "Stopp" : "Stopps"})`);
    const best = (race.lapTimes.get(r.n) || []).reduce((a, l) => (l.s != null && (!a || l.s < a.s) ? l : a), null);
    if (best) own.push(`Beste eigene Runde: ${lapTime(best.s)} (Runde ${best.lap})`);
    const i = fin.rows.indexOf(r), ahead = fin.rows[i - 1], behind = fin.rows[i + 1];
    if (!r.out && ahead) own.push(`Im Ziel hinter ${D(ahead.n).abbr}${typeof r.interval === "number" ? ` (${r.interval.toFixed(1)} s)` : ""}`);
    if (!r.out && behind && !behind.out) own.push(`vor ${D(behind.n).abbr}`);
    const myPos = laps.slice(1).map(f => (f.rows.find(x => x.n === r.n) || {}).pos).filter(p => p != null);
    if (myPos.length) own.push(`Beste Platzierung im Rennen: P${Math.min(...myPos)}, schlechteste: P${Math.max(...myPos)}`);
    const st = (fin.stew || {})[r.n];
    if (st && st.pens.length) own.push("Strafen: " + st.pens.map(p => p.text).join("; "));
    const mine = (radios || []).filter(x => x.n === r.n).slice(0, 4).map(x => `„${x.de || x.en}“${x.lap ? ` (Runde ${x.lap})` : ""}`);
    if (mine.length) own.push("Eigener Funk: " + mine.join(" · "));
    drivers.set(r.n, own.join("\n"));
  }
  return { text: L.join("\n"), drivers };
}

export const REPORT_SYSTEM = "Du bist Formel-1-Reporter für eine österreichische Fan-App. Schreib einen Rennbericht auf Deutsch (österreichisch, locker, aber sachlich). " +
  "Länge 170–240 Wörter. Erste Zeile: eine knackige Überschrift mit einer Aussage zum Rennen (z. B. wer wie gewonnen hat) – NICHT bloß der Name des Grand Prix, ohne Anführungszeichen, ohne „Überschrift:“. Danach drei kurze Absätze. " +
  "Verwende AUSSCHLIESSLICH die Fakten aus der Nachricht. Erfinde keine Gründe, Gefühle, Zitate, Zahlen oder Ereignisse. Bleib bei Strategien genau (Zahl der Stopps und Reifen je Fahrer wie angegeben, nicht verallgemeinern). Funksprüche nur wörtlich aus den Fakten. " +
  "Keine Aufzählungen, kein Markdown, keine Emojis.";
export const favSystem = name => `Du bist Formel-1-Reporter für eine österreichische Fan-App. Schreib auf Deutsch (österreichisch, sachlich) 80–130 Wörter über das Rennen von ${name}, in der dritten Person. ` +
  "Erste Zeile: kurze Überschrift mit einer Aussage über sein Rennen (NICHT bloß der Name des Grand Prix). Danach ein oder zwei Absätze in flüssigem Deutsch, keine Wiederholungen. Verwende AUSSCHLIESSLICH die Fakten aus der Nachricht, erfinde nichts dazu. Kein Markdown, keine Emojis.";

// Antwort des Modells → { title, body: [Absätze] } oder null (zu kurz / kaputt)
export function parseReport(raw, minWords) {
  if (typeof raw !== "string") return null;
  const lines = raw.replace(/\r/g, "").split("\n").map(l => l.trim()).filter(Boolean)
    .map(l => l.replace(/^#+\s*/, "").replace(/^\*\*(.+)\*\*$/, "$1"));
  if (lines.length < 2) return null;
  const title = lines[0].replace(/^(Überschrift|Titel)\s*:\s*/i, "").replace(/^["„“]|["“”]$/g, "").slice(0, 140);
  const body = lines.slice(1).map(l => l.slice(0, 1200));
  const words = body.join(" ").split(/\s+/).length;
  return words >= (minWords || 60) ? { title, body } : null;
}
