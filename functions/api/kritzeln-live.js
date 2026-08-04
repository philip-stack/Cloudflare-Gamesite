// Echtzeit für „Kritzeln & Raten": WebSocket-Upgrade → DrawRoom (Binding
// DRAW_ROOM im Worker worker-rt/). Gemeinsame Logik in _ws.js.
//   GET /api/kritzeln-live?code=XXXX
import { wsProxy } from "./_ws.js";
export const onRequestGet = wsProxy("DRAW_ROOM", /^[A-Z0-9]{4,6}$/);
