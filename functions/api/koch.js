import { bumpStat, statToday } from "./stat.js";
import { json, rateLimit, clientIp, logError } from "./_util.js";

// ====================================================================
// Kochstudio-API: KI-Rezepte aus Kühlschrank-Zutaten + echte Websuche.
//
//   POST /api/koch  body: { ingredients, wishes? }
//   → { answer, links: [{title, url}] }
//
// - Rezepte generiert Cloudflare Workers AI (Binding AI, kostenloses
//   Tageskontingent — kein externer API-Schlüssel).
// - Links kommen aus einer echten DuckDuckGo-Suche ("Rezept <zutaten>");
//   schlägt die fehl, gibt es konstruierte Such-Links als Fallback.
// ====================================================================

// Sieht das aus wie ein Rezept? Absichtlich grob: es soll offensichtlichen
// Unsinn abfangen (leer, abgeschnitten, Entschuldigungstext), nicht den Stil
// bewerten. Zwei Rezepte mit Zutaten und Zubereitung ergeben immer deutlich
// mehr als 200 Zeichen und tragen die vorgegebenen Ueberschriften.
function istRezept(t) {
  if (typeof t !== "string") return false;
  const s = t.trim();
  if (s.length < 200) return false;
  return /zutaten/i.test(s) && /zubereitung/i.test(s);
}

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MODEL_FALLBACK = "@cf/meta/llama-3.1-8b-instruct-fp8";   // Vorgaenger seit 2026-05-30 abgekuendigt

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#x27;|&#39;/g, "'").replace(/&nbsp;/g, " ");
}

// DuckDuckGo-HTML-Suche: liefert [{title, url}] der ersten Treffer
async function webSearch(query, max = 6) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 5000);
  try {
    const res = await fetch("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query), {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
        "Accept-Language": "de-AT,de;q=0.9",
      },
      signal: ctl.signal,
    });
    if (!res.ok) return [];
    const html = await res.text();
    const out = [];
    const re = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
    let m;
    while ((m = re.exec(html)) && out.length < max) {
      let url = m[1];
      // DDG verlinkt über einen Redirect (uddg-Parameter) → echte URL holen
      const uddg = url.match(/[?&]uddg=([^&]+)/);
      if (uddg) url = decodeURIComponent(uddg[1]);
      else if (url.startsWith("//")) url = "https:" + url;
      if (!/^https?:\/\//.test(url)) continue;
      const title = decodeEntities(m[2].replace(/<[^>]+>/g, "").trim()).slice(0, 120);
      if (title && !out.some(l => l.url === url)) out.push({ title, url });
    }
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// Fallback/Ergänzung: direkte Such-Links auf bekannte Rezeptseiten
function searchLinks(ings) {
  const q = ings.split(/[,;\n]/).map(s => s.trim()).filter(Boolean).slice(0, 5).join(" ");
  return [
    { title: `Chefkoch-Suche: ${q}`, url: "https://www.chefkoch.de/rs/s0/" + encodeURIComponent(q).replace(/%20/g, "+") + "/Rezepte.html" },
    { title: `GuteKueche.at-Suche: ${q}`, url: "https://www.gutekueche.at/rezepte?search=" + encodeURIComponent(q) },
  ];
}

// Modell-Aufrufe pro Tag (ai:koch zählt jeden Versuch, auch den Fallback).
const KOCH_DAY_MAX = 25;

export async function onRequestPost({ request, env }) {
  if (!env.AI) return json({ error: "KI ist auf diesem Deployment nicht verfügbar" }, 503);

  // Rate-Limit: dieser Endpunkt verbrennt AI-Kontingent + externen Scrape pro
  // Aufruf. Höchstens 6 Anfragen/Minute pro Client-IP, sonst Kosten-DoS möglich.
  if (!(await rateLimit(env, `koch:${clientIp(request)}`, 6, 60))) {
    return json({ error: "Zu viele Anfragen — kurz warten" }, 429);
  }

  // Tagesdeckel über ALLE Besucher: das Gratis-Kontingent von Workers AI teilen
  // sich Kochstudio, Briefing und die Sprit-Freitextsuche. Ein Rezept auf dem
  // großen Modell kostet ein Vielfaches einer Suche — ohne Deckel konnte ein
  // einzelner Besucher (6/min) den ganzen Tag für alle verbrauchen.
  if ((await statToday(env, "ai:koch")) >= KOCH_DAY_MAX) {
    return json({ error: "Die Küche hat für heute Feierabend — morgen kocht sie wieder" }, 429);
  }

  const b = await request.json().catch(() => ({}));
  const ings = String(b.ingredients || "").trim().slice(0, 400);
  const wishes = String(b.wishes || "").trim().slice(0, 200);
  if (ings.length < 3) return json({ error: "Sag mir zuerst, was im Kühlschrank ist" }, 400);

  // 1) Echte Websuche nach passenden Rezepten (parallel zur KI wäre schöner,
  //    aber die Treffer fließen als Kontext in den Prompt ein)
  const found = await webSearch(`Rezept ${ings.split(/[,;\n]/).slice(0, 4).join(" ")}`);
  const links = [...found, ...searchLinks(ings)].slice(0, 8);

  // 2) Rezepte von Workers AI generieren lassen
  const system = `Du bist ein herzlicher österreichischer Kochprofi. Der Nutzer sagt dir, was er im Kühlschrank/Vorrat hat.
Antworte auf Deutsch, im Markdown-Format, und schlage GENAU ZWEI Rezepte vor, die mit den genannten Zutaten realistisch kochbar sind.
Grundzutaten (Salz, Pfeffer, Öl, Butter, Mehl, Zucker, Gewürze, Wasser) darfst du voraussetzen — andere fehlende Zutaten höchstens als "optional" erwähnen.
Für jedes Rezept:
## <Emoji> <Name>
*Dauer: … min · Schwierigkeit: …*
**Zutaten:** Liste mit Mengen für 2 Portionen
**Zubereitung:** nummerierte Schritte, präzise und anfängertauglich (Hitze, Zeiten, Konsistenz-Hinweise)
**Tipp:** ein kurzer Profi-Tipp
Sei konkret, keine Floskeln. Erfinde keine Zutaten, die nicht genannt oder Grundzutaten sind.`;

  const userMsg = `Im Kühlschrank/Vorrat: ${ings}${wishes ? `\nWünsche: ${wishes}` : ""}${
    found.length ? `\n\nZur Inspiration — diese Rezepte gibt es online (nur als Ideengeber, nicht abschreiben):\n${found.map(l => "- " + l.title).join("\n")}` : ""}`;

  const messages = [
    { role: "system", content: system },
    { role: "user", content: userMsg },
  ];

  // Die Antwort wird GEPRUEFT, nicht geglaubt — wie beim Briefing und bei der
  // Freitext-Suche. Zwei Gruende, beide real:
  //  • env.AI.run liefert je nach Modell/Laufzeit auch OBJEKTE statt Text.
  //    Der Client ruft answer.match(...) auf — bei einem Objekt bricht die
  //    Seite ab, statt sauber "hat nicht geklappt" zu zeigen.
  //  • Ein halber oder leerer Text ist kein Rezept. Lieber ehrlich melden.
  let answer = null, letzte = null;
  for (const modell of [MODEL, MODEL_FALLBACK]) {
    try {
      await bumpStat(env, "ai:koch");
      const res = await env.AI.run(modell, { messages, max_tokens: modell === MODEL ? 1400 : 1200 });
      const roh = res && res.response;
      letzte = roh;
      if (typeof roh === "string" && istRezept(roh)) { answer = roh; break; }
      await logError(env, "koch: Antwort taugt nicht", "koch",
        (typeof roh === "string" ? roh.slice(0, 160) : "kein Text: " + typeof roh));
    } catch (e) {
      await logError(env, "koch: Modell wirft", "koch", String((e && e.message) || e).slice(0, 160));
    }
  }
  if (!answer) {
    return json({ error: "Die Küchen-KI liefert gerade nichts Brauchbares — probier es gleich nochmal", links }, 503);
  }

  return json({ answer, links });
}
