// Syntaxprüfung aller JS-Dateien: public/* als klassische Skripte
// (node --check), functions/* als ES-Module (import validiert Syntax).
import { readdirSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".js") || p.endsWith(".mjs")) out.push(p);
  }
  return out;
}
let ok = true;

for (const f of walk(path.join(root, "public"))) {
  try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); console.log("OK   " + path.relative(root, f)); }
  catch (e) { console.log("FAIL " + path.relative(root, f) + "\n" + (e.stderr || e).toString()); ok = false; }
}
for (const f of walk(path.join(root, "functions"))) {
  const rel = path.relative(root, f);
  try { await import(pathToFileURL(f).href); console.log("OK   " + rel); }
  catch (e) {
    // Runtime-only-Importe (z. B. "cloudflare:workers" fürs Durable Object)
    // kann Node nicht auflösen — dann nur die Syntax prüfen statt zu laden.
    const msg = String((e && e.message) || e);
    if (/cloudflare:/.test(msg) || (e && e.code === "ERR_MODULE_NOT_FOUND" && /cloudflare/.test(msg))) {
      try { execFileSync(process.execPath, ["--check", f], { stdio: "pipe" }); console.log("OK   " + rel + " (nur Syntax — Runtime-Import)"); }
      catch (e2) { console.log("FAIL " + rel + "\n" + ((e2.stderr || e2).toString())); ok = false; }
    } else { console.log("FAIL " + rel + " — " + msg); ok = false; }
  }
}

console.log("\n" + (ok ? "SYNTAX OK" : "SYNTAXFEHLER GEFUNDEN"));
process.exit(ok ? 0 : 1);
