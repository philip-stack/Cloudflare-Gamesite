// ====================================================================
// Rennticker — Reiter „Bericht“: KI-Rennbericht zu Rennen und Sprints
// (/api/f1/report, geschrieben aus den Renndaten, kurz nach der Zielflagge).
// Verrät das Ergebnis → in der Nachschau erst nach Tippen, außer man steht
// schon am Ende. Dazu auf Wunsch die Sicht des Lieblingsfahrers.
// ====================================================================
(function () {
  "use strict";
  const { S, $, esc } = window.RT;
  RT.view("report", { title: "Bericht", noPlayer: true });
  const cache = new Map();      // "<key>|<fav>" → Promise<Bericht>
  const revealed = new Set();   // Sessions, deren Bericht schon aufgedeckt ist

  function load(key, year, fav) {
    const id = key + "|" + (fav || "");
    if (!cache.has(id)) cache.set(id, (async () => {
      const res = await fetch("/api/f1/report?" + new URLSearchParams({ session_key: key, year, ...(fav ? { fav } : {}) }));
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { const e = new Error(j.error || "Bericht gerade nicht möglich."); e.status = res.status; throw e; }
      return j;
    })().catch(e => { cache.delete(id); throw e; }));
    return cache.get(id);
  }
  const para = r => `<h3 class="rep-t">${esc(r.title)}</h3>${(r.body || []).map(p => `<p>${esc(p)}</p>`).join("")}`;

  async function render() {
    if (S.view !== "report") return;
    const box = $("report-box"), race = S.race;
    const ses = race && race.session;
    if (!ses || !ses.race) { box.innerHTML = `<p class="chart-empty">Berichte gibt es zu Rennen und Sprints.</p>`; return; }
    if (race.live) { box.innerHTML = `<p class="chart-empty">Der Bericht kommt etwa 40 Minuten nach der Zielflagge – dann unter dem Rennen in der Nachschau.</p>`; return; }
    const f = race.frames[S.frame];
    if (!f.final && !revealed.has(ses.key)) {
      box.innerHTML = `<div class="rep-gate"><p>Der Bericht verrät das Ergebnis.</p><button type="button" class="more" id="rep-show">Bericht trotzdem lesen</button></div>`;
      $("rep-show").addEventListener("click", () => { revealed.add(ses.key); render(); });
      return;
    }
    if (!box.dataset.key || box.dataset.key !== String(ses.key)) box.innerHTML = `<p class="chart-empty"><span class="spinner"></span><br>Bericht wird geladen …</p>`;
    box.dataset.key = String(ses.key);
    let r;
    try { r = await load(ses.key, ses.year, null); }
    catch (e) {
      if (S.view === "report" && S.race === race) box.innerHTML = `<p class="chart-empty">${esc(e.status === 425 ? "Der Bericht ist noch nicht fertig – er folgt kurz nach dem Rennen." : e.message)}</p>`;
      return;
    }
    if (S.view !== "report" || S.race !== race) return;
    const d = S.fav && race.drivers.get(S.fav);
    box.innerHTML = `<article class="rep">${para(r)}</article>
      ${d ? `<div class="rep-fav" id="rep-fav"><button type="button" class="more" id="rep-fav-btn">Aus Sicht von ${esc(d.first)} ${esc(d.last)}</button></div>` : ""}
      <p class="rep-src">Automatisch per KI aus den Renndaten geschrieben – kann Fehler enthalten.</p>`;
    const btn = $("rep-fav-btn");
    if (btn) btn.addEventListener("click", async () => {
      const slot = $("rep-fav");
      slot.innerHTML = `<p class="chart-empty"><span class="spinner"></span><br>Wird geschrieben …</p>`;
      try { const x = await load(ses.key, ses.year, S.fav); slot.innerHTML = `<article class="rep rep-mine" style="--team:${esc(d.color)}">${para(x)}</article>`; }
      catch (e) { slot.innerHTML = `<p class="chart-empty">${esc(e.message)}</p>`; }
    });
  }
  RT.on("show", render);
  RT.on("view", v => { if (v === "report") render(); });
  RT.on("loading", () => { const b = $("report-box"); if (b) { b.innerHTML = ""; delete b.dataset.key; } });
})();
