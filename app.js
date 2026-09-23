import { Csound } from "./lib/csound.js";
import { createEngine, splitCode, classifyLines } from "./engine.js";
import { createFox } from "./fox.js";
import { highlight, escapeHtml } from "./highlight.js";
import { SHORTCUTS, LIMITS } from "./registry.js";

const $ = (id) => document.getElementById(id);
const editor = $("editor");
const consoleEl = $("console");
const statusEl = $("status");
const startBtn = $("start");
const stopBtn = $("stop");
const canvas = $("scope");
const bpmInput = $("bpm");
const barInput = $("bar");
const posEl = $("pos");
let beatTimer = null;

const SAMPLE_VERSION = 18;
const SAMPLE = `; ============================================================
; CLive feature tour. Press Start, then either select everything
; and press Ctrl+Enter, or evaluate one block at a time from top
; to bottom (blank lines separate blocks).
; Ctrl+Enter: block/selection   Alt+Enter: line   Ctrl+.: silence
; Players and score lines always start on the next bar line.
; ============================================================

; 1. Clock and defaults
tempo 120
bar 4
scale "major"
root 0

bus1: bus(amp=0.6, pan=0)
; 2. Reverbs are shared send-return buses. Change a value and
; re-evaluate the line: it updates live, without a restart.
rev1: reverb(decay=0.92, lowcut=250, highcut=5500, level=0.55)
rev2: reverb(decay=0.6, lowcut=120, highcut=9000, level=0.3)

p1: pluck@bus1(0, dur=1, send=rev1(0.2))
`;

const STORE_KEY = "clive.tabs";
// Tab persistence is switched off for now: every launch starts from the default tab.
const PERSIST = false;
const highlightEl = $("highlight");
const flashEl = $("flash");
const tabsEl = $("tabs");
const renderHighlight = () => (highlightEl.innerHTML = highlight(editor.value));

const isTab = (t) => t && typeof t.name === "string" && typeof t.code === "string";

function loadState() {
  if (!PERSIST) return { tabs: [{ name: "main", code: SAMPLE }], active: 0, sampleVersion: SAMPLE_VERSION, shippedSample: SAMPLE };
  try {
    const raw = JSON.parse(localStorage.getItem(STORE_KEY));
    if (raw && Array.isArray(raw.tabs)) raw.tabs = raw.tabs.filter(isTab);
    if (raw && raw.tabs?.length) {
      raw.active = Math.min(Math.max(0, raw.active | 0), raw.tabs.length - 1);
      if (raw.sampleVersion !== SAMPLE_VERSION) {
        // Only touch "main" if it's still exactly what was last shipped -- update it in
        // place so an untouched tab keeps showing the current tour. If it has been
        // edited, leave it alone entirely: no rename, no forked "main (old)" tab, no
        // new tab inserted. The user's own edits are just theirs from then on.
        const main = raw.tabs.find((t) => t.name === "main");
        if (main && main.code === raw.shippedSample) {
          main.code = SAMPLE;
          raw.active = raw.tabs.indexOf(main);
        }
        raw.shippedSample = SAMPLE;
        raw.sampleVersion = SAMPLE_VERSION;
      }
      return raw;
    }
    const legacy = localStorage.getItem("clive.code");
    if (legacy !== null) {
      const code = legacy.replace(/^(\s*[A-Za-z_]\w*)\s*>>/gm, "$1:");
      return { tabs: [{ name: "main", code }], active: 0, sampleVersion: SAMPLE_VERSION, shippedSample: SAMPLE };
    }
  } catch {
    // Storage unavailable or corrupt: start from the example.
  }
  return { tabs: [{ name: "main", code: SAMPLE }], active: 0, sampleVersion: SAMPLE_VERSION, shippedSample: SAMPLE };
}

const state = loadState();
const saveState = () => {
  if (!PERSIST) return;
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch {
    // Storage full or blocked: the session still works, it just will not persist.
  }
};
saveState();
const activeTab = () => state.tabs[state.active];

function showTab() {
  const tab = activeTab();
  editor.value = tab.code;
  editor.setSelectionRange(tab.cursor ?? 0, tab.cursor ?? 0);
  renderHighlight();
  flashEl.textContent = "";
  renderTabs();
  editor.scrollTop = tab.scroll ?? 0;
  editor.scrollLeft = 0;
  for (const el of [flashEl, highlightEl]) el.scrollTop = editor.scrollTop;
}

function selectTab(i) {
  if (i === state.active) return;
  Object.assign(activeTab(), { cursor: editor.selectionStart, scroll: editor.scrollTop });
  state.active = i;
  saveState();
  showTab();
  editor.focus();
}

function addTab() {
  Object.assign(activeTab(), { cursor: editor.selectionStart, scroll: editor.scrollTop });
  let n = state.tabs.length + 1;
  while (state.tabs.some((t) => t.name === `untitled ${n}`)) n++;
  state.tabs.push({ name: `untitled ${n}`, code: "" });
  state.active = state.tabs.length - 1;
  saveState();
  showTab();
  editor.focus();
}

function closeTab(i) {
  const tab = state.tabs[i];
  if (tab.code.trim() && !confirm(`Close "${tab.name}"? Its code will be lost.`)) return;
  state.tabs.splice(i, 1);
  if (!state.tabs.length) state.tabs.push({ name: "untitled", code: "" });
  if (i < state.active) state.active--;
  state.active = Math.min(state.active, state.tabs.length - 1);
  saveState();
  showTab();
}

function renameTab(i) {
  const name = prompt("Tab name", state.tabs[i].name)?.trim();
  if (!name) return;
  state.tabs[i].name = name;
  saveState();
  renderTabs();
}

function renderTabs() {
  const items = state.tabs.map((tab, i) => {
    const el = document.createElement("div");
    el.className = "tab" + (i === state.active ? " active" : "");
    el.title = "Double-click to rename";
    const label = document.createElement("span");
    label.textContent = tab.name;
    const close = document.createElement("button");
    close.className = "tab-close";
    close.textContent = "×";
    close.title = "Close tab";
    el.append(label, close);
    el.addEventListener("click", () => selectTab(i));
    el.addEventListener("dblclick", () => renameTab(i));
    el.addEventListener("auxclick", (ev) => ev.button === 1 && closeTab(i));
    close.addEventListener("click", (ev) => {
      ev.stopPropagation();
      closeTab(i);
    });
    close.addEventListener("dblclick", (ev) => ev.stopPropagation());
    return el;
  });
  const add = document.createElement("button");
  add.id = "tab-add";
  add.textContent = "+";
  add.title = "New tab";
  add.addEventListener("click", addTab);
  tabsEl.replaceChildren(...items, add);
}

editor.addEventListener("input", () => {
  activeTab().code = editor.value;
  saveState();
  renderHighlight();
});

// A short status line for something the user just did; kind is "info" or "kill".
const note = (text, kind = "info") => log(`> ${text}`, false, kind);

function log(text, isErr = false, kind = "") {
  const line = document.createElement("div");
  if (isErr || (!kind && /error|failed/i.test(text))) line.className = "err";
  else if (kind) line.className = kind;
  line.textContent = text;
  consoleEl.appendChild(line);
  while (consoleEl.childElementCount > 500) consoleEl.firstChild.remove();
  consoleEl.scrollTop = consoleEl.scrollHeight;
}

const engine = createEngine(Csound, { onMessage: (m) => log(m.replace(/\n$/, "")) });
const fox = createFox(engine, {
  onTempo: (v) => (bpmInput.value = v),
  onBar: (v) => (barInput.value = v),
  onError: (message) => log(message, true),
  onLog: note,
});

window.addEventListener("unhandledrejection", (ev) => log(String(ev.reason), true));

bpmInput.min = LIMITS.minBpm;
bpmInput.max = LIMITS.maxBpm;
barInput.min = 1;
barInput.max = LIMITS.maxBar;

// Reads a number box, forcing it back into its allowed range.
function readBox(input, min, max, fallback) {
  const v = Number(input.value);
  const value = input.value.trim() !== "" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  input.value = value;
  return value;
}
const readBpm = () => readBox(bpmInput, LIMITS.minBpm, LIMITS.maxBpm, 120);
const readBar = () => readBox(barInput, 1, LIMITS.maxBar, 4);

function setRunning(running) {
  startBtn.disabled = running;
  stopBtn.disabled = !running;
  statusEl.textContent = running ? "running" : "stopped";
}

startBtn.addEventListener("click", async () => {
  startBtn.disabled = true;
  statusEl.textContent = "starting…";
  try {
    const analyser = await engine.start();
    setRunning(true);
    drawScope(analyser);
    await engine.setTempo(readBpm());
    await engine.setBar(readBar());
    fox.start();
    beatTimer = setInterval(updatePosition, 50);
  } catch (e) {
    log(String(e), true);
    setRunning(false);
  }
});

stopBtn.addEventListener("click", stop);

function updatePosition() {
  const now = engine.now();
  if (!now) return;
  posEl.textContent = `${Math.floor(now.beat / now.bar) + 1}.${Math.floor(now.beat % now.bar) + 1}`;
}

bpmInput.addEventListener("change", () => engine.setTempo(readBpm()));
barInput.addEventListener("change", () => engine.setBar(readBar()));

async function stop() {
  clearInterval(beatTimer);
  fox.stop();
  posEl.textContent = "-.-";
  try {
    await engine.stop();
  } catch (e) {
    log(String(e), true);
  }
  setRunning(false);
}

// Start/end offsets of every line of the text, and which line holds a cursor position.
function lineTable(value) {
  let offset = 0;
  return value.split("\n").map((text) => {
    const line = { start: offset, end: offset + text.length, blank: !text.trim() };
    offset += text.length + 1;
    return line;
  });
}

function lineIndexAt(lines, pos) {
  const i = lines.findIndex((l) => pos <= l.end);
  return i < 0 ? lines.length - 1 : i;
}

// The selection, or the block around the cursor. Blocks are separated by blank lines
// (lines with only spaces count); on a blank line the block above is used.
function currentBlock() {
  const { selectionStart: s, selectionEnd: e, value } = editor;
  if (s !== e) return [s, e];
  const lines = lineTable(value);
  let i = lineIndexAt(lines, s);
  while (i > 0 && lines[i].blank) i--;
  if (lines[i].blank) return [s, s];
  let first = i;
  let last = i;
  while (first > 0 && !lines[first - 1].blank) first--;
  while (last < lines.length - 1 && !lines[last + 1].blank) last++;
  return [lines[first].start, lines[last].end];
}

function currentLine() {
  const { selectionStart: s, value } = editor;
  const a = value.lastIndexOf("\n", s - 1) + 1;
  const b = value.indexOf("\n", s);
  return [a, b === -1 ? value.length : b];
}

let flashTimer = null;

// Briefly highlights a range of the editor text (restarts if already flashing).
function flash([start, end], kind = "") {
  const { value } = editor;
  flashEl.innerHTML =
    escapeHtml(value.slice(0, start)) +
    `<span class="${kind}">${escapeHtml(value.slice(start, end))}</span>` +
    escapeHtml(value.slice(end)) + "\n";
  flashEl.scrollTop = editor.scrollTop;
  flashEl.scrollLeft = editor.scrollLeft;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => (flashEl.textContent = ""), 500);
}

editor.addEventListener("scroll", () => {
  for (const el of [flashEl, highlightEl]) {
    el.scrollTop = editor.scrollTop;
    el.scrollLeft = editor.scrollLeft;
  }
});

showTab();

async function evaluate(range) {
  const code = editor.value.slice(range[0], range[1]);
  if (!code.trim()) return;
  if (!engine.running) return log("Press Start first.", true);
  flash(range);
  try {
    (await engine.evaluate(code)).forEach(note);
    fox.run(splitCode(code).fox);
  } catch (e) {
    log(String(e), true);
    flash(range, "err");
  }
}

// The selection, or the whole player statement the cursor is in (it may span lines).
function playerRange() {
  const { selectionStart: s, selectionEnd: e, value } = editor;
  if (s !== e) return [s, e];
  const lines = lineTable(value);
  const i = lineIndexAt(lines, s);
  const info = classifyLines(value.split("\n"));
  if (info[i].kind !== "fox") return [lines[i].start, lines[i].end];
  const first = info[i].statement;
  let last = i;
  while (last + 1 < lines.length && info[last + 1].kind === "fox" && info[last + 1].statement === first) last++;
  return [lines[first].start, lines[last].end];
}

// Ctrl+Alt+Enter: kill the players, reverbs, drones and buses defined in the range,
// like "kill name".
function killPlayers() {
  if (!engine.running) return log("Press Start first.", true);
  const range = playerRange();
  const code = editor.value.slice(range[0], range[1]);
  const names = [...new Set([...splitCode(code).fox.matchAll(/^\s*([A-Za-z_]\w*)\s*:/gm)].map((m) => m[1]))];
  if (!names.length) return log("No player, reverb, drone or bus definition here to kill.", true);
  flash(range, "kill");
  try {
    fox.run(names.map((n) => `kill ${n}`).join("\n"));
  } catch (e) {
    log(String(e), true);
    flash(range, "err");
  }
}

const matchKeys = (ev, keys) => {
  const parts = keys.split("+");
  const key = parts.pop().toLowerCase();
  const mods = new Set(parts.map((m) => m.toLowerCase()));
  return (
    ev.ctrlKey === mods.has("ctrl") &&
    ev.altKey === mods.has("alt") &&
    ev.shiftKey === mods.has("shift") &&
    ev.key.toLowerCase() === key
  );
};

const shortcutActions = {
  evalBlock: () => evaluate(currentBlock()),
  evalLine: () => evaluate(currentLine()),
  killLine: killPlayers,
  silence: () => {
    fox.clear();
    engine.silence();
  },
  indent: () => document.execCommand("insertText", false, "  "),
};

// Bracket and quote pairing: an opener also types its closer and leaves the cursor
// between them (or wraps the selection). Typing a closer that is already next to the
// cursor steps over it, and Backspace inside an empty pair removes both halves.
// A quote right after a letter or digit is typed alone, so apostrophes in comments
// ("don't") do not grow a partner. Modifiers are not checked on purpose: AltGr
// (needed for [ and { on many layouts) reports as Ctrl+Alt.
const PAIRS = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'" };
const CLOSERS = new Set(Object.values(PAIRS));

function autoPair(ev) {
  if (ev.isComposing || ev.metaKey) return false;
  const { selectionStart: a, selectionEnd: b, value } = editor;
  if (a === b && CLOSERS.has(ev.key) && value[a] === ev.key) {
    editor.setSelectionRange(a + 1, a + 1);
    return true;
  }
  if (PAIRS[ev.key]) {
    const isQuote = PAIRS[ev.key] === ev.key;
    if (isQuote && a === b && /\w/.test(value[a - 1] ?? "")) return false;
    const inner = value.slice(a, b);
    document.execCommand("insertText", false, ev.key + inner + PAIRS[ev.key]);
    editor.setSelectionRange(a + 1, a + 1 + inner.length);
    return true;
  }
  if (a !== b) return false;
  if (ev.key === "Backspace" && !ev.ctrlKey && !ev.altKey && a > 0 && PAIRS[value[a - 1]] === value[a]) {
    editor.setSelectionRange(a - 1, a + 1);
    document.execCommand("delete");
    return true;
  }
  return false;
}

editor.addEventListener("keydown", (ev) => {
  const shortcut = SHORTCUTS.find((s) => matchKeys(ev, s.keys));
  if (shortcut) {
    ev.preventDefault();
    shortcutActions[shortcut.id]();
  } else if (autoPair(ev)) {
    ev.preventDefault();
  }
});

document.querySelector(".keys").textContent = SHORTCUTS.map((s) => `${s.keys}: ${s.label}`).join(" \u00b7 ");

let scopeFrame = 0;

function clearScope() {
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#0d0f12";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawScope(analyser) {
  cancelAnimationFrame(scopeFrame);
  const ctx = canvas.getContext("2d");
  const data = new Float32Array(analyser.fftSize);
  const render = () => {
    if (!engine.running) return clearScope();
    analyser.getFloatTimeDomainData(data);
    const { width: w, height: h } = canvas;
    clearScope();
    ctx.strokeStyle = "#6cb6ff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < data.length; i++) {
      const x = (i / (data.length - 1)) * w;
      const y = h / 2 - data[i] * (h / 2 - 4);
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    scopeFrame = requestAnimationFrame(render);
  };
  render();
}
