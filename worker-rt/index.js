import { DurableObject } from "cloudflare:workers";

// ====================================================================
// Echtzeit-Worker der Gamesite: hostet das Durable Object PartyRoom
// (ein DO pro Spieleabend-Raum). Cloudflare Pages kann keine Durable
// Objects definieren, nur binden — deshalb dieser eigene Worker. Die
// Pages-Site bindet PARTY_ROOM per script_name = "philip-stack-rt".
//
// Das DO ist ein reiner Pub/Sub-Relay: Clients holen ihre Daten weiter
// über die REST-API (/api/party); hier fließt nur ein „changed"-Signal,
// damit alle sofort neu laden statt zu pollen. Hibernation-WebSockets
// (ctx.acceptWebSocket) → das DO schläft zwischen Nachrichten.
// ====================================================================

export class PartyRoom extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);

    // Interner Aufruf (vom Pages-Server): allen Verbundenen "changed" senden
    if (url.pathname.endsWith("/broadcast")) {
      const sockets = this.ctx.getWebSockets();
      for (const ws of sockets) { try { ws.send("changed"); } catch (_) {} }
      return new Response(String(sockets.length));
    }

    // Sonst: WebSocket-Upgrade eines Clients
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected websocket", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  // Ein Client meldet selbst eine Änderung (nach eigener Aktion) → an die
  // anderen weiterreichen. "ping"/"pong" hält die Verbindung am Leben.
  async webSocketMessage(ws, message) {
    const msg = typeof message === "string" ? message : "";
    if (msg === "ping") { try { ws.send("pong"); } catch (_) {} return; }
    if (msg === "changed") {
      for (const s of this.ctx.getWebSockets()) { if (s !== ws) { try { s.send("changed"); } catch (_) {} } }
    }
  }

  async webSocketClose(ws) { try { ws.close(); } catch (_) {} }
  async webSocketError(ws) { try { ws.close(); } catch (_) {} }
}

// Der Worker hostet das DO und trägt zusätzlich den Cron-Trigger für den
// Feuerwehr-Bezirksalarm: Pages kann keine Crons: Der Worker pingt darum
// zeitgesteuert die geschützte Pages-Route /api/fire/cron (dort liegen DB
// und VAPID). Der CRON_TOKEN (Secret hier UND in Pages) schützt den Aufruf.
export default {
  async fetch() { return new Response("Spieleabend-Echtzeit (Durable Object host)", { status: 200 }); },

  async scheduled(event, env, ctx) {
    ctx.waitUntil((async () => {
      try {
        const base = env.PAGES_ORIGIN || "https://philip-stack.pages.dev";
        await fetch(base + "/api/fire/cron?key=" + encodeURIComponent(env.CRON_TOKEN || ""), {
          headers: { "User-Agent": "philip-stack-rt/cron" },
        });
      } catch (_) { /* nächster Lauf versucht es erneut */ }
    })());
  },
};
