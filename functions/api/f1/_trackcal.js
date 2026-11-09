// ====================================================================
// Eichung der Strecke für die Live-Karte (D1 trackcal/<Strecke>), vom Cron
// vor jedem Wochenende angelegt — solange OpenF1 frei ist (während einer
// Live-Session sperrt es alles). Quelle: die schnellste saubere Runde der
// jüngsten fertigen Session auf derselben Strecke (dieses Wochenende, sonst
// Vorjahre). Das Live-DO schärft sie mit den gemessenen Mini-Sektoren nach.
// ====================================================================
import F1Track from "../../../public/f1/trackcal.js";

const BASE = "https://api.openf1.org/v1/";
const sleep = ms => new Promise(r => setTimeout(r, ms));

// fetchJson(url, ttl) → Objekt | null (null = gesperrt/Fehler → nächster Lauf)
export async function buildTrackCal(fetchJson, circuit, now) {
  const all = await fetchJson(`${BASE}sessions?circuit_key=${circuit}`, 3600);
  if (!Array.isArray(all)) return null;
  const done = all.filter(s => !s.is_cancelled && Date.parse(s.date_end) + 3600e3 < now)
    .sort((a, b) => Date.parse(b.date_start) - Date.parse(a.date_start)).slice(0, 3);
  for (const s of done) {
    await sleep(400);
    const laps = await fetchJson(`${BASE}laps?session_key=${s.session_key}`, 86400);
    if (!Array.isArray(laps)) return null;
    const lap = laps.filter(l => l.lap_duration > 40 && l.duration_sector_1 && l.duration_sector_2 && !l.is_pit_out_lap && (l.segments_sector_1 || []).length)
      .sort((a, b) => a.lap_duration - b.lap_duration)[0];
    if (!lap) continue;
    await sleep(400);
    const from = new Date(Date.parse(lap.date_start) - 1000).toISOString(), to = new Date(Date.parse(lap.date_start) + lap.lap_duration * 1000 + 1000).toISOString();
    const loc = await fetchJson(`${BASE}location?session_key=${s.session_key}&driver_number=${lap.driver_number}&date>=${from}&date<=${to}`, 86400);
    if (!Array.isArray(loc)) return null;
    const o = F1Track.openf1Lap(lap, loc);
    const cal = o && F1Track.buildCal(o.track, o.lap);
    if (cal) return { ...cal, from: `openf1:${s.session_key}` };
  }
  return null;
}
