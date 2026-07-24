import { json } from "../_util.js";
import { pushToEndpoint } from "../push.js";

// ====================================================================
// Zeitgesteuerte Prüfung neuer Feuerwehr-Einsätze (NÖ) und Bezirks-Alarm.
// Wird NICHT vom Browser, sondern vom Cron-Worker (worker-rt) aufgerufen:
//   GET /api/fire/cron?key=<CRON_TOKEN>
// Cloudflare Pages kann keine Cron-Trigger; darum pingt der Worker diese
// Route. Der Token (Secret in Pages UND Worker) schützt vor Fremdaufruf.
//
// Ablauf: aktive Einsätze holen → neue (Einsatznr. nicht in fire_seen)
// ermitteln → an alle fire_alert-Abos des jeweiligen Bezirks (oder "*")
// pushen → alle aktuellen als gesehen markieren → aufräumen.
// ====================================================================

const BASE = "https://infoscreen.florian10.info/OWS/wastlMobile";
const UA = "SpieleabendFireNoe/1.0 (+https://philip-stack.pages.dev/fire/noe/)";

const BEZIRK = {
  "01": "Amstetten", "02": "Baden", "03": "Bruck/Leitha", "04": "Gänserndorf",
  "05": "Gmünd", "061": "Klosterneuburg", "062": "St. Pölten (Land)", "063": "Bruck/Leitha",
  "07": "Hollabrunn", "08": "Horn", "09": "Korneuburg", "10": "Krems/Donau",
  "11": "Lilienfeld", "12": "Melk", "13": "Mistelbach", "14": "Mödling",
  "15": "Neunkirchen", "17": "St. Pölten", "18": "Scheibbs", "19": "Tulln",
  "20": "Waidhofen/Thaya", "21": "Wr. Neustadt", "22": "Zwettl",
};

export async function onRequestGet({ request, env }) {
  const key = new URL(request.url).searchParams.get("key") || "";
  if (!env.CRON_TOKEN || key !== env.CRON_TOKEN) return json({ error: "forbidden" }, 403);

  let list = [];
  try {
    const res = await fetch(`${BASE}/getEinsatzAktiv.ashx`, { headers: { "User-Agent": UA } });
    const data = res.ok ? await res.json() : {};
    list = Array.isArray(data.Einsatz) ? data.Einsatz : [];
  } catch (_) {
    return json({ ok: false, error: "upstream" });
  }
  if (!list.length) return json({ ok: true, active: 0, sent: 0 });

  // Welche der aktuellen Einsätze kennen wir schon?
  const nums = list.map(e => String(e.n || "")).filter(Boolean);
  const seen = new Set();
  try {
    const rows = (await env.DB.prepare(
      `SELECT n FROM fire_seen WHERE n IN (${nums.map(() => "?").join(",")})`
    ).bind(...nums).all()).results || [];
    for (const r of rows) seen.add(r.n);
  } catch (_) {}

  const fresh = list.filter(e => e.n && !seen.has(String(e.n)));
  let sent = 0;

  for (const e of fresh) {
    const bez = String(e.b || "");
    let targets = [];
    try {
      targets = (await env.DB.prepare(
        "SELECT DISTINCT endpoint FROM fire_alert WHERE bezirk = ? OR bezirk = '*'"
      ).bind(bez).all()).results || [];
    } catch (_) {}

    const bezName = BEZIRK[bez] || (bez ? "Bezirk " + bez : "");
    const msg = {
      title: "🚒 " + (e.a ? e.a + " · " : "") + (e.m || "Einsatz"),
      body: (e.o || "") + (bezName ? " · " + bezName : ""),
      url: "/fire/noe/",
    };
    for (const t of targets) {
      const r = await pushToEndpoint(env, t.endpoint, msg);
      if (r.ok) sent++;
      if (r.gone) {
        try {
          await env.DB.prepare("DELETE FROM fire_alert WHERE endpoint = ?").bind(t.endpoint).run();
          await env.DB.prepare("DELETE FROM push_queue WHERE endpoint = ?").bind(t.endpoint).run();
        } catch (_) {}
      }
    }
  }

  // Alle aktuellen als gesehen markieren (baut die Basislinie auf; neue
  // Abonnenten bekommen dadurch nur künftige Einsätze, nicht den Rückstand).
  try {
    for (const n of nums) {
      await env.DB.prepare("INSERT OR IGNORE INTO fire_seen (n) VALUES (?)").bind(n).run();
    }
    // Aufräumen: alte Merker (>2 Tage) und alte Queue-Reste (>1 Tag).
    await env.DB.prepare("DELETE FROM fire_seen WHERE at < datetime('now','-2 days')").run();
    await env.DB.prepare("DELETE FROM push_queue WHERE at < datetime('now','-1 day')").run();
  } catch (_) {}

  // Historie mitschreiben: aktive Einsätze speichern/auffrischen, aus der
  // Live-Liste gefallene als „beendet" markieren. (Nur wenn wir Daten haben
  // — der frühe Return oben verhindert, dass ein Ausfall alles beendet.)
  try {
    for (const e of list) {
      await env.DB.prepare(
        `INSERT INTO fire_op (n, m, a, o, o2, b, last_seen, ended)
         VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 0)
         ON CONFLICT(n) DO UPDATE SET m=excluded.m, a=excluded.a, o=excluded.o,
           o2=excluded.o2, b=excluded.b, last_seen=CURRENT_TIMESTAMP, ended=0, ended_at=NULL`
      ).bind(String(e.n), e.m || "", e.a || "", e.o || "", e.o2 || "", String(e.b || "")).run();
    }
    const placeholders = nums.map(() => "?").join(",");
    await env.DB.prepare(
      `UPDATE fire_op SET ended=1, ended_at=CURRENT_TIMESTAMP WHERE ended=0 AND n NOT IN (${placeholders})`
    ).bind(...nums).run();
    await env.DB.prepare("DELETE FROM fire_op WHERE ended=1 AND ended_at < datetime('now','-3 days')").run();
  } catch (_) {}

  return json({ ok: true, active: list.length, fresh: fresh.length, sent });
}
