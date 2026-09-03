// Tages-Briefing — reine Anzeige. Erzeugt wird nichts hier (das macht der
// Cron), die Seite liest nur /api/briefing.
(() => {
  "use strict";
  const out = document.getElementById("out");
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const num = (n, d = 0) => (n == null ? "–" : Number(n).toLocaleString("de-AT", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const eur = p => (p == null ? "–" : p.toFixed(3).replace(".", ",") + " €");

  const tag = (iso) => {
    const d = new Date(iso + "T12:00:00");
    return isNaN(d) ? iso : d.toLocaleDateString("de-AT", { weekday: "long", day: "numeric", month: "long" });
  };
  const uhr = (at) => {
    // SQLite schreibt "YYYY-MM-DD HH:MM:SS" in UTC.
    const t = Date.parse(String(at || "").replace(" ", "T") + "Z");
    return isNaN(t) ? "" : new Date(t).toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
  };

  function zahlen(data) {
    if (!data) return "";
    const rows = [];
    if (data.weather) {
      const w = data.weather;
      rows.push(["Wetter", `${esc(w.text)} · ${num(w.min)}–${num(w.max)} °C`]);
      if (w.prob != null) rows.push(["Regenwahrscheinlichkeit", num(w.prob) + " %"]);
      if (w.mm != null && w.mm > 0) rows.push(["Niederschlag", String(w.mm).replace(".", ",") + " mm"]);
    }
    if (data.sprit) {
      const p = data.sprit;
      rows.push([esc(p.fuel) + " günstigste", eur(p.price)]);
      rows.push(["Station", esc(p.name) + (p.city ? " · " + esc(p.city) : "") + (p.dist != null ? ` · ${String(p.dist).replace(".", ",")} km` : "")]);
      if (p.diffCent != null) rows.push(["gegenüber davor", (p.diffCent > 0 ? "+" : "") + String(p.diffCent).replace(".", ",") + " Cent"]);
      if (p.stations != null) rows.push(["offene Stationen im Umkreis", num(p.stations)]);
    }
    if (data.fire) {
      const f = data.fire;
      rows.push(["Einsätze Bezirk " + esc(f.bezirk), num(f.count) + (f.open ? ` · ${num(f.open)} offen` : "")]);
      (f.letzte || []).forEach(x => rows.push(["· " + esc(x.wo || ""), esc(x.was || "")]));
    }
    if (!rows.length) return "";
    return `<div class="card"><h2>Die Zahlen dahinter</h2>${
      rows.map(([k, v]) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`).join("")
    }</div>`;
  }

  function render(d) {
    const heute = d.today;
    if (!heute) {
      out.innerHTML = `<div class="card">
        <p class="empty">Noch kein Briefing erzeugt. Es entsteht automatisch am Morgen —
        eingestellt wird das im Betriebs-Panel unter <b>System</b>.</p></div>`;
      return;
    }
    const rest = (d.days || []).slice(1);
    out.innerHTML = `
      <div class="card">
        <p class="lead">${esc(heute.text)}</p>
        <p class="meta">${esc(tag(heute.day))} · ${esc(uhr(heute.at))}${heute.via === "plain" ? " · ohne KI zusammengestellt" : ""}</p>
      </div>
      ${zahlen(heute.data)}
      ${rest.length ? `<div class="card"><h2>Die Tage davor</h2><ul class="hist">${
        rest.map(x => `<li><span class="d">${esc(tag(x.day))}</span>${esc(x.text)}</li>`).join("")
      }</ul></div>` : ""}`;
  }

  fetch("/api/briefing")
    .then(r => r.json())
    .then(render)
    .catch(() => {
      out.innerHTML = `<div class="card"><p class="empty">Konnte nicht geladen werden. Später nochmal probieren.</p></div>`;
    });
})();
