// ====================================================================
// LICHTWERK — Spiegel drehen, Strahlen lenken, Kristalle entzünden.
// Leveldaten & Simulation: levels.js (LW_LEVELS, lwSimulate)
// ====================================================================

const $ = sel => document.querySelector(sel);
const canvas = $("#board");
const ctx = canvas.getContext("2d");
const holder = $("#board-holder");

const GOLD = "#e8c15a", CYAN = "#5ec4c9", WHITE = "#f8f5ea";
const COLORS = { 1: GOLD, 2: CYAN, 3: WHITE };

// ---------- Fortschritt ----------
function loadStars() {
  try { return JSON.parse(localStorage.getItem("lw_stars") || "{}"); }
  catch { return {}; }
}
function saveStars(s) { localStorage.setItem("lw_stars", JSON.stringify(s)); }
function totalStars() {
  const s = loadStars();
  return Object.values(s).reduce((a, b) => a + b, 0);
}
function getName() { return (localStorage.getItem("bb_name") || "").trim(); }

// ---------- Zustand ----------
let cur = -1;               // aktueller Level-Index
let level = null;
let orient = [];            // Orientierung je Item
let moves = 0;
let sim = null;
let won = false;
let dispAngle = [];         // animierte Spiegelwinkel
let litPrev = new Set();
let CELL = 48, OX = 0, OY = 0;

// ---------- Level-Auswahl ----------
function showSelect() {
  cur = -1;
  $("#screen-game").classList.add("hidden");
  $("#screen-select").classList.remove("hidden");
  const stars = loadStars();
  $("#star-total").textContent = `★ ${totalStars()} / ${LW_LEVELS.length * 3} Sterne`;
  const grid = $("#level-grid");
  grid.innerHTML = LW_LEVELS.map((lv, i) => {
    const st = stars[i] || 0;
    const unlocked = i === 0 || (stars[i - 1] || 0) > 0;
    return `
      <button class="lvl-tile ${st ? "done" : ""} ${unlocked ? "" : "locked"}" data-i="${i}" style="--i:${i}">
        <span class="n">${i + 1}</span>
        <span class="stars">${st ? "★".repeat(st) + "☆".repeat(3 - st) : (unlocked ? "· · ·" : "")}</span>
      </button>`;
  }).join("");
  grid.querySelectorAll(".lvl-tile").forEach(el => {
    el.onclick = () => openLevel(Number(el.dataset.i));
  });
}

function openLevel(i) {
  cur = i;
  level = LW_LEVELS[i];
  orient = level.items.map(it => (it.t === "mi" ? it.o : 0));
  dispAngle = level.items.map(it => (it.t === "mi" ? mirrorAngle(it.o) : 0));
  moves = 0;
  won = false;
  litPrev = new Set();
  $("#screen-select").classList.add("hidden");
  $("#screen-game").classList.remove("hidden");
  $("#lvl-name").textContent = `${i + 1} · ${level.name}`;
  updateSub();
  resizeBoard();
  resim();
}

function mirrorAngle(o) { return o === 0 ? -45 : 45; }

function updateSub() {
  $("#lvl-sub").textContent = `${moves} Züge · Par ${level.par}`;
}

function resizeBoard() {
  if (!level) return;
  const availW = holder.clientWidth;
  const availH = holder.clientHeight;
  CELL = Math.floor(Math.min(availW / level.w, availH / level.h, 64));
  const w = CELL * level.w, h = CELL * level.h;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = w + "px";
  canvas.style.height = h + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resizeBoard);

function resim() {
  sim = lwSimulate(level, orient);
  // Neu entzündete Kristalle → Ping
  const lit = new Set();
  level.items.forEach((it, idx) => {
    if (it.t === "cr" && (sim.hits[idx] || 0) === it.need) lit.add(idx);
  });
  for (const idx of lit) if (!litPrev.has(idx)) sound.lit();
  litPrev = lit;

  if (sim.win && !won) {
    won = true;
    setTimeout(winLevel, 550);
  }
}

// ---------- Interaktion ----------
canvas.addEventListener("pointerdown", e => {
  if (!level || won) return;
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) / CELL);
  const y = Math.floor((e.clientY - rect.top) / CELL);
  const idx = level.items.findIndex(it => it.x === x && it.y === y && it.t === "mi");
  if (idx < 0) return;
  orient[idx] ^= 1;
  dispAngle[idx] += 90;      // fühlt sich wie echtes Drehen an
  moves++;
  updateSub();
  sound.rotate();
  if (navigator.vibrate) navigator.vibrate(8);
  resim();
});

$("#btn-levels").onclick = () => showSelect();
$("#btn-reset").onclick = () => { if (cur >= 0) openLevel(cur); };
$("#btn-top").onclick = () => showLeaderboard();

// ---------- Gewonnen ----------
function starsFor(m, par) {
  if (m <= par) return 3;
  if (m <= par + 2) return 2;
  return 1;
}

async function winLevel() {
  const st = starsFor(moves, level.par);
  const all = loadStars();
  all[cur] = Math.max(all[cur] || 0, st);
  saveStars(all);
  sound.win();
  if (st === 3) confetti();
  if (navigator.vibrate) navigator.vibrate([30, 40, 60]);

  const hasNext = cur + 1 < LW_LEVELS.length;
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="panel">
      <h2>${st === 3 ? "Perfekt!" : "Geschafft!"}</h2>
      <div class="win-stars">${"★".repeat(st)}${"☆".repeat(3 - st)}</div>
      <div class="win-moves">${moves} Züge (Par ${level.par})${st < 3 ? " · Par schaffen = ★★★" : ""}</div>
      <div class="win-moves" id="lw-rank"></div>
      <div id="lw-name-area"></div>
      ${hasNext ? `<button class="btn-primary" id="w-next">Weiter → Level ${cur + 2}</button>` : `<button class="btn-primary" id="w-done">🏆 Alle Level geschafft!</button>`}
      <button class="btn-secondary" id="w-retry">↺ Nochmal (für mehr Sterne)</button>
      <button class="btn-secondary" id="w-select" style="margin-top:10px">Levelübersicht</button>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => overlay.remove();
  if (hasNext) overlay.querySelector("#w-next").onclick = () => { close(); openLevel(cur + 1); };
  else overlay.querySelector("#w-done").onclick = () => { close(); showSelect(); confetti(); };
  overlay.querySelector("#w-retry").onclick = () => { close(); openLevel(cur); };
  overlay.querySelector("#w-select").onclick = () => { close(); showSelect(); };

  // Sterne-Gesamtstand in die Bestenliste
  const rankEl = overlay.querySelector("#lw-rank");
  const nameArea = overlay.querySelector("#lw-name-area");
  if (!getName()) {
    nameArea.innerHTML = `
      <p class="sub">Dein Name für die Bestenliste (einmalig):</p>
      <input type="text" id="lw-name" maxlength="16" placeholder="Dein Name" autocomplete="off">
      <button class="btn-secondary" id="lw-save" style="margin-bottom:10px">Speichern</button>`;
    nameArea.querySelector("#lw-save").onclick = async () => {
      const v = nameArea.querySelector("#lw-name").value.trim().slice(0, 16);
      if (!v) return;
      localStorage.setItem("bb_name", v);
      nameArea.innerHTML = "";
      const resp = await submitScore();
      if (resp) rankEl.textContent = `🌍 Weltweit Platz ${resp.rank} mit ${totalStars()} ★`;
    };
  } else {
    const resp = await submitScore();
    if (resp) rankEl.textContent = `🌍 Weltweit Platz ${resp.rank} mit ${totalStars()} ★`;
  }
}

async function submitScore() {
  const name = getName();
  const score = totalStars();
  if (!name || score <= 0) return null;
  try {
    const res = await fetch("/api/lichtwerk/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, score }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error();
    return data;
  } catch { return null; }
}

// ---------- Rendering ----------
function draw(now) {
  requestAnimationFrame(draw);
  if (cur < 0 || !level) return;

  const w = CELL * level.w, h = CELL * level.h;
  ctx.clearRect(0, 0, w, h);
  const C = c => (c - 0) * CELL + CELL / 2;

  // Gitterpunkte
  ctx.fillStyle = "rgba(244,239,226,0.07)";
  for (let x = 0; x < level.w; x++)
    for (let y = 0; y < level.h; y++)
      ctx.fillRect(C(x) - 1, C(y) - 1, 2, 2);

  // Spiegelwinkel animieren
  level.items.forEach((it, idx) => {
    if (it.t !== "mi") return;
    const target = Math.round(dispAngle[idx] / 90) * 90;
    dispAngle[idx] += (target - dispAngle[idx]) * 0.25;
  });

  // Strahlen (unter den Items)
  const pulse = 0.75 + 0.25 * Math.sin(now / 300);
  for (const s of sim.segs) {
    const x1 = C(s.x1), y1 = C(s.y1);
    const x2 = Math.max(-CELL / 2, Math.min(w + CELL / 2, C(s.x2)));
    const y2 = Math.max(-CELL / 2, Math.min(h + CELL / 2, C(s.y2)));
    const col = COLORS[s.c];
    ctx.lineCap = "round";
    ctx.globalAlpha = 0.22 * pulse;
    ctx.strokeStyle = col;
    ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Items
  level.items.forEach((it, idx) => {
    const x = C(it.x), y = C(it.y);
    const r = CELL * 0.36;

    if (it.t === "wa") {
      ctx.fillStyle = "#1c241e";
      roundRect(x - r, y - r, r * 2, r * 2, 6);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,252,240,0.12)";
      ctx.lineWidth = 1;
      roundRect(x - r, y - r, r * 2, r * 2, 6);
      ctx.stroke();
    }

    if (it.t === "em") {
      const col = COLORS[it.c];
      ctx.fillStyle = "#131a14";
      roundRect(x - r, y - r, r * 2, r * 2, 8);
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      roundRect(x - r, y - r, r * 2, r * 2, 8);
      ctx.stroke();
      // Richtungs-Nase
      const d = { R: [1, 0], L: [-1, 0], U: [0, -1], D: [0, 1] }[it.dir];
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x + d[0] * r * 0.55, y + d[1] * r * 0.55, CELL * 0.09, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, CELL * 0.12, 0, Math.PI * 2);
      ctx.fill();
    }

    if (it.t === "mi") {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((dispAngle[idx] * Math.PI) / 180);
      // Fassung
      ctx.strokeStyle = "rgba(244,239,226,0.15)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, 0, r * 1.12, 0, Math.PI * 2); ctx.stroke();
      // Spiegelfläche
      const grad = ctx.createLinearGradient(0, -r, 0, r);
      grad.addColorStop(0, "#fff8dc");
      grad.addColorStop(0.5, "#e8c15a");
      grad.addColorStop(1, "#8a6a1c");
      ctx.strokeStyle = grad;
      ctx.lineWidth = CELL * 0.13;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(0, r);
      ctx.stroke();
      ctx.restore();
    }

    if (it.t === "sp") {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = "#131a14";
      roundRect(-r * 0.7, -r * 0.7, r * 1.4, r * 1.4, 5);
      ctx.fill();
      ctx.strokeStyle = "rgba(232,193,90,0.7)";
      ctx.lineWidth = 1.5;
      roundRect(-r * 0.7, -r * 0.7, r * 1.4, r * 1.4, 5);
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = "rgba(232,193,90,0.85)";
      [[0, -0.5], [0, 0.5], [-0.5, 0], [0.5, 0]].forEach(([px, py]) => {
        ctx.beginPath();
        ctx.arc(x + px * r, y + py * r, 2, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    if (it.t === "cr") {
      const got = sim.hits[idx] || 0;
      const litOk = got === it.need;
      const col = COLORS[it.need];
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.PI / 4);
      const s = r * 0.82;
      if (litOk) {
        ctx.shadowColor = col;
        ctx.shadowBlur = 16 * pulse;
        ctx.fillStyle = col;
        roundRect(-s, -s, s * 2, s * 2, 5);
        ctx.fill();
        ctx.shadowBlur = 0;
      } else {
        if (got) {
          ctx.fillStyle = COLORS[got] || "#333";
          ctx.globalAlpha = 0.3;
          roundRect(-s, -s, s * 2, s * 2, 5);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.strokeStyle = col;
        ctx.lineWidth = 2;
        ctx.setLineDash(got && got !== it.need ? [4, 3] : []);
        roundRect(-s, -s, s * 2, s * 2, 5);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }
  });
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

requestAnimationFrame(draw);

// ---------- Sound ----------
const sound = (() => {
  let ctxA = null;
  function ensure() {
    if (!ctxA) try { ctxA = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
    return ctxA;
  }
  function tone(freq, dur, type = "sine", gain = 0.1, when = 0) {
    if (!ensure()) return;
    const t = ctxA.currentTime + when;
    const o = ctxA.createOscillator();
    const g = ctxA.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctxA.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  return {
    rotate() { tone(520, 0.06, "triangle", 0.07); },
    lit() { tone(1047, 0.15, "sine", 0.1); tone(1319, 0.18, "sine", 0.08, 0.06); },
    win() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, "sine", 0.12, i * 0.09)); },
  };
})();

// ---------- Konfetti ----------
function confetti() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  document.querySelectorAll(".confetti").forEach(el => el.remove());
  const colors = ["#e8c15a", "#fff3c4", "#5ec4c9", "#f4efe2"];
  const box = document.createElement("div");
  box.className = "confetti";
  box.innerHTML = Array.from({ length: 50 }, () => {
    const left = Math.random() * 100;
    const delay = Math.random() * 1;
    const dur = 2.4 + Math.random() * 2;
    const color = colors[Math.floor(Math.random() * colors.length)];
    const rot = Math.floor(Math.random() * 360);
    return `<i style="left:${left}vw;background:${color};transform:rotate(${rot}deg);animation-duration:${dur}s;animation-delay:${delay}s"></i>`;
  }).join("");
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 6000);
}

// ---------- Bestenliste ----------
function escHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

async function showLeaderboard() {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="panel">
      <h2><span class="foil">Bestenliste</span></h2>
      <p class="sub">Gesammelte Sterne weltweit (max. ${LW_LEVELS.length * 3})</p>
      <div id="lb-content"><p class="lb-empty">Lade …</p></div>
      <button class="btn-secondary" id="lb-close">Schließen</button>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) close(); };
  overlay.querySelector("#lb-close").onclick = close;

  try {
    const res = await fetch("/api/lichtwerk/scores");
    const data = await res.json();
    const me = getName().toLowerCase();
    const medals = ["🥇", "🥈", "🥉"];
    const content = overlay.querySelector("#lb-content");
    if (!data.top?.length) {
      content.innerHTML = `<p class="lb-empty">Noch keine Einträge — sei die/der Erste!</p>`;
      return;
    }
    content.innerHTML = `<ol class="lb-list">${data.top.map((row, i) => `
      <li class="${row.name.toLowerCase() === me ? "me" : ""}">
        <span class="lb-rank">${medals[i] || i + 1}</span>
        <span class="lb-name">${escHtml(row.name)}</span>
        <span class="lb-score">${row.score} ★</span>
      </li>`).join("")}</ol>`;
  } catch {
    overlay.querySelector("#lb-content").innerHTML = `<p class="lb-empty">Bestenliste nicht erreichbar</p>`;
  }
}

// ---------- Start ----------
showSelect();
if (new URLSearchParams(location.search).has("auto")) openLevel(0);
