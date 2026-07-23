// Web-Push-API mit gemockter D1 (ohne Netzwerk): Abo speichern, Warteschlange
// abholen/löschen, abmelden, VAPID-Public-Key ausliefern, sendToName-No-op.
import { fileURLToPath } from "node:url";
import path from "node:path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modUrl = "file://" + path.join(__dirname, "..", "functions", "api", "push.js").replace(/\\/g, "/");
const mod = await import(modUrl);

let ok = true;
const assert = (name, cond) => { if (cond) console.log("OK  ", name); else { console.log("FAIL", name); ok = false; } };

function mockDB() {
  const subs = [];    // {endpoint,name,p256dh,auth,device}
  const queue = [];   // {id,endpoint,title,body,url}
  let qid = 0;
  return {
    _subs: subs, _queue: queue,
    prepare(sql) {
      return {
        sql, args: [],
        bind(...a) { this.args = a; return this; },
        async run() {
          if (/INSERT INTO push_sub/.test(this.sql)) {
            const [endpoint, name, p256dh, auth, device] = this.args;
            const ex = subs.find(s => s.endpoint === endpoint);
            if (ex) Object.assign(ex, { name, p256dh, auth, device });
            else subs.push({ endpoint, name, p256dh, auth, device });
          } else if (/INSERT INTO push_queue/.test(this.sql)) {
            const [endpoint, title, body, url] = this.args;
            queue.push({ id: ++qid, endpoint, title, body, url });
          } else if (/DELETE FROM push_sub/.test(this.sql)) {
            const i = subs.findIndex(s => s.endpoint === this.args[0]); if (i >= 0) subs.splice(i, 1);
          } else if (/DELETE FROM push_queue WHERE id IN/.test(this.sql)) {
            for (const id of this.args) { const i = queue.findIndex(q => q.id === id); if (i >= 0) queue.splice(i, 1); }
          } else if (/DELETE FROM push_queue WHERE endpoint/.test(this.sql)) {
            for (let i = queue.length - 1; i >= 0; i--) if (queue[i].endpoint === this.args[0]) queue.splice(i, 1);
          }
          return {};
        },
        async first() {
          if (/COUNT\(\*\) AS n FROM rate/.test(this.sql)) return { n: 0 };
          if (/SELECT 1 FROM push_sub WHERE endpoint/.test(this.sql)) return subs.some(s => s.endpoint === this.args[0]) ? { 1: 1 } : null;
          return null;
        },
        async all() {
          if (/SELECT endpoint FROM push_sub WHERE LOWER\(name\)/.test(this.sql)) {
            const nm = String(this.args[0]).toLowerCase();
            return { results: subs.filter(s => (s.name || "").toLowerCase() === nm).map(s => ({ endpoint: s.endpoint })) };
          }
          if (/FROM push_queue WHERE endpoint/.test(this.sql)) {
            return { results: queue.filter(q => q.endpoint === this.args[0]).sort((a, b) => a.id - b.id).slice(0, 10).map(q => ({ id: q.id, title: q.title, body: q.body, url: q.url })) };
          }
          return { results: [] };
        },
      };
    },
  };
}

const db = mockDB();
const env = { DB: db };  // absichtlich OHNE VAPID_PRIVATE_JWK → kein Netz
const post = async body => { const r = await mod.onRequestPost({ request: new Request("https://x/api/push", { method: "POST", body: JSON.stringify(body) }), env }); return { status: r.status, data: await r.json() }; };

// Public-Key wird ausgeliefert
const g = await mod.onRequestGet();
const gd = await g.json();
assert("GET liefert VAPID-Public-Key", typeof gd.key === "string" && gd.key.length > 80);

const EP = "https://push.example.com/abc123";
let r = await post({ action: "subscribe", subscription: { endpoint: EP, keys: { p256dh: "PK", auth: "AU" } }, name: "Alice", device: "alicedevice0001" });
assert("Abo gespeichert (200)", r.status === 200 && db._subs.length === 1 && db._subs[0].name === "Alice");

// Ungültiger Endpoint abgelehnt
r = await post({ action: "subscribe", subscription: { endpoint: "ftp://nope" } });
assert("Ungültiger Endpoint abgelehnt (400)", r.status === 400);

// Warteschlange: eine Nachricht einreihen (direkt im Mock) und via "pending" holen
db._queue.push({ id: 999, endpoint: EP, title: "Hallo", body: "Welt", url: "/" });
r = await post({ action: "pending", endpoint: EP });
assert("pending liefert Nachricht", r.status === 200 && r.data.messages.length === 1 && r.data.messages[0].title === "Hallo");
assert("pending leert die Warteschlange", db._queue.filter(q => q.endpoint === EP).length === 0);

// sendToName ohne VAPID-Key ist ein sicheres No-op (kein Wurf, kein Netz)
await mod.sendToName(env, "Alice", { title: "x", body: "y", url: "/" });
assert("sendToName ohne VAPID-Key wirft nicht", true);

// Abmelden entfernt das Abo
r = await post({ action: "unsubscribe", endpoint: EP });
assert("Abmelden entfernt Abo", r.status === 200 && db._subs.length === 0);

// Unbekannte Aktion
r = await post({ action: "quatsch" });
assert("Unbekannte Aktion (400)", r.status === 400);

console.log("\n" + (ok ? "PUSH-TESTS OK" : "PUSH-TESTS FEHLGESCHLAGEN"));
process.exit(ok ? 0 : 1);
