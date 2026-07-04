// ====================================================================
// BLOCK BLAST — 8×8-Block-Puzzle mit globaler Bestenliste (D1)
//
// Regeln: 3 Teile pro Runde, per Drag & Drop aufs Brett. Volle Reihen
// UND Spalten werden gleichzeitig geräumt. Aufeinanderfolgende Räum-
// Züge erhöhen die Combo. Game Over, wenn kein Teil mehr passt.
//
// Punkte: 1 je gelegtem Block · Räumen: 10·n(n+1)/2 bei n Linien,
// multipliziert mit der Combo · leeres Brett: +300 Bonus.
// ====================================================================

const SIZE = 8;

// ---------- Formen (als Strings, X = Block) ----------
function shape(str, weight) {
  const rows = str.split("|");
  const cells = [];
  rows.forEach((row, r) => [...row].forEach((ch, c) => { if (ch === "X") cells.push([r, c]); }));
  return { cells, h: rows.length, w: Math.max(...rows.map(r => r.length)), weight };
}

const SHAPES = [
  // Punkte & Linien
  shape("X", 2.2),
  shape("XX", 2.4), shape("X|X", 2.4),
  shape("XXX", 2.2), shape("X|X|X", 2.2),
  shape("XXXX", 1.6), shape("X|X|X|X", 1.6),
  shape("XXXXX", 0.9), shape("X|X|X|X|X", 0.9),
  // Quadrate & Rechtecke
  shape("XX|XX", 2.4),
  shape("XXX|XXX", 1.3), shape("XX|XX|XX", 1.3),
  shape("XXX|XXX|XXX", 0.6),
  // Kleine Ecken (3 Blöcke)
  shape("X.|XX", 1.8), shape(".X|XX", 1.8), shape("XX|X.", 1.8), shape("XX|.X", 1.8),
  // Große Ecken (5 Blöcke)
  shape("X..|X..|XXX", 0.9), shape("..X|..X|XXX", 0.9),
  shape("XXX|X..|X..", 0.9), shape("XXX|..X|..X", 0.9),
  // T
  shape("XXX|.X.", 1.1), shape(".X.|XXX", 1.1), shape("X.|XX|X.", 1.1), shape(".X|XX|.X", 1.1),
  // S / Z
  shape(".XX|XX.", 1.0), shape("X.|XX|.X", 1.0),
  shape("XX.|.XX", 1.0), shape(".X|XX|X.", 1.0),
  // L / J (4 Blöcke)
  shape("X.|X.|XX", 1.1), shape("XXX|X..", 1.1), shape("XX|.X|.X", 1.1), shape("..X|XXX", 1.1),
  shape(".X|.X|XX", 1.1), shape("X..|XXX", 1.1), shape("XX|X.|X.", 1.1), shape("XXX|..X", 1.1),
];
const TOTAL_WEIGHT = SHAPES.reduce((s, x) => s + x.weight, 0);

function randomShapeIdx() {
  let r = Math.random() * TOTAL_WEIGHT;
  for (let i = 0; i < SHAPES.length; i++) {
    r -= SHAPES[i].weight;
    if (r <= 0) return i;
  }
  return 0;
}
function randomPiece() {
  return { s: randomShapeIdx(), color: 1 + Math.floor(Math.random() * 7) };
}

// ---------- Zustand ----------
let board = [];          // SIZE×SIZE, 0 = leer, 1..7 = Farbe
let tray = [null, null, null];
let score = 0;
let combo = 0;           // Combo-Streak (aufeinanderfolgende Räum-Züge)
let best = Number(localStorage.getItem("bb_best") || 0);
let over = false;
let submitted = false;

const $ = sel => document.querySelector(sel);
const boardEl = $("#board");
const fxEl = $("#fx-layer");

function getName() { return (localStorage.getItem("bb_name") || "").trim(); }

// ---------- Persistenz (laufendes Spiel überlebt Reload) ----------
function saveState() {
  localStorage.setItem("bb_state", JSON.stringify({ board, tray, score, combo }));
}
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem("bb_state") || "null");
    if (!s || !Array.isArray(s.board) || s.board.length !== SIZE) return false;
    board = s.board;
    tray = s.tray.map(p => (p && SHAPES[p.s] ? p : null));
    if (tray.every(p => !p)) tray = [randomPiece(), randomPiece(), randomPiece()];
    score = Number(s.score) || 0;
    combo = Number(s.combo) || 0;
    return true;
  } catch { return false; }
}

function newGame() {
  board = Array.from({ length: SIZE }, () => Array(SIZE).fill(0));
  tray = [randomPiece(), randomPiece(), randomPiece()];
  score = 0;
  combo = 0;
  over = false;
  submitted = false;
  saveState();
  renderAll();
}

// ---------- Logik ----------
function canPlace(sh, r0, c0) {
  return sh.cells.every(([r, c]) => {
    const rr = r0 + r, cc = c0 + c;
    return rr >= 0 && rr < SIZE && cc >= 0 && cc < SIZE && board[rr][cc] === 0;
  });
}
function anyPlacement(sh) {
  for (let r = 0; r <= SIZE - sh.h; r++)
    for (let c = 0; c <= SIZE - sh.w; c++)
      if (canPlace(sh, r, c)) return true;
  return false;
}
function movesLeft() {
  return tray.some(p => p && anyPlacement(SHAPES[p.s]));
}
function fullLines() {
  const rows = [], cols = [];
  for (let r = 0; r < SIZE; r++) if (board[r].every(v => v !== 0)) rows.push(r);
  for (let c = 0; c < SIZE; c++) if (board.every(row => row[c] !== 0)) cols.push(c);
  return { rows, cols };
}

// Linien, die eine Platzierung räumen WÜRDE (für die Vorschau)
function previewClears(sh, r0, c0) {
  const tmp = board.map(row => [...row]);
  sh.cells.forEach(([r, c]) => { tmp[r0 + r][c0 + c] = 1; });
  const rows = [], cols = [];
  for (let r = 0; r < SIZE; r++) if (tmp[r].every(v => v !== 0)) rows.push(r);
  for (let c = 0; c < SIZE; c++) if (tmp.every(row => row[c] !== 0)) cols.push(c);
  return { rows, cols };
}

function placePiece(slot, r0, c0) {
  const piece = tray[slot];
  const sh = SHAPES[piece.s];
  sh.cells.forEach(([r, c]) => { board[r0 + r][c0 + c] = piece.color; });
  tray[slot] = null;

  let gained = sh.cells.length;
  const { rows, cols } = fullLines();
  const n = rows.length + cols.length;

  renderBoard();
  sh.cells.forEach(([r, c]) => cellEl(r0 + r, c0 + c).classList.add("pop"));

  if (n > 0) {
    combo += 1;
    const base = 10 * n * (n + 1) / 2;
    const lineGain = base * combo;
    gained += lineGain;
    blastLines(rows, cols);
    sound.clear(Math.min(combo, 6));
    if (navigator.vibrate) navigator.vibrate(n >= 2 ? [30, 40, 50] : 25);
    if (n >= 2) shake();
    floatText(`+${lineGain}`, r0, c0, n >= 2 || combo >= 2);
    if (combo >= 2) setTimeout(() => floatCenter(`🔥 Combo x${combo}`), 240);
  } else {
    combo = 0;
    sound.place();
    if (navigator.vibrate) navigator.vibrate(10);
  }

  score += gained;

  // Board komplett leer geräumt → Bonus
  if (n > 0 && board.every(row => row.every(v => v === 0))) {
    score += 300;
    setTimeout(() => { floatCenter("✨ BOARD CLEAR! +300", true); sound.fanfare(); }, 380);
  }

  if (tray.every(p => !p)) tray = [randomPiece(), randomPiece(), randomPiece()];

  updateHud();
  renderTray();
  saveState();

  if (!movesLeft()) {
    over = true;
    setTimeout(gameOver, n > 0 ? 650 : 350);
  }
}

function blastLines(rows, cols) {
  const doomed = new Set();
  rows.forEach(r => { for (let c = 0; c < SIZE; c++) doomed.add(r * SIZE + c); });
  cols.forEach(c => { for (let r = 0; r < SIZE; r++) doomed.add(r * SIZE + c); });
  // Board-Array sofort leeren (Logik), nur die Optik verzögert räumen
  doomed.forEach(idx => { board[Math.floor(idx / SIZE)][idx % SIZE] = 0; });
  doomed.forEach(idx => {
    const r = Math.floor(idx / SIZE), c = idx % SIZE;
    const el = cellEl(r, c);
    el.style.animationDelay = `${(r + c) * 18}ms`;
    el.classList.add("blast");
  });
  setTimeout(() => { renderBoard(); }, 340 + 14 * 18);
}

// ---------- Rendering ----------
function cellEl(r, c) { return boardEl.children[r * SIZE + c]; }

function renderBoard() {
  if (!boardEl.children.length) {
    for (let i = 0; i < SIZE * SIZE; i++) {
      boardEl.appendChild(document.createElement("div"));
    }
  }
  for (let r = 0; r < SIZE; r++) {
    for (let c = 0; c < SIZE; c++) {
      const el = cellEl(r, c);
      const v = board[r][c];
      el.className = "cell" + (v ? ` blk c${v}` : "");
      el.style.animationDelay = "";
    }
  }
}

function renderTray() {
  document.querySelectorAll(".slot").forEach((slotEl, i) => {
    slotEl.innerHTML = "";
    const piece = tray[i];
    if (!piece) return;
    const sh = SHAPES[piece.s];
    const el = document.createElement("div");
    el.className = "piece";
    const mini = Math.min(20, Math.floor(84 / Math.max(sh.w, sh.h)));
    el.style.setProperty("--mini", mini + "px");
    el.style.gridTemplateColumns = `repeat(${sh.w}, ${mini}px)`;
    const grid = Array.from({ length: sh.h }, () => Array(sh.w).fill(false));
    sh.cells.forEach(([r, c]) => { grid[r][c] = true; });
    grid.forEach(row => row.forEach(filled => {
      const d = document.createElement("div");
      d.className = filled ? `blk c${piece.color}` : "void";
      el.appendChild(d);
    }));
    el.dataset.slot = i;
    slotEl.appendChild(el);
  });
}

function updateHud() {
  $("#score").textContent = score;
  if (score > best) { best = score; localStorage.setItem("bb_best", best); }
  $("#best").textContent = best;
  const chip = $("#combo-chip");
  if (combo >= 2) { chip.classList.remove("hidden"); $("#combo-n").textContent = "x" + combo; }
  else chip.classList.add("hidden");
}

function renderAll() { renderBoard(); renderTray(); updateHud(); }

// ---------- FX ----------
function floatText(text, r, c, big = false) {
  const rect = boardEl.getBoundingClientRect();
  const wrap = $("#board-wrap").getBoundingClientRect();
  const el = document.createElement("div");
  el.className = "float-text" + (big ? " big" : "");
  el.textContent = text;
  el.style.left = rect.left - wrap.left + (c + 1) * (rect.width / SIZE) + "px";
  el.style.top = rect.top - wrap.top + r * (rect.height / SIZE) + "px";
  fxEl.appendChild(el);
  setTimeout(() => el.remove(), 950);
}
function floatCenter(text, big = false) {
  const el = document.createElement("div");
  el.className = "float-text" + (big ? " big" : "");
  el.textContent = text;
  el.style.left = "50%";
  el.style.top = "45%";
  fxEl.appendChild(el);
  setTimeout(() => el.remove(), 950);
}
function shake() {
  const w = $("#board-wrap");
  w.classList.remove("shake");
  void w.offsetWidth;
  w.classList.add("shake");
}
function confetti() {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  document.querySelectorAll(".confetti").forEach(el => el.remove());
  const colors = ["#e8c15a", "#fff3c4", "#79c793", "#5ec4c9", "#b08ade", "#e2685a"];
  const box = document.createElement("div");
  box.className = "confetti";
  box.innerHTML = Array.from({ length: 70 }, () => {
    const left = Math.random() * 100;
    const delay = Math.random() * 1.1;
    const dur = 2.4 + Math.random() * 2;
    const color = colors[Math.floor(Math.random() * colors.length)];
    const rot = Math.floor(Math.random() * 360);
    return `<i style="left:${left}vw;background:${color};transform:rotate(${rot}deg);animation-duration:${dur}s;animation-delay:${delay}s"></i>`;
  }).join("");
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 6000);
}

// ---------- Sound (WebAudio, winzige Synth-Bleeps) ----------
const sound = (() => {
  let ctx = null;
  let muted = localStorage.getItem("bb_muted") === "1";
  function ensure() {
    if (!ctx) try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
    return ctx;
  }
  function tone(freq, dur, type = "sine", gain = 0.12, when = 0) {
    if (muted || !ensure()) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
  return {
    place() { tone(340, 0.08, "triangle", 0.1); },
    pick()  { tone(520, 0.05, "triangle", 0.07); },
    clear(n) {
      [523, 659, 784, 988, 1175, 1397].slice(0, Math.max(2, n + 1))
        .forEach((f, i) => tone(f, 0.14, "triangle", 0.11, i * 0.06));
    },
    fanfare() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, "sine", 0.12, i * 0.09)); },
    dead() { tone(220, 0.3, "sawtooth", 0.06); tone(165, 0.4, "sawtooth", 0.06, 0.12); },
    toggle() {
      muted = !muted;
      localStorage.setItem("bb_muted", muted ? "1" : "0");
      return muted;
    },
    get muted() { return muted; },
  };
})();

// ---------- Drag & Drop (Pointer Events) ----------
let drag = null; // {slot, sh, color, ghost, cellPx, gapPx, offX, offY, lastValid}

function startDrag(slot, e) {
  if (over) return;
  const piece = tray[slot];
  if (!piece) return;
  const sh = SHAPES[piece.s];

  const cellRect = boardEl.children[0].getBoundingClientRect();
  const cellPx = cellRect.width;
  const gapPx = 5;
  const step = cellPx + gapPx;

  const ghost = document.createElement("div");
  ghost.id = "ghost";
  ghost.style.gridTemplateColumns = `repeat(${sh.w}, ${cellPx}px)`;
  ghost.style.gap = gapPx + "px";
  const grid = Array.from({ length: sh.h }, () => Array(sh.w).fill(false));
  sh.cells.forEach(([r, c]) => { grid[r][c] = true; });
  grid.forEach(row => row.forEach(filled => {
    const d = document.createElement("div");
    d.className = filled ? `blk c${piece.color}` : "void";
    d.style.width = cellPx + "px";
    d.style.height = cellPx + "px";
    ghost.appendChild(d);
  }));
  document.body.appendChild(ghost);

  const touch = e.pointerType !== "mouse";
  const gw = sh.w * step - gapPx;
  const gh = sh.h * step - gapPx;
  drag = {
    slot, sh, color: piece.color, ghost, cellPx, gapPx, step,
    offX: gw / 2,
    offY: touch ? gh + 46 : gh / 2,
    lastValid: null,
  };

  document.querySelector(`.slot[data-slot="${slot}"] .piece`)?.classList.add("dragging");
  sound.pick();
  moveDrag(e);
}

function moveDrag(e) {
  if (!drag) return;
  const x = e.clientX - drag.offX;
  const y = e.clientY - drag.offY;
  drag.ghost.style.left = x + "px";
  drag.ghost.style.top = y + "px";

  const rect = boardEl.getBoundingClientRect();
  const pad = 8;
  const col = Math.round((x - rect.left - pad) / drag.step);
  const row = Math.round((y - rect.top - pad) / drag.step);

  clearPreview();
  if (row >= 0 && col >= 0 && row + drag.sh.h <= SIZE && col + drag.sh.w <= SIZE && canPlace(drag.sh, row, col)) {
    drag.lastValid = [row, col];
    drag.sh.cells.forEach(([r, c]) => cellEl(row + r, col + c).classList.add("preview-ok"));
    const { rows, cols } = previewClears(drag.sh, row, col);
    rows.forEach(r => { for (let c = 0; c < SIZE; c++) markWillClear(r, c); });
    cols.forEach(c => { for (let r = 0; r < SIZE; r++) markWillClear(r, c); });
  } else {
    drag.lastValid = null;
  }
}

function markWillClear(r, c) {
  const el = cellEl(r, c);
  el.classList.add("will-clear");
  if (board[r][c] !== 0) el.classList.add("filled-hint");
}

function clearPreview() {
  boardEl.querySelectorAll(".preview-ok, .will-clear").forEach(el =>
    el.classList.remove("preview-ok", "will-clear", "filled-hint"));
}

function endDrag() {
  if (!drag) return;
  const { slot, lastValid } = drag;
  drag.ghost.remove();
  clearPreview();
  document.querySelector(`.slot[data-slot="${slot}"] .piece`)?.classList.remove("dragging");
  const d = drag;
  drag = null;
  if (lastValid) placePiece(slot, lastValid[0], lastValid[1]);
}

document.addEventListener("pointerdown", e => {
  const pieceEl = e.target.closest(".slot .piece");
  if (pieceEl) {
    e.preventDefault();
    startDrag(Number(pieceEl.dataset.slot), e);
  }
});
document.addEventListener("pointermove", e => { if (drag) { e.preventDefault(); moveDrag(e); } }, { passive: false });
document.addEventListener("pointerup", endDrag);
document.addEventListener("pointercancel", endDrag);

// ---------- Game Over & Bestenliste ----------
async function submitScore() {
  const name = getName();
  if (!name || score <= 0 || submitted) return null;
  submitted = true;
  try {
    const res = await fetch("/api/blockblast/scores", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, score }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Fehler");
    return data.rank;
  } catch {
    submitted = false;
    return null;
  }
}

async function gameOver() {
  sound.dead();
  const isRecord = score >= best && score > 0;
  if (isRecord) confetti();
  localStorage.removeItem("bb_state");

  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="panel">
      <h2>${isRecord ? "Neuer Rekord!" : "Game Over"}</h2>
      <div class="go-score">${score}</div>
      ${isRecord ? `<div class="go-best-badge">👑 Persönliche Bestleistung</div>` : `<div class="sub">Bestleistung: ${best}</div>`}
      <div class="go-rank" id="go-rank"></div>
      <div id="go-name-area"></div>
      <button class="btn-primary" id="go-again">Nochmal spielen</button>
      <button class="btn-secondary" id="go-top">🏆 Bestenliste ansehen</button>
    </div>`;
  document.body.appendChild(overlay);

  overlay.querySelector("#go-again").onclick = () => { overlay.remove(); newGame(); };
  overlay.querySelector("#go-top").onclick = () => showLeaderboard();

  const rankEl = overlay.querySelector("#go-rank");
  const nameArea = overlay.querySelector("#go-name-area");

  if (!getName() && score > 0) {
    // Erster Game Over ohne Namen → einmalig festlegen
    nameArea.innerHTML = `
      <p class="sub">Wie sollen wir dich in der Bestenliste nennen?</p>
      <input type="text" id="go-name" maxlength="16" placeholder="Dein Name" autocomplete="off">
      <button class="btn-secondary" id="go-save" style="margin-bottom:10px">Score eintragen</button>`;
    nameArea.querySelector("#go-save").onclick = async () => {
      const v = nameArea.querySelector("#go-name").value.trim().slice(0, 16);
      if (!v) return;
      localStorage.setItem("bb_name", v);
      updateNameLabel();
      nameArea.innerHTML = "";
      rankEl.textContent = "Übertrage …";
      const rank = await submitScore();
      rankEl.innerHTML = rank ? `Weltweit <b>Platz ${rank}</b> als ${escHtml(v)}` : "Konnte nicht übertragen werden";
    };
  } else if (score > 0) {
    rankEl.textContent = "Übertrage …";
    const rank = await submitScore();
    rankEl.innerHTML = rank
      ? `Weltweit <b>Platz ${rank}</b> als ${escHtml(getName())}`
      : "Score konnte nicht übertragen werden";
  }
}

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
      <p class="sub">Die 50 besten Blast-Runden weltweit</p>
      <div id="lb-content"><p class="lb-empty">Lade …</p></div>
      <button class="btn-secondary" id="lb-close">Schließen</button>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) close(); };
  overlay.querySelector("#lb-close").onclick = close;

  try {
    const res = await fetch("/api/blockblast/scores");
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
        <span class="lb-score">${row.score}</span>
      </li>`).join("")}</ol>`;
  } catch {
    overlay.querySelector("#lb-content").innerHTML = `<p class="lb-empty">Bestenliste nicht erreichbar</p>`;
  }
}

// ---------- Name setzen / ändern ----------
function updateNameLabel() {
  $("#name-label").textContent = getName() || "Name";
}

function showNameDialog() {
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  overlay.innerHTML = `
    <div class="panel">
      <h2>Dein Name</h2>
      <p class="sub">Wird auf diesem Gerät gespeichert und für die globale Bestenliste verwendet.</p>
      <input type="text" id="nm-input" maxlength="16" placeholder="Dein Name" autocomplete="off" value="${escHtml(getName())}">
      <button class="btn-primary" id="nm-save">Speichern</button>
      <button class="btn-secondary" id="nm-cancel">Abbrechen</button>
    </div>`;
  document.body.appendChild(overlay);
  const input = overlay.querySelector("#nm-input");
  input.focus();
  input.select();
  const close = () => overlay.remove();
  overlay.onclick = e => { if (e.target === overlay) close(); };
  overlay.querySelector("#nm-cancel").onclick = close;
  const save = () => {
    const v = input.value.trim().slice(0, 16);
    if (v) localStorage.setItem("bb_name", v);
    else localStorage.removeItem("bb_name");
    updateNameLabel();
    close();
  };
  overlay.querySelector("#nm-save").onclick = save;
  input.onkeydown = e => { if (e.key === "Enter") save(); };
}

// ---------- UI-Verdrahtung ----------
$("#btn-top").onclick = () => showLeaderboard();
$("#btn-name").onclick = () => showNameDialog();
$("#btn-restart").onclick = () => {
  if (score > 0 && !over && !confirm("Laufendes Spiel wirklich verwerfen?")) return;
  newGame();
};
const soundBtn = $("#btn-sound");
soundBtn.textContent = sound.muted ? "🔇" : "🔊";
soundBtn.onclick = () => { soundBtn.textContent = sound.toggle() ? "🔇" : "🔊"; };

// ---------- Start ----------
updateNameLabel();
if (loadState()) {
  renderAll();
  if (!movesLeft()) { over = true; setTimeout(gameOver, 400); }
} else {
  newGame();
}
