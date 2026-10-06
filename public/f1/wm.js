// ====================================================================
// Rennticker — Reiter „WM“: Fahrer- und Teamwertung
// ====================================================================
(function () {
  "use strict";
  const { S, $, esc, store, get, M } = window.RT;
  const { gpName, sessName } = RT;
  RT.view("wm", { title: "WM-Stand", noPlayer: true });
  let wmMode = store.get("f1_wmmode") === "teams" ? "teams" : "drivers";
  const wmCache = new Map();   // session_key → Promise<{ drivers, teams, names }>
  function wmSession() {
    // Rennen/Sprint, das zum gewählten Stand passt: die gewählte Session selbst
    // oder das letzte Rennen davor
    const cur = S.sessions.find(s => s.session_key === +$("session").value);
    const until = cur ? Date.parse(cur.date_end) : Date.now();
    return S.sessions.filter(s => s.session_type === "Race" && Date.parse(s.date_end) <= until)
      .sort((a, b) => Date.parse(b.date_start) - Date.parse(a.date_start))[0] || null;
  }
  function loadWM(key) {
    if (!wmCache.has(key)) wmCache.set(key, (async () => {
      const [dr, tm, names] = await Promise.all([get("championship_drivers", { session_key: key }), get("championship_teams", { session_key: key }), get("drivers", { session_key: key })]);
      const norm = (x, id) => ({ ...id, pos0: x.position_start, pos: x.position_current, pts0: x.points_start ?? 0, pts: x.points_current ?? 0 });
      return {
        drivers: dr.map(x => norm(x, { n: x.driver_number })).sort((a, b) => a.pos - b.pos),
        teams: tm.map(x => norm(x, { team: x.team_name })).sort((a, b) => a.pos - b.pos),
        names: new Map(names.map(d => [d.driver_number, { n: d.driver_number, abbr: d.name_acronym, first: d.first_name, last: d.last_name, team: d.team_name, color: "#" + (d.team_colour || "888888") }])),
      };
    })().catch(e => { wmCache.delete(key); throw e; }));
    return wmCache.get(key);
  }
  let wmRun = 0;
  async function renderWM() {
    if (S.view !== "wm") return;
    document.querySelectorAll(".seg2 button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.wm === wmMode)));
    const list = $("wm-list"), cap = $("wm-cap");
    const run = ++wmRun;
    let data, names = S.race ? S.race.drivers : new Map();
    if (S.race && S.race.live && S.race.wm) {
      data = S.race.wm;
      cap.innerHTML = `<b>Live</b> · Hochrechnung, wenn jetzt Schluss wäre`;
    } else {
      const s = wmSession();
      if (!s) { list.innerHTML = `<li class="doc-empty">Noch kein Rennen in dieser Saison.</li>`; cap.textContent = ""; return; }
      cap.textContent = `Nach: ${gpName(s.meeting) || s.location} · ${sessName(s)}`;
      if (!list.children.length || list.dataset.key !== String(s.session_key)) list.innerHTML = `<li class="doc-empty"><span class="spinner"></span></li>`;
      try { data = await loadWM(s.session_key); } catch (_) { if (run === wmRun) list.innerHTML = `<li class="doc-empty">WM-Stand gerade nicht verfügbar.</li>`; return; }
      if (run !== wmRun) return;
      list.dataset.key = String(s.session_key);
      names = data.names;
    }
    const teamColor = new Map([...names.values()].map(d => [d.team, d.color]));
    const favTeam = S.fav && names.get(S.fav) ? names.get(S.fav).team : null;
    const rows = wmMode === "teams" ? data.teams : data.drivers;
    list.innerHTML = rows.map(x => {
      const d = wmMode === "drivers" ? names.get(x.n) : null;
      const color = d ? d.color : teamColor.get(x.team) || "#888";
      const mv = x.pos0 && x.pos ? x.pos0 - x.pos : 0;
      const gain = Math.round((x.pts - x.pts0) * 10) / 10;
      const mine = wmMode === "drivers" ? x.n === S.fav : x.team === favTeam;
      return `<li class="wm-row${mine ? " is-S.fav" : ""}" style="--team:${esc(color)}">
        <span class="wm-pos"><b>${x.pos ?? "–"}</b>${mv > 0 ? `<i class="up">▲${mv}</i>` : mv < 0 ? `<i class="down">▼${-mv}</i>` : ""}</span>
        <span class="bar"></span>
        <span class="wm-name"><b>${esc(d ? d.last || d.abbr : x.team)}</b><small>${esc(d ? d.team : "")}</small></span>
        <span class="wm-gain${gain ? "" : " zero"}">${gain ? "+" + gain : "±0"}</span>
        <span class="wm-pts">${Math.round(x.pts * 10) / 10}</span>
      </li>`;
    }).join("") || `<li class="doc-empty">Keine Daten.</li>`;
  }
  RT.on("show", () => renderWM());
  RT.on("view", v => { if (v === "wm") renderWM(); });
  document.querySelectorAll(".seg2 button").forEach(b => b.addEventListener("click", () => {
    wmMode = b.dataset.wm; store.set("f1_wmmode", wmMode); renderWM();
  }));
})();
