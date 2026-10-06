// ====================================================================
// FIA-Dokumente für den Rennticker (/f1/): Entscheidungen der Rennleitung,
// Strafen, Startaufstellung usw. als PDF von fia.com.
//
//   GET /f1data/fia?year=2026                     → { events: [Name, …] }
//   GET /f1data/fia?year=2026&event=<Name>        → { docs: [{ no, title, date, path }] }
//   GET /f1data/fia-pdf?path=/system/files/decision-document/….pdf
//
// Die FIA hat keine API; wir lesen die öffentliche Dokumentenliste (HTML).
// Die PDFs schickt fia.com als Download (Content-Disposition: attachment) —
// über uns kommen sie „inline“ und same-origin, damit pdf.js sie im Browser
// zeigen kann. Ändert die FIA ihr HTML, liefert die Liste nichts mehr.
// ====================================================================

const FIA = "https://www.fia.com";
const LIST = FIA + "/documents/championships/fia-formula-one-world-championship-14";
const UA = "Mozilla/5.0 (compatible; Rennticker/1.0; +https://philip-stack.pages.dev/f1/)";
const PDF_PATH = /^\/system\/files\/decision-document\/[^?#\\]+\.pdf$/i;

const decode = s => s.replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

// Saison-Kennung („season-2026-2072“) aus der Übersichtsseite
export function parseSeasonId(html, year) {
  const m = new RegExp(`season-${year}-(\\d+)`).exec(html);
  return m ? `season-${year}-${m[1]}` : null;
}

// Grand-Prix-Namen aus dem Event-Auswahlfeld der Saisonseite
export function parseEvents(html, seasonId) {
  const out = new Set();
  const re = new RegExp(`/${seasonId}/event/([^"]+)"`, "g");
  let m;
  while ((m = re.exec(html))) { try { out.add(decodeURIComponent(m[1])); } catch (_) {} }
  return [...out];
}

// Dokumentenliste: je <li class="document-row"> Link, Titel, Veröffentlichung
export function parseDocs(html) {
  const docs = [];
  for (const part of html.split(/<li class="document-row/).slice(1)) {
    const href = /href="([^"]+\.pdf)"/i.exec(part);
    const title = /field-name-title-field[\s\S]*?field-item[^>]*>([\s\S]*?)<\/div>/.exec(part);
    const date = /date-display-single[^>]*>([^<]+)</.exec(part);
    if (!href || !title) continue;
    let path = href[1];
    try { path = decodeURI(new URL(path, FIA).pathname); } catch (_) { continue; }
    if (!PDF_PATH.test(path)) continue;
    const t = decode(title[1].replace(/<[^>]+>/g, ""));
    const no = /^Doc\s+(\d+)\s*[-–]\s*/i.exec(t);
    // „04.10.26 15:55“ (MEZ/MESZ der FIA, so übernommen)
    const d = date && /(\d\d)\.(\d\d)\.(\d\d)\s+(\d\d):(\d\d)/.exec(date[1]);
    docs.push({
      no: no ? +no[1] : null,
      title: no ? t.slice(no[0].length) : t,
      date: d ? `20${d[3]}-${d[2]}-${d[1]}T${d[4]}:${d[5]}` : null,
      path,
    });
  }
  return docs;
}

const json = (data, status = 200, maxAge = 0) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": maxAge ? `public, max-age=${maxAge}` : "no-store" },
});
const page = async (url, ttl) => {
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "text/html" }, cf: { cacheTtl: ttl, cacheEverything: true } });
  if (!r.ok) throw new Error("fia " + r.status);
  return r.text();
};

export async function fiaList(search) {
  const q = new URLSearchParams(search);
  const year = q.get("year") || "", event = q.get("event");
  if (!/^20\d\d$/.test(year) || (event != null && !/^[\p{L}\p{N} .'\-]{2,80}$/u.test(event))) return json({ error: "bad request" }, 400);
  try {
    const seasonId = parseSeasonId(await page(LIST, 86400), year);
    if (!seasonId) return json({ events: [], docs: [] }, 200, 3600);
    const base = `${LIST}/season/${seasonId}`;
    if (event == null) return json({ events: parseEvents(await page(base, 3600), seasonId) }, 200, 3600);
    // Am Rennwochenende kommen laufend neue Dokumente → kurz cachen
    return json({ docs: parseDocs(await page(`${base}/event/${encodeURIComponent(event)}`, 120)) }, 200, 120);
  } catch (_) {
    return json({ error: "fia" }, 502);
  }
}

export async function fiaPdf(search) {
  const path = new URLSearchParams(search).get("path") || "";
  if (!PDF_PATH.test(path) || path.includes("..")) return new Response("bad request", { status: 400 });
  try {
    const r = await fetch(FIA + encodeURI(path), { headers: { "User-Agent": UA }, cf: { cacheTtl: 86400, cacheEverything: true } });
    if (!r.ok) return new Response("not found", { status: r.status === 404 ? 404 : 502 });
    const name = path.split("/").pop().replace(/[^\w.\-]+/g, "_");
    return new Response(r.body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${name}"`,
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (_) {
    return new Response("fetch failed", { status: 502 });
  }
}

// Für den Meldungs-Cron (/api/f1/cron): Dokumente eines Grand Prix nach Namen.
// match(events, name) wählt das passende FIA-Event (siehe api/f1/_logic.js).
export async function fiaDocsFor(year, name, match) {
  const seasonId = parseSeasonId(await page(LIST, 86400), year);
  if (!seasonId) return null;
  const base = `${LIST}/season/${seasonId}`;
  const event = match(parseEvents(await page(base, 3600), seasonId), name);
  if (!event) return null;
  return { event, docs: parseDocs(await page(`${base}/event/${encodeURIComponent(event)}`, 120)) };
}
