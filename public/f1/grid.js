// ====================================================================
// Rennticker — Reiter „Startaufstellung“: zweireihig wie auf der Strecke.
//   Rennen/Sprint (Nachschau): Stand vor dem Start (Frame 0, OpenF1) mit
//     Startreifen; Vergleich mit dem Qualifying zeigt Strafen/Boxengassen-Starts.
//   Qualifying/Sprint-Qualifying: vorläufige Aufstellung aus dem Ergebnis.
//   Live: vor dem Start die Aufstellung aus dem Feed, im Qualifying der Zwischenstand.
// ====================================================================
(function () {
  "use strict";
  const { S, $, esc, get, M } = window.RT;
  RT.view("grid", { title: "Startaufstellung", noPlayer: true });
  const qCache = new Map();   // Quali-session_key → Promise<Map n → Platz>

  // Zum Rennen passendes Qualifying im selben Wochenende
  function qualiOf(key) {
    const m = (S.meetings || []).find(x => x.sessions.some(s => s.session_key === key));
    const s = m && m.sessions.find(x => x.session_key === key);
    if (!s) return null;
    const want = s.session_name === "Sprint" ? /^Sprint (Qualifying|Shootout)$/ : /^Qualifying$/;
    return m.sessions.find(x => want.test(x.session_name)) || null;
  }
  function loadQuali(q) {
    if (!qCache.has(q.session_key)) qCache.set(q.session_key, get("archive", { year: new Date(q.date_start).getFullYear(), session_key: q.session_key, topic: "TimingData" })
      .then(td => new Map(Object.entries((td && td.Lines) || {}).filter(([, l]) => l && l.Position).map(([n, l]) => [+n, +l.Position])))
      .catch(e => { qCache.delete(q.session_key); throw e; }));
    return qCache.get(q.session_key);
  }

  async function render() {
    if (S.view !== "grid") return;
    const box = $("grid-box"), cap = $("grid-cap"), race = S.race;
    if (!race) { box.innerHTML = ""; return; }
    const ses = race.session || {};
    let rows, mode;
    if (race.live) {
      const f = race.frames[0];
      if (ses.race && f.lap === 0) { rows = f.rows; mode = "Aufstellung laut Live-Timing"; }
      else if (ses.quali) { rows = f.rows; mode = "Zwischenstand – so stünde es jetzt"; }
      else { box.innerHTML = `<p class="chart-empty">${ses.race ? "Das Rennen läuft – die Startaufstellung gibt's danach in der Nachschau." : "Im Training gibt es keine Startaufstellung."}</p>`; cap.textContent = ""; return; }
    } else if (ses.race && race.frames && race.frames[0]) {
      rows = race.frames[0].rows.filter(r => r.pos != null); mode = "Aufstellung beim Start";
    } else if (race.archive && ses.quali) {
      rows = race.frames[0].rows; mode = "Vorläufig – nach Qualifying, ohne spätere Strafen";
    } else {
      box.innerHTML = `<p class="chart-empty">Startaufstellung gibt es zu Rennen, Sprints und Qualifyings.</p>`; cap.textContent = ""; return;
    }
    rows = rows.slice().sort((a, b) => (a.pos ?? 99) - (b.pos ?? 99));
    cap.textContent = mode;
    // Vergleich mit dem Qualifying (nur Nachschau Rennen/Sprint)
    let qpos = null;
    if (!race.live && ses.race) {
      const q = qualiOf(ses.key);
      if (q) { try { qpos = await loadQuali(q); } catch (_) { qpos = null; } }
      if (S.view !== "grid" || S.race !== race) return;
    }
    const start = !race.live && ses.race;
    const moved = qpos ? rows.filter((r, i) => qpos.get(r.n) && (r.pos ?? i + 1) - qpos.get(r.n) >= 2) : [];
    if (moved.length) cap.textContent = mode + " · zurückversetzt: " + moved.map(r => `${(race.drivers.get(r.n) || { abbr: "#" + r.n }).abbr} (Quali P${qpos.get(r.n)} → Start P${r.pos})`).join(", ");
    box.innerHTML = `<ol class="grid">${rows.map((r, i) => {
      const d = race.drivers.get(r.n) || { abbr: "#" + r.n, last: "", team: "", color: "#888" };
      const pos = r.pos ?? i + 1, qp = qpos && qpos.get(r.n);
      const diff = qp ? pos - qp : 0;
      // Nur Zurückversetzte markieren (wer dadurch aufrückt, ist selbsterklärend);
      // ab 2 Plätzen, damit Nachrücken hinter einer Strafe nicht auffällt
      const tag = diff >= 2 ? `<i class="g-diff down" title="Qualifying P${qp}: Strafe oder Boxengassen-Start">Q${qp}</i>` : "";
      return `<li class="g-slot${pos % 2 ? " left" : " right"}${r.n === S.fav ? " is-fav" : ""}" style="--team:${esc(d.color)}">
        <span class="g-pos">${pos}</span><span class="bar"></span>
        <span class="g-name"><b>${esc(d.abbr)}</b><small>${esc(d.last || "")}</small></span>
        ${start && r.compound ? RT.tyre(r.compound) : ""}${tag}
      </li>`;
    }).join("")}</ol>`;
  }
  RT.on("show", render);
  RT.on("view", v => { if (v === "grid") render(); });
})();
