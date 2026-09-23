// Syntax highlighter for mixed Csound orchestra / score / player code.
import { FOX_START, SCORE_LINE, bracketDelta } from "./engine.js";
import { COMMAND_WORDS, FUNCTIONS } from "./registry.js";

const KEYWORDS = new Set([
  "instr", "endin", "opcode", "endop", "if", "then", "elseif", "else", "endif", "fi",
  "while", "do", "od", "until", "goto", "igoto", "kgoto", "tigoto", "cggoto", "cigoto", "ckgoto", "return",
]);
const GLOBALS = new Set(["sr", "kr", "ksmps", "nchnls", "nchnls_i", "0dbfs", "A4", "seed"]);
const VAR = /^g?[aikSwf]\w+$/;
const FOX_COMMANDS = new Set(COMMAND_WORDS);
const FOX_FUNCTIONS = new Set([...Object.keys(FUNCTIONS), "P"]);

const TOKEN = /\/\*.*?(?:\*\/|$)|;.*|"(?:[^"\\]|\\.)*"?|(?:\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+)|[A-Za-z_]\w*|<<|>>|<=|>=|==|!=|&&|\|\||\*\*|\s+|./g;

export const escapeHtml = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function lex(line, state) {
  const out = [];
  let pos = 0;
  if (state.block) {
    const j = line.indexOf("*/");
    if (j < 0) return [{ k: "comment", s: line }];
    out.push({ k: "comment", s: line.slice(0, j + 2) });
    pos = j + 2;
    state.block = false;
  }
  for (const m of line.slice(pos).matchAll(TOKEN)) {
    const s = m[0];
    let k = "op";
    if (s.startsWith("/*")) {
      k = "comment";
      if (!s.endsWith("*/")) state.block = true;
    } else if (s[0] === ";") k = "comment";
    else if (s[0] === '"') k = "string";
    else if (/^[\d.]/.test(s)) k = "number";
    else if (/^[A-Za-z_]/.test(s)) k = "ident";
    else if (/^\s/.test(s)) k = "ws";
    out.push({ k, s });
  }
  return out;
}

function significant(tokens) {
  return tokens.filter((t) => t.k !== "ws" && t.k !== "comment");
}

function classifyOrc(tokens, isScore) {
  const sig = significant(tokens);
  if (!sig.length) return;
  const at = (n) => sig[n]?.s;
  if (isScore) {
    sig[0].c = "keyword";
    return;
  }
  sig.forEach((tk, n) => {
    if (tk.k !== "ident") return;
    const s = tk.s;
    if (KEYWORDS.has(s)) tk.c = "keyword";
    else if (/^p\d+$/.test(s)) tk.c = "pfield";
    else if (GLOBALS.has(s)) tk.c = "builtin";
    else if (at(n + 1) === "(") tk.c = "opcode";
    else if (VAR.test(s)) tk.c = "var";
  });
  const first = sig[0];
  if (first.k !== "ident") return;
  if (first.s === "instr" || first.s === "opcode") {
    if (sig[1]?.k === "ident") sig[1].c = "player";
    return;
  }
  if (first.c === "keyword") return;
  let n = 0;
  if (first.c === "var") {
    n = 1;
    if (at(n) === "[") {
      while (n < sig.length && sig[n].s !== "]") n++;
      n++;
    }
    while (at(n) === "," && sig[n + 1]?.k === "ident") n += 2;
  }
  const head = sig[n];
  if (head?.k === "ident" && head.c !== "keyword" && at(n + 1) !== "=" && (n > 0 || head.c !== "var")) head.c = "opcode";
}

function classifyFox(tokens) {
  const sig = significant(tokens);
  sig.forEach((tk, n) => {
    if (tk.k !== "ident") return;
    const s = tk.s;
    const prev = sig[n - 1]?.s;
    const next = sig[n + 1]?.s;
    if (next === ":") tk.c = "player";
    else if (prev === ":") tk.c = "synth";
    else if (n === 0 && FOX_COMMANDS.has(s)) tk.c = "keyword";
    else if (next === "=" && (prev === "(" || prev === ",")) tk.c = "param";
    else if (s === "r") tk.c = "keyword";
    else if (FOX_FUNCTIONS.has(s)) tk.c = "opcode";
  });
}

export function highlight(code) {
  const state = { block: false };
  let depth = 0;
  let foxDepth = 0;
  const html = code.split("\n").map((line) => {
    const t = line.trim();
    let fox = false;
    if (!state.block) {
      if (foxDepth > 0) {
        fox = true;
        foxDepth += bracketDelta(line);
      } else if (depth === 0 && FOX_START.some((re) => re.test(line))) {
        fox = true;
        foxDepth = Math.max(0, bracketDelta(line));
      }
    }
    const tokens = lex(line, state);
    if (fox) classifyFox(tokens);
    else {
      if (/^(instr|opcode)\b/.test(t)) depth++;
      classifyOrc(tokens, depth === 0 && SCORE_LINE.test(line));
      if (/^(endin|endop)\b/.test(t)) depth = Math.max(0, depth - 1);
    }
    return tokens
      .map((tk) => {
        const cls = tk.c ?? (tk.k === "comment" || tk.k === "string" || tk.k === "number" ? tk.k : null);
        return cls ? `<span class="tk-${cls}">${escapeHtml(tk.s)}</span>` : escapeHtml(tk.s);
      })
      .join("");
  });
  return html.join("\n") + "\n";
}
