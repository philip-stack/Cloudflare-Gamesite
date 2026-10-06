// Tests für den Rennticker (/f1/): Rechenkern (public/f1/model.js) mit einem
// kleinen, erfundenen 3-Runden-Rennen und die Allowlist des OpenF1-Proxys
// (functions/f1data/[ep].js). Ohne Netz.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const M = require(path.join(__dirname, "..", "public", "f1", "model.js"));
const { buildUrl } = await import("file://" + path.join(__dirname, "..", "functions", "f1data", "[ep].js").replace(/\\/g, "/"));

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

// ---- Proxy-Allowlist ----
assert("Proxy: erlaubter Endpunkt", buildUrl("laps", "?session_key=11731") === "https://api.openf1.org/v1/laps?session_key=11731");
assert("Proxy: Kalender", buildUrl("sessions", "?year=2026&session_type=Race") === "https://api.openf1.org/v1/sessions?year=2026&session_type=Race");
assert("Proxy: unbekannter Endpunkt", buildUrl("car_data", "?session_key=1") === null);
assert("Proxy: Session-Daten ohne session_key", buildUrl("laps", "") === null);
assert("Proxy: fremder Parameter", buildUrl("laps", "?session_key=1&driver_number=1") === null);
assert("Proxy: kaputter Wert", buildUrl("laps", "?session_key=1;drop") === null);
assert("Proxy: Prototyp-Name", buildUrl("constructor", "?session_key=1") === null);

if (!ok) process.exit(1);
console.log("f1: alle Tests grün");
