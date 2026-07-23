// ====================================================================
// Echtzeit für den Spieleabend-Raum. Die Durable-Object-Klasse (PartyRoom)
// lebt in einem SEPARATEN Worker (worker-rt/) — Cloudflare Pages kann selbst
// keine Durable Objects definieren, nur an einen Worker gebundene nutzen
// (Binding PARTY_ROOM mit script_name in wrangler.toml). Diese Pages-Funktion
// reicht nur den WebSocket-Upgrade an das richtige Raum-DO weiter; das Signal
// „neu laden" an alle kommt über broadcastParty() (in _util.js).
//
//   GET /api/party-live?code=XXXXXX   (WebSocket-Upgrade)  → verbindet mit dem DO
// ====================================================================

// WebSocket-Upgrade an das richtige Raum-DO weiterreichen.
export async function onRequestGet(context) {
  const { request, env } = context;
  if (!env.PARTY_ROOM) return new Response("realtime unavailable", { status: 503 });
  const code = String(new URL(request.url).searchParams.get("code") || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) return new Response("bad code", { status: 400 });
  if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
  const stub = env.PARTY_ROOM.get(env.PARTY_ROOM.idFromName(code));
  return stub.fetch(request);
}
