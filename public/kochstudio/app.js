// ====================================================================
// KOCHSTUDIO — KI-Rezepte aus dem Kühlschrank + Rezept-Links aus dem Netz.
// Frontend: schickt Zutaten an /api/koch, rendert Markdown-Antwort.
// ====================================================================
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[c]);

// Mini-Markdown → HTML (nur was der Prompt erzeugt: ##, **, *, Listen)
function md(text) {
  const lines = String(text).split("\n");
  let html = "", list = null; // null | "ul" | "ol"
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

const COOKING = [
  "Schnipple die Zutaten …", "Rühre im Topf …", "Schmecke ab …",
  "Blättere in Rezeptbüchern …", "Frage die Oma um Rat …", "Suche im Netz …",
];

let busy = false;
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
  let i = 0;
  $("#recipes").innerHTML = `<p class="cooking">👨‍🍳 ${COOKING[0]}</p>`;
  const ticker = setInterval(() => {
    const el = document.querySelector(".cooking");
    if (el) el.textContent = "👨‍🍳 " + COOKING[++i % COOKING.length];
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
    } else {
      $("#recipes").innerHTML = md(data.answer);
    }

    if (data.links && data.links.length) {
      $("#weblinks").innerHTML = data.links.map(l => `
        <li><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title)}</a>
        <span class="host">${esc(new URL(l.url).hostname.replace(/^www\./, ""))}</span></li>`).join("");
      $("#webbox").hidden = false;
    }
  } catch {
    clearInterval(ticker);
    $("#recipes").innerHTML = `<p class="err">😔 Keine Verbindung — bist du online?</p>`;
  }
  btn.disabled = false;
  busy = false;
  $("#out").scrollIntoView({ behavior: "smooth", block: "nearest" });
};

// Enter im Wünsche-Feld startet direkt
$("#wishes").addEventListener("keydown", e => { if (e.key === "Enter") $("#go").click(); });
