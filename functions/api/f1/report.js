import { json, clientIp, rateLimit, logError } from "../_util.js";
import { dbGet } from "../../f1data/[ep].js";
import { generateReport, calendarEntry } from "./_gen-report.js";

// ====================================================================
// Rennticker — KI-Rennbericht eines Rennens/Sprints.
//   GET /api/f1/report?session_key=11388&year=2026[&fav=1]
//     → { title, body: [Absätze], meeting, fav, at } | 425 (noch nicht fertig)
// Den Bericht schreibt der Cron gleich nach dem Rennen; die Sicht eines
// Fahrers (fav) entsteht beim ersten Abruf und wird dann gemerkt.
// ====================================================================
export async function onRequestGet({ request, env }) {
  const q = new URL(request.url).searchParams;
  const key = q.get("session_key") || "", year = q.get("year") || "", fav = q.get("fav") || "";
  if (!/^\d{1,6}$/.test(key) || !/^20\d\d$/.test(year) || (fav && !/^\d{1,2}$/.test(fav))) return json({ error: "ungültig" }, 400);
  const k = "report/" + key + (fav ? "/" + fav : "");
  const hit = await dbGet(env, k);
  if (hit) return new Response(await hit.text(), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

  // Nur fertige Rennen/Sprints (OpenF1 gibt die Daten ~30 min nach dem Ende frei)
  const cal = await calendarEntry(env, year, key).catch(() => null);
  if (!cal || cal.s.session_type !== "Race") return json({ error: "kein Rennen" }, 404);
  if (Date.parse(cal.s.date_end) + 35 * 60000 > Date.now()) return json({ error: "Bericht folgt nach dem Rennen" }, 425);
  // Ohne Fahrer schreibt den Bericht der Cron; hier nur, falls er noch fehlt
  if (!(await rateLimit(env, `f1rep:${clientIp(request)}`, 3, 60))) return json({ error: "Zu viele Anfragen – kurz warten" }, 429);
  try {
    return json(await generateReport(env, key, year, fav || null));
  } catch (e) {
    if (e && (e.status === 401 || e.status === 403)) return json({ error: "Daten noch gesperrt – Bericht folgt" }, 425);
    if (e && e.status === 404) return json({ error: e.message }, 404);
    await logError(env, "F1-Bericht fehlgeschlagen", "f1-report", `${k}: ${e && (e.stack || e.message) || e}`);
    return json({ error: "Bericht gerade nicht möglich" }, 502);
  }
}
