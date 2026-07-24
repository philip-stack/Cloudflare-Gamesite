import { json, clientIp, rateLimit } from "../_util.js";

// ====================================================================
// Statistik/Trends für /fire/noe. Rechnet aus der eigenen Historie
// (fire_op: aktive = ended 0, beendete = ended 1) die Kennzahlen der
// letzten 24 h aus.
//   GET /api/fire/stats
//     → { active, last24, byKind:{B,T,S,X}, avgMin, topBezirk:{name,count}, byHour:[..24] }
// Hinweis: Sammelt erst seit Aktivierung der Historie — anfangs dünn.
// ====================================================================

const BEZIRK = {
  "01": "Amstetten", "02": "Baden", "03": "Bruck/Leitha", "04": "Gänserndorf",
  "05": "Gmünd", "061": "Klosterneuburg", "062": "St. Pölten (Land)", "063": "Bruck/Leitha",
  "07": "Hollabrunn", "08": "Horn", "09": "Korneuburg", "10": "Krems/Donau",
  "11": "Lilienfeld", "12": "Melk", "13": "Mistelbach", "14": "Mödling",
  "15": "Neunkirchen", "17": "St. Pölten", "18": "Scheibbs", "19": "Tulln",
  "20": "Waidhofen/Thaya", "21": "Wr. Neustadt", "22": "Zwettl",
};
const kindOf = a => { const c = String(a || "").trim().toUpperCase()[0]; return "BTS".includes(c) ? c : "X"; };

export async function onRequestGet({ request, env }) {
  if (env && env.DB && !(await rateLimit(env, "firestats:" + clientIp(request), 60, 60))) {
    return json({ error: "Zu viele Anfragen" }, 429);
  }
  const empty = { active: 0, last24: 0, byKind: { B: 0, T: 0, S: 0, X: 0 }, avgMin: null, topBezirk: null, byHour: new Array(24).fill(0) };
  if (!env || !env.DB) return json(empty);

  try {
    const rows = (await env.DB.prepare(
      `SELECT a, b, ended, first_seen, ended_at FROM fire_op
       WHERE ended = 0 OR (ended = 1 AND ended_at > datetime('now','-1 day'))`
    ).all()).results || [];

    const byKind = { B: 0, T: 0, S: 0, X: 0 };
    const byBez = {};
    const byHour = new Array(24).fill(0);
    let durSum = 0, durN = 0, active = 0;

    for (const r of rows) {
      byKind[kindOf(r.a)]++;
      if (r.ended === 0) active++;
      const bz = BEZIRK[String(r.b)] || null;
      if (bz) byBez[bz] = (byBez[bz] || 0) + 1;
      // Beginn-Stunde (UTC→lokal grob egal für Verteilung)
      const t = Date.parse(String(r.first_seen || "").replace(" ", "T") + "Z");
      if (!isNaN(t)) byHour[new Date(t).getHours()]++;
      // Dauer nur für beendete
      if (r.ended === 1 && r.ended_at && r.first_seen) {
        const a = Date.parse(r.first_seen.replace(" ", "T") + "Z");
        const b = Date.parse(r.ended_at.replace(" ", "T") + "Z");
        if (!isNaN(a) && !isNaN(b) && b > a) { durSum += (b - a); durN++; }
      }
    }

    let topBezirk = null;
    for (const [name, count] of Object.entries(byBez)) {
      if (!topBezirk || count > topBezirk.count) topBezirk = { name, count };
    }

    return json({
      active,
      last24: rows.length,
      byKind,
      avgMin: durN ? Math.round(durSum / durN / 60000) : null,
      topBezirk,
      byHour,
    });
  } catch (_) {
    return json(empty);
  }
}
