import { json, clientIp, rateLimit, logError } from "../_util.js";
import { radioSource, RADIO_UA } from "../../f1data/[ep].js";
import { whisperPrompt, segmentsOf, TRANSLATE_SYSTEM, translateInput, parseTranslation, toBase64 } from "./_transcript.js";

// ====================================================================
// Rennticker — Abschrift eines Boxenfunk-Clips (wie die TV-Einblendung).
//   GET /api/f1/transcript?file=VER_3_…mp3&(path=…|year=…&session_key=…)[&who=Max Verstappen]
//     → { segs: [{ s, e, t, d }], via: "cache"|"ki" }   t = Englisch, d = Deutsch
//
// Jeder Clip wird genau EINMAL abgeschrieben (Whisper) und übersetzt (Llama)
// und dann in f1_transcript gespeichert — der Dateiname enthält Fahrer, Datum
// und Uhrzeit und ist damit eindeutig. Kosten nur beim ersten Anhören.
// Schutz vor Kosten-DoS: Drossel je IP und Tagesobergrenze für neue Clips.
// ====================================================================
const WHISPER = "@cf/openai/whisper-large-v3-turbo";
const LLM = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MAX_BYTES = 2 * 1024 * 1024;   // ein Clip hat 50–400 KB
const DAY_CAP = 400;                 // neue Abschriften je 24 h (alle Nutzer)

async function translate(env, segs) {
  if (!segs.length) return [];
  try {
    const res = await env.AI.run(LLM, { messages: [{ role: "system", content: TRANSLATE_SYSTEM }, { role: "user", content: translateInput(segs) }], max_tokens: 600 });
    return parseTranslation(res && res.response, segs.length);
  } catch (e) {
    await logError(env, "F1-Funk: Übersetzung fehlgeschlagen", "f1-radio", e && e.message);
    return null;
  }
}
async function save(env, file, segs) {
  try {
    await env.DB.prepare("INSERT INTO f1_transcript (file, segs) VALUES (?, ?) ON CONFLICT(file) DO UPDATE SET segs = excluded.segs")
      .bind(file, JSON.stringify(segs)).run();
  } catch (e) { await logError(env, "F1-Funk: Speichern fehlgeschlagen", "f1-radio", e && e.message); }
}

export async function onRequestGet({ request, env }) {
  const search = new URL(request.url).search;
  const file = new URLSearchParams(search).get("file") || "";
  // 1. Schon abgeschrieben?
  let row = null;
  try { row = await env.DB.prepare("SELECT segs FROM f1_transcript WHERE file = ?").bind(file).first(); } catch (_) { row = null; }
  if (row) {
    let segs = [];
    try { segs = JSON.parse(row.segs) || []; } catch (_) { segs = []; }
    // Übersetzung damals ausgefallen → jetzt nachholen (billig, nur Text)
    if (env.AI && segs.length && segs.some(x => !x.d)) {
      const de = await translate(env, segs);
      if (de) { segs = segs.map((x, i) => ({ ...x, d: de[i] })); await save(env, file, segs); }
    }
    return json({ segs, via: "cache" });
  }
  if (!env.AI) return json({ error: "KI ist auf diesem Deployment nicht verfügbar" }, 503);

  // 2. Neu: erst prüfen, dann drosseln, dann Kosten
  let src;
  try { src = await radioSource(search); } catch (_) { src = { status: 502 }; }
  if (!src.url) return json({ error: src.status === 400 ? "ungültiger Clip" : "Clip nicht gefunden" }, src.status || 502);
  if (!(await rateLimit(env, `f1tr:${clientIp(request)}`, 15, 60))) return json({ error: "Zu viele Anfragen – kurz warten" }, 429);
  try {
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM f1_transcript WHERE at > datetime('now', '-1 day')").first();
    if (n && n.n >= DAY_CAP) return json({ error: "Tageskontingent für Abschriften aufgebraucht" }, 429);
  } catch (_) { /* Zähler kaputt → nicht blockieren */ }

  let buf;
  try {
    const r = await fetch(src.url, { headers: { "User-Agent": RADIO_UA }, cf: { cacheTtl: 86400, cacheEverything: true } });
    if (!r.ok) return json({ error: "Clip nicht gefunden" }, r.status === 404 ? 404 : 502);
    buf = await r.arrayBuffer();
  } catch (_) { return json({ error: "Clip nicht erreichbar" }, 502); }
  if (!buf.byteLength || buf.byteLength > MAX_BYTES) return json({ error: "Clip zu groß" }, 413);

  let segs;
  try {
    const res = await env.AI.run(WHISPER, { audio: toBase64(buf), task: "transcribe", language: "en", vad_filter: true,
      initial_prompt: whisperPrompt(new URLSearchParams(search).get("who")) });
    segs = segmentsOf(res);
  } catch (e) {
    await logError(env, "F1-Funk: Abschrift fehlgeschlagen", "f1-radio", e && e.message);
    return json({ error: "Abschrift gerade nicht möglich" }, 502);
  }
  const de = await translate(env, segs);
  if (de) segs = segs.map((x, i) => ({ ...x, d: de[i] }));
  await save(env, src.file, segs);
  return json({ segs, via: "ki" });
}
