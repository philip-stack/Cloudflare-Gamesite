// Tests für den Rennticker (/f1/): Rechenkern (public/f1/model.js) mit einem
// kleinen, erfundenen 3-Runden-Rennen und die Allowlist des OpenF1-Proxys
// (functions/f1data/[ep].js). Ohne Netz.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = require(path.join(__dirname, "..", "public", "f1", "model.js"));
const { buildUrl, RADIO_FILE, SESSION_PATH, bundleTtl, BUNDLE_PARTS, trackSources, dbPut, dbGet, dbHas, calKey } = await import("file://" + path.join(__dirname, "..", "functions", "f1data", "[ep].js").replace(/\\/g, "/"));

let ok = true;
const assert = (name, cond) => { if (cond) console.log("OK  ", name); else { console.log("FAIL", name); ok = false; } };

// ---- Mini-Rennen: A führt, B stoppt in Runde 1, C fällt in Runde 2 aus ----
const T0 = Date.parse("2026-05-01T12:00:00Z");
const at = s => new Date(T0 + s * 1000).toISOString();
const lap = (n, k, start, dur) => ({ driver_number: n, lap_number: k, date_start: at(start), lap_duration: dur });
const raw = {
  drivers: [
    { driver_number: 1, name_acronym: "AAA", first_name: "Anna", last_name: "A", team_name: "Rot", team_colour: "FF0000" },
    { driver_number: 2, name_acronym: "BBB", first_name: "Ben", last_name: "B", team_name: "Blau", team_colour: "0000FF" },
    { driver_number: 3, name_acronym: "CCC", first_name: "Cleo", last_name: "C", team_name: "Grün", team_colour: "00FF00" },
  ],
  laps: [
    lap(1, 1, 0, 90), lap(1, 2, 90, 88), lap(1, 3, 178, 87),
    lap(2, 1, 0, 91), lap(2, 2, 91, 110), lap(2, 3, 201, 86),
    lap(3, 1, 0, 92), lap(3, 2, 92, 95), lap(3, 3, 187, null),
  ],
  position: [
    { driver_number: 1, date: at(-600), position: 2 }, { driver_number: 2, date: at(-600), position: 1 },
    { driver_number: 3, date: at(-600), position: 3 }, { driver_number: 1, date: at(30), position: 1 },
    { driver_number: 2, date: at(30), position: 2 },
  ],
  intervals: [
    { driver_number: 1, date: at(89), gap_to_leader: 0, interval: 0 },
    { driver_number: 2, date: at(89), gap_to_leader: 1.2, interval: 1.2 },
    { driver_number: 3, date: at(89), gap_to_leader: 2.5, interval: 1.3 },
    { driver_number: 2, date: at(177), gap_to_leader: 21.5, interval: 21.5 },
  ],
  stints: [
    { driver_number: 1, stint_number: 1, lap_start: 1, lap_end: 3, compound: "MEDIUM", tyre_age_at_start: 2 },
    { driver_number: 2, stint_number: 1, lap_start: 1, lap_end: 1, compound: "SOFT", tyre_age_at_start: 0 },
    { driver_number: 2, stint_number: 2, lap_start: 2, lap_end: 3, compound: "HARD", tyre_age_at_start: 0 },
    // Fehlerhafter Split ohne Stopp (kommt bei OpenF1 vor) → muss verschmelzen
    { driver_number: 3, stint_number: 1, lap_start: 1, lap_end: 1, compound: "SOFT", tyre_age_at_start: 0 },
    { driver_number: 3, stint_number: 2, lap_start: 2, lap_end: 2, compound: "SOFT", tyre_age_at_start: 0 },
  ],
  pit: [{ driver_number: 2, date: at(95), lap_number: 1, lane_duration: 22 }],
  race_control: [
    { date: at(0), category: "SessionStatus", message: "SESSION STARTED", lap_number: 1 },
    { date: at(100), category: "SafetyCar", message: "SAFETY CAR DEPLOYED", lap_number: 2 },
    { date: at(150), category: "Other", message: "CAR 3 (CCC) TIME 1:30.000 DELETED - TRACK LIMITS", lap_number: 2 },
    { date: at(160), category: "Other", message: "FIA STEWARDS: 5 SECOND TIME PENALTY FOR CAR 2 (BBB) - CAUSING A COLLISION", lap_number: 2 },
    { date: at(170), category: "SafetyCar", message: "SAFETY CAR IN THIS LAP", lap_number: 2 },
    { date: at(176), category: "Flag", flag: "CLEAR", scope: "Track", message: "TRACK CLEAR", lap_number: 2 },
    { date: at(265), category: "Flag", flag: "CHEQUERED", scope: "Track", message: "CHEQUERED FLAG", lap_number: 3 },
  ],
  session_result: [
    { driver_number: 1, position: 1, number_of_laps: 3, gap_to_leader: 0, points: 25 },
    { driver_number: 2, position: 2, number_of_laps: 3, gap_to_leader: 22.4, points: 18 },
    { driver_number: 3, position: null, number_of_laps: 2, gap_to_leader: null, points: 0, dnf: true },
  ],
};

const R = M.buildRace(raw);
assert("3 Runden + Startframe", R.laps === 3 && R.frames.length === 4);
const f0 = R.frames[0], f1 = R.frames[1], f2 = R.frames[2], fz = R.frames[3];
assert("Start: Aufstellung aus Positionsdaten (BBB vorne)", f0.rows[0].n === 2 && f0.status === "pre");
assert("Runde 1: AAA führt, Intervall BBB 1.2", f1.rows[0].n === 1 && f1.rows[1].interval === 1.2);
assert("Runde 1: BBB noch auf Soft (Stopp kommt erst)", f1.rows[1].compound === "SOFT" && f1.rows[1].pits === 0);
assert("Runde 2: BBB auf Hard, 1 Stopp, BOX-Markierung", f2.rows[1].compound === "HARD" && f2.rows[1].pits === 1 && f2.rows[1].pitNow);
assert("Runde 2: Reifenalter AAA = 2 + 2", f2.rows[0].tyreAge === 4);
assert("Status nach SC-Ende wieder grün", f2.status === "green");
assert("Status während SC", M.trackStatus(raw.race_control.map(r => ({ ...r, time: Date.parse(r.date) })), T0 + 120000, T0) === "sc");
assert("CCC: Split-Stint verschmolzen (Alter läuft weiter)", fz.rows.find(r => r.n === 3).tyreAge === 2);
assert("Ergebnis: final, Punkte, Ausfall ans Ende", fz.final && fz.rows[0].points === 25 && fz.rows[2].out && fz.rows[2].status === "DNF");
assert("Ergebnis: Intervall aus Gesamtlücke", fz.rows[1].interval === 22.4);
assert("Schnellste Runde = BBB 86.0", fz.rows.find(r => r.n === 2).fastest && !fz.rows.find(r => r.n === 1).fastest);
const texts = fz.msgs.map(m => m.text);
assert("Track-Limits-Meldung ausgefiltert", !texts.some(t => /track limits|gestrichen/i.test(t)));
assert("Strafe übersetzt", texts.includes("BBB: 5-Sekunden-Zeitstrafe (Kollision verursacht)"));
assert("Safety Car übersetzt", texts.includes("Safety Car auf der Strecke"));

// ---- Rundenzeiten je Fahrer (Diagramm, Duell, Karte) ----
const lt = R.lapTimes.get(2);
assert("Rundenzeiten: alle Runden mit Zeit & Reifen", lt.length === 3 && lt[0].s === 91 && lt[0].c === "SOFT" && lt[1].c === "HARD");
assert("Rundenzeiten: Box-Runde markiert", lt[0].pitIn && !lt[1].pitIn && isFinite(lt[0].t) && lt[0].end > lt[0].t);
const LR = M.fromLive({ SessionInfo: { Name: "Race", Type: "Race", Path: "2026/x/2026-10-04_Race/", Meeting: { Circuit: { Key: 12 } } },
  TeamRadio: { Captures: [{ Utc: "2026-10-04T08:40:00Z", RacingNumber: "44", Path: "TeamRadio/HAM_44_20261004_164000.mp3" }] } });
assert("Live: Funk + Strecke + Pfad", LR.radio.length === 1 && LR.radio[0].n === 44 && LR.radio[0].file === "HAM_44_20261004_164000.mp3"
  && LR.session.circuit === 12 && LR.session.path === "2026/x/2026-10-04_Race/");

// ---- Formatierung ----
assert("lapTime", M.lapTime(98.22) === "1:38.220" && M.lapTime(null) === "–");
assert("gapText Zahl/Runden", M.gapText(2.3) === "+2.300" && M.gapText("+1 LAP") === "+1 Rd." && M.gapText("+2 LAPS") === "+2 Rd.");

// ---- Live: Feed-Änderungen zusammenführen ----
const base = { Lines: { "1": { Position: "2", Stints: [{ Compound: "SOFT", TotalLaps: 3 }] } }, Messages: [{ Message: "a" }] };
M.mergeFeed(base, { Lines: { "1": { Position: "1", Stints: { "1": { Compound: "HARD", TotalLaps: 0 } } } }, Messages: { "1": { Message: "b" } } });
assert("Live: Feld überschrieben", base.Lines["1"].Position === "1");
assert("Live: Index-Objekt hängt an Liste an", Array.isArray(base.Lines["1"].Stints) && base.Lines["1"].Stints[1].Compound === "HARD");
assert("Live: Liste bleibt Liste", Array.isArray(base.Messages) && base.Messages.length === 2);
M.mergeFeed(base, { Lines: { _deleted: ["1"] } });
assert("Live: _deleted entfernt Schlüssel", !("1" in base.Lines));
assert("Live: Abstände lesen", M.parseGap("+13.993") === 13.993 && M.parseGap("LAP 12") === null && M.parseGap("1L") === "+1 LAP" && M.parseGap("") === null);
assert("Live: Rundenzeit lesen", M.parseTime("1:38.220") === 98.22 && M.parseTime("38.5") === 38.5 && M.parseTime("") === null);

const liveState = {
  SessionInfo: { Key: 9, Name: "Race", Type: "Race", Meeting: { Name: "Austrian Grand Prix", Location: "Spielberg" } },
  SessionStatus: { Status: "Started" }, TrackStatus: { Status: "4" }, LapCount: { CurrentLap: 12, TotalLaps: 71 },
  DriverList: { "1": { RacingNumber: "1", Tla: "AAA", TeamColour: "FF0000" }, "2": { RacingNumber: "2", Tla: "BBB" }, "3": { RacingNumber: "3", Tla: "CCC" } },
  TimingData: { Lines: {
    "1": { Position: "1", GapToLeader: "LAP 12", IntervalToPositionAhead: { Value: "LAP 12" }, NumberOfLaps: 11, NumberOfPitStops: 0, LastLapTime: { Value: "1:05.100", OverallFastest: true }, BestLapTime: { Value: "1:05.100" } },
    "2": { Position: "2", GapToLeader: "+0.800", IntervalToPositionAhead: { Value: "+0.800" }, NumberOfLaps: 11, NumberOfPitStops: 1, InPit: true, LastLapTime: { Value: "1:06.000" }, BestLapTime: { Value: "1:05.900" } },
    "3": { Position: "3", Retired: true, NumberOfLaps: 4, LastLapTime: { Value: "" }, BestLapTime: { Value: "" } },
  } },
  TimingAppData: { Lines: { "1": { Stints: [{ Compound: "MEDIUM", TotalLaps: 11 }] }, "2": { Stints: [{ Compound: "MEDIUM", TotalLaps: 9 }, { Compound: "HARD", TotalLaps: 0 }] } } },
  RaceControlMessages: { Messages: [{ Utc: "2026-06-28T13:20:00", Lap: 11, Category: "SafetyCar", Message: "SAFETY CAR DEPLOYED" },
    { Utc: "2026-06-28T13:19:00", Lap: 11, Category: "Other", Message: "CAR 2 (BBB) TIME 1:05.000 DELETED - TRACK LIMITS" }] },
};
const L = M.fromLive(liveState);
assert("Live: Session & Status", L.session.race && L.session.meeting === "Austrian GP" && L.frame.status === "sc" && L.frame.lap === 12 && L.frame.total === 71);
assert("Live: Reihenfolge & Ausfall ans Ende", L.frame.rows.map(r => r.n).join() === "1,2,3" && L.frame.rows[2].out && L.frame.rows[2].status === "DNF");
const lb = L.frame.rows[1];
assert("Live: BBB Intervall, Box, aktueller Reifen", lb.interval === 0.8 && lb.pitNow && lb.compound === "HARD" && lb.tyreAge === 0 && lb.pits === 1);
assert("Live: schnellste Runde", L.frame.rows[0].fastest && L.frame.rows[0].lastPurple && L.frame.rows[0].last === 65.1);
assert("Live: Meldungen gefiltert & übersetzt", L.frame.msgs.length === 1 && L.frame.msgs[0].text === "Safety Car auf der Strecke");
const Q = M.fromLive({ ...liveState, SessionInfo: { Name: "Qualifying", Type: "Qualifying", Meeting: {} }, SessionStatus: { Status: "Finished" } });
assert("Live Qualifying: Rückstand auf Bestzeit", Q.frame.rows[1].gap === 0.8 && Q.frame.status === "fin" && !Q.session.race);
assert("Live: leerer Stand wirft nicht", M.fromLive({}).frame.rows.length === 0);
assert("Live: Reifenverlauf aus Stints", JSON.stringify(lb.stints) === '[{"c":"MEDIUM","from":1,"laps":9},{"c":"HARD","from":10,"laps":0}]');
const Q1 = M.fromLive({ ...liveState, SessionInfo: { Name: "Qualifying", Type: "Qualifying", Meeting: {} },
  TimingData: { ...liveState.TimingData, SessionPart: 1, NoEntries: [22, 16, 10] } });
assert("Live Qualifying: Teil Q1, Grenze 16", Q1.frame.part === "Q1" && Q1.frame.cut === 16);
const Q3 = M.fromLive({ ...liveState, SessionInfo: { Name: "Sprint Qualifying", Type: "Qualifying", Meeting: {} },
  TimingData: { ...liveState.TimingData, SessionPart: 3, NoEntries: [22, 16, 10] } });
assert("Live Sprint-Qualifying: SQ3 ohne Grenze", Q3.frame.part === "SQ3" && Q3.frame.cut === null);
assert("Live Rennen: keine Qualifying-Grenze", L.frame.part === null && L.frame.cut === null);
assert("Nachschau: Reifenverlauf je Stopp", JSON.stringify(f2.rows[1].stints) === '[{"c":"SOFT","from":1,"laps":1},{"c":"HARD","from":2,"laps":0}]'
  && JSON.stringify(fz.rows.find(r => r.n === 1).stints) === '[{"c":"MEDIUM","from":1,"laps":3}]');

// ---- Reifenplan: Grenzen aus Stopps, Mischungen der Reihe nach ----
const plan = (pits, total, src) => M.tyrePlan(pits, total, src).map(g => g.c[0] + (g.to - g.from + 1) + (g.age0 ? "u" + g.age0 : "")).join(" ");
const S = c => ({ c, age0: 0 });
// Kuala Lumpur 2026, VER: OpenF1-Spannen verschoben (I1 S1 S7 S46), Stopps 9/33/43
assert("Reifenplan: Stopps setzen die Grenzen", plan([9, 33, 43], 55, [S("INTERMEDIATE"), S("SOFT"), S("SOFT"), S("SOFT")]) === "I9 S24 S10 S12");
assert("Reifenplan: überzählige Stints am Ende fallen weg", plan([2, 9, 33, 45], 55, ["MEDIUM", "INTERMEDIATE", "HARD", "HARD", "MEDIUM", "HARD"].map(S)) === "M2 I7 H24 H12 M10");
assert("Reifenplan: zu wenige Stints → letzte Mischung", plan([10], 20, [S("SOFT")]) === "S10 S10");
assert("Reifenplan: gebrauchter Satz (Alter beim Aufziehen)", plan([5], 10, [S("SOFT"), { c: "SOFT", age0: 3 }]) === "S5 S5u3");
assert("Reifenplan: Stopp in der letzten Runde zählt nicht", plan([20], 20, [S("HARD"), S("SOFT")]) === "H20");

// ---- Archiv-Reifen haben Vorrang vor OpenF1 ----
const RA = M.buildRace({ ...raw, tyres: { Lines: {
  "1": { Stints: [{ Compound: "SOFT", New: "true", StartLaps: 0, TotalLaps: 3 }] },
  "2": { Stints: { "0": { Compound: "MEDIUM", New: "true" }, "1": { Compound: "SOFT", New: "false", StartLaps: 2 } } },
} } });
const ra = n => RA.frames.at(-1).rows.find(r => r.n === n);
assert("Archiv: Mischung von AAA aus dem F1-Archiv", ra(1).compound === "SOFT" && ra(1).tyreAge === 3);
assert("Archiv: BBB gebraucht aufgezogen (2 + 2 Runden)", ra(2).compound === "SOFT" && ra(2).tyreAge === 4 && ra(2).stints[0].c === "MEDIUM");
assert("Archiv fehlt für CCC → OpenF1", ra(3).compound === "SOFT");

// ---- Qualifying: Zeit + Rückstand im Abschnitt, in dem man ausgeschieden ist ----
const qState = {
  SessionInfo: { Name: "Qualifying", Type: "Qualifying", Meeting: {} }, SessionStatus: { Status: "Finalised" },
  DriverList: { "1": { RacingNumber: "1", Tla: "AAA" }, "2": { RacingNumber: "2", Tla: "BBB" }, "3": { RacingNumber: "3", Tla: "CCC" } },
  TimingData: { SessionPart: 3, NoEntries: [3, 2, 1], Lines: {
    "1": { Position: "1", BestLapTimes: [{ Value: "1:30.500" }, { Value: "1:30.000" }, { Value: "1:29.800" }] },
    "2": { Position: "2", KnockedOut: true, BestLapTimes: [{ Value: "1:30.700" }, { Value: "1:30.400" }, {}] },
    "3": { Position: "3", KnockedOut: true, BestLapTimes: [{ Value: "1:31.000" }, {}, {}] },
  } },
};
const QL = M.fromLive(qState), qr = n => QL.frame.rows.find(r => r.n === n);
assert("Quali: Pole mit Q3-Zeit", qr(1).best === 89.8 && qr(1).fastest && qr(1).gap === null);
assert("Quali: Q2-Aus mit Q2-Zeit, Rückstand auf Q2-Schnellsten", qr(2).best === 90.4 && qr(2).gap === 0.4 && qr(2).status === "Q2" && qr(2).knocked && !qr(2).out);
assert("Quali: Q1-Aus mit Q1-Zeit, Rückstand auf Q1-Schnellsten", qr(3).best === 91 && qr(3).gap === 0.5 && qr(3).status === "Q1");
assert("Quali: Frame ist Zeitsession", QL.frame.timed && QL.session.quali && QL.frame.status === "fin");

// ---- FIA-Dokumente: HTML der fia.com-Liste auslesen ----
const FIA = await import("file://" + path.join(__dirname, "..", "functions", "f1data", "_fia.js").replace(/\\/g, "/"));
const row = (no, title, file, date) => `<li class="document-row key-${no}"><div class="node"><a href="/system/files/decision-document/${file}" download target="_blank">
  <div class="title"><div class="field field-name-title-field field-type-text"><div class="field-items"><div class="field-item even">${title}</div></div></div></div>
  <div class="published"><div class="field-item even">Published on <span  class="date-display-single">${date}</span> CET</div></div></a></div></li>`;
const fiaHtml = `<select><option value="/documents/championships/fia-formula-one-world-championship-14/season/season-2026-2072/event/Bahrain%20Grand%20Prix">Bahrain Grand Prix</option>
  <option value="/documents/championships/fia-formula-one-world-championship-14/season/season-2026-2072/event/S%C3%A3o%20Paulo%20Grand%20Prix">x</option></select>
  ${row(61, "Doc 61 - Championship Points", "2026_bahrain_-_championship_points.pdf", "04.10.26 15:55")}
  ${row(52, "Doc 52 - Infringement - Car 5 - Causing a collision &amp; more", "2026_bahrain_-_infringement.pdf", "04.10.26 12:22")}
  ${row(9, "Evil", "../../etc/passwd.pdf", "04.10.26 12:22")}`;
assert("FIA: Saison-Kennung", FIA.parseSeasonId(fiaHtml, 2026) === "season-2026-2072" && FIA.parseSeasonId(fiaHtml, 2019) === null);
assert("FIA: Events (inkl. Umlaute)", JSON.stringify(FIA.parseEvents(fiaHtml, "season-2026-2072")) === '["Bahrain Grand Prix","São Paulo Grand Prix"]');
const fd = FIA.parseDocs(fiaHtml);
assert("FIA: Dokumente mit Nummer, Titel, Datum", fd.length === 2 && fd[0].no === 61 && fd[0].title === "Championship Points" && fd[0].date === "2026-10-04T15:55");
assert("FIA: HTML-Entities im Titel", fd[1].title === "Infringement - Car 5 - Causing a collision & more");
assert("FIA: Pfad-Ausbruch wird verworfen", !fd.some(d => d.path.includes("..") || d.path.includes("passwd")));
const pdfRes = await FIA.fiaPdf("?path=/etc/passwd");
const pdfRes2 = await FIA.fiaPdf("?path=" + encodeURIComponent("/system/files/decision-document/../../x.pdf"));
assert("FIA-PDF: nur Entscheidungs-PDFs", pdfRes.status === 400 && pdfRes2.status === 400);
assert("FIA: ungültiges Jahr", (await FIA.fiaList("?year=abc")).status === 400);

// ---- Meldungen: Entscheidungslogik des Crons ----
const LG = await import("file://" + path.join(__dirname, "..", "functions", "api", "f1", "_logic.js").replace(/\\/g, "/"));
const T = Date.parse("2026-10-09T08:30:00Z");
const sess = [
  { session_key: 1, meeting_key: 9, session_name: "Practice 1", date_start: "2026-10-09T08:40:00Z", date_end: "2026-10-09T09:40:00Z" },
  { session_key: 2, meeting_key: 9, session_name: "Practice 2", date_start: "2026-10-09T12:00:00Z", date_end: "2026-10-09T13:00:00Z" },
  { session_key: 3, meeting_key: 9, session_name: "Race", date_start: "2026-10-11T12:00:00Z", date_end: "2026-10-11T14:00:00Z" },
  { session_key: 4, meeting_key: 9, session_name: "Practice 3", date_start: "2026-10-09T08:35:00Z", date_end: "2026-10-09T09:35:00Z", is_cancelled: true },
];
assert("Start: 10 min vorher fällig, abgesagte nicht", LG.dueStarts(sess, T, []).map(s => s.session_key).join() === "1");
assert("Start: schon gemeldet → nicht nochmal", LG.dueStarts(sess, T, [1]).length === 0);
assert("Start: 3,5 h vorher noch nicht", LG.dueStarts(sess, Date.parse("2026-10-09T08:30:00Z"), []).every(s => s.session_key !== 2));
assert("Live-Session mit Vorlauf", LG.liveSession(sess, Date.parse("2026-10-09T08:32:00Z")).session_key === 1 && LG.liveSession(sess, Date.parse("2026-10-10T08:00:00Z")) === null);
assert("Rennwochenende: 2 Tage vorher aktiv", LG.currentMeeting(sess, Date.parse("2026-10-07T12:00:00Z")).key === 9 && LG.currentMeeting(sess, Date.parse("2026-10-01T12:00:00Z")) === null);
const lbl = { label: "Singapore GP · Rennen", race: true, winner: "VER" };
assert("Flagge: Grün → SC meldet", LG.flagEvent("green", "sc", lbl).title === "🟡 Safety Car");
assert("Flagge: erster Blick (kein Vorher) → still", LG.flagEvent(null, "red", lbl) === null);
assert("Flagge: SC bleibt SC → still", LG.flagEvent("sc", "sc", lbl) === null && LG.flagEvent("sc", "sc-end", lbl) === null);
assert("Flagge: Ziel im Rennen → Sieger", LG.flagEvent("green", "fin", lbl).title === "🏁 Singapore GP · Rennen: VER gewinnt");
assert("Flagge: Ende im Training → still", LG.flagEvent("green", "fin", { label: "x", winner: "VER" }) === null);
assert("FIA: Startnummern im Titel", LG.carNumbers("Infringement - Car 5 - Causing a collision with Car 55").join() === "5,55"
  && LG.carNumbers("Summons - Cars 23 and 81 - Incident").join() === "23,81" && LG.carNumbers("Final Race Classification").length === 0);
const d1 = [{ path: "/a.pdf" }, { path: "/b.pdf" }];
const first = LG.newDocs(null, "Singapore Grand Prix", d1);
assert("FIA: erster Blick merkt nur", first.fresh.length === 0 && first.seen.length === 2);
const next = LG.newDocs({ event: "Singapore Grand Prix", seen: first.seen }, "Singapore Grand Prix", [...d1, { path: "/c.pdf" }]);
assert("FIA: danach nur Neues", next.fresh.map(d => d.path).join() === "/c.pdf" && next.seen.length === 3);
assert("FIA: anderes Wochenende → wieder nur merken", LG.newDocs(next, "Japanese Grand Prix", d1).fresh.length === 0);
assert("FIA-Event-Abgleich", LG.matchEvent(["Japanese Grand Prix", "Singapore Grand Prix"], "Singapore Grand Prix") === "Singapore Grand Prix"
  && LG.matchEvent(["Mexico City Grand Prix", "Monaco Grand Prix"], "Mexico City GP") === "Mexico City Grand Prix");

// ---- Proxy-Allowlist ----
assert("Proxy: erlaubter Endpunkt", buildUrl("laps", "?session_key=11731") === "https://api.openf1.org/v1/laps?session_key=11731");
assert("Proxy: Kalender", buildUrl("sessions", "?year=2026&session_type=Race") === "https://api.openf1.org/v1/sessions?year=2026&session_type=Race");
assert("Proxy: unbekannter Endpunkt", buildUrl("car_data", "?session_key=1") === null);
assert("Proxy: Session-Daten ohne session_key", buildUrl("laps", "") === null);
assert("Proxy: fremder Parameter", buildUrl("laps", "?session_key=1&x=1") === null);
assert("Proxy: location nur mit Zeitfenster ≤ 5 min", buildUrl("location", "?session_key=1&driver_number=3&from=2026-10-04T09:30:00Z&to=2026-10-04T09:31:30Z") === "https://api.openf1.org/v1/location?session_key=1&driver_number=3&date>=2026-10-04T09:30:00Z&date<=2026-10-04T09:31:30Z"
  && buildUrl("location", "?session_key=1") === null && buildUrl("location", "?session_key=1&from=2026-10-04T09:30:00Z&to=2026-10-04T10:30:00Z") === null);
assert("Proxy: kaputtes Zeitformat", buildUrl("location", "?session_key=1&from=gestern&to=heute") === null);
assert("Funk: nur Clip-Dateinamen und Session-Pfade", RADIO_FILE.test("VER_3_20261004_143127.mp3") && !RADIO_FILE.test("../x.mp3")
  && SESSION_PATH.test("2026/2026-10-04_Bahrain_Grand_Prix/2026-10-04_Race/") && !SESSION_PATH.test("http://evil/"));
assert("Proxy: kaputter Wert", buildUrl("laps", "?session_key=1;drop") === null);
assert("Proxy: Prototyp-Name", buildUrl("constructor", "?session_key=1") === null);

// ---- Rennleitung je Fahrer (echte Meldungen, Bahrain 2026) ----
const rcm = (message, extra) => ({ category: "Other", message, ...extra });
const stw1 = M.stewards([
  rcm("TURN 9 INCIDENT INVOLVING CARS 16 (LEC) AND 27 (HUL) NOTED - CAUSING A COLLISION (16:40:50)"),
  rcm("TURN 2 INCIDENT INVOLVING CARS 5 (BOR) AND 55 (SAI) NOTED - CAUSING A COLLISION (17:01:01)"),
  rcm("FIA STEWARDS: TURN 2 INCIDENT INVOLVING CARS 5 (BOR) AND 55 (SAI) UNDER INVESTIGATION - CAUSING A COLLISION (17:01:01)"),
  rcm("FIA STEWARDS: INCIDENT INVOLVING CAR 23 (ALB) WILL BE INVESTIGATED AFTER THE RACE - DRIVING ERRATICALLY (16:53:01)"),
  { category: "Flag", flag: "BLACK AND WHITE", driver_number: 87, message: "BLACK AND WHITE FLAG FOR CAR 87 (BEA) - TRACK LIMITS" },
  rcm("CAR 44 (HAM) TIME 1:32.100 DELETED - TRACK LIMITS AT TURN 4 LAP 7 14:01:02"),
]);
assert("Rennleitung: notiert / untersucht / nach dem Rennen / Verwarnung", stw1[16].inv === "noted" && stw1[27].inv === "noted"
  && stw1[5].inv === "inv" && stw1[55].inv === "inv" && stw1[23].inv === "after" && stw1[87].warn && !stw1[44]);
const stw2 = M.stewards([
  rcm("FIA STEWARDS: TURN 2 INCIDENT INVOLVING CARS 5 (BOR) AND 55 (SAI) UNDER INVESTIGATION - CAUSING A COLLISION (17:01:01)"),
  rcm("FIA STEWARDS: TURN 9 INCIDENT INVOLVING CARS 16 (LEC) AND 27 (HUL) REVIEWED NO FURTHER INVESTIGATION - CAUSING A COLLISION (16:40:50)"),
  rcm("FIA STEWARDS: 10 SECOND TIME PENALTY FOR CAR 5 (BOR) - CAUSING A COLLISION (17:01:01)"),
]);
assert("Rennleitung: Strafe beendet die Untersuchung für alle Beteiligten", stw2[5].pens.length === 1 && stw2[5].pens[0].label === "+10 s"
  && !stw2[5].inv && !(stw2[55] && stw2[55].inv) && /BOR: 10-Sekunden-Zeitstrafe/.test(stw2[5].pens[0].text));
const stw3 = M.stewards([
  rcm("FIA STEWARDS: 10 SECOND TIME PENALTY FOR CAR 5 (BOR) - CAUSING A COLLISION (17:01:01)"),
  rcm("FIA STEWARDS: PENALTY SERVED - 10 SECOND TIME PENALTY FOR CAR 5 (BOR) - CAUSING A COLLISION (17:01:01)"),
  rcm("FIA STEWARDS: DRIVE THROUGH PENALTY FOR CAR 18 (STR) - SPEEDING IN THE PIT LANE (17:20:00)"),
]);
assert("Rennleitung: abgesessene Strafe weg, Durchfahrt offen", (!stw3[5] || !stw3[5].pens.length) && stw3[18].pens[0].label === "Durchfahrt");
assert("Rennleitung: Stand je Runde im Rennen", R.frames.every(f => f.stew && typeof f.stew === "object"));

// ---- Ereignisse zwischen zwei Ständen ----
const fr = (rows, extra) => ({ rows: rows.map(([n, pos, pits, o]) => ({ n, pos, pits, out: false, pitNow: false, compound: "MEDIUM", best: null, fastest: false, ...(o || {}) })), ...extra });
const evA = fr([[1, 1, 0], [2, 2, 0], [3, 3, 0], [4, 4, 0]]);
const evB = fr([[2, 1, 0], [1, 2, 0], [4, 3, 1, { compound: "HARD" }], [3, 4, 0, { out: true, status: "DNF" }]]);
const ev = M.frameEvents(evA, evB, false);
assert("Ereignisse: Überholung, Box mit Reifenwechsel, Ausfall", ev.some(e => e.k === "pass" && e.n === 2 && e.o.join() === "1" && e.pos === 1)
  && ev.some(e => e.k === "pit" && e.n === 4 && e.stop === 1 && e.c0 === "MEDIUM" && e.c === "HARD")
  && ev.some(e => e.k === "out" && e.n === 3) && !ev.some(e => e.k === "pass" && (e.n === 4 || e.o.includes(4) || e.o.includes(3))));
const evG = M.frameEvents(fr([[1, 1, 0], [2, 2, 0], [3, 3, 0]]), fr([[3, 1, 0], [1, 2, 0], [2, 3, 0]]), false);
const evD = M.frameEvents(fr([[1, 1, 0], [2, 2, 0], [3, 3, 0], [4, 4, 0]]), fr([[2, 1, 0], [3, 2, 0], [4, 3, 0], [1, 4, 0]]), false);
assert("Ereignisse: von 3+ überholt = verliert Plätze", evD.length === 1 && evD[0].k === "drop" && evD[0].n === 1 && evD[0].d === 3);
assert("Ereignisse: mehrere Überholte in einer Zeile", evG.length === 1 && evG[0].n === 3 && evG[0].o.join() === "1,2");
const evS = M.frameEvents(fr([[1, 1, 0], [2, 2, 0], [3, 3, 0], [4, 4, 0]]), fr([[4, 1, 0], [1, 2, 0], [2, 3, 0], [3, 4, 0]]), true);
assert("Ereignisse: Start = Gewinner/Verlierer statt Duelle", evS.length === 1 && evS[0].k === "start" && evS[0].moves[0].n === 4 && evS[0].moves[0].d === 3);
const evF = M.frameEvents(fr([[1, 1, 0, { best: 90, fastest: true }], [2, 2, 0, { best: 91 }]]), fr([[1, 1, 0, { best: 90 }], [2, 2, 0, { best: 89.5, fastest: true }]]), false);
assert("Ereignisse: neue schnellste Runde", evF.some(e => e.k === "fl" && e.n === 2 && e.s === 89.5));

// ---- Boxenstopp-Rechner ----
const pr = [{ n: 1, pos: 1, gap: null }, { n: 2, pos: 2, gap: 3 }, { n: 3, pos: 3, gap: 10 }, { n: 4, pos: 4, gap: 24 }, { n: 5, pos: 5, gap: 30 }, { n: 6, pos: 6, gap: "+1 LAP" }];
const rj = M.pitRejoin(pr, 2, 20);
assert("Boxenstopp: P4 zwischen Nr. 3 und Nr. 4", rj.pos === 3 && rj.ahead.n === 3 && rj.ahead.d === 13 && rj.behind.n === 4 && rj.behind.d === 1);
assert("Boxenstopp: Führender / ohne Abstand", M.pitRejoin(pr, 1, 25).pos === 4 && M.pitRejoin(pr, 6, 20) === null);
const plt = () => [88, 88.2, 88.1, 88.3, 108.5, 99.9, 88.4, 88.2, 88.5].map((s, i) => ({ lap: i + 2, s, pitIn: i === 4, pitOut: i === 5, sc: false }));
const pl = M.pitLoss(new Map([[1, plt()], [2, plt()]]));
assert("Boxenverlust aus den Rundenzeiten", pl && pl.stops === 2 && Math.abs(pl.s - 31.8) < 0.3);

// ---- Wetter + Sektoren im Live-Format ----
const wx = M.weather({ AirTemp: "27.9", Humidity: "79.2", Rainfall: "1", TrackTemp: "32.8", WindDirection: "72", WindSpeed: "2.0" });
const wx2 = M.weather({ air_temperature: 31, track_temperature: 45.6, humidity: 61.7, rainfall: 0, wind_speed: 3, wind_direction: 254 });
assert("Wetter: Feed und OpenF1 im selben Format", wx.air === 27.9 && wx.rain === true && wx.dir === 72 && wx2.track === 45.6 && wx2.rain === false && M.weather({}) === null);
const lv2 = M.fromLive({
  SessionInfo: { Name: "Qualifying", Type: "Qualifying" },
  DriverList: { "1": { RacingNumber: "1", Tla: "NOR" } },
  TimingData: { Lines: { "1": { Position: "1", Sectors: [{ Value: "25.691", OverallFastest: true }, { Value: "34.327", PersonalFastest: true }, { Value: "" }] } } },
  TimingStats: { Lines: { "1": { BestSectors: [{ Position: 10, Value: "24.906" }, { Position: 1, Value: "31.481" }, { Position: 5, Value: "39.342" }] } } },
  WeatherData: { AirTemp: "20", TrackTemp: "30" },
  RaceControlMessages: { Messages: [{ Category: "Other", Message: "FIA STEWARDS: CAR 1 (NOR) UNDER INVESTIGATION - IMPEDING (14:00:00)", Utc: "2026-10-03T14:01:00" }] },
});
const s1 = lv2.frame.rows[0];
assert("Live: Sektoren, beste Sektoren, Wetter, Rennleitung", s1.sec[0].v === 25.691 && s1.sec[0].ob && s1.sec[1].pb && s1.sec[2].v === null && s1.bsec[1].rank === 1 && s1.bsec[0].v === 24.906
  && lv2.weather.air === 20 && lv2.frame.stew[1].inv === "inv");

// ---- Boxenfunk-Abschrift (reine Helfer) ----
const TX = await import("file://" + path.join(__dirname, "..", "functions", "api", "f1", "_transcript.js").replace(/\\/g, "/"));
const sg = TX.segmentsOf({ text: "x", segments: [
  { start: 0, end: 2.4, text: " Box, box. ", no_speech_prob: 0.01 },
  { start: 2.4, end: 3, text: "Thank you.", no_speech_prob: 0.2 },
  { start: 3, end: 5, text: "rauschen", no_speech_prob: 0.95 },
  { start: 5, end: 7.5, text: "Copy.", no_speech_prob: 0.1 }] });
assert("Funk: Sätze ohne Stille und Rausch-Halluzinationen", sg.length === 2 && sg[0].t === "Box, box." && sg[1].s === 5 && sg[1].e === 7.5);
assert("Funk: ohne Segmente → ganzer Text", TX.segmentsOf({ text: " Push now. " })[0].t === "Push now." && TX.segmentsOf({ text: "Thank you." }).length === 0);
assert("Funk: Übersetzung Zeile für Zeile", JSON.stringify(TX.parseTranslation("1| Box, box.\n2| Verstanden.", 2)) === '["Box, box.","Verstanden."]'
  && TX.parseTranslation("1| Box, box.", 2) === null && TX.parseTranslation(null, 1) === null && TX.translateInput(sg) === "1| Box, box.\n2| Copy.");
assert("Funk: Name im Prompt nur, wenn harmlos", TX.whisperPrompt("Max Verstappen").includes("Max Verstappen.") && !TX.whisperPrompt("<script>").includes("<script>"));
assert("Funk: Base64", TX.toBase64(new TextEncoder().encode("Box box").buffer) === "Qm94IGJveA==");

// ---- Rennen als ein Paket ----
const NOW = Date.parse("2026-10-04T20:00:00Z");
assert("Paket: kurz nach dem Rennen nur kurz cachen, später eine Woche", bundleTtl("2026-10-04T18:30:00+00:00", NOW) === 600
  && bundleTtl("2026-10-04T10:00:00Z", NOW) === 7 * 86400 && bundleTtl("", NOW) === 600);
assert("Paket: enthält alle Teile der Nachschau", ["drivers", "laps", "intervals", "pit", "race_control", "weather"].every(k => BUNDLE_PARTS.includes(k))
  && BUNDLE_PARTS.every(k => buildUrl(k, "?session_key=1")));

// ---- Live-Karte aus der Zeitmessung ----
const seg = (s, k, st) => ({ Sectors: { [s]: { Segments: { [k]: { Status: st } } } } });
let sp = M.segStep(null, seg(0, 3, 2048), 1000);
sp = M.segStep(sp, seg(1, 2, 2049), 5000);
assert("Mini-Sektor: vorwärts", sp.s === 1 && sp.k === 2 && sp.t === 5000);
assert("Mini-Sektor: Umfärben eines alten Segments zählt nicht", M.segStep(sp, seg(0, 5, 2051), 6000).s === 1);
sp = M.segStep(sp, seg(2, 7, 2048), 9000);
const lapMsg = { NumberOfLaps: 6, ...seg(2, 7, 2049) };
sp = M.segStep(sp, lapMsg, 9100);
assert("Mini-Sektor: Nachzügler nach der Linie ignoriert", M.segStep(sp, seg(1, 5, 2049), 9300).s === 2);
sp = M.segStep(sp, seg(0, 0, 2048), 11900);
assert("Mini-Sektor: neue Runde beginnt bei 0/0", sp.s === 0 && sp.k === 0 && sp.t === 11900);
const TR = require(path.join(__dirname, "..", "public", "f1", "trackcal.js"));
const ring = { pts: [[0, 0], [100, 0], [100, 100], [0, 100], [0, 0]], cum: [0, 100, 200, 300, 400], len: 400, segF: [0.25, 0.5, 0.75, 1], segDur: [10, 10, 10, 10], counts: [2, 2], lap: 40 };
const pa = TR.pointAt(ring, 0.375);
assert("Strecke: Punkt bei Anteil", pa[0] === 100 && pa[1] === 50);
assert("Strecke: gleitet zur nächsten Grenze, bleibt davor stehen", Math.abs(TR.fracOf(ring, 0, 5) - 0.375) < 1e-9 && TR.fracOf(ring, 0, 60) < 0.5 && TR.fracOf(ring, 0, 60) > 0.49);
const tds = ["00:00:01.000{\"Lines\":{\"7\":{\"NumberOfLaps\":1}}}"];
for (let g = 0; g < 4; g++) tds.push(`00:00:${String(10 + g * 20).padStart(2, "0")}.000{"Lines":{"7":{"Sectors":{"${g >> 1}":{"Segments":{"${g & 1}":{"Status":2048}}}}${g === 3 ? ',"NumberOfLaps":2' : ""}}}}`);
const tl = TR.timingLaps(tds.join("\n"));
assert("Strecke: saubere Runde aus der Zeitmessung", tl.length === 1 && tl[0].n === 7 && tl[0].seg.join() === "10,30,50,70" && tl[0].counts.join() === "2,2");
const idxNow = { Meetings: [{ Sessions: [
  { Name: "Practice 1", StartDate: "2026-10-09T16:30:00", Path: "2026/2026-10-11_Singapore_Grand_Prix/2026-10-09_Practice_1/" },
  { Name: "Sprint Qualifying", StartDate: "2026-10-09T20:30:00", Path: "2026/2026-10-11_Singapore_Grand_Prix/2026-10-09_Sprint_Qualifying/" }] },
  { Sessions: [{ Name: "Race", Path: "2026/2026-10-04_Bahrain_Grand_Prix/2026-10-04_Race/" }] }] };
const idxPrev = { Meetings: [{ Circuit: { Key: 61 }, Sessions: [{ Name: "Race", StartDate: "2025-10-05T20:00:00", Path: "2025/2025-10-05_Singapore_Grand_Prix/2025-10-05_Race/" }] }] };
const srcs = trackSources(idxNow, idxPrev, "2026/2026-10-11_Singapore_Grand_Prix/2026-10-09_Sprint_Qualifying/", 61);
assert("Strecke: Quellen = gleiches Wochenende, dann Vorjahr", srcs.join() === "2026/2026-10-11_Singapore_Grand_Prix/2026-10-09_Practice_1/,2025/2025-10-05_Singapore_Grand_Prix/2025-10-05_Race/");

// ---- Live-Verlauf im DO ----
const LF = (lap, rows) => ({ session: { path: "2026/x/race/", race: true }, frame: { lap, status: "green", rows } });
const R0 = (n, pos, extra) => ({ n, pos, pits: 0, out: false, pitNow: false, gap: pos - 1, interval: 1, compound: "MEDIUM", tyreAge: 3, laps: 0, last: null, best: null, fastest: false, ...(extra || {}) });
let H = M.histStep(null, LF(4, [R0(1, 1, { laps: 4, last: 90.1 }), R0(2, 2, { laps: 4, last: 90.5 })]), 1000);
H = M.histStep(H, LF(5, [R0(2, 1, { laps: 5, last: 89.0 }), R0(1, 2, { laps: 5, last: 91.0 })]), 4000);
assert("Verlauf: Stand je Runde, Rundenzeiten, Überholung", H.hist[4].rows[0].n === 1 && H.hist[5].rows[0].n === 2 && H.hist[4].t === 1000
  && H.laps[2][5].s === 89 && H.laps[1][4].s === 90.1 && H.events.some(e => e.k === "pass" && e.n === 2 && e.o.join() === "1"));
H = M.histStep(H, LF(5, [R0(2, 1, { laps: 5, last: 89.2 }), R0(1, 2, { laps: 5, last: 91.0 })]), 6000);
assert("Verlauf: gleiche Runde überschreibt, Zeitpunkt bleibt", H.laps[2][5].s === 89.2 && H.laps[2][5].t === 4000 && H.hist[5].t === 4000);
const H2 = M.histStep(H, { session: { path: "2026/x/sprint/", race: true }, frame: { lap: 1, status: "green", rows: [] } }, 7000);
assert("Verlauf: neue Session beginnt leer", H2.key === "2026/x/sprint/" && !H2.hist[4] && !Object.keys(H2.laps).length && !H2.events.length);

// ---- Qualifying: „Finished“ nach Q1/Q2 ist nur Pause ----
const qf = part => M.fromLive({ SessionInfo: { Name: "Sprint Qualifying", Type: "Qualifying" }, SessionStatus: { Status: "Finished" },
  TimingData: { SessionPart: part, NoEntries: [22, 16, 10], Lines: { "1": { Position: "1" } } }, DriverList: { "1": { RacingNumber: "1", Tla: "NOR" } } }).frame;
assert("Quali: nach SQ1 Pause statt Endstand, nach SQ3 Ende", qf(1).status === "break" && !qf(1).final && qf(1).cut === null && qf(3).status === "fin" && qf(3).final);
const { flagEvent } = await import("file://" + path.join(__dirname, "..", "functions", "api", "f1", "_logic.js").replace(/\\/g, "/"));
assert("Push: keine Pole-Meldung in der Pause nach SQ1", flagEvent("green", "break", { label: "x", quali: true, winner: "NOR" }) === null
  && /Pole/.test(flagEvent("green", "fin", { label: "x", quali: true, winner: "NOR" }).title));

// ---- Schnelle Runde im Qualifying ----
const fq = (n, best, qpart, extra) => ({ n, best, qpart, out: false, knocked: false, pitNow: false, segs: [2049, 2051, 0], bsec: [{ v: 27.4 }, { v: 39.3 }, { v: 26.3 }], sec: [null, 44, 29], ...(extra || {}) });
const fqrows = [fq(1, 93.0, 2), fq(2, 93.6, 2), fq(3, 94.2, 1, { sec: [{ v: 27.5 }, null, null] })];
const fl1 = M.flyingLap(fqrows[2], [1, 3, 2000], { rows: fqrows, part: 2, cut: 2 });
assert("Schnelle Runde: Hochrechnung, Platz, Weiterkommen", fl1 && fl1.proj === 93.1 && fl1.rank === 2 && fl1.inCut === true && fl1.delta === -1.1);
assert("Schnelle Runde: fertige Runde (alle Mini-Sektoren gefärbt) → nein", M.flyingLap({ ...fqrows[2], segs: [2049, 2051, 2048] }, [2, 7, 500], { rows: fqrows, part: 2 }) === null);
assert("Schnelle Runde: Ausfahrrunde (S1 zu langsam) / Boxengasse / noch in S1 → nein",
  M.flyingLap(fq(4, 94, 1, { sec: [{ v: 31 }, null, null] }), [1, 2, 1000], { rows: fqrows, part: 2 }) === null
  && M.flyingLap(fq(4, 94, 1, { sec: [{ v: 27.5 }, null, null], segs: [2064, 2048] }), [1, 2, 1000], { rows: fqrows, part: 2 }) === null
  && M.flyingLap(fqrows[2], [0, 5, 1000], { rows: fqrows, part: 2 }) === null);
const lvS = M.fromLive({ SessionInfo: { Name: "Qualifying", Type: "Qualifying" }, DriverList: { "1": { RacingNumber: "1" } },
  TimingData: { Lines: { "1": { Position: "1", Sectors: [{ Segments: [{ Status: 2049 }, { Status: 2051 }] }, { Segments: [{ Status: 0 }] }] } } } });
assert("Live: Mini-Sektoren der Runde je Auto", lvS.frame.rows[0].segs.join() === "2049,2051,0");

// ---- Karte: weiche Nachführung ----
let fst = TR.follow(null, 0.5, 0.01, 1 / 60);
assert("Nachführung: erster Wert direkt", fst.f === 0.5);
fst = TR.follow(fst, 0.5, 0.01, 0.1);
assert("Nachführung: fährt mit eigenem Tempo weiter, auch wenn das Ziel steht", fst.f > 0.5 && fst.f < 0.5011);
const back = TR.follow({ f: 0.6 }, 0.55, 0.01, 0.1);
assert("Nachführung: nie rückwärts, großer Abstand → springen", back.f >= 0.6 && TR.follow({ f: 0.1 }, 0.5, 0.01, 0.1).f === 0.5);
assert("Nachführung: über die Ziellinie", TR.follow({ f: 0.999 }, 0.002, 0.01, 0.1).f < 0.01);
assert("Tempo je Mini-Sektor", Math.abs(TR.speedAt(ring, 0, 1) - 0.025) < 1e-9 && Math.abs(TR.speedAt(ring, 0, 2) - 0.0125) < 1e-9);

// ---- Dauerhafte Kopie in D1 (gzip) ----
const mem = new Map();
const fakeDB = { prepare: sql => ({ bind: (...a) => ({
  run: async () => { if (/INSERT INTO f1_cache/.test(sql)) mem.set(a[0], a[1]); return {}; },
  first: async () => (/SELECT body/.test(sql) ? (mem.has(a[0]) ? { body: [...new Uint8Array(mem.get(a[0]))] } : null) : (mem.has(a[0]) ? { x: 1 } : null)),
}) }) };
const big = JSON.stringify({ laps: Array.from({ length: 2000 }, (_, i) => ({ lap: i, s: 90 + i / 1000 })) });
await dbPut({ DB: fakeDB }, "bundle/1", big);
const dbBack = await dbGet({ DB: fakeDB }, "bundle/1");
assert("D1-Kopie: komprimiert gespeichert, unverändert zurück", mem.get("bundle/1").byteLength < big.length / 3 && (await dbBack.text()) === big && dbBack.headers.get("X-Rennticker-Stale") === "db");
assert("D1-Kopie: vorhanden / fehlt", (await dbHas({ DB: fakeDB }, "bundle/1")) && !(await dbHas({ DB: fakeDB }, "bundle/2")) && (await dbGet({ DB: fakeDB }, "bundle/2")) === null);
assert("D1-Kopie: Kalender-Schlüssel = Proxy-URL", calKey(buildUrl("sessions", "?year=2026")) === "openf1/https://api.openf1.org/v1/sessions?year=2026");

if (!ok) process.exit(1);
console.log("f1: alle Tests grün");
