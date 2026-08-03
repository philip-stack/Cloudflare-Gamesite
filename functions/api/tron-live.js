// ====================================================================
// Echtzeit für Neon-Tron. Wie /api/party-live reicht diese Pages-Funktion
// nur den WebSocket-Upgrade an das richtige Match-DO (TronRoom im Worker
// worker-rt/, Binding TRON_ROOM mit script_name) weiter. Das DO ist der
// autoritative Server (Spiel-Schleife, Kollisionen).
//
//   GET /api/tron-live?code=XXXX   (WebSocket-Upgrade) → verbindet mit dem DO
// ====================================================================
export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.TRON_ROOM) return new Response("realtime unavailable", { status: 503 });
  const code = String(new URL(request.url).searchParams.get("code") || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{4,6}$/.test(code)) return new Response("bad code", { status: 400 });
  if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
  const stub = env.TRON_ROOM.get(env.TRON_ROOM.idFromName(code));
  return stub.fetch(request);
}
