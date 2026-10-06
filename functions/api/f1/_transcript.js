// ====================================================================
// Rennticker — Boxenfunk-Abschrift: reine Helfer (ohne Netz/DB, getestet in
// tests/f1.test.mjs). Der Endpunkt liegt in transcript.js.
// ====================================================================

// Whisper bekommt einen Kontext-Satz: Fachbegriffe und Namen, die sonst
// gern falsch verstanden werden („box box“ → „books books“).
export function whisperPrompt(who) {
  const name = typeof who === "string" && /^[A-Za-zÀ-ž' .-]{2,40}$/.test(who) ? who + ". " : "";
  return `Formula 1 team radio between the driver and the race engineer. ${name}Box, box. Box this lap. Stay out. DRS, Safety Car, VSC, undercut, overcut, deg, inters, softs, mediums, hards, Plan A, Plan B, push now, copy, understood, P1, gap, turn 1, pit lane.`;
}

// Whisper-Antwort → [{ s, e, t }] (Start/Ende in Sekunden, Text). Stille und
// typische Halluzinationen auf Rauschen fliegen raus.
const NOISE = /^(thank you\.?|thanks for watching\.?|you|\.+|bye\.?)$/i;
export function segmentsOf(res) {
  const raw = Array.isArray(res && res.segments) ? res.segments : [];
  let segs = raw
    .filter(x => x && typeof x.text === "string" && !(x.no_speech_prob > 0.85))
    .map(x => ({ s: +(+x.start || 0).toFixed(2), e: +(+x.end || 0).toFixed(2), t: x.text.trim() }))
    .filter(x => x.t && !NOISE.test(x.t));
  if (!segs.length && res && typeof res.text === "string" && res.text.trim() && !NOISE.test(res.text.trim())) {
    segs = [{ s: 0, e: 0, t: res.text.trim() }];
  }
  return segs.slice(0, 40).map(x => ({ ...x, t: x.t.slice(0, 400) }));
}

// Übersetzung: nummerierte Zeilen rein, gleich viele nummerierte Zeilen raus.
export const TRANSLATE_SYSTEM = "Du übersetzt Formel-1-Boxenfunk vom Englischen ins Deutsche, locker und kurz wie TV-Untertitel, österreichisches Deutsch. " +
  "Fachbegriffe bleiben: Box, DRS, Safety Car, VSC, Undercut, Overcut, Soft, Medium, Hard, Inters, Plan A/B, P1 usw. " +
  "Antworte NUR mit den übersetzten Zeilen, genau so viele wie im Original, jede beginnt mit ihrer Nummer und einem senkrechten Strich, z. B. „1| Box, box.“";
export function translateInput(segs) {
  return segs.map((x, i) => `${i + 1}| ${x.t}`).join("\n");
}
// → Array gleicher Länge wie segs, oder null wenn die Antwort nicht passt
export function parseTranslation(raw, n) {
  if (typeof raw !== "string") return null;
  const out = new Array(n).fill(null);
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*(\d{1,2})\s*[|:.)]\s*(.+?)\s*$/.exec(line);
    if (m && +m[1] >= 1 && +m[1] <= n && !out[+m[1] - 1]) out[+m[1] - 1] = m[2].replace(/^["„“]|["“”]$/g, "").slice(0, 400);
  }
  return out.every(Boolean) ? out : null;
}

export function toBase64(buf) {
  const b = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  return btoa(s);
}
