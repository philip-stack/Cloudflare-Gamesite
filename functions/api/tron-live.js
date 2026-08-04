// Echtzeit für Neon-Tron: WebSocket-Upgrade → TronRoom (Binding TRON_ROOM im
// Worker worker-rt/). Das DO ist der autoritative Server. Logik in _ws.js.
//   GET /api/tron-live?code=XXXX
import { wsProxy } from "./_ws.js";
export const onRequestGet = wsProxy("TRON_ROOM", /^[A-Z0-9]{4,6}$/);
