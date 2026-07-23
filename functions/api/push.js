import { json, clientIp, rateLimit } from "./_util.js";

// ====================================================================
// Web-Push (VAPID). Bewusst OHNE verschlüsselte Payload: wir senden einen
// „Tickle"-Push (nur VAPID-Auth, kein Body). Der Service Worker holt dann
// die eigentlichen Nachrichten aus einer serverseitigen Warteschlange
// (push_queue, nach Endpoint), zeigt sie an und löscht sie. Das vermeidet
// die fehleranfällige aes128gcm-Verschlüsselung und bleibt voll funktional.
//
//   GET  /api/push                         → { key }  (VAPID-Public-Key)
//   POST /api/push {action:"subscribe", subscription, name?, device?}
//   POST /api/push {action:"unsubscribe", endpoint}
//   POST /api/push {action:"test", endpoint}          → Test-Benachrichtigung
//   POST /api/push {action:"pending", endpoint}       → vom SW: Nachrichten holen
//
// sendToName(env, name, {title,body,url}) verschickt an alle Abos eines Namens.
// ====================================================================

// Öffentlicher VAPID-Key (darf im Client stehen). Der private liegt als
// Pages-Secret VAPID_PRIVATE_JWK und verlässt den Server nie.
export const VAPID_PUBLIC = "BAIqSwEe8nr4OCdaYNvsJ1NGhYa_ewRj_J1IBRH0YuiKC9j5SqBhT1qH7cGSI494UMyHR-Wv0yLCykF58zw-GQI";
const CONTACT = "mailto:philip.stix@workheld.com";
const DEV_RE = /^[A-Za-z0-9_-]{8,40}$/;

const b64urlBytes = u8 => btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlStr = str => b64urlBytes(new TextEncoder().encode(str));

// VAPID-JWT (ES256) signieren. WebCrypto liefert die Signatur bereits als
// rohes r||s (64 Byte) — genau das JOSE-ES256-Format.
async function vapidJWT(env, audience) {
  const jwk = JSON.parse(env.VAPID_PRIVATE_JWK);
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64urlStr(JSON.stringify({ typ: "JWT", alg: "ES256" })) + "." +
    b64urlStr(JSON.stringify({ aud: audience, exp: now + 12 * 3600, sub: CONTACT }));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsigned));
  return unsigned + "." + b64urlBytes(new Uint8Array(sig));
}

// „Tickle"-Push: nur VAPID-Auth, kein Body → weckt den SW.
async function tickle(env, endpoint) {
  const jwt = await vapidJWT(env, new URL(endpoint).origin);
  return fetch(endpoint, {
    method: "POST",
    headers: { "Authorization": `vapid t=${jwt}, k=${VAPID_PUBLIC}`, "TTL": "86400" },
  });
}

// Abgelaufene Abos (404/410) aufräumen.
async function dropSub(env, endpoint) {
  await env.DB.prepare("DELETE FROM push_sub WHERE endpoint = ?").bind(endpoint).run();
  await env.DB.prepare("DELETE FROM push_queue WHERE endpoint = ?").bind(endpoint).run();
}

// Nachricht an alle Abos eines Namens: erst in die Queue, dann Tickle.
// Vollständig fehlertolerant — darf nie den aufrufenden Pfad stören.
export async function sendToName(env, name, msg) {
  try {
    if (!name || !env.VAPID_PRIVATE_JWK) return;
    const subs = (await env.DB.prepare("SELECT endpoint FROM push_sub WHERE LOWER(name) = LOWER(?)").bind(name).all()).results;
    for (const s of subs) {
      try {
        await env.DB.prepare("INSERT INTO push_queue (endpoint, title, body, url) VALUES (?, ?, ?, ?)")
          .bind(s.endpoint, msg.title, msg.body || "", msg.url || "/").run();
        const res = await tickle(env, s.endpoint);
        if (res.status === 404 || res.status === 410) await dropSub(env, s.endpoint);
      } catch { /* einzelnes Abo darf den Rest nicht stoppen */ }
    }
  } catch { /* nie werfen */ }
}

export async function onRequestGet() {
  return json({ key: VAPID_PUBLIC });
}

export async function onRequestPost({ request, env }) {
  if (!(await rateLimit(env, "push:" + clientIp(request), 60, 60))) {
    return json({ error: "Zu viele Anfragen — kurz warten" }, 429);
  }
  const b = await request.json().catch(() => ({}));
  const action = String(b.action || "");

  if (action === "subscribe") {
    const sub = b.subscription || {};
    const endpoint = String(sub.endpoint || "");
    if (!/^https:\/\//.test(endpoint) || endpoint.length > 800) return json({ error: "Ungültiges Abo" }, 400);
    const name = String(b.name || "").trim().slice(0, 16) || null;
    const device = DEV_RE.test(String(b.device || "")) ? String(b.device) : null;
    const p256dh = sub.keys && sub.keys.p256dh ? String(sub.keys.p256dh).slice(0, 200) : null;
    const auth = sub.keys && sub.keys.auth ? String(sub.keys.auth).slice(0, 100) : null;
    await env.DB.prepare(
      `INSERT INTO push_sub (endpoint, name, p256dh, auth, device) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET name = excluded.name, p256dh = excluded.p256dh, auth = excluded.auth, device = excluded.device`
    ).bind(endpoint, name, p256dh, auth, device).run();
    return json({ ok: true });
  }

  if (action === "unsubscribe") {
    await dropSub(env, String(b.endpoint || ""));
    return json({ ok: true });
  }

  if (action === "test") {
    const endpoint = String(b.endpoint || "");
    const found = await env.DB.prepare("SELECT 1 FROM push_sub WHERE endpoint = ?").bind(endpoint).first();
    if (!found) return json({ error: "Kein Abo gefunden — erst aktivieren" }, 404);
    await env.DB.prepare("INSERT INTO push_queue (endpoint, title, body, url) VALUES (?, ?, ?, ?)")
      .bind(endpoint, "🎲 Spieleabend", "Push funktioniert! Du bekommst ab jetzt Neuigkeiten.", "/").run();
    let status = 0;
    try { status = (await tickle(env, endpoint)).status; } catch {}
    if (status === 404 || status === 410) { await dropSub(env, endpoint); return json({ error: "Abo abgelaufen — bitte neu aktivieren" }, 410); }
    return json({ ok: true, status });
  }

  if (action === "pending") {
    // Vom Service Worker aufgerufen: Nachrichten dieses Abos holen & löschen.
    const endpoint = String(b.endpoint || "");
    if (!endpoint) return json({ messages: [] });
    const msgs = (await env.DB.prepare("SELECT id, title, body, url FROM push_queue WHERE endpoint = ? ORDER BY id ASC LIMIT 10").bind(endpoint).all()).results;
    if (msgs.length) {
      const ids = msgs.map(m => m.id);
      await env.DB.prepare(`DELETE FROM push_queue WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).run();
    }
    return json({ messages: msgs.map(m => ({ title: m.title, body: m.body, url: m.url })) });
  }

  return json({ error: "Unbekannte Aktion" }, 400);
}
