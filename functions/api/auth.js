import { json, clientIp, rateLimit } from "./_util.js";
import {
  b64urlToBytes, randomB64url, coseToJwk, parseAuthData,
  parseClientData, verifyAssertion, cborDecodeFirst,
} from "./_webauthn.js";

// ====================================================================
// Passkeys (WebAuthn) als bequemer, robuster Login für den Cloud-Speicher.
// Ein Passkey wird an einen bestehenden Cloud-Code gebunden; beim Login per
// Face ID / Fingerabdruck liefert der Server die Spielstände zurück — ohne
// Code-Tippen. Der Code-Login bleibt als Fallback erhalten.
//
//   POST /api/auth {action:"register-start", name?}          → { chalId, options }
//   POST /api/auth {action:"register-finish", chalId, code, name?, credential}
//   POST /api/auth {action:"login-start"}                    → { chalId, options }
//   POST /api/auth {action:"login-finish", chalId, credential}  → { code, data, updated_at }
//
// Nur ES256/P-256, Attestation "none" (Geräte-Provenienz ist hier egal).
// ====================================================================

const CODE_RE = /^[A-Z0-9]{6,12}$/;
const CHAL_MAX_AGE_S = 300;

async function takeChallenge(env, chalId) {
  if (!chalId) return null;
  const row = await env.DB.prepare("SELECT challenge, created_at FROM webauthn_chal WHERE chal_id = ?").bind(chalId).first();
  if (!row) return null;
  await env.DB.prepare("DELETE FROM webauthn_chal WHERE chal_id = ?").bind(chalId).run();
  // Alter prüfen (Server-Zeit ist UTC)
  const age = (Date.now() - new Date(row.created_at.replace(" ", "T") + "Z").getTime()) / 1000;
  if (!(age >= 0) || age > CHAL_MAX_AGE_S) return null;
  return row.challenge;
}
async function newChallenge(env) {
  const chalId = randomB64url(16), challenge = randomB64url(32);
  await env.DB.prepare("INSERT INTO webauthn_chal (chal_id, challenge) VALUES (?, ?)").bind(chalId, challenge).run();
  // gelegentlich aufräumen
  await env.DB.prepare("DELETE FROM webauthn_chal WHERE created_at < datetime('now', '-1 hour')").run();
  return { chalId, challenge };
}

export async function onRequestPost({ request, env }) {
  if (!(await rateLimit(env, "auth:" + clientIp(request), 40, 60))) {
    return json({ error: "Zu viele Anfragen — kurz warten" }, 429);
  }
  const url = new URL(request.url);
  const rpId = url.hostname;
  const origin = url.origin;
  const b = await request.json().catch(() => ({}));
  const action = String(b.action || "");

  if (action === "register-start") {
    const { chalId, challenge } = await newChallenge(env);
    const name = String(b.name || "Spieler:in").trim().slice(0, 32) || "Spieler:in";
    return json({
      chalId,
      options: {
        challenge,
        rp: { id: rpId, name: "Spieleabend" },
        user: { id: randomB64url(16), name, displayName: name },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }],
        authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
        timeout: 60000,
        attestation: "none",
      },
    });
  }

  if (action === "register-finish") {
    const challenge = await takeChallenge(env, b.chalId);
    if (!challenge) return json({ error: "Sitzung abgelaufen — erneut versuchen" }, 400);
    const code = String(b.code || "").trim().toUpperCase();
    if (!CODE_RE.test(code)) return json({ error: "Kein gültiger Cloud-Code" }, 400);
    const cred = b.credential || {};
    let clientData;
    try { clientData = parseClientData(b64urlToBytes(cred.clientDataJSON)); } catch { return json({ error: "Ungültige Anmeldedaten" }, 400); }
    if (clientData.type !== "webauthn.create") return json({ error: "Falscher Typ" }, 400);
    if (clientData.challenge !== challenge) return json({ error: "Challenge stimmt nicht" }, 400);
    if (clientData.origin !== origin) return json({ error: "Falsche Herkunft" }, 400);

    let jwk, signCount, credIdB64 = String(cred.id || "");
    try {
      const att = cborDecodeFirst(b64urlToBytes(cred.attestationObject));
      const authData = att.get("authData");
      const parsed = parseAuthData(authData);
      if (!parsed.coseKey) return json({ error: "Kein Schlüssel im Passkey" }, 400);
      jwk = coseToJwk(parsed.coseKey);
      signCount = parsed.signCount;
    } catch { return json({ error: "Passkey konnte nicht gelesen werden" }, 400); }
    if (!credIdB64) return json({ error: "Credential-ID fehlt" }, 400);

    const name = String(b.name || "").trim().slice(0, 16) || null;
    await env.DB.prepare(
      `INSERT INTO webauthn_cred (cred_id, pubkey_jwk, sign_count, code, name) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(cred_id) DO UPDATE SET pubkey_jwk = excluded.pubkey_jwk, sign_count = excluded.sign_count, code = excluded.code, name = excluded.name`
    ).bind(credIdB64, JSON.stringify(jwk), signCount, code, name).run();
    return json({ ok: true });
  }

  if (action === "login-start") {
    const { chalId, challenge } = await newChallenge(env);
    return json({
      chalId,
      options: { challenge, rpId, userVerification: "preferred", timeout: 60000, allowCredentials: [] },
    });
  }

  if (action === "login-finish") {
    const challenge = await takeChallenge(env, b.chalId);
    if (!challenge) return json({ error: "Sitzung abgelaufen — erneut versuchen" }, 400);
    const cred = b.credential || {};
    const credIdB64 = String(cred.id || "");
    const row = await env.DB.prepare("SELECT pubkey_jwk, sign_count, code, name FROM webauthn_cred WHERE cred_id = ?").bind(credIdB64).first();
    if (!row) return json({ error: "Unbekannter Passkey" }, 404);

    let clientData;
    try { clientData = parseClientData(b64urlToBytes(cred.clientDataJSON)); } catch { return json({ error: "Ungültige Anmeldedaten" }, 400); }
    if (clientData.type !== "webauthn.get") return json({ error: "Falscher Typ" }, 400);
    if (clientData.challenge !== challenge) return json({ error: "Challenge stimmt nicht" }, 400);
    if (clientData.origin !== origin) return json({ error: "Falsche Herkunft" }, 400);

    let valid = false, newCount = 0;
    try {
      const authData = b64urlToBytes(cred.authenticatorData);
      newCount = ((authData[33] << 24) | (authData[34] << 16) | (authData[35] << 8) | authData[36]) >>> 0;
      valid = await verifyAssertion({
        jwk: JSON.parse(row.pubkey_jwk),
        authData,
        clientDataJSON: b64urlToBytes(cred.clientDataJSON),
        signature: b64urlToBytes(cred.signature),
      });
    } catch { valid = false; }
    if (!valid) return json({ error: "Passkey-Signatur ungültig" }, 401);

    // Replay-/Klon-Schutz: Zähler muss steigen (falls der Authenticator ihn führt)
    if (newCount > 0 && row.sign_count > 0 && newCount <= row.sign_count) {
      return json({ error: "Passkey-Zähler ungültig (möglicher Klon)" }, 401);
    }
    await env.DB.prepare("UPDATE webauthn_cred SET sign_count = ? WHERE cred_id = ?").bind(Math.max(newCount, row.sign_count), credIdB64).run();

    // Cloud-Spielstände des verknüpften Codes zurückgeben
    const save = await env.DB.prepare("SELECT data, updated_at FROM cloud_saves WHERE code = ?").bind(row.code).first();
    return json({ ok: true, code: row.code, name: row.name, data: save ? save.data : null, updated_at: save ? save.updated_at : null });
  }

  return json({ error: "Unbekannte Aktion" }, 400);
}
