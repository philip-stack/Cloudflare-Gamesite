import { json, logError } from "../_util.js";
import { generate } from "./_gen.js";

// ====================================================================
// Zeitgesteuertes Tages-Briefing.
//   GET /api/briefing/cron      (Header x-cron-key, bzw. ?key=)
//   GET /api/briefing/cron?force=1   → sofort erzeugen (Admin-Knopf)
//
// Der Cron-Worker pingt alle 2 Minuten; generate() entscheidet selbst, ob
// etwas zu tun ist (richtige Stunde in Wiener Zeit, heute noch nichts
// geschrieben). Damit braucht es keinen zweiten Zeitplan.
// ====================================================================

function keyEq(got, want) {
  if (!want || got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const got = request.headers.get("x-cron-key") || url.searchParams.get("key") || "";
  if (!keyEq(got, env.CRON_TOKEN)) return json({ error: "forbidden" }, 403);
  if (!env.DB) return json({ ok: false, error: "no-db" });

  try {
    const r = await generate(env, { force: url.searchParams.get("force") === "1" });
    return json(r);
  } catch (e) {
    await logError(env, "briefing-cron: " + (e && e.message), "briefing/cron");
    return json({ ok: false, error: String(e && e.message) }, 500);
  }
}
