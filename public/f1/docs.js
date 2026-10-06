// ====================================================================
// Rennticker — Reiter „FIA“: Dokumente der Rennleitung + PDF-Betrachter
// ====================================================================
(function () {
  "use strict";
  const { S, $, esc, store, get, M } = window.RT;
  RT.view("docs", { noPlayer: true });
  const PDFJS = "./vendor/pdfjs-4.10.38/";
  const fmtDocDay = new Intl.DateTimeFormat("de-AT", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  let docTarget = null, docsTagged = false;   // { year, name } — Grand Prix, dessen Dokumente gezeigt werden
  let docs = { key: "", list: null, error: false };
  const fiaEvents = new Map();   // Jahr → Promise<[Namen]>
  const docClass = t => /infringement|offence|decision|summons|penalt|reprimand|investigation|protest|appeal/i.test(t) ? "dec"
    : /classification|starting grid|championship points|lap chart|fastest laps/i.test(t) ? "res" : "";

  function setDocTarget(meetingName, date) {
    if (!meetingName) return;
    docTarget = { name: meetingName, year: new Date(date || Date.now()).getFullYear() };
    if (S.view === "docs") loadDocs();
  }
  // OpenF1-Name ↔ FIA-Event: meist identisch, sonst über gemeinsame Wörter
  function matchEvent(events, name) {
    const norm = s => s.toLowerCase().replace(/grand prix|\bgp\b|formula 1|\bthe\b|\bof\b/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    const exact = events.find(e => e.toLowerCase() === name.toLowerCase());
    if (exact) return exact;
    const want = new Set(norm(name).split(" ").filter(Boolean));
    let best = null, score = 0;
    for (const e of events) {
      const sc = norm(e).split(" ").filter(w => want.has(w)).length;
      if (sc > score) { best = e; score = sc; }
    }
    return best;
  }
  async function loadDocs(force) {
    if (!docTarget) { renderDocs(); return; }
    const key = docTarget.year + "|" + docTarget.name;
    if (!force && docs.key === key && (docs.list || docs.error)) { renderDocs(); return; }
    docs = { key, list: null, error: false };
    $("doc-list").innerHTML = `<li class="doc-empty"><span class="spinner"></span></li>`;
    try {
      if (!fiaEvents.has(docTarget.year)) fiaEvents.set(docTarget.year, get("fia", { year: docTarget.year }).then(d => d.events || []));
      const ev = matchEvent(await fiaEvents.get(docTarget.year), docTarget.name);
      const list = ev ? (await get("fia", { year: docTarget.year, event: ev })).docs || [] : [];
      if (docs.key === key) docs.list = list;
    } catch (_) {
      fiaEvents.delete(docTarget.year);
      if (docs.key === key) docs.error = true;
    }
    renderDocs();
  }
  // „Car 5“ → „Car 5 BOR“ (Kürzel aus der geladenen Session)
  const carTags = t => S.race ? t.replace(/\bCars? ([\d, and]+)/g, (m, nums) =>
    m + nums.split(/\D+/).filter(Boolean).map(n => S.race.drivers.get(+n)).filter(Boolean).map(d => ` <i class="doc-car">${esc(d.abbr)}</i>`).join("")) : t;
  function renderDocs() {
    if (S.view !== "docs") return;
    docsTagged = !!S.race;
    const box = $("doc-list");
    if (!docTarget) { box.innerHTML = `<li class="doc-empty">Kein Wochenende gewählt.</li>`; return; }
    if (docs.error) { box.innerHTML = `<li class="doc-empty">fia.com ist gerade nicht erreichbar.</li>`; return; }
    if (!docs.list) return;
    const q = $("doc-q").value.trim().toLowerCase();
    const onlyDec = $("doc-dec").getAttribute("aria-pressed") === "true";
    const list = docs.list.filter(d => (!onlyDec || docClass(d.title) === "dec") &&
      (!q || d.title.toLowerCase().includes(q) || String(d.no) === q));
    if (!docs.list.length) { box.innerHTML = `<li class="doc-empty">Für ${esc(docTarget.name)} gibt es (noch) keine FIA-Dokumente.</li>`; return; }
    if (!list.length) { box.innerHTML = `<li class="doc-empty">Nichts gefunden.</li>`; return; }
    const fresh = Date.now() - 3 * 3600e3;
    box.innerHTML = list.map(d => {
      const c = docClass(d.title);
      // FIA-Zeit ist Ortszeit Mitteleuropa → so anzeigen, wie sie dasteht
      const when = d.date ? `${fmtDocDay.format(new Date(d.date + "Z"))} · ${d.date.slice(11, 16)}` : "";
      const isNew = d.date && Date.parse(d.date) > fresh;
      return `<li><button type="button" class="doc${isNew ? " doc-new" : ""}" data-path="${esc(d.path)}" data-title="${esc(d.title)}" data-no="${d.no ?? ""}">
        <span class="doc-no">${d.no ?? "–"}</span>
        <span class="doc-t"><b>${carTags(esc(d.title))}</b><small>${c ? `<span class="doc-tag ${c}">${c === "dec" ? "Entscheidung" : "Ergebnis"}</span>` : ""}${esc(when)}</small></span>
        <span class="doc-go" aria-hidden="true">›</span>
      </button></li>`;
    }).join("");
  }

  // PDF-Betrachter: pdf.js (selbst gehostet), PDF same-origin über /f1data/fia-pdf
  let pdfjs = null, pdfDoc = null, pdfZoom = 1, pdfRun = 0;
  async function openPdf(path, title, no) {
    const v = $("pdfview");
    $("pdf-title").textContent = title;
    $("pdf-sub").textContent = (no ? `Dokument ${no} · ` : "") + (docTarget ? docTarget.name : "");
    $("pdf-pages").innerHTML = `<div class="loading"><span class="spinner"></span><span>Lade PDF …</span></div>`;
    v.hidden = false; document.body.classList.add("pdf-open");
    if (!history.state || !history.state.pdf) history.pushState({ pdf: true }, "");   // Zurück-Taste schließt
    pdfZoom = 1;
    const run = ++pdfRun;
    try {
      if (!pdfjs) {
        pdfjs = await import(PDFJS + "pdf.min.mjs");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(PDFJS + "pdf.worker.min.mjs", location.href).href;
      }
      if (pdfDoc) { pdfDoc.destroy(); pdfDoc = null; }
      const doc = await pdfjs.getDocument({
        url: "/f1data/fia-pdf?path=" + encodeURIComponent(path),
        isEvalSupported: false,
        standardFontDataUrl: new URL(PDFJS + "standard_fonts/", location.href).href,
      }).promise;
      if (run !== pdfRun) { doc.destroy(); return; }
      pdfDoc = doc;
      await renderPdf(run);
    } catch (e) {
      if (run === pdfRun) $("pdf-pages").innerHTML = `<div class="loading err">PDF konnte nicht geladen werden.</div>`;
    }
  }
  async function renderPdf(run) {
    const box = $("pdf-pages");
    box.classList.toggle("fit", pdfZoom === 1);
    const width = Math.min(box.clientWidth - 30, 900) * pdfZoom;     // 2 × 12 px Rand + Luft für Scrollbalken
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const canvases = [];
    for (let i = 1; i <= pdfDoc.numPages; i++) {
      const page = await pdfDoc.getPage(i);
      if (run !== pdfRun) return;
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: width / base.width * dpr });
      const c = document.createElement("canvas");
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      c.style.width = Math.floor(vp.width / dpr) + "px";
      c.setAttribute("aria-label", `Seite ${i} von ${pdfDoc.numPages}`);
      await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      if (run !== pdfRun) return;
      if (i === 1) box.innerHTML = "";
      box.appendChild(c); canvases.push(c);
    }
  }
  function closePdf(fromHistory) {
    if ($("pdfview").hidden) return;
    pdfRun++;
    $("pdfview").hidden = true; document.body.classList.remove("pdf-open");
    $("pdf-pages").innerHTML = "";
    if (pdfDoc) { pdfDoc.destroy(); pdfDoc = null; }
    if (!fromHistory && history.state && history.state.pdf) history.back();
  }
  function zoomPdf(f) {
    if (!pdfDoc) return;
    pdfZoom = Math.max(1, Math.min(3, +(pdfZoom * f).toFixed(2)));
    renderPdf(++pdfRun);
  }
  RT.on("meeting", m => setDocTarget(m.name, m.date));
  RT.on("view", v => { if (v === "docs") loadDocs(); });
  // Fahrerkürzel nachtragen, sobald die Session geladen ist
  RT.on("show", () => { if (S.view === "docs" && !docsTagged) { docsTagged = true; renderDocs(); } });
  $("doc-q").addEventListener("input", renderDocs);
  $("doc-dec").addEventListener("click", e => {
    const b = e.currentTarget; b.setAttribute("aria-pressed", String(b.getAttribute("aria-pressed") !== "true")); renderDocs();
  });
  $("doc-list").addEventListener("click", e => {
    const b = e.target.closest(".doc");
    if (b) openPdf(b.dataset.path, b.dataset.title, b.dataset.no);
  });
  $("pdf-close").addEventListener("click", () => closePdf());
  $("pdf-in").addEventListener("click", () => zoomPdf(1.5));
  $("pdf-out").addEventListener("click", () => zoomPdf(1 / 1.5));
  window.addEventListener("popstate", () => closePdf(true));
  document.addEventListener("keydown", e => { if (e.key === "Escape") closePdf(); });
  // Aus einer FIA-Meldung geöffnet: #doc=<pfad>
  const deepDoc = /^#doc=(.+)$/.exec(location.hash);
  if (deepDoc) {
    history.replaceState(null, "", location.pathname + location.search);
    const p = decodeURIComponent(deepDoc[1]);
    const t = p.split("/").pop().replace(/\.pdf$/i, "").replace(/^\d{4}_[^-]+-_/, "").replace(/_/g, " ");
    RT.setView("docs");
    openPdf(p, t, null);
  }
})();
