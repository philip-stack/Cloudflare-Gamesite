// Statischer Qualitäts-/Barrierefreiheits-Check aller HTML-Seiten.
// Deterministisch, ohne Browser — läuft in jedem `npm test`. Fängt echte
// Regressionen ab: externe Ressourcen (verletzen die CSP/„alles selbst
// gehostet"), Bilder ohne alt-Text, fehlendes lang/viewport.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUB = path.join(__dirname, "..", "public");

let ok = true, warns = 0;
const fail = (file, msg) => { console.log("FAIL", `${file}: ${msg}`); ok = false; };
const warn = (file, msg) => { console.log("warn", `${file}: ${msg}`); warns++; };

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (e.endsWith(".html")) out.push(p);
  }
  return out;
}

const files = walk(PUB);
for (const f of files) {
  const rel = path.relative(PUB, f).replace(/\\/g, "/");
  const html = readFileSync(f, "utf8");

  // 1) Keine externen Skripte/Stylesheets/Bilder/iframes (self-hosted only)
  const extPatterns = [
    [/<script[^>]+src\s*=\s*["']https?:\/\//i, "externes <script src>"],
    [/<link[^>]+href\s*=\s*["']https?:\/\//i, "externes <link href>"],
    [/<img[^>]+src\s*=\s*["']https?:\/\//i, "externes <img src>"],
    [/<iframe[^>]+src\s*=\s*["']https?:\/\//i, "externes <iframe src>"],
  ];
  for (const [re, what] of extPatterns) if (re.test(html)) fail(rel, what + " gefunden (CSP verbietet externe Hosts)");

  // 2) Jedes <img> braucht ein alt-Attribut (Screenreader)
  const imgs = html.match(/<img\b[^>]*>/gi) || [];
  for (const tag of imgs) if (!/\balt\s*=/.test(tag)) fail(rel, "<img> ohne alt-Attribut");

  // 3) lang & viewport (Warnung — Fehler nur, wenn es echte Nutzerseiten trifft)
  if (!/<html[^>]*\blang\s*=/i.test(html)) warn(rel, "<html> ohne lang-Attribut");
  if (!/<meta[^>]+name\s*=\s*["']viewport["']/i.test(html)) warn(rel, "kein viewport-meta");
}

console.log(`\ngeprüft: ${files.length} HTML-Dateien, ${warns} Warnung(en)`);
console.log(ok ? "QUALITY-CHECK OK" : "QUALITY-CHECK FEHLGESCHLAGEN");
process.exit(ok ? 0 : 1);
