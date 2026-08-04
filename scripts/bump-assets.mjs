// Cache-Busting automatisieren: setzt bei allen lokalen .js/.css-Referenzen in
// public/**/*.html den Query-Parameter ?v=<8-stelliger-Inhaltshash>. Ersetzt das
// fehleranfällige manuelle Hochzählen von ?v=N (29 Stellen von Hand). Der Hash
// ändert sich NUR, wenn sich der Dateiinhalt ändert → kein vergessener Bump mehr,
// keine unnötigen Invalidierungen. Query-Parameter beeinflussen nicht, welche
// Datei ausgeliefert wird (statisches Hosting) — ein „falscher" Hash ist harmlos.
//
//   node scripts/bump-assets.mjs          (schreibt Änderungen)
//   node scripts/bump-assets.mjs --check  (nur prüfen, Exit 1 wenn veraltet — CI)
import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const pub = path.join(root, "public");
const CHECK = process.argv.includes("--check");

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".html")) out.push(p);
  }
  return out;
}

const hashCache = new Map();
function hashOf(file) {
  if (hashCache.has(file)) return hashCache.get(file);
  let h = null;
  try {
    // Zeilenenden normalisieren (\r\n → \n), damit der Hash plattformunabhängig
    // ist — sonst weichen Windows-Arbeitskopie (CRLF) und CI (LF) voneinander ab.
    const norm = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
    h = createHash("sha1").update(norm).digest("hex").slice(0, 8);
  } catch { h = null; }
  hashCache.set(file, h);
  return h;
}

// (src|href)="<pfad>.js|.css[?v=…]"  — nur lokale Pfade (kein http/@)
const RE = /\b(src|href)="((?:\/|\.{0,2}\/)?[^":?][^":]*\.(?:js|css))(\?v=[^"]*)?"/g;

let changed = 0, stale = 0;
for (const html of walk(pub)) {
  const dir = path.dirname(html);
  const src = readFileSync(html, "utf8");
  const out = src.replace(RE, (m, attr, assetPath, oldV) => {
    if (/^https?:/i.test(assetPath)) return m;
    const abs = assetPath.startsWith("/") ? path.join(pub, assetPath) : path.join(dir, assetPath);
    const h = hashOf(abs);
    if (!h) return m;                      // Datei nicht auflösbar → unverändert
    const want = `?v=${h}`;
    if (oldV === want) return m;
    return `${attr}="${assetPath}${want}"`;
  });
  if (out !== src) {
    stale++;
    if (CHECK) { console.log("VERALTET " + path.relative(root, html)); }
    else { writeFileSync(html, out); changed++; console.log("bumped   " + path.relative(root, html)); }
  }
}

if (CHECK && stale) { console.log(`\n${stale} Datei(en) mit veralteten ?v=-Hashes — 'npm run bump' ausführen.`); process.exit(1); }
console.log(CHECK ? "\n✅ Alle ?v=-Hashes aktuell." : `\n✅ ${changed} Datei(en) aktualisiert.`);
