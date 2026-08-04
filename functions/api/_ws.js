// ====================================================================
// Gemeinsame Factory für die WebSocket-Upgrade-Proxies. Cloudflare Pages kann
// keine Durable Objects definieren, nur an den Worker worker-rt/ gebundene
// nutzen. Diese Funktionen reichen den Upgrade nur an das richtige Raum-DO
// weiter (env[binding].idFromName(code)). party/tron/kritzeln unterschieden
// sich nur in Binding-Name und Code-Länge — daher hier EINE Implementierung.
// ====================================================================
export function wsProxy(binding, codeRe) {
  return async function onRequestGet({ request, env }) {
    const room = env && env[binding];
    if (!room) return new Response("realtime unavailable", { status: 503 });
    const code = String(new URL(request.url).searchParams.get("code") || "").trim().toUpperCase();
    if (!codeRe.test(code)) return new Response("bad code", { status: 400 });
    if (request.headers.get("Upgrade") !== "websocket") return new Response("expected websocket", { status: 426 });
    const stub = room.get(room.idFromName(code));
    return stub.fetch(request);
  };
}
