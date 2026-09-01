// ====================================================================
// Tron/Lichtrenn-Physik — REINE Logik (keine Durable-Object-Abhängigkeit).
// Ausgelagert aus TronRoom, damit Bewegung & Kollision ohne laufenden Worker
// unit-testbar sind (tests/tron.test.mjs). Der Raum ruft advance()/collides();
// gespielt wird auf einfachen Objekten { x, y, a, aim, trail: [{x,y}], alive }.
// ====================================================================

export const T_TICK = 30, T_DT = 1 / 30, T_ARENA = 1000;
export const T_SPEED = 200, T_TURN = 3.0, T_SKIP = 16, T_HITR = 7;

// Einen lebenden Spieler einen Tick weiterbewegen: zur Zielrichtung (aim)
// drehen — pro Tick um höchstens T_TURN·dt —, dann vorwärts, Spur verlängern.
// Mutiert p (x, y, a, trail) wie im Live-Loop.
export function advance(p, dt = T_DT) {
  let d = p.aim - p.a;
  while (d > Math.PI) d -= 6.283185;
  while (d < -Math.PI) d += 6.283185;
  p.a += Math.max(-T_TURN * dt, Math.min(T_TURN * dt, d));
  p.x += Math.cos(p.a) * T_SPEED * dt;
  p.y += Math.sin(p.a) * T_SPEED * dt;
  p.trail.push({ x: p.x, y: p.y });
}

// Kollision an der aktuellen Position: Wand ODER irgendeine Lichtspur. Die
// eigene Spur wird um die T_SKIP jüngsten Punkte gekürzt (sonst kollidiert man
// sofort mit dem gerade gesetzten Punkt hinter sich). `players` ist eine
// Iterable der Mitspieler-Objekte (inkl. p selbst).
export function collides(p, players) {
  const r2 = T_HITR * T_HITR;
  if (p.x < T_HITR || p.x > T_ARENA - T_HITR || p.y < T_HITR || p.y > T_ARENA - T_HITR) return true;
  for (const q of players) {
    const tr = q.trail, lim = tr.length - (q === p ? T_SKIP : 0);
    for (let i = 0; i < lim; i++) {
      const dx = p.x - tr[i].x, dy = p.y - tr[i].y;
      if (dx * dx + dy * dy < r2) return true;
    }
  }
  return false;
}
