// Rennticker live: aktueller Stand aus dem F1-Live-Feed. Das DO F1Live
// (Worker worker-rt/) hält die Verbindung zum Feed, solange jemand abfragt.
//   GET /api/f1-live  →  { ok, updated, session, drivers, frame }
export async function onRequestGet({ env }) {
  const ns = env && env.F1_LIVE;
  if (!ns) return new Response(JSON.stringify({ ok: false, error: "unavailable" }), { status: 503, headers: { "Content-Type": "application/json" } });
  return ns.get(ns.idFromName("live")).fetch("https://f1-live/state");
}
