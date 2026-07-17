// ====================================================================
// KOCHSTUDIO — KI-Rezepte aus dem Kühlschrank + Rezept-Links aus dem Netz.
// - Verlauf pro Gerät (localStorage), anklickbar & löschbar
// - Ausgabe kopieren / teilen / als Textdatei speichern
// ====================================================================
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c]);

// Mini-Markdown → HTML (nur was der Prompt erzeugt: ##, **, *, Listen)
function md(text) {
  const lines = String(text).split("\n");
  let html = "", list = null;
  const closeList = () => { if (list) { html += `</${list}>`; list = null; } };
  const inline = s => esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { closeList(); continue; }
    let m;
    if ((m = line.match(/^#{2,3}\s+(.*)/))) { closeList(); html += `<h2>${inline(m[1])}</h2>`; }
    else if ((m = line.match(/^[-•]\s+(.*)/))) {
      if (list !== "ul") { closeList(); html += "<ul>"; list = "ul"; }
      html += `<li>${inline(m[1])}</li>`;
    } else if ((m = line.match(/^(\d+)[.)]\s+(.*)/))) {
      if (list !== "ol") { closeList(); html += "<ol>"; list = "ol"; }
      html += `<li>${inline(m[2])}</li>`;
    } else { closeList(); html += `<p>${inline(line)}</p>`; }
  }
  closeList();
  return html;
}

// ---------- Klartext (für Kopieren / Teilen / Download) ----------
const stripMd = s => String(s)
  .replace(/^#{2,3}\s+/gm, "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1");

function toPlain(e) {
  let t = "🍳 Rezepte aus dem Kochstudio\n";
  t += `Zutaten: ${e.ingredients}\n`;
  if (e.wishes) t += `Wünsche: ${e.wishes}\n`;
  t += "\n" + stripMd(e.answer).trim() + "\n";
  if (e.links && e.links.length) {
    t += "\nRezepte aus dem Netz:\n" + e.links.map(l => `• ${l.title}: ${l.url}`).join("\n") + "\n";
  }
  t += `\n— erstellt mit dem Kochstudio · ${location.origin}/kochstudio/`;
  return t;
}

// ---------- Verlauf (localStorage, pro Gerät) ----------
const HKEY = "koch_history", HMAX = 20;
const loadHist = () => { try { return JSON.parse(localStorage.getItem(HKEY) || "[]"); } catch { return []; } };
const saveHist = h => { try { localStorage.setItem(HKEY, JSON.stringify(h.slice(0, HMAX))); } catch {} };

function addHist(entry) {
  const h = loadHist().filter(e => e.id !== entry.id);
  h.unshift(entry);
  saveHist(h);
  renderHist();
}

function fmtWhen(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit" }) + " " +
         d.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
}

// Titel der Rezepte aus der Antwort ziehen (## Zeilen), sonst Zutaten
function histTitle(e) {
  const titles = (e.answer.match(/^#{2,3}\s+(.+)$/gm) || [])
    .map(l => l.replace(/^#{2,3}\s+/, "").trim());
  return titles.length ? titles.join(" · ") : e.ingredients;
}

function renderHist() {
  const h = loadHist();
  $("#history-sec").hidden = h.length === 0;
  $("#history").innerHTML = h.map(e => `
    <li class="hist-item" data-id="${esc(e.id)}">
      <button class="hist-open" data-id="${esc(e.id)}">
        <span class="hist-title">${esc(histTitle(e))}</span>
        <span class="hist-meta">${esc(fmtWhen(e.ts))} · ${esc(e.ingredients)}</span>
      </button>
      <button class="hist-del" data-del="${esc(e.id)}" title="Löschen" aria-label="Eintrag löschen">🗑</button>
    </li>`).join("");
}

// ---------- Ergebnis anzeigen ----------
let current = null;

function showResult(entry) {
  current = entry;
  $("#recipes").innerHTML = md(entry.answer);
  if (entry.links && entry.links.length) {
    $("#weblinks").innerHTML = entry.links.map(l => `
      <li><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title)}</a>
      <span class="host">${esc(hostOf(l.url))}</span></li>`).join("");
    $("#webbox").hidden = false;
  } else {
    $("#webbox").hidden = true;
  }
  $("#actions").hidden = false;
  $("#out").hidden = false;
}

function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } }

// ---------- Generieren ----------
const COOKING = [
  "Schnipple die Zutaten …", "Rühre im Topf …", "Schmecke ab …",
  "Blättere in Rezeptbüchern …", "Frage die Oma um Rat …", "Suche im Netz …",
  "Wetze die Messer …", "Heize den Ofen vor …", "Zerlasse die Butter …",
  "Hacke frische Kräuter …", "Röste Zwiebeln goldbraun …", "Öffne die Gewürzlade …",
  "Setze das Nudelwasser auf …", "Salze, wie das Meer es mag …", "Zupfe am Basilikum …",
  "Reibe den Parmesan …", "Prüfe die Garprobe …", "Deglaciere die Pfanne …",
  "Zähme die Chili …", "Klopfe an Nonnas Küchentür …", "Konsultiere die Sterneköche …",
  "Krame im Vorratsschrank …", "Poliere den Kochlöffel …", "Lausche dem Brutzeln …",
  "Rechne die Portionen aus …", "Sortiere nach Farbe & Frische …", "Karamellisiere ein bisschen …",
  "Presse eine Zitrone aus …", "Stimme die Aromen ab …", "Träume von Trüffeln …",
  "Frage den Marktstandler …", "Entkorke Inspiration …", "Balanciere süß & salzig …",
  "Föhne den Braten glasig …", "Blättere durch Chefkoch …", "Rufe kurz beim Wirt an …",
];
let busy = false;

// zufällig, ohne direkte Wiederholung
let lastCook = -1;
function nextCook() {
  let n;
  do { n = Math.floor(Math.random() * COOKING.length); } while (n === lastCook && COOKING.length > 1);
  lastCook = n;
  return COOKING[n];
}

$("#go").onclick = async () => {
  if (busy) return;
  const ingredients = $("#ings").value.trim();
  const wishes = $("#wishes").value.trim();
  if (ingredients.length < 3) { $("#ings").focus(); return; }

  busy = true;
  const btn = $("#go");
  btn.disabled = true;
  $("#out").hidden = false;
  $("#webbox").hidden = true;
  $("#actions").hidden = true;
  $("#recipes").innerHTML = `<p class="cooking">👨‍🍳 ${nextCook()}</p>`;
  const ticker = setInterval(() => {
    const el = document.querySelector(".cooking");
    if (el) el.textContent = "👨‍🍳 " + nextCook();
  }, 1800);

  try {
    const res = await fetch("/api/koch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ingredients, wishes }),
    });
    const data = await res.json().catch(() => ({}));
    clearInterval(ticker);

    if (!res.ok || !data.answer) {
      $("#recipes").innerHTML = `<p class="err">😔 ${esc(data.error || "Das hat leider nicht geklappt — probier es gleich nochmal.")}</p>`;
      $("#actions").hidden = true;
      if (data.links && data.links.length) {
        $("#weblinks").innerHTML = data.links.map(l => `
          <li><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title)}</a>
          <span class="host">${esc(hostOf(l.url))}</span></li>`).join("");
        $("#webbox").hidden = false;
      }
    } else {
      const entry = { id: String(Date.now()), ts: Date.now(), ingredients, wishes, answer: data.answer, links: data.links || [] };
      showResult(entry);
      addHist(entry);
    }
  } catch {
    clearInterval(ticker);
    $("#recipes").innerHTML = `<p class="err">😔 Keine Verbindung — bist du online?</p>`;
    $("#actions").hidden = true;
  }
  btn.disabled = false;
  busy = false;
  $("#out").scrollIntoView({ behavior: "smooth", block: "nearest" });
};

$("#wishes").addEventListener("keydown", e => { if (e.key === "Enter") $("#go").click(); });

// ---------- Aktionen: Kopieren / Teilen / Download ----------
async function flash(btn, text) {
  const old = btn.textContent;
  btn.textContent = text;
  setTimeout(() => { btn.textContent = old; }, 1600);
}

$("#copy").onclick = async () => {
  if (!current) return;
  try { await navigator.clipboard.writeText(toPlain(current)); flash($("#copy"), "✔ Kopiert"); }
  catch { flash($("#copy"), "✖ Ging nicht"); }
};

$("#share").onclick = async () => {
  if (!current) return;
  const text = toPlain(current);
  try {
    if (navigator.share) { await navigator.share({ title: "Rezepte aus dem Kochstudio", text }); return; }
    await navigator.clipboard.writeText(text);
    flash($("#share"), "✔ Kopiert");
  } catch { /* Abbruch durch Nutzer ignorieren */ }
};

$("#dl").onclick = () => {
  if (!current) return;
  const blob = new Blob([toPlain(current)], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const d = new Date(current.ts);
  a.href = url;
  a.download = `Rezepte-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}.txt`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// ---------- Verlauf-Interaktion ----------
$("#history").addEventListener("click", e => {
  const del = e.target.closest("[data-del]");
  if (del) {
    saveHist(loadHist().filter(x => x.id !== del.dataset.del));
    renderHist();
    return;
  }
  const open = e.target.closest(".hist-open");
  if (open) {
    const entry = loadHist().find(x => x.id === open.dataset.id);
    if (entry) {
      $("#ings").value = entry.ingredients;
      $("#wishes").value = entry.wishes || "";
      showResult(entry);
      $("#out").scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }
});

$("#hist-clear").onclick = () => {
  if (!loadHist().length) return;
  if (confirm("Gesamten Verlauf auf diesem Gerät löschen?")) { saveHist([]); renderHist(); }
};

// Beim Laden: Verlauf anzeigen
renderHist();
