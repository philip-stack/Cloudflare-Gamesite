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

  // Der Schlüssel ist derselbe wie im Betriebs-Panel und liegt unter dem
  // gleichen Ursprung — wer dort angemeldet ist, kommt hier ohne Eingabe rein.
  const LS = "admin_key";
  // Aus der Adresse übernehmen (einmalig, dann aus der History entfernen).
  try {
    const u = new URL(location.href);
    const k = u.searchParams.get("key");
    if (k) {
      localStorage.setItem(LS, k);
      u.searchParams.delete("key");
      history.replaceState(null, "", u.pathname + u.search + u.hash);
    }
  } catch (_) {}

  function frageSchluessel(msg) {
    out.innerHTML = `<div class="card">
      <p class="empty">${msg}</p>
      <p style="margin-top:12px"><input id="k" type="password" placeholder="Betriebsschlüssel" autocomplete="off"
        style="width:100%;padding:11px 13px;border-radius:12px;border:1px solid var(--edge);background:var(--card);color:var(--ink);font:inherit"></p>
      <p style="margin-top:10px"><button id="go" style="width:100%;padding:12px;border:0;border-radius:12px;background:var(--gold);color:#1a1508;font:inherit;font-weight:700;cursor:pointer">Anmelden</button></p>
    </div>`;
    const go = () => {
      const v = document.getElementById("k").value.trim();
      if (!v) return;
      localStorage.setItem(LS, v);
      laden();
    };
    document.getElementById("go").onclick = go;
    document.getElementById("k").onkeydown = e => { if (e.key === "Enter") go(); };
  }

  function laden() {
    const key = localStorage.getItem(LS);
    if (!key) return frageSchluessel("Das Briefing ist persönlich — es nennt Bezirk und Tankstelle in Wohnortnähe. Bitte den Betriebsschlüssel eingeben.");
    out.innerHTML = `<div class="card"><p class="empty">lädt…</p></div>`;
    fetch("/api/briefing", { headers: { "x-admin-key": key } })
      .then(async r => {
        if (r.status === 401) { localStorage.removeItem(LS); frageSchluessel("Schlüssel passt nicht."); return null; }
        return r.json();
      })
      .then(d => { if (d) render(d); })
      .catch(() => {
        out.innerHTML = `<div class="card"><p class="empty">Konnte nicht geladen werden. Später nochmal probieren.</p></div>`;
      });
  }
  laden();
})();
