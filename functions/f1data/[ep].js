// ====================================================================
// Same-Origin-Proxy für OpenF1 (Rennticker unter /f1/).
//   GET /f1data/{endpoint}?session_key=…  →  https://api.openf1.org/v1/{endpoint}
// Die CSP erlaubt nur 'self', darum geht der Browser über uns. Die Antwort
// wird unverändert durchgereicht (kein Parsen → kaum CPU) und am Edge
// gecacht. Bewusst NICHT unter /api/ (dort erzwingt _headers "no-store").
// Gratis-Stufe von OpenF1: nur abgeschlossene Sessions (ab ~30 min danach),
// 3 Anfragen/s — bei 429 einmal kurz warten und nochmal versuchen.
// ====================================================================

const BASE = "https://api.openf1.org/v1/";
const UA = "Rennticker/1.0 (+https://philip-stack.pages.dev/f1/; privat)";

// Endpunkt → Cache-Dauer in Sekunden (Listen ändern sich, Session-Daten kaum)
export const ENDPOINTS = {
  sessions: 1800, meetings: 1800,
  drivers: 3600, position: 3600, intervals: 3600, laps: 3600,
  stints: 3600, pit: 3600, race_control: 3600, session_result: 3600,
};
const PARAMS = { session_key: /^\d{1,6}$/, meeting_key: /^\d{1,6}$/, year: /^20\d\d$/, session_type: /^[A-Za-z]{1,20}$/ };

export function buildUrl(ep, search) {
  if (!Object.prototype.hasOwnProperty.call(ENDPOINTS, ep)) return null;
  const q = new URLSearchParams();
  for (const [k, v] of new URLSearchParams(search)) {
    if (!PARAMS[k] || !PARAMS[k].test(v)) return null;
    q.set(k, v);
  }
  // Session-Daten nur mit session_key — sonst käme die ganze Saison
  if (ep !== "sessions" && ep !== "meetings" && !q.has("session_key")) return null;
  return BASE + ep + (q.toString() ? "?" + q : "");
}

export async function onRequestGet({ params, request }) {
  const ep = String(params.ep || "");
  const url = buildUrl(ep, new URL(request.url).search);
  if (!url) return new Response("bad request", { status: 400 });
  const ttl = ENDPOINTS[ep];
  try {
    let res;
    for (let i = 0; i < 3; i++) {
      res = await fetch(url, {
        headers: { "User-Agent": UA, "Accept": "application/json" },
        cf: { cacheTtl: ttl, cacheEverything: true, cacheTtlByStatus: { "200-299": ttl, "400-599": 0 } },
      });
      if (res.status !== 429) break;
      await new Promise(r => setTimeout(r, 1100));
    }
    if (!res.ok) {
      // 401/403 = Live-Session (nur für OpenF1-Sponsoren), 404 = keine Daten
      return new Response(JSON.stringify({ error: res.status }), {
        status: res.status === 404 ? 404 : res.status === 401 || res.status === 403 ? 403 : 502,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }
    const r = new Response(res.body, res);
    r.headers.set("Content-Type", "application/json; charset=utf-8");
    r.headers.set("Cache-Control", `public, max-age=${Math.min(ttl, 600)}`);
    r.headers.delete("set-cookie");
    return r;
  } catch (_) {
    return new Response(JSON.stringify({ error: "fetch" }), { status: 502, headers: { "Content-Type": "application/json" } });
  }
}
