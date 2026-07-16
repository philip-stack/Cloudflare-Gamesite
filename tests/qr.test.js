// QR-Encoder-Tests: prüft Format-/Versions-BCH gegen die ISO-Tabelle
// und die grundlegende Matrix-Struktur (Finder, Timing).
const path = require("path");
const QR = require(path.join(__dirname, "..", "public", "qr.js"));

let ok = true;
const eq = (name, got, exp) => {
  const g = got.toString(2).padStart(exp.length, "0");
  if (g !== exp) { console.log("FAIL", name, "got", g, "exp", exp); ok = false; }
  else console.log("OK  ", name);
};

const fmtM = ["101010000010010", "101000100100101", "101111001111100", "101101101001011",
  "100010111111001", "100000011001110", "100111110010111", "100101010100000"];
fmtM.forEach((s, i) => eq("Formatinfo M Maske " + i, QR._formatBits(i), s));

const verKnown = { 7: 0x07C94, 8: 0x085BC, 9: 0x09A99, 10: 0x0A4D3 };
for (const v of [7, 8, 9, 10]) eq("Versionsinfo " + v, QR._versionBits(v), verKnown[v].toString(2).padStart(18, "0"));

function checkMatrix(text) {
  const m = QR.matrix(text);
  const n = m.length;
  const finderOK = m[0][0] && m[0][6] && m[6][0] && m[6][6] && !m[1][1] && m[2][2] && m[3][3];
  if (!finderOK) { console.log("FAIL Finder-Muster für", JSON.stringify(text)); ok = false; return; }
  let timingOK = true;
  for (let i = 8; i < n - 8; i++) if (m[6][i] !== (i % 2 === 0)) timingOK = false;
  if (!timingOK) { console.log("FAIL Timing-Muster für", JSON.stringify(text)); ok = false; return; }
  console.log(`OK   Matrix ${JSON.stringify(text).slice(0, 36)} (size ${n})`);
}
["HELLO WORLD", "https://philip-stack.pages.dev/wuerfelpoker/#/game/12345/ABCDEF",
  "kurz", "ä ö ü Straße 🎲"].forEach(checkMatrix);

console.log("\n" + (ok ? "QR-TESTS OK" : "QR-TESTS FEHLGESCHLAGEN"));
process.exit(ok ? 0 : 1);
