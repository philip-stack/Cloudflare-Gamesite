// Admin-Panel-Oberfläche: render() gegen eine realistische Antwort laufen
// lassen. Das Panel ist eine einzige große Vorlage ohne Framework — ein
// Tippfehler darin heißt nicht „ein Kästchen fehlt", sondern leere Seite.
// Geprüft wird darum: läuft render() durch, und stehen in jeder Ansicht die
// Abschnitte, die dort hingehören?
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import vm from "node:vm";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(__dirname, "..", "public", "admin", "index.html"), "utf8");
const script = html.slice(html.lastIndexOf("<script>") + 8, html.lastIndexOf("</script>"));

let ok = true;
const assert = (name, cond) => { if (cond) console.log("OK  ", name); else { console.log("FAIL", name); ok = false; } };

// ---------- minimale DOM-Attrappe ----------
// Kein jsdom im Projekt (und keine Lust auf die Abhängigkeit): die Vorlage
// braucht nur innerHTML/textContent/className und ein paar Ereignis-Haken.
function el(id) {
  return {
    id, innerHTML: "", textContent: "", className: "", value: "", checked: true, hidden: false,
    style: {}, dataset: {}, tagName: "DIV",
    classList: { add() {}, remove() {}, contains: () => false },
    addEventListener() {}, setAttribute() {}, focus() {}, select() {},
    querySelectorAll: () => [],
  };
}
const nodes = new Map();
const byId = (sel) => {
  if (!nodes.has(sel)) nodes.set(sel, el(sel));
  return nodes.get(sel);
};
const KNOWN = ["#gate", "#dash", "#key", "#gate-msg", "#ampel", "#stamp", "#content", "#tabs", "#auto", "#refresh", "#logout", "#help", "#help-btn", "#enter"];
KNOWN.forEach(byId);

const sandbox = {
  console,
  document: {
    // Nur bekannte Hüllen-Elemente existieren. Alles, was erst im gerenderten
    // HTML steckt, ist null — genau der Fall, den wire() abfangen muss.
    querySelector: (sel) => (nodes.has(sel) ? nodes.get(sel) : null),
    querySelectorAll: () => [],
    addEventListener() {},
    createElement: () => el("neu"),
    activeElement: null,
    hidden: false,
    body: { appendChild() {} },
  },
  localStorage: { store: {}, getItem(k) { return this.store[k] ?? null; }, setItem(k, v) { this.store[k] = String(v); }, removeItem(k) { delete this.store[k]; } },
  location: { href: "https://x/admin/", hash: "", pathname: "/admin/", search: "" },
  history: { replaceState() {} },
  fetch: async () => ({ ok: false, status: 401, json: async () => ({}) }),
  setInterval: () => 1, clearInterval() {}, setTimeout: () => 1,
  requestAnimationFrame: () => 1,
  alert() {}, confirm: () => false, prompt: () => null,
  navigator: { userAgent: "test" },
  URL, Blob: class {}, Date, Math, JSON, Number, String, Object, Array,
  window: null,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;

const ctx = vm.createContext(sandbox);
// Die Datei ruft am Ende load() auf; fetch liefert 401 → showGate(), harmlos.
try {
  vm.runInContext(script, ctx, { filename: "admin/index.html" });
  assert("Panel-Skript lädt ohne Ausnahme", true);
} catch (e) {
  assert("Panel-Skript lädt ohne Ausnahme (" + e.message + ")", false);
}

// ---------- realistische Antwort ----------
const answer = {
  generatedAt: new Date().toISOString(),
  status: "warn", warns: ["Fire-Cron verzögert"],
  scores: { total: 998, last24h: 38, games: [{ game: "komet", subs: 802, players: 4, top: 51234, topName: "Philip" }] },
  errors: {
    total: 12, last24h: 3, upstream522: 1,
    top: [{ msg: "boom", n: 2, total: 9, last: "2026-09-03 08:00:00", page: "komet", firstSeen: "2026-09-03 07:00:00" }],
    latest: [{ created_at: "2026-09-03 08:00:00", page: "komet", msg: "boom", ua: "Chrome/142", extra: "score=99" }],
  },
  clientErrors: { total: 4, last24h: 1, latest: [{ created_at: "2026-09-03 08:00:00", page: "/", msg: "oops", ua: "Safari", extra: "canvas=0" }] },
  ops: {
    since: "2026-09-01 12:00:00", sinceStatus: "ok",
    log: [
      { at: "2026-09-01 12:12:00", status: "ok", reasons: null },
      { at: "2026-09-01 12:00:00", status: "warn", reasons: "Push-Queue: 900" },
    ],
  },
  push: { subscriptions: 2, queued: 0, oldestAgeSec: null },
  fire: { lastRun: "2026-09-03 07:00:00", ageSec: 3600, active: 0, detailFetched: 1, note: "ok", openOps: 0, keptOps: 120 },
  sprit: { lastRun: null, ageSec: 300, alerts: 1, subscribers: 1, priceLog: 500 },
  db: { rateRows: 10, usedTokens: 5, bannedDevices: 1, tables: { scores: 998, error_log: 12, rate: 10, used_token: 5 } },
  reach: { players: 7, new7: 1, active7: 2, returning: 3 },
  kritzeln: { players: 3, games: 5, topName: "A", topPoints: 9, entries: [{ name: "A", points: 9, games: 2, wins: 1, best: 5 }] },
  quiz: { players: 2, games: 3, topName: "B", topPoints: 7, entries: [{ name: "B", points: 7, games: 1, wins: 1, best: 4 }], reportCount: 2, reports: [{ id: 1, created_at: "2026-09-03 08:00:00", msg: "FRAGE GEMELDET: x", extra: "y" }] },
  live: { rooms: [{ code: "AB12", game: "quiz", players: 3, state: "play", updated_at: "2026-09-03 08:30:00" }] },
  adminLog: [{ action: "auth:fail", detail: "GET · Schlüssel: ohne", created_at: "2026-09-03 08:00:00" }],
  trends: { days: 30, scores: [{ d: "2026-09-02", n: 5 }], errors: [], devices: [] },
  usage: [{ k: "play:flatterfink", n: 21 }],
  alert: { name: "Philip" },
  recent: [{ id: 9, game: "komet", name: "Philip", device: "abcdef123456", score: 1234, meta: "{}", created_at: "2026-09-03 08:00:00" }],
  banned: [{ device: "deadbeef1234", at: "2026-09-01 10:00:00" }],
  health: { cron: { ok: true }, vapid: true },
};

const content = byId("#content"), tabs = byId("#tabs"), ampel = byId("#ampel");
const renderAs = (v) => {
  sandbox.localStorage.setItem("admin_view", v);
  // setView() rendert selbst, wenn lastData steht — hier direkt über render().
  vm.runInContext(`view = ${JSON.stringify(v)}; lastData = ANSWER; render(ANSWER);`, ctx);
  return content.innerHTML;
};
sandbox.ANSWER = answer;

// ---------- Ansichten ----------
{
  const h = renderAs("ueberblick");
  assert("Überblick: Reichweite", h.includes("Reichweite") && h.includes(">7<"));
  assert("Überblick: Trends + Nutzung", h.includes("Trends") && h.includes("Nutzung"));
  assert("Überblick: aktive Räume mit Zeile", h.includes("AB12"));
  assert("Überblick: KEINE Moderation/Systemteile", !h.includes("Push-Queue leeren") && !h.includes("alert-name"));
}
{
  const h = renderAs("fehler");
  assert("Fehler: Log + Client-Fehler + Meldungen", h.includes("Fehler-Log") && h.includes("Client-Fehler") && h.includes("Gemeldete Fragen"));
  assert("Fehler: neue Fehlerart markiert", h.includes(">neu<"));
  assert("Fehler: Gesamtzahl neben 24-h-Zahl", h.includes("9 gesamt"));
}
{
  const h = renderAs("moderation");
  assert("Moderation: Einsendungen + Suche", h.includes("Letzte Einsendungen") && h.includes("search-q"));
  assert("Moderation: drei Klappblöcke + gesperrte Geräte", (h.match(/<details class="fold"/g) || []).length === 4);
  assert("Moderation: Aktionen als Text statt Emoji", h.includes(">löschen<") && h.includes(">sperren<"));
}
{
  // Der Zeitraum-Umschalter MUSS die Kurve treffen: vorher stand im Etikett
  // immer "30 Tage" und gezeichnet wurden immer 30 Punkte, egal was der
  // Server geliefert hat.
  const sieben = JSON.parse(JSON.stringify(answer));
  sieben.trends.days = 7;
  sandbox.ANSWER = sieben;
  vm.runInContext(`view = "ueberblick"; lastData = ANSWER; render(ANSWER);`, ctx);
  const h7 = content.innerHTML;
  assert("Kurve: Etikett folgt dem Zeitraum", h7.includes("7 Tage ·") && !h7.includes("30 Tage ·"));
  const punkte = (JSON.parse(h7.match(/data-series='(\[.*?\])'/)[1]) || []).length;
  assert("Kurve: 7 Tage = 7 Punkte", punkte === 7);
  sandbox.ANSWER = answer;
}
{
  const h = renderAs("fehler");
  assert("Fehler: Kontext (extra) aufklappbar", h.includes("class=\"mini\"") && h.includes("score=99"));
  assert("Fehler: volles UA im Kontext", h.includes("Chrome/142"));
  assert("Client-Fehler: extra sichtbar", h.includes("canvas=0"));
}
{
  const h = renderAs("system");
  assert("System: Vorfall-Verlauf mit Grund", h.includes("Vorfall-Verlauf") && h.includes("Push-Queue: 900"));
  assert("System: Vorfall-Dauer berechnet", h.includes(">12 min<"));
  assert("System: Crons + Push + Tabellen", h.includes("Fire-Cron") && h.includes("Sprit-Cron") && h.includes("Tabellen"));
  assert("System: Alarm-Feld", h.includes("alert-name"));
  assert("System: Admin-Protokoll als Klappblock", h.includes("Admin-Protokoll") && h.includes("auth:fail"));
}

// ---------- Reiter + Statuszeile ----------
{
  renderAs("ueberblick");
  assert("Reiter: alle vier", ["Überblick", "Fehler", "Moderation", "System"].every(t => tabs.innerHTML.includes(t)));
  assert("Reiter: aktive Ansicht markiert", tabs.innerHTML.includes('data-view="ueberblick" aria-current="true"'));
  assert("Reiter: Zähler zeigt Fehler aus anderer Ansicht", tabs.innerHTML.includes('class="badge">3<'));
  assert("Statuszeile trägt die Signalklasse", ampel.className === "ampel warn");
  assert("Statuszeile nennt den Grund", ampel.innerHTML.includes("Fire-Cron verzögert"));
  // Bei „ok" tritt an die Stelle der Gründe die Ruhe-Angabe.
  const gut = JSON.parse(JSON.stringify(answer));
  gut.status = "ok"; gut.warns = [];
  sandbox.ANSWER = gut;
  vm.runInContext(`lastData = ANSWER; render(ANSWER);`, ctx);
  assert("Statuszeile: seit … ohne Vorfall", /seit .* ohne Vorfall/.test(ampel.innerHTML));
  sandbox.ANSWER = answer;
}

// ---------- Leere Abschnitte schrumpfen ----------
{
  const leer = JSON.parse(JSON.stringify(answer));
  leer.errors.top = []; leer.errors.latest = [];
  leer.clientErrors.latest = []; leer.quiz.reports = [];
  leer.live.rooms = []; leer.banned = []; leer.recent = [];
  sandbox.ANSWER = leer;
  vm.runInContext(`view = "fehler"; lastData = ANSWER; render(ANSWER);`, ctx);
  const h = content.innerHTML;
  assert("leer: kein Tabellengerüst in der Fehler-Ansicht", !h.includes("<table"));
  assert("leer: eine Zeile statt Tabelle", (h.match(/class="quiet"/g) || []).length === 3);
  vm.runInContext(`view = "ueberblick"; render(ANSWER);`, ctx);
  assert("leer: aktive Räume als Zeile", content.innerHTML.includes("gerade keine aktiven Räume"));
  vm.runInContext(`view = "moderation"; render(ANSWER);`, ctx);
  assert("leer: Einsendungen als Zeile", content.innerHTML.includes("keine Einsendungen"));
}

console.log(ok ? "\n✅ admin-ui: alle Tests grün" : "\n❌ admin-ui: Tests fehlgeschlagen");
process.exit(ok ? 0 : 1);
