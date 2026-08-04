// Echtzeit für den Spieleabend-Raum: WebSocket-Upgrade → PartyRoom (Binding
// PARTY_ROOM im Worker worker-rt/). Das „neu laden"-Signal kommt separat über
// broadcastParty() (in _util.js). Gemeinsame Upgrade-Logik in _ws.js.
//   GET /api/party-live?code=XXXXXX
import { wsProxy } from "./_ws.js";
export const onRequestGet = wsProxy("PARTY_ROOM", /^[A-Z0-9]{6}$/);
