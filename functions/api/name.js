import { json, clientIp, rateLimit, nameProblem, nameOwner, isDevice, logError } from "./_util.js";

// ====================================================================
// Namensprüfung für die Begrüßung.
//
//   GET /api/name?name=Flip&device=abc…  → { free, taken, mine, problem }
//
// Warum es das gibt: Ein Name gehört dem Gerät, das ihn zuerst in eine
// Bestenliste eingetragen hat. Bisher hat man das erst NACH dem ersten
// Spiel erfahren (409 beim Einsenden) — also genau dann, wenn der Punkte-
// stand schon dranhängt. Hier fragt die Startseite vorher.
//
// Grundhaltung: fehlertolerant. Kann die Datenbank nicht antworten, gilt der
// Name als frei (unknown: true). Ein wackeliges Netz darf niemanden davon
// abhalten, überhaupt anzufangen — die verbindliche Prüfung passiert beim
// Einsenden ohnehin noch einmal.
//
// Kein Geheimnis wird verraten: welche Namen benutzt sind, steht in jeder
// öffentlichen Bestenliste. Zurückgegeben wird deshalb nie, WEM ein Name
// gehört, nur ob er frei ist.
// ====================================================================

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const name = String(url.searchParams.get("name") || "");
  const device = String(url.searchParams.get("device") || "");

  // 1) Form zuerst — das braucht keine Datenbank.
  const problem = nameProblem(name);
  if (problem) return json({ free: false, taken: false, mine: false, problem });

  if (!env || !env.DB) return json({ free: true, unknown: true });

  // 2) Gedrosselt: die Startseite fragt beim Tippen (entprellt), das soll
  //    aber niemand als Namens-Scanner missbrauchen.
  if (!(await rateLimit(env, "name:" + clientIp(request), 40, 60))) {
    return json({ free: true, unknown: true, error: "Zu viele Anfragen" }, 429);
  }

  try {
    const owner = await nameOwner(env, name);
    const mine = !!owner && isDevice(device) && owner === device;
    return json({ free: !owner || mine, taken: !!owner && !mine, mine });
  } catch (e) {
    await logError(env, "Namensprüfung fehlgeschlagen", "name", e && e.message);
    return json({ free: true, unknown: true });
  }
}
