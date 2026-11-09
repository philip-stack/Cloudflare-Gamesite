// Name der DO-Instanz; bei Bedarf hochzählen, um eine hängende Instanz zu ersetzen
export const F1_LIVE_NAME = "live-9";
// Rennticker live: aktueller Stand aus dem F1-Live-Feed. Das DO F1Live
// (Worker worker-rt/) hält die Verbindung zum Feed, solange jemand abfragt.
//   GET /api/f1-live  →  { ok, updated, session, drivers, frame }
//   GET /api/f1-live?hist=1  →  { ok, key, hist: [Runden], laps: { n: [Runden] }, events }
//   GET /api/f1-live?trackcal=1&circuit=61  →  Eichung der Strecke (D1, vom Cron angelegt, live nachgeschärft)
export async function onRequestGet({ env, request }) {
  const ns = env && env.F1_LIVE;
  if (!ns) return new Response(JSON.stringify({ ok: false, error: "unavailable" }), { status: 503, headers: { "Content-Type": "application/json" } });
  const q = new URL(request.url).searchParams;
  const stub = ns.get(ns.idFromName(F1_LIVE_NAME));
  if (q.has("trackcal")) return stub.fetch("https://f1-live/trackcal?" + new URLSearchParams({ circuit: q.get("circuit") || "" }));
  return stub.fetch(q.has("hist") ? "https://f1-live/hist" : "https://f1-live/state");
}
