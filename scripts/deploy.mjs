// Live schalten in der richtigen Reihenfolge — statt vier Befehle von Hand.
//
//   npm run deploy            # alles, was nötig ist
//   npm run deploy -- --dry   # nur anzeigen, was passieren würde
//
// Warum ein Skript: die Schritte hängen voneinander ab, und von Hand kam
// die Reihenfolge schon falsch heraus (Pages zuerst, Migration zuletzt →
// neuer Code lief kurz gegen Tabellen, die es noch nicht gab).
//
//   1. Arbeitsbaum sauber?  `wrangler pages deploy` lädt den Ordner so hoch,
//      wie er GERADE ist — Uncommittetes ginge sonst live, ohne im Git zu sein.
//   2. ?v=-Hashes aktuell + alle Tests grün.
//   3. D1-Migrationen   → zuerst, damit neuer Code seine Tabellen vorfindet.
//   4. worker-rt        → nur wenn sich dort seit dem letzten Deploy etwas
//      geändert hat (die Pages-Site bindet dessen Durable Objects).
//   5. Pages.
//   6. Git-Tag deploy-JJJJMMTT-HHMM → Grundlage für Schritt 4 beim nächsten Mal.
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const dry = process.argv.includes("--dry");
const sh = (cmd, opts = {}) => execSync(cmd, { cwd: root, stdio: "inherit", shell: true, ...opts });
const out = cmd => execSync(cmd, { cwd: root, encoding: "utf8", shell: true, stdio: ["ignore", "pipe", "ignore"] }).trim();
const step = (label, cmd, opts) => {
  console.log(`\n▶ ${label}${cmd ? `\n  $ ${cmd}` : ""}`);
  if (cmd && !dry) sh(cmd, opts);
};
const fail = msg => { console.error("\n✖ " + msg); process.exit(1); };

if (out("git status --porcelain")) {
  fail("Arbeitsbaum nicht sauber — erst committen (oder verwerfen). Pages würde sonst Uncommittetes veröffentlichen.");
}

try { out("node scripts/bump-assets.mjs --check"); }
catch { fail("?v=-Hashes veraltet — `npm run bump`, committen, dann nochmal."); }

step("Tests", "npm test");

// Der Migrationsschritt scheiterte schon zweimal sporadisch an der Cloudflare-API
// (beim zweiten Aufruf sofort ok) — darum ein zweiter Versuch, bevor abgebrochen wird.
try { step("D1-Migrationen", "npx wrangler d1 migrations apply wuerfelpoker --remote"); }
catch { console.log("  … erster Versuch fehlgeschlagen, zweiter Versuch"); step("D1-Migrationen (2. Versuch)", "npx wrangler d1 migrations apply wuerfelpoker --remote"); }

let lastTag = "";
try { lastTag = out('git describe --tags --abbrev=0 --match "deploy-*"'); } catch {}
let rtChanged = true;
if (lastTag) {
  try { execSync(`git diff --quiet ${lastTag} HEAD -- worker-rt`, { cwd: root, shell: true }); rtChanged = false; }
  catch { rtChanged = true; }
}
if (rtChanged) step(`worker-rt (geändert seit ${lastTag || "— noch kein Deploy-Tag"})`, "npx wrangler deploy", { cwd: path.join(root, "worker-rt") });
else console.log(`\n▶ worker-rt unverändert seit ${lastTag} — übersprungen`);

step("Pages", "npx wrangler pages deploy public --project-name philip-stack --branch main");

const d = new Date(), z = n => String(n).padStart(2, "0");
const tag = `deploy-${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}`;
step(`Tag ${tag}`, `git tag ${tag}`);

console.log(dry ? "\n(Trockenlauf — nichts ausgeführt)" : "\n✔ Live. Tag nicht vergessen zu pushen: git push --tags");
