// WebAuthn-Krypto (functions/api/_webauthn.js) mit selbst erzeugten Vektoren:
// echter P-256-Schlüssel, konstruierte authenticatorData + clientDataJSON,
// echte Signatur → prüft den sicherheitskritischen Verify-Pfad OHNE Browser-
// Authenticator. Plus CBOR/COSE/DER-Bausteine und Manipulations-Ablehnung.
import { fileURLToPath } from "node:url";
import path from "node:path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const w = await import("file://" + path.join(__dirname, "..", "functions", "api", "_webauthn.js").replace(/\\/g, "/"));

let ok = true;
const assert = (name, cond) => { if (cond) console.log("OK  ", name); else { console.log("FAIL", name); ok = false; } };

// --- kleine CBOR-Encoder-Helfer (nur für den Test, um Eingaben zu bauen) ---
const bytes = (...a) => Uint8Array.from(a);
const concat = arrs => { const n = arrs.reduce((s, a) => s + a.length, 0); const o = new Uint8Array(n); let i = 0; for (const a of arrs) { o.set(a, i); i += a.length; } return o; };
const encInt = k => k >= 0 ? bytes(k) : bytes(0x20 | (-1 - k));           // nur kleine Werte
const encBytes32 = u8 => concat([bytes(0x58, 0x20), u8]);                  // major2, Länge 32
function encCose(x, y) {
  return concat([
    bytes(0xA5),                        // Map mit 5 Einträgen
    encInt(1), encInt(2),               // kty = EC2
    encInt(3), encInt(-7),              // alg = ES256
    encInt(-1), encInt(1),              // crv = P-256
    encInt(-2), encBytes32(x),          // x
    encInt(-3), encBytes32(y),          // y
  ]);
}
function rawToDer(raw) {
  const trim = b => { let i = 0; while (i < b.length - 1 && b[i] === 0) i++; b = b.slice(i); return (b[0] & 0x80) ? concat([bytes(0), b]) : b; };
  const R = trim(raw.slice(0, 32)), S = trim(raw.slice(32));
  const body = concat([bytes(0x02, R.length), R, bytes(0x02, S.length), S]);
  return concat([bytes(0x30, body.length), body]);
}
const enc = new TextEncoder();

// --- CBOR/COSE-Decoder gegen selbst gebaute Bytes ---
const x = new Uint8Array(32).fill(9), y = new Uint8Array(32).fill(7);
const cose = w.cborDecodeFirst(encCose(x, y));
assert("CBOR: COSE-Map dekodiert", cose instanceof Map && cose.get(1) === 2 && cose.get(3) === -7);
const jwk0 = w.coseToJwk(cose);
assert("COSE→JWK: x/y korrekt", jwk0.crv === "P-256" && w.b64urlToBytes(jwk0.x)[0] === 9 && w.b64urlToBytes(jwk0.y)[5] === 7);

// --- authData mit attestedCredentialData bauen & parsen ---
const credId = new Uint8Array(16).fill(3);
const authDataReg = concat([
  new Uint8Array(32),                    // rpIdHash
  bytes(0x45),                           // flags: UP|UV|AT
  bytes(0, 0, 0, 1),                     // signCount = 1
  new Uint8Array(16),                    // aaguid
  bytes(0, 16),                          // credIdLen = 16
  credId,
  encCose(x, y),
]);
const parsed = w.parseAuthData(authDataReg);
assert("parseAuthData: credId & Zähler", parsed.credId.length === 16 && parsed.signCount === 1 && !!parsed.coseKey);

// --- echter Schlüssel: Registrierung (Key-Extraktion) → Assertion verifizieren ---
const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const jpub = await crypto.subtle.exportKey("jwk", kp.publicKey);
const xB = w.b64urlToBytes(jpub.x), yB = w.b64urlToBytes(jpub.y);

// authData aus einem "echten" COSE-Key bauen, per parseAuthData → coseToJwk zurückgewinnen
const authDataReal = concat([new Uint8Array(32), bytes(0x45), bytes(0, 0, 0, 2), new Uint8Array(16), bytes(0, credId.length), credId, encCose(xB, yB)]);
const jwkBack = w.coseToJwk(w.parseAuthData(authDataReal).coseKey);
assert("Registrierung: JWK aus authData rückgewinnbar", jwkBack.x === jpub.x && jwkBack.y === jpub.y);

// Assertion: authenticatorData (37 B) + clientDataJSON signieren
const authAssert = concat([new Uint8Array(32), bytes(0x05), bytes(0, 0, 0, 3)]);
const clientDataJSON = enc.encode(JSON.stringify({ type: "webauthn.get", challenge: "abc", origin: "https://x" }));
const cdHash = new Uint8Array(await crypto.subtle.digest("SHA-256", clientDataJSON));
const signed = concat([authAssert, cdHash]);
const rawSig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, kp.privateKey, signed));
const derSig = rawToDer(rawSig);

// DER→raw Round-Trip
assert("derToRaw: Round-Trip", w.derToRaw(derSig).every((v, i) => v === rawSig[i]));

// Gültige Assertion wird akzeptiert
let good = await w.verifyAssertion({ jwk: jwkBack, authData: authAssert, clientDataJSON, signature: derSig });
assert("verifyAssertion: gültige Signatur akzeptiert", good === true);

// Manipulierte authData wird abgelehnt
const tampered = authAssert.slice(); tampered[0] = 0xFF;
let bad1 = await w.verifyAssertion({ jwk: jwkBack, authData: tampered, clientDataJSON, signature: derSig });
assert("verifyAssertion: manipulierte authData abgelehnt", bad1 === false);

// Manipulierte Signatur wird abgelehnt
const badSig = derSig.slice(); badSig[badSig.length - 1] ^= 0x01;
let bad2 = false; try { bad2 = await w.verifyAssertion({ jwk: jwkBack, authData: authAssert, clientDataJSON, signature: badSig }); } catch { bad2 = false; }
assert("verifyAssertion: manipulierte Signatur abgelehnt", bad2 === false);

// Fremder Schlüssel wird abgelehnt
const kp2 = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const j2 = await crypto.subtle.exportKey("jwk", kp2.publicKey);
let bad3 = await w.verifyAssertion({ jwk: { kty: "EC", crv: "P-256", x: j2.x, y: j2.y }, authData: authAssert, clientDataJSON, signature: derSig });
assert("verifyAssertion: fremder Schlüssel abgelehnt", bad3 === false);

console.log("\n" + (ok ? "WEBAUTHN-TESTS OK" : "WEBAUTHN-TESTS FEHLGESCHLAGEN"));
process.exit(ok ? 0 : 1);
