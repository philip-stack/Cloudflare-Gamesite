// ====================================================================
// Rennticker — Ereignisse unter der Zeitenliste: Überholmanöver, Boxenstopps,
// Ausfälle, schnellste Runden und Strafen als kurze Zeitleiste (neueste oben).
// Nachschau: aus den Runden-Ständen bis zur gewählten Runde (kein Spoiler).
// Live: was vor dem Öffnen war, kommt aus dem Verlauf des Servers (DO), ab
// dann Vergleich von Abfrage zu Abfrage.
// ====================================================================
(function () {
  "use strict";
  const { S, $, esc, M, fmtClock } = window.RT;
  const SHOW = 6;
  let all = false, onlyFav = false;
  let cache = { race: null, list: [] };
  let live = { key: null, prev: null, list: [], pitAt: new Map() };
  let srv = { key: null, list: [] };   // Ereignisse vom Server (vor dem Öffnen)
  const PEN = /Strafe|Stop-and-Go|Durchfahrt/;

  function replayList(race) {
    if (cache.race === race) return cache.list;
    const list = [];
    for (let k = 1; k < race.frames.length; k++) {
      const b = race.frames[k];
      if (b.final) continue;
      for (const e of M.frameEvents(race.frames[k - 1], b, k === 1)) list.push({ ...e, lap: k, t: b.t });
    }
    cache = { race, list };
    return list;
  }
  function liveStep(race, f) {
    const key = race.session.key;
    if (live.key !== key) live = { key, prev: null, list: [], pitAt: new Map() };
    if (live.prev && live.prev.src === f) return;
    const now = Date.now();
    for (const r of f.rows) if (r.pitNow) live.pitAt.set(r.n, now);
    if (live.prev && race.session.race) {
      // Kurz nach einem Stopp sortiert der Feed die Plätze noch um → keine „Überholung“
      const fresh = n => now - (live.pitAt.get(n) || 0) < 90000;
      for (const e of M.frameEvents(live.prev, f, false)) {
        if (e.k === "pass") {
          if (f.lap <= 1 || fresh(e.n) || /sc|vsc|red/.test(f.status)) continue;
          e.o = e.o.filter(o => !fresh(o));
          if (!e.o.length) continue;
        }
        live.list.push({ ...e, lap: f.lap, t: now });
      }
      if (live.list.length > 300) live.list.splice(0, live.list.length - 300);
    }
    live.prev = { src: f, rows: f.rows.map(r => ({ ...r })) };
  }

  function text(e, nm) {
    switch (e.k) {
      case "pass": return `<b>${nm(e.n)}</b> überholt ${e.o.map(o => `<b>${nm(o)}</b>`).join(", ")} · P${e.pos}`;
      case "drop": return `<b>${nm(e.n)}</b> verliert ${e.d} Plätze · jetzt P${e.pos}`;
      case "start": return "Start: " + e.moves.map(m => `<b>${nm(m.n)}</b> <span class="${m.d > 0 ? "up" : "down"}">${m.d > 0 ? "+" : "−"}${Math.abs(m.d)}</span>`).join(" · ");
      case "pit": {
        const c0 = M.TYRE[e.c0], c = M.TYRE[e.c];
        return `<b>${nm(e.n)}</b> an der Box (${e.stop}. Stopp)${c ? ` · ${c0 && c0 !== c ? RT.tyre(e.c0) + " → " : ""}${RT.tyre(e.c)}` : ""}`;
      }
      case "out": return `<b>${nm(e.n)}</b> ${e.status === "DSQ" ? "disqualifiziert" : "ausgefallen"}`;
      case "fl": return `<b>${nm(e.n)}</b> schnellste Runde <span class="purple">${M.lapTime(e.s)}</span>`;
      case "pen": return esc(e.text);
    }
    return "";
  }
  const ICO = { drop: "▼", pass: "⇅", start: "◆", pit: "P", out: "✕", fl: "⏱", pen: "⚖︎" };
  const involves = (e, n) => e.n === n || (e.o && e.o.includes(n)) || (e.moves && e.moves.some(m => m.n === n));

  function render() {
    const sec = $("events");
    const race = S.race, f = race && race.frames[S.frame];
    if (!f || S.view !== "times" || f.timed) { sec.hidden = true; return; }
    if (race.live) liveStep(race, f);
    // Server-Ereignisse nur bis zum ersten eigenen (keine doppelten)
    const first = live.list.length ? live.list[0].t : Infinity;
    let list = race.live ? srv.list.filter(e => e.t < first).concat(live.list) : replayList(race).filter(e => e.lap <= f.lap || f.final);
    // Strafen aus der Rennleitung (stehen dort schon zeitlich gefiltert)
    for (const m of f.msgs) if (PEN.test(m.text) && !/keine Strafe|abgesessen/.test(m.text)) {
      list.push({ k: "pen", n: m.driver, text: m.text, lap: m.lap, t: m.time });
    }
    list.sort((a, b) => (b.t || 0) - (a.t || 0) || (b.lap || 0) - (a.lap || 0));
    sec.hidden = false;
    const fav = S.fav;
    const chip = $("ev-fav");
    chip.hidden = !fav;
    if (fav && race.drivers.get(fav)) chip.textContent = "Nur " + race.drivers.get(fav).abbr;
    chip.setAttribute("aria-pressed", String(onlyFav && !!fav));
    if (onlyFav && fav) list = list.filter(e => involves(e, fav) || (e.k === "pen" && new RegExp("\\b" + esc(race.drivers.get(fav).abbr) + "\\b").test(e.text)));
    const nm = n => esc((race.drivers.get(n) || { abbr: "#" + n }).abbr);
    const shown = all ? list : list.slice(0, SHOW);
    $("ev-list").innerHTML = shown.length ? shown.map(e =>
      `<li class="ev-${e.k}${fav && involves(e, fav) ? " mine" : ""}"><span class="rl">${e.lap ? "R" + e.lap : isFinite(e.t) ? fmtClock(e.t) : ""}</span><i class="ev-ico" aria-hidden="true">${ICO[e.k]}</i><span class="ev-t">${text(e, nm)}</span></li>`).join("")
      : `<li class="muted">${race.live ? "Ereignisse sammeln sich ab jetzt." : "Noch nichts passiert."}</li>`;
    const more = $("ev-more");
    more.hidden = list.length <= SHOW;
    more.textContent = all ? "Weniger anzeigen" : `Alle ${list.length} Ereignisse`;
  }

  RT.on("show", render);
  RT.on("livehist", h => { srv = { key: h.key, list: h.events || [] }; });
  RT.on("view", () => { if (!S.race) $("events").hidden = true; });
  RT.on("loading", () => { $("events").hidden = true; all = false; srv = { key: null, list: [] }; });
  $("ev-more").addEventListener("click", () => { all = !all; render(); });
  $("ev-fav").addEventListener("click", () => { onlyFav = !onlyFav; render(); });
})();
