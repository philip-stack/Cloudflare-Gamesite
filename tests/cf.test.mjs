// Cloudflare-Kennzahlen: cfStats() darf das Dashboard NIE mitnehmen — weder
// ohne Token, noch bei einem API-Ausfall, noch bei kaputtem Zwischenspeicher.
// Und es darf die Analytics-API nicht bei jedem 45-Sekunden-Refresh anfassen.
import { fileURLToPath } from "node:url";
import path from "node:path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modUrl = "file://" + path.join(__dirname, "..", "functions", "api", "_cf.js").replace(/\\/g, "/");
const { cfStats, CF_LIMITS } = await import(modUrl);

let ok = true;
const assert = (name, cond) => { if (cond) console.log("OK  ", name); else { console.log("FAIL", name); ok = false; } };

// Mock-D1 mit einer echten app_config-Ablage
function mockDB(initial) {
  const store = { ...(initial || {}) };
  return {
    store,
    prepare(sql) {
      return {
        args: [],
        bind(...a) { this.args = a; return this; },
        async first() { const v = store[this.args[0]]; return v === undefined ? null : { v }; },
        async run() {
          if (/INSERT INTO app_config/.test(sql)) store[this.args[0]] = this.args[1];
          return {};
        },
      };
    },
  };
}

const ANTWORT = {
  data: { viewer: { accounts: [{
    pages: [
      { dimensions: { date: "2026-09-03" }, sum: { requests: 900, errors: 2 } },
      { dimensions: { date: "2026-09-02" }, sum: { requests: 2351, errors: 0 } },
    ],
    d1: [
      { dimensions: { date: "2026-09-03" }, sum: { readQueries: 10, writeQueries: 4, rowsRead: 1_900_000, rowsWritten: 10_000 } },
    ],
    workers: [
      { dimensions: { scriptName: "philip-stack-rt", status: "success" }, sum: { requests: 4639, errors: 0 } },
      { dimensions: { scriptName: "philip-stack-rt", status: "clientDisconnected" }, sum: { requests: 5, errors: 1 } },
    ],
    dos: [{ dimensions: { date: "2026-09-03" }, sum: { requests: 6, errors: 4 } }],
    // Nach Tag UND Modell gruppiert: zwei Zeilen für denselben Tag, plus der
    // Fallback an einem anderen Tag.
    ai: [
      { count: 3, dimensions: { date: "2026-09-03", modelId: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" }, sum: { totalNeurons: 372.5, totalInputTokens: 1000, totalOutputTokens: 1700 } },
      { count: 1, dimensions: { date: "2026-09-03", modelId: "@cf/meta/llama-3.1-8b-instruct" }, sum: { totalNeurons: 20.5, totalInputTokens: 300, totalOutputTokens: 400 } },
      { count: 2, dimensions: { date: "2026-09-02", modelId: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" }, sum: { totalNeurons: 250, totalInputTokens: 700, totalOutputTokens: 1100 } },
    ],
  }] } },
};
const D1LISTE = { result: [{ name: "wuerfelpoker", file_size: 1470464, running_in_region: "EEUR" }] };

const envMit = (db) => ({ DB: db, CF_API_TOKEN: "tok", CF_ACCOUNT_ID: "acc" });
let calls = [];
function stubFetch(handler) {
  calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push(String(url));
    const body = handler(String(url), opts);
    if (body instanceof Error) throw body;
    return { json: async () => body };
  };
}
const antwortAuf = (url) => (url.includes("/graphql") ? ANTWORT : D1LISTE);

// ---------- Ohne Token: sauberer Hinweis, kein Netzaufruf ----------
{
  stubFetch(antwortAuf);
  const r = await cfStats({ DB: mockDB() });
  assert("ohne Token → error statt Ausnahme", !!r.error && /CF_API_TOKEN/.test(r.error));
  assert("ohne Token → kein API-Aufruf", calls.length === 0);
  assert("Kontingente werden trotzdem mitgeliefert", r.limits === CF_LIMITS);
}

// ---------- Frischer Abruf ----------
{
  stubFetch(antwortAuf);
  const db = mockDB();
  const r = await cfStats(envMit(db));
  assert("frischer Abruf → keine Fehlermeldung", !r.error);
  assert("genau zwei Aufrufe (GraphQL + REST)", calls.length === 2);
  const heute = r.days[0];
  assert("Tage neueste zuerst", r.days.length === 2 && heute.d === "2026-09-03");
  assert("vier Datensätze pro Tag zusammengeführt",
    heute.pagesReq === 900 && heute.pagesErr === 2 && heute.rowsRead === 1_900_000 && heute.doErr === 4);
  assert("D1-Größe aus der REST-Antwort", r.d1 && r.d1.fileSize === 1470464 && r.d1.region === "EEUR");
  assert("Worker-Zeilen übernommen", r.workers.length === 2 && r.workers[0].requests === 4639);
  // Zwei Modell-Zeilen desselben Tages müssen in EINER Tageszeile landen.
  assert("KI je Tag zusammengefasst (beide Modelle)",
    heute.aiReq === 4 && Math.round(heute.aiNeurons) === 393 && heute.aiTokIn === 1300 && heute.aiTokOut === 2100);
  assert("KI-Modelle über das Fenster aufgeschlüsselt", r.aiModels.length === 2);
  assert("KI-Modelle nach Aufrufen sortiert", r.aiModels[0].requests === 5 && /70b/.test(r.aiModels[0].model));
  assert("KI-Neuronen je Modell über Tage summiert", Math.round(r.aiModels[0].neurons) === 623);
  assert("Ergebnis wird zwischengespeichert", typeof db.store.cf_stats === "string" && db.store.cf_stats.includes("2026-09-03"));
}

// ---------- Zwischenspeicher: kein zweiter Abruf ----------
{
  stubFetch(antwortAuf);
  const db = mockDB();
  await cfStats(envMit(db));
  const vorher = calls.length;
  const r2 = await cfStats(envMit(db));
  assert("zweiter Aufruf kommt aus dem Zwischenspeicher", calls.length === vorher && r2.cached === true);
  assert("Zwischenspeicher liefert dieselben Tage", r2.days[0].pagesReq === 900);
}

// ---------- Zwischenspeicher abgelaufen → neu holen ----------
{
  const alt = JSON.stringify({ at: new Date(Date.now() - 3600e3).toISOString(), days: [{ d: "2026-08-01", pagesReq: 1 }], workers: [] });
  stubFetch(antwortAuf);
  const db = mockDB({ cf_stats: alt });
  const r = await cfStats(envMit(db), { maxAgeSec: 600 });
  assert("abgelaufen → neuer Abruf", calls.length === 2 && r.days[0].d === "2026-09-03" && r.cached === false);
}

// ---------- API kaputt, aber alte Zahlen da → alte Zahlen zeigen ----------
{
  const alt = JSON.stringify({ at: new Date(Date.now() - 3600e3).toISOString(), days: [{ d: "2026-08-01", pagesReq: 42 }], workers: [] });
  stubFetch(() => new Error("Netz weg"));
  const db = mockDB({ cf_stats: alt });
  const r = await cfStats(envMit(db));
  assert("Ausfall → alte Zahlen mit stale-Kennzeichen", r.stale === true && r.days[0].pagesReq === 42);
  assert("Ausfall → Grund wird mitgeliefert", /Netz weg/.test(r.error || ""));
  assert("Ausfall überschreibt den Zwischenspeicher NICHT", db.store.cf_stats === alt);
}

// ---------- GraphQL antwortet mit Fehlerliste ----------
{
  stubFetch((url) => (url.includes("/graphql") ? { errors: [{ message: "unknown field \"x\"" }] } : D1LISTE));
  const r = await cfStats(envMit(mockDB()));
  assert("GraphQL-Fehler wird durchgereicht", /unknown field/.test(r.error || ""));
}

// ---------- Kaputter Zwischenspeicher darf nicht stören ----------
{
  stubFetch(antwortAuf);
  const r = await cfStats(envMit(mockDB({ cf_stats: "{kein json" })));
  assert("unlesbarer Zwischenspeicher → einfach neu holen", !r.error && r.days.length === 2);
}

// ---------- Kontingente plausibel ----------
{
  assert("D1-Leselimit 5 Mio./Tag", CF_LIMITS.d1RowsRead === 5_000_000);
  assert("D1-Schreiblimit 100k/Tag", CF_LIMITS.d1RowsWritten === 100_000);
  assert("Workers-AI-Limit 10.000 Neuronen/Tag", CF_LIMITS.aiNeurons === 10_000);
}

console.log(ok ? "\n✅ cf: alle Tests grün" : "\n❌ cf: Tests fehlgeschlagen");
process.exit(ok ? 0 : 1);
