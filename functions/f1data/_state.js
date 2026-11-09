// ====================================================================
// Endstand einer Session im Format des F1-Feeds (SessionInfo, TimingData,
// TimingAppData, …) — so zeichnet der Rennticker Training/Qualifying, Funk
// und Startaufstellung, egal woher die Daten kommen.
//
// Das F1-Archiv (livetiming.formula1.com/static) ist seit Okt. 2026 nur noch
// angemeldet abrufbar. Ersatz, in dieser Reihenfolge (siehe sessionState in
// [ep].js):
//   1. D1 state/<session_key> — das Live-DO schreibt den Feed-Stand jeder
//      Session mit (genau wie früher das Archiv)
//   2. F1-Archiv (falls es wieder aufgeht)
//   3. aus OpenF1 nachgebaut (synthState) — Ergebnis, Reifen, Rennleitung,
//      Wetter, Funk; ohne Sektoren/Mini-Sektoren
// ====================================================================

// Teile, die synthState aus OpenF1 braucht (Endpunkt → Schlüssel)
export const SYNTH_PARTS = ["drivers", "session_result", "stints", "race_control", "weather", "team_radio"];

const utc = d => String(d || "").replace(/(\.\d{3})\d*/, "$1").replace(/(Z|[+-]\d\d:\d\d)$/, "");
const secs = v => (v == null || !isFinite(+v) ? "" : String(+(+v).toFixed(3)));

// Session-Pfad im F1-Archiv aus einer Funk-URL (für /f1data/radio und Abschriften)
export function pathFromRadio(url) {
  const m = /\/static\/(20\d\d\/[^?#\\]+?\/)TeamRadio\//.exec(String(url || ""));
  return m && !m[1].includes("..") ? m[1] : null;
}

//   p = { session, meeting, drivers, session_result, stints, race_control, weather, team_radio }
export function synthState(p) {
  const s = p.session || {}, m = p.meeting || {};
  const isQuali = /qualifying|shootout/i.test(s.session_type || "") || /qualifying|shootout/i.test(s.session_name || "");
  const isRace = !isQuali && /race|sprint/i.test(s.session_type || "");
  const radio = (p.team_radio || []).filter(r => r && r.recording_url);
  const path = radio.map(r => pathFromRadio(r.recording_url)).find(Boolean) || null;

  const DriverList = {};
  for (const d of p.drivers || []) {
    if (!d || !d.driver_number) continue;
    DriverList[d.driver_number] = { RacingNumber: String(d.driver_number), Tla: d.name_acronym || String(d.driver_number),
      FirstName: d.first_name || "", LastName: d.last_name || "", TeamName: d.team_name || "", TeamColour: d.team_colour || "888888" };
  }

  const Lines = {};
  for (const r of p.session_result || []) {
    if (!r || !r.driver_number) continue;
    const dur = r.duration, gap = r.gap_to_leader;
    const l = { Position: r.position != null ? String(r.position) : "", NumberOfLaps: r.number_of_laps || 0,
      Retired: !!r.dnf, Stopped: !!(r.dns || r.dsq) };
    if (isQuali) {
      const q = Array.isArray(dur) ? dur : [dur];
      l.BestLapTimes = q.map(v => ({ Value: secs(v) }));
      // Q3 erreichen immer die besten 10 (auch im Sprint-Qualifying)
      l.KnockedOut = r.position > 10;
    } else {
      l.BestLapTime = { Value: secs(Array.isArray(dur) ? dur.filter(v => v != null).pop() : dur) };
      if (isRace) l.GapToLeader = typeof gap === "number" && gap > 0 ? "+" + gap.toFixed(3) : typeof gap === "string" ? gap : "";
    }
    Lines[r.driver_number] = l;
  }

  // Reifen: TotalLaps = Alter am Ende, StartLaps = Alter beim Aufziehen (wie im Feed)
  const app = {};
  for (const x of (p.stints || []).slice().sort((a, b) => a.stint_number - b.stint_number)) {
    if (!x || !x.driver_number || !x.compound) continue;
    const age0 = x.tyre_age_at_start || 0, laps = x.lap_end != null && x.lap_start != null ? x.lap_end - x.lap_start + 1 : 0;
    (app[x.driver_number] = app[x.driver_number] || { Stints: [] }).Stints.push({ Compound: x.compound, New: String(age0 === 0), StartLaps: age0, TotalLaps: age0 + laps });
  }

  const w = (p.weather || [])[(p.weather || []).length - 1];
  return {
    _src: "openf1",
    SessionInfo: { Key: s.session_key, Name: s.session_name || "", Type: s.session_type || "", StartDate: utc(s.date_start), EndDate: utc(s.date_end), Path: path,
      Meeting: { Name: m.meeting_name || "", Location: s.location || "", Country: { Name: s.country_name || "" }, Circuit: { Key: s.circuit_key || null, ShortName: s.circuit_short_name || "" } } },
    SessionStatus: { Status: "Finalised" },
    TrackStatus: { Status: "1" },
    DriverList,
    TimingData: { Lines, ...(isQuali ? { SessionPart: 3 } : {}) },
    TimingAppData: { Lines: app },
    RaceControlMessages: { Messages: (p.race_control || []).map(x => ({ Utc: utc(x.date), Category: x.category, Flag: x.flag || undefined, Scope: x.scope || undefined,
      Message: x.message, Lap: x.lap_number ?? undefined, RacingNumber: x.driver_number != null ? String(x.driver_number) : undefined })) },
    WeatherData: w ? { AirTemp: String(w.air_temperature), TrackTemp: String(w.track_temperature), Humidity: String(w.humidity), Rainfall: String(w.rainfall ? 1 : 0),
      WindSpeed: String(w.wind_speed), WindDirection: String(w.wind_direction) } : null,
    TeamRadio: { Captures: radio.map(r => ({ Utc: utc(r.date), RacingNumber: String(r.driver_number), Path: "TeamRadio/" + String(r.recording_url).split("/").pop() })) },
  };
}

// Was das Live-DO von seinem Feed-Stand sichert (ohne Positionen)
export const KEEP_TOPICS = ["SessionInfo", "SessionStatus", "TrackStatus", "LapCount", "DriverList", "TimingData", "TimingAppData", "TimingStats",
  "RaceControlMessages", "WeatherData", "TeamRadio", "ChampionshipPrediction"];
