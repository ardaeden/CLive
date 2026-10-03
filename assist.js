// Editor assistance for player code: suggestions for what can go at the cursor, a line
// under the editor documenting what the cursor is in, an outline on the bracket matching
// the one at the cursor, and red marks on statements that would fail when evaluated.
// Everything it knows comes from registry.js and from the definitions in the tabs' code;
// the error marks come from the player language's own parser, run without side effects.
import {
  SYNTHS, PLAYER_PARAMS, DRUM_PARAMS, DRUM_KITS, REVERB_PARAMS, DELAY_PARAMS, BUS_PARAMS,
  FUNCTIONS, COMMANDS, COMMAND_WORDS, SCALES,
} from "./registry.js";
import { classifyLines, splitCode } from "./engine.js";
import { createFox } from "./fox.js";
import { escapeHtml } from "./highlight.js";

// ---- what the code defines ----

const DEFINITION = /^[ \t]*([A-Za-z_]\w*)[ \t]*:[ \t]*([A-Za-z_]\w*)[ \t]*(?:@[ \t]*[A-Za-z_]\w*[ \t]*)?\(/gm;
const INSTR = /^[ \t]*instr[ \t]+([^;\n]+)/gm;

// Names defined anywhere in `texts` (every tab): reverbs, delays, buses, every defined
// name, and named Csound instruments.
export function scanDefinitions(texts) {
  const known = { reverbs: new Set(), delays: new Set(), buses: new Set(), names: new Set(), instrs: new Set() };
  for (const text of texts) {
    for (const [, name, callee] of text.matchAll(DEFINITION)) {
      known.names.add(name);
      if (callee === "reverb") known.reverbs.add(name);
      else if (callee === "delay") known.delays.add(name);
      else if (callee === "bus") known.buses.add(name);
    }
    for (const m of text.matchAll(INSTR)) {
      for (const part of m[1].split(",")) if (/^[A-Za-z_]\w*$/.test(part.trim())) known.instrs.add(part.trim());
    }
  }
  return known;
}

// The parameters a definition's call takes, or null for an unknown callee.
function paramsOf(callee, known) {
  const send = { send: PLAYER_PARAMS.send };
  if (callee === "reverb") return REVERB_PARAMS;
  if (callee === "delay") return { ...DELAY_PARAMS, ...send };
  if (callee === "bus") return { ...BUS_PARAMS, ...send };
  if (callee === "log") return { dur: PLAYER_PARAMS.dur };
  if (callee === "play") return { ...PLAYER_PARAMS, ...DRUM_PARAMS };
  if (SYNTHS[callee]) return { ...PLAYER_PARAMS, ...(SYNTHS[callee].params ?? {}) };
  if (known.instrs.has(callee) || /^i\d+$/.test(callee)) return PLAYER_PARAMS;
  return null;
}

const CALLEE_DOCS = {
  play: "Drum patterns from a string, e.g. play(\"x-o-\", dur=1/2); kit=\"808\" for the 808 kit.",
  log: "Prints a value to the console on every step instead of playing, e.g. log(cosr(5, 3, 4), dur=1).",
  reverb: "A reverb return that players, drones, buses and delays send to with send=name(amount).",
  delay: "A tempo-synced delay that players, drones and buses send to with send=name(amount).",
  bus: "A mixing group: players routed to it with synth@name share its amp, pan and sends.",
};
// The first sentence of a doc ("..." inside a sentence does not end it).
const firstSentence = (doc = "") => doc.split(/(?<=[^.]\.)\s/)[0];

// ---- reading the code around the cursor ----

// A small tokenizer for the player statement before the cursor. `inComment` tells that
// the cursor sits in a ; comment; an unterminated string is returned with open: true.
function scan(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === ";") {
      const j = src.indexOf("\n", i);
      if (j < 0) return { toks, inComment: true };
      i = j;
    } else if (/\s/.test(c)) {
      i++;
    } else if (c === '"' || c === "'") {
      const j = src.indexOf(c, i + 1);
      if (j < 0) {
        toks.push({ t: "str", v: src.slice(i + 1), open: true, at: i });
        break;
      }
      toks.push({ t: "str", v: src.slice(i + 1, j), at: i, end: j + 1 });
      i = j + 1;
    } else {
      const id = /^[A-Za-z_]\w*/.exec(src.slice(i));
      const num = /^(?:\d+\.?\d*|\.\d+)/.exec(src.slice(i));
      const v = id?.[0] ?? num?.[0] ?? (src.startsWith("**", i) ? "**" : c);
      toks.push({ t: id ? "id" : num ? "num" : "op", v, at: i, end: i + v.length });
      i += v.length;
    }
  }
  return { toks, inComment: false };
}

// The player statement that the cursor is in, from its start up to the cursor, or null
// where player code cannot be: inside instr/opcode blocks and on classic score lines. A
// line that is only being typed ("p1: plu") counts as the start of a new statement.
function statementBefore(text, pos) {
  const lines = text.split("\n");
  let line = text.slice(0, pos).split("\n").length - 1;
  const kinds = classifyLines(lines);
  if (kinds[line].kind !== "fox") {
    let depth = 0;
    for (let k = 0; k < line; k++) {
      if (/^\s*(instr|opcode)\b/.test(lines[k])) depth++;
      if (/^\s*(endin|endop)\b/.test(lines[k])) depth = Math.max(0, depth - 1);
    }
    if (depth > 0 || /^\s*[ifeatqrsmnvxy]\s+[-\d.]/.test(lines[line])) return null;
  } else {
    line = kinds[line].statement;
  }
  const start = lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0);
  return text.slice(start, pos);
}

// What the cursor is in. Returns { kind, prefix, ... } where kind is one of: none,
// start (a new statement), kill, command, callee (after "name:"), bus (after @), key (a
// parameter name inside a definition's parentheses), value (a value), string (inside
// quotes). `call` is the definition's callee and `key` the parameter being written.
export function analyze(text, pos) {
  const stmt = statementBefore(text, pos);
  const none = { kind: "none", prefix: "" };
  if (stmt === null) return none;
  const { toks, inComment } = scan(stmt);
  if (inComment) return none;
  let before = toks;
  const last = toks.at(-1);
  if (last?.t === "str" && last.open) {
    const p1 = toks.at(-2);
    const p2 = toks.at(-3);
    let key = null;
    if (p1?.v === "=" && p2?.t === "id") key = p2.v;
    else if (p1?.t === "id" && toks.length === 2 && COMMAND_WORDS.includes(p1.v)) key = p1.v;
    return { kind: "string", prefix: last.v, key };
  }
  let prefix = "";
  if (last?.t === "id" && last.end === stmt.length) {
    prefix = last.v;
    before = toks.slice(0, -1);
  } else if (last && last.end === stmt.length && last.t !== "op") {
    return none; // right after a number or a closed string
  }
  const first = before[0];
  const isDefinition = before[1]?.v === ":";
  if (!before.length) return { kind: "start", prefix };
  if (!isDefinition && first.t === "id" && first.v === "kill") return { kind: "kill", prefix };
  if (!isDefinition && first.t === "id" && COMMAND_WORDS.includes(first.v)) return { kind: "command", prefix, word: first.v };
  if (!isDefinition) return none;
  if (before.length === 2) return { kind: "callee", prefix };
  if (before.at(-1).v === "@" && before.length === 4) return { kind: "bus", prefix };

  // Walk the brackets: the definition's own call is the "(" right after its callee
  // (and @bus), and each frame remembers which parameter its current argument is for.
  const call = before[2].t === "id" ? before[2].v : null;
  const defOpen = before[3]?.v === "@" ? 5 : 3;
  const stack = [];
  for (let k = 0; k < before.length; k++) {
    const t = before[k];
    const top = stack.at(-1);
    if (t.v === "(" || t.v === "[") {
      stack.push({ open: t.v, callee: t.v === "(" && before[k - 1]?.t === "id" ? before[k - 1].v : null, own: k === defOpen, key: null, arg: 0, used: new Set(), fresh: true });
      continue;
    }
    if (t.v === ")" || t.v === "]") {
      stack.pop();
      continue;
    }
    if (!top) continue;
    if (t.v === ",") {
      Object.assign(top, { arg: top.arg + 1, key: null, fresh: true });
    } else if (top.fresh && t.t === "id" && before[k + 1]?.v === "=") {
      top.key = t.v;
      top.used.add(t.v);
    } else if (t.v !== "=") {
      top.fresh = false;
    }
  }
  const frame = stack.at(-1);
  if (!frame || !stack[0].own) return none;
  const own = stack[0];
  const prev = before.at(-1);
  const base = { prefix, call, key: own.key, arg: own.arg, used: own.used, inList: frame.open === "[" };
  if (frame.own && (prev.v === "(" || prev.v === ",")) return { ...base, kind: "key" };
  if (frame.own && prev.t !== "op") return none;
  return { ...base, kind: "value", fn: frame.own ? null : frame.callee };
}

// ---- suggestions ----

const item = (label, insert, detail, caret = 0) => ({ label, insert, detail, caret });
const quoted = (names) => names.map((n) => item(`"${n}"`, `"${n}"`, ""));

// The candidates for a context (before filtering by what has been typed).
function candidates(ctx, known, samples) {
  const functions = () => Object.entries(FUNCTIONS).map(([n, f]) => item(n, `${n}()`, firstSentence(f.doc), -1));
  const sendNames = () => [...known.reverbs].map((n) => item(n, n, "reverb")).concat([...known.delays].map((n) => item(n, n, "delay")));
  const stringsFor = (key) =>
    key === "scale" ? Object.keys(SCALES)
    : key === "kit" ? Object.keys(DRUM_KITS)
    : key === "updates" ? ["bar", "beat"]
    : key === "src" ? samples
    : [];
  switch (ctx.kind) {
    case "start":
      return COMMAND_WORDS.map((w) => item(w, `${w} `, firstSentence(COMMANDS.find((c) => c.syntax.startsWith(w))?.doc)));
    case "kill":
      return [...known.names].map((n) => item(n, n, ""));
    case "command":
      return ctx.word === "scale" || ctx.word === "updates" ? quoted(stringsFor(ctx.word)) : [];
    case "callee":
      return [
        ...Object.entries(SYNTHS).map(([n, s]) => item(n, `${n}()`, firstSentence(s.doc), -1)),
        ...Object.entries(CALLEE_DOCS).map(([n, d]) => item(n, `${n}()`, d, -1)),
        ...[...known.instrs].map((n) => item(n, `${n}()`, "your instrument", -1)),
      ];
    case "bus":
      return [...known.buses].map((n) => item(n, n, "bus"));
    case "key": {
      const params = paramsOf(ctx.call, known) ?? {};
      const keys = Object.entries(params)
        .filter(([k]) => !ctx.used.has(k))
        .map(([k, p]) => item(k, `${k}=`, firstSentence(p.doc)));
      return ctx.arg === 0 && ctx.call !== "reverb" && ctx.call !== "bus" && ctx.call !== "delay" ? [...keys, ...functions()] : keys;
    }
    case "value": {
      const out = [];
      if (ctx.key === "send") out.push(...sendNames());
      if (!ctx.fn && !ctx.inList) out.push(...quoted(stringsFor(ctx.key)));
      out.push(...functions());
      if (ctx.key !== "send" && ctx.key !== "scale" && ctx.key !== "kit" && ctx.key !== "src") out.push(item("r", "r", "a rest"));
      return out;
    }
    case "string":
      return stringsFor(ctx.key).map((n) => item(n, n, ""));
    default:
      return [];
  }
}

// What to offer at the cursor: candidates whose name starts with what has been typed,
// then those that merely contain it.
export function suggestions(ctx, known, samples = []) {
  const all = candidates(ctx, known, samples);
  const p = ctx.prefix.toLowerCase();
  const name = (it) => it.label.replace(/"/g, "").toLowerCase();
  if (!p) return all;
  return [...all.filter((it) => name(it).startsWith(p)), ...all.filter((it) => !name(it).startsWith(p) && name(it).includes(p))];
}

// ---- the documentation line ----

const rangeOf = (p) => (p.kind === "sample" ? "file name" : p.kind === "kit" ? Object.keys(DRUM_KITS).map((k) => `"${k}"`).join(" ") : p.min !== undefined ? `${p.min} to ${p.max}${p.unit ? " " + p.unit : ""}` : "");

// Parts of the line under the editor for the cursor at `pos`: [text, className] pairs.
export function describe(text, pos, known) {
  // The context is read where the word under the cursor starts, and the whole word
  // (both sides of the cursor; it may be a number) is looked at on its own.
  const left = /\w*$/.exec(text.slice(0, pos))[0];
  const word = left + /^\w*/.exec(text.slice(pos))[0];
  const ctx = analyze(text, pos - left.length);
  if (ctx.kind === "callee") {
    const doc = SYNTHS[word]?.doc ?? CALLEE_DOCS[word];
    return doc ? [[word, "cur"], [` — ${doc}`, "doc"]] : [];
  }
  if (ctx.kind === "command" || ctx.kind === "kill" || (ctx.kind === "start" && COMMAND_WORDS.includes(word))) {
    const w = ctx.word ?? (ctx.kind === "kill" ? "kill" : word);
    const c = COMMANDS.find((x) => x.syntax.startsWith(w));
    return c ? [[c.syntax, "cur"], [` — ${c.doc}`, "doc"]] : [];
  }
  if (ctx.kind !== "key" && ctx.kind !== "value" && ctx.kind !== "string") return [];
  const fnName = FUNCTIONS[word] ? word : ctx.fn && FUNCTIONS[ctx.fn] ? ctx.fn : null;
  if (fnName) return [[FUNCTIONS[fnName].syntax, "cur"], [` — ${FUNCTIONS[fnName].doc}`, "doc"]];
  const params = paramsOf(ctx.call, known);
  if (!params) return [];
  // The parameter being written: the key before =, the one being typed, or the first
  // positional argument (degree, or play()'s pattern).
  const key = ctx.kind === "key" && params[word] ? word : ctx.key ?? (ctx.arg === 0 && params.degree ? "degree" : null);
  // The current parameter and its doc first: the signature can be longer than the line.
  const parts = [];
  const p = params[key];
  if (p) {
    const facts = [p.shown ?? (p.default === "" ? "" : p.default), rangeOf(p)].filter((x) => x !== "" && x !== undefined).join(" · ");
    parts.push([key, "cur"], [`${facts ? ` (${facts})` : ""} — ${p.doc}   `, "doc"]);
  }
  parts.push([`${ctx.call}(`, "sig"]);
  Object.keys(params).forEach((k, i) => parts.push([i ? ", " : "", "sig"], [k, k === key ? "cur" : "sig"]));
  parts.push([")", "sig"]);
  return parts;
}

// ---- brackets ----

// The positions of the bracket just before (or else at) `pos` and of its match, as
// [a, b], or null. Brackets inside strings or comments are not told apart: the outline
// is only a visual aid.
export function matchBracket(text, pos) {
  const OPEN = "([{";
  const CLOSE = ")]}";
  for (const at of [pos - 1, pos]) {
    const c = text[at];
    if (c === undefined || (!OPEN.includes(c) && !CLOSE.includes(c))) continue;
    const forward = OPEN.includes(c);
    const other = forward ? CLOSE[OPEN.indexOf(c)] : OPEN[CLOSE.indexOf(c)];
    let depth = 0;
    for (let i = at; forward ? i < text.length : i >= 0; i += forward ? 1 : -1) {
      if (text[i] === c) depth++;
      else if (text[i] === other && --depth === 0) return [at, i];
    }
  }
  return null;
}

// ---- error marks ----

// A player-language instance that only checks code: a stand-in engine (nothing sounds,
// nothing is sent anywhere), and lint mode for the checks that depend on live state.
function createLinter() {
  let instrs = new Set();
  const noop = () => {};
  const engine = {
    now: () => ({ beat: 0, bpm: 120, bar: 4 }),
    outputLatency: () => 0,
    resolveInstrument: (name) => (instrs.has(name) ? 300 : undefined),
    sample: () => ({ table: 1, fraction: 1, fresh: false }),
    note: noop, silence: noop, setTempo: noop, setBar: noop,
    defineReverb: noop, stopReverb: noop, defineDelay: noop, updateDelay: noop, stopDelay: noop,
    defineDrone: noop, updateDrone: noop, stopDrone: noop, defineBus: noop, updateBus: noop, stopBus: noop,
  };
  const fox = createFox(engine, { lint: true });
  return {
    // The errors in `code` as { line, message }, with every tab's reverbs, delays and
    // buses (`texts`) defined first so sends and @ routes to them check out.
    check(code, texts, known) {
      instrs = known.instrs;
      fox.stop();
      const effects = texts.flatMap((t) => splitCode(t).fox.split("\n")).filter((l) => /^\s*[A-Za-z_]\w*\s*:\s*(reverb|delay|bus)\s*\(/.test(l));
      const order = (l) => (/:\s*reverb/.test(l) ? 0 : 1); // delays may send to reverbs
      fox.check(effects.sort((a, b) => order(a) - order(b)).join("\n"));
      return fox.check(splitCode(code).fox);
    },
  };
}

// ---- the editor side ----

// Wires everything to the editor. `marks` is an overlay layer like the flash one,
// `info` the line under the editor, `texts()` returns every tab's code.
export function createAssist({ editor, wrap, marks, info, texts }) {
  const popup = document.createElement("div");
  popup.id = "complete";
  popup.hidden = true;
  wrap.append(popup);
  const linter = createLinter();
  let items = [];
  let active = 0;
  let ctx = null;
  let known = scanDefinitions(texts());
  let lintErrors = []; // { line, message }
  let lintTimer = null;
  let samples = [];
  let samplesFetched = false;

  // Sound files in samples/, for src= (server.py lists the folder; others may not).
  async function fetchSamples() {
    samplesFetched = true;
    try {
      const html = await (await fetch("samples/")).text();
      samples = [...html.matchAll(/href="([^"?#]+)"/g)].map((m) => decodeURIComponent(m[1])).filter((n) => /\.(wav|mp3|ogg|flac|aiff?|m4a)$/i.test(n));
    } catch {
      samples = [];
    }
    if (!popup.hidden) update(true);
  }

  // ---- popup ----

  const style = getComputedStyle(editor);
  const measure = document.createElement("canvas").getContext("2d");
  measure.font = style.font;
  const charWidth = measure.measureText("0".repeat(100)).width / 100;
  const lineHeight = parseFloat(style.lineHeight);

  function caretXY(pos) {
    const before = editor.value.slice(0, pos);
    const line = before.split("\n").length - 1;
    const col = pos - (before.lastIndexOf("\n") + 1);
    return {
      x: parseFloat(style.paddingLeft) + col * charWidth - editor.scrollLeft,
      y: parseFloat(style.paddingTop) + (line + 1) * lineHeight - editor.scrollTop,
    };
  }

  function render() {
    popup.replaceChildren(
      ...items.slice(0, 50).map((it, i) => {
        const row = document.createElement("div");
        row.className = "item" + (i === active ? " active" : "");
        const label = document.createElement("span");
        label.className = "label";
        label.textContent = it.label;
        const detail = document.createElement("span");
        detail.className = "detail";
        detail.textContent = it.detail;
        row.append(label, detail);
        row.addEventListener("mousedown", (ev) => {
          ev.preventDefault(); // keep the focus in the editor
          accept(i);
        });
        return row;
      }),
    );
    const { x, y } = caretXY(editor.selectionStart - (ctx?.prefix.length ?? 0));
    popup.hidden = false;
    const below = y + popup.offsetHeight < wrap.clientHeight;
    popup.style.left = `${Math.max(0, Math.min(x, wrap.clientWidth - popup.offsetWidth))}px`;
    popup.style.top = `${below ? y : y - lineHeight - popup.offsetHeight}px`;
    popup.querySelector(".active")?.scrollIntoView({ block: "nearest" });
  }

  function close() {
    popup.hidden = true;
    items = [];
  }

  // Recomputes the suggestions at the cursor; `force` shows them even with nothing typed.
  function update(force) {
    const pos = editor.selectionStart;
    if (pos !== editor.selectionEnd) return close();
    ctx = analyze(editor.value, pos);
    if (ctx.kind === "none") return close();
    known = scanDefinitions(texts());
    if ((ctx.key === "src" || ctx.kind === "string") && !samplesFetched) fetchSamples();
    items = suggestions(ctx, known, samples);
    // Typing a word that is already complete closes the list instead of offering itself.
    if (!items.length || (items.length === 1 && items[0].label === ctx.prefix)) return close();
    if (!force && !ctx.prefix && popup.hidden) return close();
    active = Math.min(active, items.length - 1);
    render();
  }

  function accept(i = active) {
    const it = items[i];
    if (!it) return;
    const pos = editor.selectionStart;
    editor.setSelectionRange(pos - ctx.prefix.length, pos);
    close();
    document.execCommand("insertText", false, it.insert);
    const at = editor.selectionStart + it.caret;
    editor.setSelectionRange(at, at);
    // After name= the value list (send names, scales, kits) is usually what comes next.
    const next = analyze(editor.value, at);
    if (next.kind === "value" && ["send", "scale", "kit", "src"].includes(next.key)) update(true);
  }

  // ---- marks: the matching bracket and the error lines ----

  function renderMarks() {
    const text = editor.value;
    const ranges = [];
    const lines = text.split("\n");
    let offset = 0;
    const starts = lines.map((l) => {
      const s = offset;
      offset += l.length + 1;
      return s;
    });
    for (const e of lintErrors) {
      const l = lines[e.line];
      if (l === undefined) continue;
      const lead = l.length - l.trimStart().length;
      const end = l.replace(/\s*;.*$/, "").trimEnd().length;
      if (end > lead) ranges.push([starts[e.line] + lead, starts[e.line] + end, "lint"]);
    }
    const pair = editor.selectionStart === editor.selectionEnd ? matchBracket(text, editor.selectionStart) : null;
    if (pair) for (const at of pair) ranges.push([at, at + 1, "match"]);
    ranges.sort((a, b) => a[0] - b[0]);
    let html = "";
    let pos = 0;
    for (const [a, b, cls] of ranges) {
      if (a < pos) continue;
      html += escapeHtml(text.slice(pos, a)) + `<span class="${cls}">${escapeHtml(text.slice(a, b))}</span>`;
      pos = b;
    }
    marks.innerHTML = html + escapeHtml(text.slice(pos)) + "\n";
    marks.scrollTop = editor.scrollTop;
    marks.scrollLeft = editor.scrollLeft;
  }

  function renderInfo() {
    const line = editor.value.slice(0, editor.selectionStart).split("\n").length - 1;
    // Help for what the cursor is in comes first, so a statement still being typed (which
    // is an error until it is finished) does not hide it; elsewhere on an error line,
    // such as its start, the error is shown.
    const err = lintErrors.find((e) => e.line === line);
    const help = describe(editor.value, editor.selectionStart, known);
    const parts = help.length || !err ? help : [[err.message, "err"]];
    info.replaceChildren(
      ...parts.map(([t, cls]) => {
        const s = document.createElement("span");
        s.className = cls;
        s.textContent = t;
        return s;
      }),
    );
    info.title = info.textContent;
  }

  function lintNow() {
    known = scanDefinitions(texts());
    try {
      lintErrors = linter.check(editor.value, texts(), known);
    } catch {
      lintErrors = [];
    }
    renderMarks();
    renderInfo();
  }

  const scheduleLint = () => {
    clearTimeout(lintTimer);
    lintTimer = setTimeout(lintNow, 300);
  };

  // ---- events ----

  let caretFrame = 0;
  document.addEventListener("selectionchange", () => {
    if (document.activeElement !== editor) return;
    cancelAnimationFrame(caretFrame);
    caretFrame = requestAnimationFrame(() => {
      renderMarks();
      renderInfo();
      if (!popup.hidden) {
        const c = analyze(editor.value, editor.selectionStart);
        if (c.kind === "none" || c.prefix !== ctx?.prefix || editor.selectionStart !== editor.selectionEnd) close();
      }
    });
  });
  editor.addEventListener("blur", close);
  editor.addEventListener("scroll", () => {
    marks.scrollTop = editor.scrollTop;
    marks.scrollLeft = editor.scrollLeft;
    close();
  });

  return {
    // Keys while the list is open: arrows choose, Tab/Enter accept, Esc closes. Returns
    // true when it used the key.
    handleKey(ev) {
      if (popup.hidden) return false;
      const plain = !ev.ctrlKey && !ev.altKey && !ev.metaKey;
      if (plain && (ev.key === "ArrowDown" || ev.key === "ArrowUp")) {
        active = (active + (ev.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
        render();
        return true;
      }
      if (plain && !ev.shiftKey && (ev.key === "Enter" || ev.key === "Tab")) {
        accept();
        return true;
      }
      if (ev.key === "Escape") {
        close();
        return true;
      }
      return false;
    },

    // Ctrl+Space.
    open() {
      update(true);
    },

    // After every edit: follow the typing with the list, and re-check the code.
    onInput(ev) {
      const typed = ev.inputType === "insertText" ? ev.data ?? "" : "";
      if (!popup.hidden || /\w$/.test(typed)) update(false);
      else if (/[@"=]$/.test(typed)) {
        const c = analyze(editor.value, editor.selectionStart);
        if (c.kind === "bus" || c.kind === "string" || (c.kind === "value" && ["send", "scale", "kit", "src"].includes(c.key))) update(true);
      }
      renderMarks();
      scheduleLint();
    },

    // After the editor's whole text changes (another tab shown, a scene loaded).
    refresh() {
      close();
      lintNow();
    },
  };
}
