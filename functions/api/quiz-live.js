// Echtzeit für „Quiz-Duell": WebSocket-Upgrade → QuizRoom (Binding QUIZ_ROOM
// im Worker worker-rt/). Gemeinsame Logik in _ws.js.
//   GET /api/quiz-live?code=XXXX
import { wsProxy } from "./_ws.js";
export const onRequestGet = wsProxy("QUIZ_ROOM", /^[A-Z0-9]{4,6}$/);
