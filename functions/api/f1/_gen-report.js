import F1 from "../../../public/f1/model.js";
import { dbGet, dbPut, buildBundle, buildUrl, calKey, archiveTopic } from "../../f1data/[ep].js";
import { reportFacts, REPORT_SYSTEM, favSystem, parseReport } from "./_report.js";

// ====================================================================
// Rennticker — KI-Rennbericht erzeugen und in D1 ablegen
// (f1_cache k = "report/<session_key>" bzw. "report/<key>/<Startnummer>").
// Aufgerufen vom Cron (gleich nach dem Rennen) und von /api/f1/report
// (Sicht eines Fahrers, beim ersten Antippen).
// ====================================================================
const LLM = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const text = async r => (r ? r.text() : null);

// Session + Wochenende aus der Kalender-Kopie in D1 (gilt auch während der OpenF1-Sperre)
export async function calendarEntry(env, year, key) {
  const [ss, ms] = await Promise.all([
    text(await dbGet(env, calKey(buildUrl("sessions", "?year=" + year)))),
    text(await dbGet(env, calKey(buildUrl("meetings", "?year=" + year)))),
  ]);
  const s = (JSON.parse(ss || "[]") || []).find(x => x.session_key === +key) || null;
  const m = s && (JSON.parse(ms || "[]") || []).find(x => x.meeting_key === s.meeting_key);
  return s ? { s, m } : null;
}

// Abgetippte Funksprüche dieses Rennens (nur, was schon jemand angehört hat)
async function radioQuotes(env, year, key, race) {
  try {
    const tr = await archiveTopic(year, key, "TeamRadio");
    const caps = tr && tr.Captures ? (Array.isArray(tr.Captures) ? tr.Captures : Object.values(tr.Captures)) : [];
    const byFile = new Map(caps.filter(c => c && c.Path).map(c => [String(c.Path).replace(/^TeamRadio\//, ""), c]));
    const files = [...byFile.keys()];
    const out = [];
    for (let i = 0; i < files.length; i += 90) {
      const part = files.slice(i, i + 90);
      const rows = (await env.DB.prepare(`SELECT file, segs FROM f1_transcript WHERE file IN (${part.map(() => "?").join(",")})`).bind(...part).all()).results || [];
      for (const r of rows) {
        let segs = []; try { segs = JSON.parse(r.segs) || []; } catch (_) { segs = []; }
        if (!segs.length) continue;
        const c = byFile.get(r.file), t = Date.parse(c.Utc);
        const lap = race.frames.filter(f => !f.final && f.t <= t).length;
        out.push({ n: +c.RacingNumber, lap: lap || null, en: segs.map(x => x.t).join(" "), de: segs.every(x => x.d) ? segs.map(x => x.d).join(" ") : "" });
      }
    }
    // Spitze zuerst, längere Sprüche bevorzugt
    const fin = race.frames[race.frames.length - 1];
    const rank = n => { const r = fin.rows.find(x => x.n === n); return r && !r.out ? r.pos : 30; };
    return out.sort((a, b) => rank(a.n) - rank(b.n) || b.en.length - a.en.length);
  } catch (_) { return []; }
}

export async function generateReport(env, key, year, fav) {
  if (!env.AI) throw new Error("KI nicht verfügbar");
  const raw = JSON.parse((await text(await dbGet(env, "bundle/" + key))) || (await buildBundle(String(key), String(year))));
  const race = F1.buildRace(raw);
  const fin = race.frames[race.frames.length - 1];
  if (!fin || !fin.final) throw new Error("noch kein Ergebnis");
  const cal = await calendarEntry(env, year, key);
  const gp = cal && cal.m ? cal.m.meeting_name.replace(/ Grand Prix$/i, " GP") : "Grand Prix";
  const title = `${gp} ${year}${cal && cal.s.location ? ` (${cal.s.location})` : ""} · ${cal && cal.s.session_name === "Sprint" ? "Sprint" : "Rennen"}`;
  const facts = reportFacts(race, { title }, await radioQuotes(env, year, key, race));
  let system = REPORT_SYSTEM, user = "Fakten:\n" + facts.text;
  if (fav) {
    const d = race.drivers.get(+fav);
    if (!d || !facts.drivers.has(+fav)) throw Object.assign(new Error("Fahrer nicht im Rennen"), { status: 404 });
    system = favSystem(`${d.first} ${d.last}`);
    user += "\n\nZum Fahrer:\n" + facts.drivers.get(+fav);
  }
  const res = await env.AI.run(LLM, { messages: [{ role: "system", content: system }, { role: "user", content: user }], max_tokens: fav ? 400 : 700 });
  const rep = parseReport(res && res.response, fav ? 45 : 110);
  if (!rep) throw new Error("Antwort des Modells unbrauchbar");
  const out = { ...rep, meeting: title, session: +key, fav: fav ? +fav : null, at: Date.now() };
  await dbPut(env, "report/" + key + (fav ? "/" + fav : ""), JSON.stringify(out));
  return out;
}
