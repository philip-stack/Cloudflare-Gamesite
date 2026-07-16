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
  try { await import(pathToFileURL(f).href); console.log("OK   " + path.relative(root, f)); }
  catch (e) { console.log("FAIL " + path.relative(root, f) + " — " + e.message); ok = false; }
}

console.log("\n" + (ok ? "SYNTAX OK" : "SYNTAXFEHLER GEFUNDEN"));
process.exit(ok ? 0 : 1);
