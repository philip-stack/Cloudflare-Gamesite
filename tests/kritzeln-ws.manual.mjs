// DO-INTEGRATIONSTEST für Kritzeln (DrawRoom) — MANUELL, nicht im CI-`npm test`,
// weil er einen LIVE-Deploy braucht (echte WebSockets ans Durable Object). Prüft
// den Teil, der sich mit Unit-Tests nicht abdecken lässt: WS-Relay (stroke/fill/
// undo), Reconnect-Snapshot, eigene Wörter, Kick und die autoritative Wertung.
//
// Voraussetzung: Node ≥ 22 (globales WebSocket). Ausführen:
//   node tests/kritzeln-ws.manual.mjs                    (gegen philip-stack.pages.dev)
//   node tests/kritzeln-ws.manual.mjs <hash>.philip-stack.pages.dev   (frischer Deploy)
// Exit 0 = alle Checks grün.
const HOST = (process.argv[2] || "philip-stack.pages.dev").replace(/^https?:\/\//, "");
const code = "M" + Math.random().toString(36).slice(2, 6).toUpperCase();
const url = c => `wss://${HOST}/api/kritzeln-live?code=${c}`;
const J = o => JSON.stringify(o);
const log = (...a) => console.log(...a);

const R = { drawRecv: false, fillRecv: false, undoRecv: false, snapshot: false, customWord: false, guessed: false, turnEnd: false, kicked: false };
let word = null, started = false, aDrew = false, bId = null;

const a = new WebSocket(url(code));
a.onopen = () => a.send(J({ t: "join", name: "Alice", uid: "uA" }));
a.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.t === "lobby") {
    const bob = (m.players || []).find(p => p.name === "Bob"); if (bob) bId = bob.id;
    if ((m.players || []).length >= 2 && !started) {
      started = true;
      setTimeout(() => { a.send(J({ t: "words", list: ["Zonk", "Wackelpudding", "Trampolin", "Kaugummi"] })); setTimeout(() => a.send(J({ t: "start" })), 300); }, 300);
    }
  }
  if (m.t === "choices") { R.customWord = m.words.every(w => ["Zonk", "Wackelpudding", "Trampolin", "Kaugummi"].includes(w)); a.send(J({ t: "choose", word: m.words[0] })); }
  if (m.t === "word") {
    word = m.word;
    setTimeout(() => a.send(J({ t: "stroke", pts: [[0.1, 0.1], [0.3, 0.3]], c: "#111827", w: 6, s: true })), 200);
    setTimeout(() => a.send(J({ t: "fill", x: 0.5, y: 0.5, c: "#ff0000" })), 400);
    setTimeout(() => { a.send(J({ t: "undo" })); aDrew = true; }, 600);
    setTimeout(() => { if (bId != null) a.send(J({ t: "kick", id: bId })); }, 6500);
  }
  if (m.t === "guessed" && m.name === "Bob") R.guessed = (m.place === 1 && m.gain > 0);
  if (m.t === "turnEnd") R.turnEnd = Array.isArray(m.gains) && m.gains.some(g => g.name === "Bob");
};

let b;
setTimeout(() => {
  b = new WebSocket(url(code));
  b.onopen = () => b.send(J({ t: "join", name: "Bob", uid: "uB" }));
  b.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.t === "draw") R.drawRecv = true;
    if (m.t === "fill") R.fillRecv = true;
    if (m.t === "undo") R.undoRecv = true;
    if (m.t === "kicked") R.kicked = true;
  };
}, 500);

// Dritter Client tritt MITTEN im Zug bei (nach den Strichen) → muss Snapshot
// bekommen. Cara rät danach ebenfalls, damit "alle haben geraten" → turnEnd.
let c;
setTimeout(() => {
  c = new WebSocket(url(code));
  c.onopen = () => c.send(J({ t: "join", name: "Cara", uid: "uC" }));
  c.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.t === "snapshot" && Array.isArray(m.ops) && m.ops.length) R.snapshot = true;
  };
}, 2500);

// Beide Rater:innen tippen, sobald Cara ihren Snapshot hat (bzw. als Fallback
// nach 4,5 s), damit alle Guesser erraten haben → endTurn → turnEnd.
function guessAll() {
  if (word && b && b.readyState === 1 && !b._guessed) { b._guessed = true; b.send(J({ t: "guess", text: word })); }
  if (word && c && c.readyState === 1 && !c._guessed) { c._guessed = true; c.send(J({ t: "guess", text: word })); }
}
const poll = setInterval(() => { if (aDrew && R.snapshot) guessAll(); }, 200);
setTimeout(guessAll, 4500);   // Fallback, falls Snapshot ausbleibt

setTimeout(() => {
  clearInterval(poll);
  log("\n=== ERGEBNIS ===");
  for (const [k, v] of Object.entries(R)) log((v ? "✅" : "❌") + " " + k);
  try { a.close(); b && b.close(); c && c.close(); } catch {}
  process.exit(Object.values(R).every(Boolean) ? 0 : 1);
}, 10000);
