// ====================================================================
// Echtzeit für „Kritzeln & Raten". Reicht den WebSocket-Upgrade an das
// richtige Raum-DO (DrawRoom im Worker worker-rt/, Binding DRAW_ROOM mit
// script_name) weiter. Das DO ist Wahrheit für Wort, Runden & Punkte.
//
//   GET /api/kritzeln-live?code=XXXX   (WebSocket-Upgrade) → verbindet mit dem DO
// ====================================================================
export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.DRAW_ROOM) return new Response("realtime unavailable", { status: 503 });
  const code = String(new URL(request.url).searchParams.get("code") || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{4,6}$/.test(code)) return new Response("bad code", { status: 400 });
  if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
  const stub = env.DRAW_ROOM.get(env.DRAW_ROOM.idFromName(code));
  return stub.fetch(request);
}
