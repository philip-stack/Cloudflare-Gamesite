// ====================================================================
// Rennticker — Reiter „Funk“: Boxenfunk-Clips der Session (F1-Archiv bzw.
// live aus dem Feed), abspielbar über /f1data/radio (same-origin, CSP).
// In der Nachschau nur Clips bis zur gewählten Runde (kein Spoiler).
// ====================================================================
(function () {
  "use strict";
  const { S, $, esc, get, fmtClock } = window.RT;
  RT.view("radio");
  const audio = new Audio();
  audio.preload = "none";
  let clips = { key: "", list: null, error: false };
  let playing = null;   // Datei des laufenden Clips
  let onlyFav = false;

  async function load() {
    const race = S.race;
    if (!race || race.live) return;
    const ses = race.session || {};
    const key = ses.key + "";
    if (clips.key === key && (clips.list || clips.error)) return;
    clips = { key, list: null, error: false };
    render();
    try {
      const d = await get("archive", { year: ses.year, session_key: ses.key, topic: "TeamRadio" });
      const cap = d && d.Captures ? (Array.isArray(d.Captures) ? d.Captures : Object.values(d.Captures)) : [];
      if (clips.key === key) clips.list = cap.filter(c => c && c.Path).map(c => ({ n: +c.RacingNumber, utc: c.Utc, file: String(c.Path).replace(/^TeamRadio\//, "") }));
    } catch (e) {
      if (clips.key === key) { if (e.status === 404) clips.list = []; else clips.error = true; }
    }
    render();
  }
  const src = c => {
    const ses = S.race.session || {};
    return "/f1data/radio?" + new URLSearchParams(S.race.live && ses.path ? { path: ses.path, file: c.file } : { year: ses.year, session_key: ses.key, file: c.file });
  };
  // Runde zum Zeitpunkt (Nachschau: wie viele Runden der Führende da beendet hatte)
  function lapAt(t) {
    const fr = S.race.frames;
    if (S.race.live || fr.length < 2) return null;
    let k = 0;
    for (let i = 1; i < fr.length; i++) if (fr[i].t <= t) k = fr[i].lap;
    return k + 1;
  }

  function render() {
    if (S.view !== "radio") return;
    const box = $("radio-list"), race = S.race;
    $("radio-fav").hidden = !S.fav;
    if (S.fav && race && race.drivers.get(S.fav)) $("radio-fav").textContent = "Nur " + race.drivers.get(S.fav).abbr;
    $("radio-fav").setAttribute("aria-pressed", String(onlyFav && !!S.fav));
    if (!race) { box.innerHTML = ""; return; }
    let list = race.live ? race.radio || [] : clips.list;
    if (!race.live && clips.error) { box.innerHTML = `<li class="doc-empty">Funk gerade nicht erreichbar.</li>`; return; }
    if (!list) { box.innerHTML = `<li class="doc-empty"><span class="spinner"></span></li>`; return; }
    // Nachschau: nichts zeigen, was nach der gewählten Runde passiert ist
    const f = race.frames[S.frame];
    let hidden = 0;
    if (!race.live && f && !f.final && f.t) {
      const before = list.filter(c => Date.parse(c.utc) <= f.t);
      hidden = list.length - before.length; list = before;
    }
    if (onlyFav && S.fav) list = list.filter(c => c.n === S.fav);
    $("radio-note").textContent = hidden ? `${hidden} weitere Funksprüche nach Runde ${f.lap} – Regler weiterziehen.` : "";
    if (!list.length) { box.innerHTML = `<li class="doc-empty">${race.live ? "Noch keine Funksprüche in dieser Session." : "Keine Funksprüche."}</li>`; return; }
    box.innerHTML = list.slice().reverse().map(c => {
      const d = race.drivers.get(c.n) || { abbr: "#" + c.n, first: "", last: "", color: "#888" };
      const t = Date.parse(c.utc), lap = lapAt(t), on = playing === c.file;
      return `<li class="clip${on ? " on" : ""}${c.n === S.fav ? " mine" : ""}" style="--team:${esc(d.color)}">
        <button type="button" class="clip-play" data-file="${esc(c.file)}" aria-label="${on ? "Anhalten" : "Abspielen"}: ${esc(d.abbr)}">${on && !audio.paused ? "❚❚" : "▶"}</button>
        <span class="bar"></span>
        <span class="clip-t"><b>${esc(d.abbr)}</b><small>${lap ? `Runde ${lap} · ` : ""}${isFinite(t) ? fmtClock(t) : ""}</small></span>
        <span class="clip-prog"><i style="width:${on && audio.duration ? (audio.currentTime / audio.duration * 100).toFixed(1) : 0}%"></i></span>
      </li>`;
    }).join("");
  }

  $("radio-list").addEventListener("click", e => {
    const b = e.target.closest(".clip-play");
    if (!b || !S.race) return;
    const file = b.dataset.file;
    if (playing === file && !audio.paused) { audio.pause(); render(); return; }
    if (playing !== file) {
      const c = (S.race.live ? S.race.radio : clips.list || []).find(x => x.file === file);
      if (!c) return;
      audio.src = src(c); playing = file;
    }
    audio.play().catch(() => { $("radio-note").textContent = "Abspielen nicht möglich."; });
    render();
  });
  audio.addEventListener("timeupdate", () => {
    const bar = document.querySelector(".clip.on .clip-prog i");
    if (bar && audio.duration) bar.style.width = (audio.currentTime / audio.duration * 100).toFixed(1) + "%";
  });
  audio.addEventListener("ended", () => { playing = null; render(); });
  audio.addEventListener("pause", render);
  $("radio-fav").addEventListener("click", () => { onlyFav = !onlyFav; render(); });

  RT.on("show", () => { if (S.view === "radio") { load(); render(); } });
  RT.on("view", v => { if (v === "radio") load(); else if (!audio.paused) audio.pause(); });
  RT.on("loading", () => { audio.pause(); playing = null; });
})();
