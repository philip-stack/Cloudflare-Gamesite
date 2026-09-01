// Tron-Physik (worker-rt/tron-logic.js): Bewegung (Drehung zum Ziel, Vorwärts,
// Spur) und Kollision (Wand, fremde Spur, eigene Spur mit T_SKIP-Ausnahme).
import { fileURLToPath } from "node:url";
import path from "node:path";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modUrl = "file://" + path.join(__dirname, "..", "worker-rt", "tron-logic.js").replace(/\\/g, "/");
const L = await import(modUrl);

let ok = true;
const assert = (name, cond) => { if (cond) console.log("OK  ", name); else { console.log("FAIL", name); ok = false; } };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

// ---------- advance ----------
{
  const p = { x: 500, y: 500, a: 0, aim: 0, trail: [{ x: 500, y: 500 }] };
  L.advance(p);
  assert("advance: geradeaus bewegt +x um Speed·dt", near(p.x, 500 + L.T_SPEED * L.T_DT) && near(p.y, 500));
  assert("advance: verlängert die Spur", p.trail.length === 2 && near(p.trail[1].x, p.x));
}
{
  // Drehung ist pro Tick auf T_TURN·dt begrenzt (nicht sofort zum Ziel).
  const p = { x: 0, y: 0, a: 0, aim: Math.PI, trail: [] };
  L.advance(p);
  assert("advance: dreht max. T_TURN·dt pro Tick", near(p.a, L.T_TURN * L.T_DT));
}
{
  // Kürzeste Drehrichtung über den ±π-Sprung: a≈π, aim≈-π → weiter erhöhen (Wrap).
  const p = { x: 0, y: 0, a: 3.0, aim: -3.0, trail: [] };
  L.advance(p);
  assert("advance: nimmt den kürzesten Weg über den π-Sprung", p.a > 3.0);
}

// ---------- collides ----------
{
  const p = { x: 3, y: 500, trail: [] };   // x < T_HITR → Wand
  assert("collides: Wand links", L.collides(p, [p]) === true);
  const q = { x: 500, y: L.T_ARENA - 2, trail: [] };
  assert("collides: Wand unten", L.collides(q, [q]) === true);
}
{
  const p = { x: 500, y: 500, trail: [{ x: 500, y: 500 }] };
  assert("collides: frei in der Mitte, keine fremden Spuren", L.collides(p, [p]) === false);
}
{
  const p = { x: 500, y: 500, trail: [] };
  const q = { x: 900, y: 900, trail: [{ x: 502, y: 500 }] };   // Punkt 2px neben p
  assert("collides: trifft fremde Spur", L.collides(p, [p, q]) === true);
}
{
  // Eigene JÜNGSTE Spurpunkte (letzte T_SKIP) werden ignoriert.
  const recent = Array.from({ length: L.T_SKIP }, () => ({ x: 500, y: 500 }));
  const oldFar = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }];
  const p = { x: 500, y: 500, trail: [...oldFar, ...recent] };
  assert("collides: eigene jüngste Spur wird ausgenommen", L.collides(p, [p]) === false);
}
{
  // Ein ALTER eigener Punkt (vor dem Skip-Fenster) an der aktuellen Position trifft.
  const recentFar = Array.from({ length: L.T_SKIP }, () => ({ x: 0, y: 0 }));
  const p = { x: 500, y: 500, trail: [{ x: 500, y: 500 }, ...recentFar] };
  assert("collides: alter eigener Spurpunkt trifft", L.collides(p, [p]) === true);
}

console.log("\n" + (ok ? "TRON-PHYSIK OK" : "TRON-PHYSIK FEHLGESCHLAGEN"));
process.exit(ok ? 0 : 1);
