// ====================================================================
// Minimale, abhängigkeitsfreie WebAuthn-Helfer (nur ES256 / P-256).
// Bewusst ohne externe Library, weil das Projekt ohne Build-Schritt läuft.
// Nur die für Passkeys nötigen Bausteine: base64url, ein kleiner CBOR-Decoder,
// COSE→JWK, authenticatorData-Parser, DER→raw-Signatur und Assertion-Prüfung.
// Läuft in Workers UND in Node (nutzt nur globales WebCrypto/atob/btoa).
// ====================================================================

export function b64urlToBytes(str) {
  const s = String(str).replace(/-/g, "+").replace(/_/g, "/");
  const pad = "=".repeat((4 - s.length % 4) % 4);
  const bin = atob(s + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
export function bytesToB64url(u8) {
  let bin = "";
  for (let i = 0; i < u8.length; i++) bin += String.fromCharCode(u8[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function randomB64url(n = 32) {
  const a = new Uint8Array(n); crypto.getRandomValues(a); return bytesToB64url(a);
}
export async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

// --- Minimaler CBOR-Decoder (nur die von WebAuthn genutzten Typen) ---
function cborRead(buf, i) {
  const first = buf[i]; const major = first >> 5; const info = first & 0x1f; i++;
  let len = info;
  if (info === 24) { len = buf[i]; i += 1; }
  else if (info === 25) { len = (buf[i] << 8) | buf[i + 1]; i += 2; }
  else if (info === 26) { len = (buf[i] * 2 ** 24) + (buf[i + 1] << 16) + (buf[i + 2] << 8) + buf[i + 3]; i += 4; }
  else if (info === 27) { // 64-bit: für unsere Zwecke reicht Number
    len = 0; for (let k = 0; k < 8; k++) len = len * 256 + buf[i + k]; i += 8;
  }
  switch (major) {
    case 0: return [len, i];                          // unsigned int
    case 1: return [-1 - len, i];                     // negative int
    case 2: { const v = buf.slice(i, i + len); return [v, i + len]; }        // bytes
    case 3: { const v = new TextDecoder().decode(buf.slice(i, i + len)); return [v, i + len]; } // text
    case 4: { const arr = []; for (let k = 0; k < len; k++) { const [v, ni] = cborRead(buf, i); arr.push(v); i = ni; } return [arr, i]; }
    case 5: { const m = new Map(); for (let k = 0; k < len; k++) { const [key, ni] = cborRead(buf, i); const [val, ni2] = cborRead(buf, ni); m.set(key, val); i = ni2; } return [m, i]; }
    default: throw new Error("CBOR: nicht unterstützter Typ " + major);
  }
}
export function cborDecodeFirst(bytes) { return cborRead(bytes, 0)[0]; }

// COSE-EC2-Schlüssel (Map) → JWK (nur P-256/ES256)
export function coseToJwk(cose) {
  const kty = cose.get(1), alg = cose.get(3), crv = cose.get(-1);
  if (kty !== 2 || alg !== -7 || crv !== 1) throw new Error("Nur ES256/P-256 wird unterstützt");
  const x = cose.get(-2), y = cose.get(-3);
  if (!(x instanceof Uint8Array) || !(y instanceof Uint8Array)) throw new Error("Ungültiger COSE-Schlüssel");
  return { kty: "EC", crv: "P-256", x: bytesToB64url(x), y: bytesToB64url(y) };
}

// authenticatorData zerlegen (inkl. optionaler attestedCredentialData)
export function parseAuthData(ad) {
  const rpIdHash = ad.slice(0, 32);
  const flags = ad[32];
  const signCount = (ad[33] << 24) | (ad[34] << 16) | (ad[35] << 8) | ad[36];
  let credId = null, coseKey = null;
  if (flags & 0x40) { // AT: attestedCredentialData vorhanden
    const idLen = (ad[53] << 8) | ad[54];
    credId = ad.slice(55, 55 + idLen);
    const rest = ad.slice(55 + idLen);
    coseKey = cborDecodeFirst(rest);
  }
  return { rpIdHash, flags, signCount: signCount >>> 0, credId, coseKey };
}

// DER-ECDSA-Signatur → rohes r||s (64 Byte) für WebCrypto-verify
export function derToRaw(der) {
  let i = 0;
  if (der[i++] !== 0x30) throw new Error("DER: keine SEQUENCE");
  if (der[i] & 0x80) i += 1 + (der[i] & 0x7f); else i += 1;   // Länge überspringen
  const readInt = () => {
    if (der[i++] !== 0x02) throw new Error("DER: kein INTEGER");
    let len = der[i++]; let val = der.slice(i, i + len); i += len;
    while (val.length > 1 && val[0] === 0x00) val = val.slice(1);      // führende Null strippen
    const out = new Uint8Array(32);
    out.set(val.slice(-32), 32 - Math.min(32, val.length));            // links auf 32 auffüllen
    return out;
  };
  const r = readInt(), s = readInt();
  const raw = new Uint8Array(64); raw.set(r, 0); raw.set(s, 32);
  return raw;
}

// clientDataJSON (Bytes) → Objekt
export function parseClientData(bytes) {
  return JSON.parse(new TextDecoder().decode(bytes));
}

// Assertion prüfen: Signatur über authData || SHA256(clientDataJSON)
export async function verifyAssertion({ jwk, authData, clientDataJSON, signature }) {
  const cdHash = await sha256(clientDataJSON);
  const signed = new Uint8Array(authData.length + cdHash.length);
  signed.set(authData, 0); signed.set(cdHash, authData.length);
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  const raw = derToRaw(signature);
  return crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, raw, signed);
}
