// ====================================================================
// Cloudflare-Kennzahlen fürs eigene Panel — damit man für „wie viel vom
// Gratis-Kontingent ist weg?" nicht ins Cloudflare-Dashboard wechseln muss.
//
// Eine GraphQL-Abfrage holt Pages-Functions-Anfragen, D1-Verbrauch,
// Worker-Aufrufe und Durable-Object-Aufrufe in einem Rutsch; die Dateigröße
// der D1 kommt aus der REST-API (die kennt GraphQL nicht).
//
// Voraussetzungen (Pages-Secrets):
//   CF_API_TOKEN    API-Token mit  Account → Account Analytics → Read
//                                  Account → D1 → Read
//   CF_ACCOUNT_ID   Account-Kennung
//   wrangler pages secret put CF_API_TOKEN  --project-name philip-stack
//
// Ohne Token liefert cfStats() { error } — das Panel zeigt dann einen
// Hinweis statt einer Fehlermeldung. Nie werfen: diese Zahlen sind nice to
// have und dürfen das Dashboard nicht mitnehmen.
//
// Zwischengespeichert wird in app_config (10 min): das Panel aktualisiert
// sich alle 45 Sekunden, die Analytics-API ist langsam und gedrosselt.
// ====================================================================

const CACHE_KEY = "cf_stats";
const GQL = "https://api.cloudflare.com/client/v4/graphql";
const REST = "https://api.cloudflare.com/client/v4";
const D1_NAME = "wuerfelpoker";

// Tageskontingente im Gratis-Tarif. Bewusst hier und nicht im Frontend:
// die Zahlen gehören zur Datenquelle, nicht zur Darstellung.
export const CF_LIMITS = {
  d1RowsRead: 5_000_000,
  d1RowsWritten: 100_000,
  pagesRequests: 100_000,
  workerRequests: 100_000,
};

const QUERY = `query Ops($acc: String!, $since: Date!, $sinceT: Time!) {
  viewer {
    accounts(filter: { accountTag: $acc }) {
      pages: pagesFunctionsInvocationsAdaptiveGroups(limit: 14, filter: { date_geq: $since }, orderBy: [date_DESC]) {
        dimensions { date } sum { requests errors }
      }
      d1: d1AnalyticsAdaptiveGroups(limit: 14, filter: { date_geq: $since }, orderBy: [date_DESC]) {
        dimensions { date } sum { readQueries writeQueries rowsRead rowsWritten }
      }
      workers: workersInvocationsAdaptive(limit: 20, filter: { datetime_geq: $sinceT }) {
        dimensions { scriptName status } sum { requests errors }
      }
      dos: durableObjectsInvocationsAdaptiveGroups(limit: 14, filter: { date_geq: $since }, orderBy: [date_DESC]) {
        dimensions { date } sum { requests errors }
      }
    }
  }
}`;

const dayKey = (o) => (o && o.dimensions && o.dimensions.date) || "";

// Die vier Datensätze kommen je Tag getrennt — fürs Panel als eine Zeile je
// Tag zusammenführen, neueste zuerst.
function mergeDays(a) {
  const byDay = new Map();
  const row = (d) => {
    if (!byDay.has(d)) byDay.set(d, { d, pagesReq: 0, pagesErr: 0, rowsRead: 0, rowsWritten: 0, readQ: 0, writeQ: 0, doReq: 0, doErr: 0 });
    return byDay.get(d);
  };
  for (const x of a.pages || []) { const r = row(dayKey(x)); r.pagesReq += x.sum.requests || 0; r.pagesErr += x.sum.errors || 0; }
  for (const x of a.d1 || []) {
    const r = row(dayKey(x));
    r.rowsRead += x.sum.rowsRead || 0; r.rowsWritten += x.sum.rowsWritten || 0;
    r.readQ += x.sum.readQueries || 0; r.writeQ += x.sum.writeQueries || 0;
  }
  for (const x of a.dos || []) { const r = row(dayKey(x)); r.doReq += x.sum.requests || 0; r.doErr += x.sum.errors || 0; }
  return [...byDay.values()].filter(r => r.d).sort((x, y) => (x.d < y.d ? 1 : -1));
}

async function fetchFresh(env) {
  const token = env.CF_API_TOKEN, acc = env.CF_ACCOUNT_ID;
  if (!token || !acc) return { error: "CF_API_TOKEN / CF_ACCOUNT_ID nicht gesetzt" };

  const since = new Date(Date.now() - 13 * 864e5).toISOString().slice(0, 10);
  const headers = { Authorization: "Bearer " + token, "Content-Type": "application/json" };

  // Analytics und Dateigröße sind unabhängig → parallel, und ein Ausfall der
  // REST-Abfrage darf die Zahlen nicht verhindern.
  const [gql, size] = await Promise.all([
    fetch(GQL, { method: "POST", headers, body: JSON.stringify({ query: QUERY, variables: { acc, since, sinceT: since + "T00:00:00Z" } }) })
      .then(r => r.json()).catch(e => ({ errors: [{ message: String(e && e.message || e) }] })),
    fetch(`${REST}/accounts/${acc}/d1/database?name=${encodeURIComponent(D1_NAME)}`, { headers: { Authorization: "Bearer " + token } })
      .then(r => r.json()).catch(() => null),
  ]);

  if (gql && gql.errors && gql.errors.length) {
    return { error: gql.errors.map(e => e.message).join(" · ").slice(0, 300) };
  }
  const a = gql && gql.data && gql.data.viewer && gql.data.viewer.accounts && gql.data.viewer.accounts[0];
  if (!a) return { error: "Unerwartete Antwort der Analytics-API" };

  // Die LISTE liefert file_size, aber weder Region noch Tabellenzahl — das
  // kennt nur die Detail-Abfrage, und die braucht die uuid aus der Liste.
  // Ein zweiter Aufruf ist bei 10 Minuten Zwischenspeicher zu verschmerzen;
  // schlägt er fehl, bleibt es bei den Werten aus der Liste.
  let db = size && size.result && size.result[0];
  if (db && db.uuid) {
    try {
      const detail = await fetch(`${REST}/accounts/${acc}/d1/database/${db.uuid}`, { headers: { Authorization: "Bearer " + token } })
        .then(r => r.json());
      if (detail && detail.result) db = { ...db, ...detail.result };
    } catch (_) { /* optional */ }
  }

  return {
    at: new Date().toISOString(),
    days: mergeDays(a),
    workers: (a.workers || []).map(w => ({
      script: w.dimensions.scriptName, status: w.dimensions.status,
      requests: w.sum.requests || 0, errors: w.sum.errors || 0,
    })),
    d1: db ? {
      name: db.name,
      fileSize: db.file_size ?? null,
      region: db.running_in_region || null,
      tables: db.num_tables ?? null,
    } : null,
  };
}

// Rückgabe immer ein Objekt: { at, days, workers, d1, limits } oder { error }.
// Bei einem API-Ausfall wird ein vorhandener (auch abgelaufener) Zwischenstand
// mit stale:true zurückgegeben — alte Zahlen sind besser als keine.
export async function cfStats(env, { maxAgeSec = 600 } = {}) {
  let cached = null;
  try {
    const row = await env.DB.prepare("SELECT v FROM app_config WHERE k = ?").bind(CACHE_KEY).first();
    if (row && row.v) cached = JSON.parse(row.v);
  } catch (_) { /* kein Zwischenspeicher, kein Problem */ }

  const ageSec = cached && cached.at ? (Date.now() - Date.parse(cached.at)) / 1000 : Infinity;
  if (cached && !cached.error && ageSec < maxAgeSec) {
    return { ...cached, limits: CF_LIMITS, cached: true, ageSec: Math.round(ageSec) };
  }

  let fresh;
  try { fresh = await fetchFresh(env); } catch (e) { fresh = { error: String(e && e.message || e) }; }

  if (fresh.error) {
    if (cached && !cached.error) {
      return { ...cached, limits: CF_LIMITS, cached: true, stale: true, ageSec: Math.round(ageSec), error: fresh.error };
    }
    return { ...fresh, limits: CF_LIMITS };
  }

  try {
    await env.DB.prepare("INSERT INTO app_config (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v")
      .bind(CACHE_KEY, JSON.stringify(fresh)).run();
  } catch (_) { /* Zwischenspeichern ist optional */ }

  return { ...fresh, limits: CF_LIMITS, cached: false, ageSec: 0 };
}
