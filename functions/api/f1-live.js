// Name der DO-Instanz; bei Bedarf hochzählen, um eine hängende Instanz zu ersetzen
export const F1_LIVE_NAME = "live-6";
// Rennticker live: aktueller Stand aus dem F1-Live-Feed. Das DO F1Live
// (Worker worker-rt/) hält die Verbindung zum Feed, solange jemand abfragt.
//   GET /api/f1-live  →  { ok, updated, session, drivers, frame }
//   GET /api/f1-live?hist=1  →  { ok, key, hist: [Runden], laps: { n: [Runden] }, events }
export async function onRequestGet({ env, request }) {
  const ns = env && env.F1_LIVE;
  if (!ns) return new Response(JSON.stringify({ ok: false, error: "unavailable" }), { status: 503, headers: { "Content-Type": "application/json" } });
  const hist = new URL(request.url).searchParams.has("hist");
  return ns.get(ns.idFromName(F1_LIVE_NAME)).fetch(hist ? "https://f1-live/hist" : "https://f1-live/state");
}
