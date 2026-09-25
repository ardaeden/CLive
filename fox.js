// Player language: tokenizer, evaluator and beat-locked scheduler.

import { LIMITS, SYNTHS, DRUMS, SCALES, PLAYER_PARAMS, REVERB_PARAMS, BUS_PARAMS, FUNCTIONS, COMMAND_WORDS, droneParamKeys } from "./registry.js";

const REST = { rest: true };

class Chord {
  constructor(notes) {
    this.notes = notes;
  }
}

// A value that is worked out when a step plays, from its beat position (cosr) or by
// chance (random). It can evaluate to a number, a chord or a rest.
class Dyn {
  constructor(at) {
    this.at = at;
  }
}

const resolve = (v, beat) => {
  while (v instanceof Dyn) v = v.at(beat);
  return v;
};

// A reference to a reverb return with a send amount (a number or a pattern).
class SendRef {
  constructor(slot, amount) {
    this.slot = slot;
    this.amount = amount;
  }
}

const REVERB_DEFAULTS = Object.fromEntries(Object.entries(REVERB_PARAMS).map(([k, v]) => [k, v.default]));
const BUS_DEFAULTS = Object.fromEntries(Object.entries(BUS_PARAMS).map(([k, v]) => [k, v.default]));
const DEFAULT_SEND = LIMITS.defaultSend;
const MAX_SENDS = LIMITS.maxSends;

// Headroom: a single voice at amp=1 plays at this level, so a chord of several
// notes (each divided by sqrt(voices) too) does not clip when they add up.
const VOICE_GAIN = 0.3;
const LOOKAHEAD_S = LIMITS.lookaheadSeconds;
const NEXT_BAR_LEAD_S = LIMITS.nextBarLeadSeconds;
const EPS = 1e-6;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));

// ---- tokenizer ----

// Sticky (/y) patterns match exactly at lastIndex, so the tokenizer never has to copy
// the rest of the source for every token.
const NUMBER = /\d+\.?\d*|\.\d+/y;
const NAME = /[A-Za-z_]\w*/y;

function matchAt(re, src, i) {
  re.lastIndex = i;
  return re.exec(src)?.[0];
}

// Every token records where it starts and ends (at/end), so "kill a b" can tell two
// separate names from one name glued to a "*" wildcard ("kill d*").
function tokenize(src) {
  const toks = [];
  let i = 0;
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    const start = i;
    const count = toks.length;
    if (c === "\n") {
      if (depth === 0) toks.push({ t: "nl" });
      i++;
    } else if (/\s/.test(c)) {
      i++;
    } else if (c === ";") {
      while (i < src.length && src[i] !== "\n") i++;
    } else if (c === '"' || c === "'") {
      const j = src.indexOf(c, i + 1);
      if (j < 0) throw new Error("Unterminated string");
      toks.push({ t: "str", v: src.slice(i + 1, j) });
      i = j + 1;
    } else {
      let m;
      if ((m = matchAt(NUMBER, src, i))) {
        toks.push({ t: "num", v: parseFloat(m) });
        i += m.length;
      } else if ((m = matchAt(NAME, src, i))) {
        toks.push({ t: "id", v: m });
        i += m.length;
      } else if (src.startsWith("**", i)) {
        toks.push({ t: "op", v: "**" });
        i += 2;
      } else if ("+-*/%()[],=:@".includes(c)) {
        if (c === "(" || c === "[") depth++;
        if (c === ")" || c === "]") depth--;
        toks.push({ t: "op", v: c });
        i++;
      } else {
        throw new Error(`Unexpected character '${c}'`);
      }
    }
    if (toks.length > count) Object.assign(toks[toks.length - 1], { at: start, end: i });
  }
  toks.push({ t: "nl" }, { t: "eof" });
  return toks;
}

// ---- values ----

function bin(op, a, b) {
  if (a === REST || b === REST) return REST;
  if (Array.isArray(a) || Array.isArray(b)) {
    const A = Array.isArray(a) ? a : [a];
    const B = Array.isArray(b) ? b : [b];
    const n = Math.max(A.length, B.length);
    return Array.from({ length: n }, (_, i) => bin(op, A[i % A.length], B[i % B.length]));
  }
  if (a instanceof Chord || b instanceof Chord) {
    const A = a instanceof Chord ? a.notes : [a];
    const B = b instanceof Chord ? b.notes : [b];
    const n = Math.max(A.length, B.length);
    return new Chord(Array.from({ length: n }, (_, i) => bin(op, A[i % A.length], B[i % B.length])));
  }
  if (a instanceof Dyn || b instanceof Dyn) return new Dyn((beat) => bin(op, resolve(a, beat), resolve(b, beat)));
  if (typeof a !== "number" || typeof b !== "number") throw new Error(`Cannot apply '${op}' to these values`);
  switch (op) {
    case "+": return a + b;
    case "-": return a - b;
    case "*": return a * b;
    case "/": return a / b;
    case "%": return ((a % b) + b) % b;
    case "**": return a ** b;
  }
  throw new Error(`Unknown operator '${op}'`);
}

function pick(list, i) {
  const v = list[i % list.length];
  return Array.isArray(v) ? pick(v, Math.floor(i / list.length)) : v;
}

// ---- parser / evaluator ----

// "kill" and "clear" have their own grammar (a name pattern, or nothing); the rest
// take a single expression, e.g. "tempo 108".
const COMMANDS_WITH_VALUE = new Set(COMMAND_WORDS.filter((w) => w !== "kill" && w !== "clear"));

class Parser {
  constructor(src, ctx) {
    this.toks = tokenize(src);
    this.pos = 0;
    this.ctx = ctx;
  }

  peek(k = 0) {
    return this.toks[Math.min(this.pos + k, this.toks.length - 1)];
  }

  next() {
    return this.toks[this.pos++];
  }

  isOp(v, k = 0) {
    const t = this.peek(k);
    return t.t === "op" && t.v === v;
  }

  expectOp(v) {
    if (!this.isOp(v)) throw new Error(`Expected '${v}'`);
    this.next();
  }

  expectId() {
    const t = this.next();
    if (t.t !== "id") throw new Error("Expected a name");
    return t.v;
  }

  run() {
    for (;;) {
      while (this.peek().t === "nl") this.next();
      if (this.peek().t === "eof") return;
      this.statement();
      if (this.peek().t !== "nl" && this.peek().t !== "eof") throw new Error("Unexpected token after statement");
    }
  }

  // A definition is any "name : ..." regardless of the name, so a player can be called
  // tempo, kill and so on. Otherwise a leading command word dispatches a command.
  statement() {
    const t = this.peek();
    if (t.t === "id" && this.isOp(":", 1)) {
      const name = this.expectId();
      this.next();
      this.ctx.define(name, this.call());
      return;
    }
    if (t.t === "id" && t.v === "kill") {
      this.next();
      for (const pattern of this.namePatterns()) this.ctx.kill(pattern);
      return;
    }
    if (t.t === "id" && t.v === "clear") {
      this.next();
      this.ctx.clear();
      return;
    }
    if (t.t === "id" && COMMANDS_WITH_VALUE.has(t.v)) {
      const word = this.next().v;
      this.ctx.set(word, this.expr());
      return;
    }
    throw new Error("Unsupported statement");
  }

  // The names after "kill", separated by spaces or commas: "kill d1 rev2", "kill d*, p1".
  // Each is letters/digits/underscore and "*" wildcards written without spaces: d1, d*, *.
  namePatterns() {
    const patterns = [];
    let prevEnd = -1;
    while (this.peek().t === "id" || this.isOp("*") || this.isOp(",")) {
      const tok = this.next();
      if (tok.v === ",") prevEnd = -1;
      else if (tok.at === prevEnd && patterns.length) patterns[patterns.length - 1] += tok.v;
      else patterns.push(tok.v);
      if (tok.v !== ",") prevEnd = tok.end;
    }
    if (!patterns.length) throw new Error("Expected a name after 'kill', e.g. kill p1 or kill d*");
    return patterns;
  }

  call() {
    const name = this.expectId();
    let bus = null;
    if (this.isOp("@")) {
      this.next();
      const busName = this.expectId();
      bus = this.ctx.busSlot(busName);
      if (bus === undefined) throw new Error(`Unknown bus '${busName}'. Buses must be defined first, e.g. ${busName}: bus()`);
    }
    this.expectOp("(");
    return { name, bus, ...this.args() };
  }

  args() {
    const args = [];
    const kwargs = {};
    while (!this.isOp(")")) {
      if (this.peek().t === "id" && this.isOp("=", 1)) {
        const key = this.expectId();
        this.next();
        kwargs[key] = this.expr();
      } else {
        args.push(this.expr());
      }
      if (this.isOp(",")) this.next();
      else break;
    }
    this.expectOp(")");
    return { args, kwargs };
  }

  expr() {
    let v = this.term();
    while (this.isOp("+") || this.isOp("-")) {
      const op = this.next().v;
      v = bin(op, v, this.term());
    }
    return v;
  }

  term() {
    let v = this.unary();
    while (this.isOp("*") || this.isOp("/") || this.isOp("%")) {
      const op = this.next().v;
      v = bin(op, v, this.unary());
    }
    return v;
  }

  unary() {
    if (this.isOp("-")) {
      this.next();
      return bin("*", this.unary(), -1);
    }
    const base = this.primary();
    if (this.isOp("**")) {
      this.next();
      return bin("**", base, this.unary());
    }
    return base;
  }

  list() {
    const items = [];
    while (!this.isOp("]")) {
      items.push(this.expr());
      if (this.isOp(",")) this.next();
      else break;
    }
    this.expectOp("]");
    return items;
  }

  primary() {
    const t = this.next();
    if (t.t === "num") return t.v;
    if (t.t === "str") return t.v;
    if (t.t === "op" && t.v === "[") return this.list();
    if (t.t === "op" && t.v === "(") {
      const first = this.expr();
      if (this.isOp(",")) {
        const notes = [first];
        while (this.isOp(",")) {
          this.next();
          if (this.isOp(")")) break;
          notes.push(this.expr());
        }
        this.expectOp(")");
        return new Chord(notes);
      }
      this.expectOp(")");
      return first;
    }
    if (t.t === "id") {
      const slot = this.ctx.reverbSlot(t.v);
      if (slot !== undefined) {
        let amount = DEFAULT_SEND;
        if (this.isOp("(")) {
          this.next();
          const { args } = this.args();
          if (args.length) amount = args[0];
        }
        return new SendRef(slot, amount);
      }
      if (t.v === "r") return REST;
      if (t.v === "P" && this.isOp("[")) {
        this.next();
        return this.list();
      }
      if (FUNCTIONS[t.v] && this.isOp("(")) {
        this.next();
        const impl = FUNCTION_IMPLS[t.v];
        if (!impl) throw new Error(`Function '${t.v}' is not implemented`);
        return impl(this.args().args);
      }
      const guess = closest(t.v, [...Object.keys(FUNCTIONS), ...this.ctx.reverbNames()]);
      throw new Error(
        `Unknown name '${t.v}'${guess ? ` (did you mean '${guess}'?)` : ""}. In a pattern a name is r (a rest), a function ` +
          `(${Object.keys(FUNCTIONS).join(", ")}) or a reverb, which must be defined first, e.g. ${t.v}: reverb(decay=0.9)`,
      );
    }
    throw new Error("Unexpected token in expression");
  }
}

// The candidate within two edits of `word` (typos like "rnage"), or undefined.
function closest(word, candidates) {
  const dist = (a, b) => {
    let row = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      const next = [i];
      for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      row = next;
    }
    return row[b.length];
  };
  let best;
  let bestDist = 3;
  for (const c of candidates) {
    const d = dist(word, c);
    if (d < bestDist) [best, bestDist] = [c, d];
  }
  return best;
}

// Text for a value shown by log(): numbers to three decimals, chords as (a, b), rests as r.
function show(v, beat) {
  v = resolve(v, beat);
  if (v === REST) return "r";
  if (v instanceof Chord) return `(${v.notes.map((x) => show(x, beat)).join(", ")})`;
  if (typeof v === "number") return String(Math.round(v * 1000) / 1000);
  return String(v);
}

// ---- functions ----

// Applies fn to every number inside a value: numbers, lists, chords and time-varying
// values (which are worked out first). Rests stay rests.
function mapNumbers(fn, v, what) {
  if (v === REST) return REST;
  if (Array.isArray(v)) return v.map((x) => mapNumbers(fn, x, what));
  if (v instanceof Chord) return new Chord(v.notes.map((x) => mapNumbers(fn, x, what)));
  if (v instanceof Dyn) return new Dyn((beat) => mapNumbers(fn, resolve(v, beat), what));
  return fn(num(v, what));
}

function oneValue(args, name) {
  if (args.length !== 1) throw new Error(`${name}(value) takes one value`);
  return args[0];
}

// lineto() needs two things no other Dyn does: a starting value that may only be known
// once it's bound to a specific drone or bus parameter (the "start from wherever it
// currently is" form), and a ramp length given in seconds, converted to beats using
// the tempo at the moment it starts (Dyn.at only ever receives a beat, never a tempo).
// Both are filled in after construction, in two steps done only for drones and buses
// (see buildDroneSpec/defineDrone and buildBusSpec/defineBus): first bind() resolves
// `from` (from a remembered value, or the target itself if there is none yet) and
// marks it as legitimately used there; then arm() fixes the actual start beat and ramp
// length once the real clock is available. A lineto() that is never bound this way
// (used on a player, a reverb, or combined with arithmetic, which wraps it in a plain,
// untagged Dyn) throws as soon as it is evaluated, rather than silently returning a
// frozen or wrong value.
function makeLinetoDyn(from, to, seconds) {
  const dyn = new Dyn((beat) => {
    const L = dyn.lineto;
    if (!L.bound) throw new Error("lineto() only works on a drone's or a bus's own parameters (a definition with no dur=), used directly -- not on a player, a reverb, or combined with arithmetic.");
    if (!L.armed) return L.to;
    const t = L.rampBeats <= 0 ? 1 : clamp((beat - L.startBeat) / L.rampBeats, 0, 1);
    return L.from + (L.to - L.from) * t;
  });
  dyn.lineto = { from, to, seconds, bound: false, armed: false };
  return dyn;
}

// Walks a plain value, list, chord or Dyn looking for lineto() Dyns inside it (fn is
// called once per one found) so buildDroneSpec/defineDrone can bind and arm them.
function forEachLineto(value, fn) {
  if (value instanceof Dyn) {
    if (value.lineto) fn(value);
  } else if (Array.isArray(value)) {
    value.forEach((v) => forEachLineto(v, fn));
  } else if (value instanceof Chord) {
    value.notes.forEach((v) => forEachLineto(v, fn));
  }
}

// Binds every lineto() found among `fields` (a list of [value, paramKey] pairs) to
// `name`: marks it as legitimately used on a drone or a bus, and resolves a missing
// `from` (the two-argument form) from the last value remembered for that exact
// name+parameter, or the target itself if this is the first time it has been seen.
// Shared by buildDroneSpec and buildBusSpec.
function bindLinetoAll(paramMemory, name, fields) {
  for (const [value, key] of fields) {
    forEachLineto(value, (dyn) => {
      dyn.lineto.bound = true;
      if (dyn.lineto.from === undefined) dyn.lineto.from = paramMemory.has(`${name}:${key}`) ? paramMemory.get(`${name}:${key}`) : dyn.lineto.to;
    });
  }
}

// Fixes the real start beat and ramp length (seconds converted using the tempo right
// now) of every lineto() found among `values`. Done separately from the bind step
// above, and only once the real clock is available, so a dry-run validation call (which
// has no real beat/tempo yet) can't corrupt a ramp's actual timing. Shared by
// defineDrone and defineBus.
function armLinetoAll(now, values) {
  for (const value of values) {
    forEachLineto(value, (dyn) => {
      dyn.lineto.startBeat = now.beat;
      dyn.lineto.rampBeats = (dyn.lineto.seconds * now.bpm) / 60;
      dyn.lineto.armed = true;
    });
  }
}

// One entry per name in FUNCTIONS (registry.js), which holds their documentation.
const FUNCTION_IMPLS = {
  range(args) {
    if (args.length < 1 || args.length > 2) throw new Error("range(end) or range(start, end) takes one or two numbers");
    const [a, b] = (args.length > 1 ? args : [0, args[0]]).map((x) => num(x, "range"));
    const length = Math.max(0, Math.ceil(b - a));
    if (length > LIMITS.maxListLength) throw new Error(`range() is limited to ${LIMITS.maxListLength} items`);
    return Array.from({ length }, (_, i) => a + i);
  },

  cosr(args) {
    if (args.length !== 3) throw new Error("cosr(center, amplitude, period) takes three numbers");
    const [center, amplitude, period] = args.map((x, i) => num(x, ["cosr center", "cosr amplitude", "cosr period"][i]));
    if (period <= 0) throw new Error("cosr period must be greater than 0 (in beats)");
    return new Dyn((beat) => center + amplitude * Math.cos((2 * Math.PI * beat) / period));
  },

  round: (args) => mapNumbers(Math.round, oneValue(args, "round"), "round"),

  floor: (args) => mapNumbers(Math.floor, oneValue(args, "floor"), "floor"),

  random(args) {
    if (args.length === 1 && Array.isArray(args[0])) {
      const list = args[0];
      if (!list.length) throw new Error("random() needs a list with at least one item");
      return new Dyn((beat) => resolve(list[Math.floor(Math.random() * list.length)], beat));
    }
    if (args.length !== 2) throw new Error("random(low, high) takes two numbers, or one list");
    const [a, b] = args.map((x, i) => num(x, ["random low", "random high"][i]));
    const low = Math.min(a, b);
    const high = Math.max(a, b);
    return new Dyn(() => low + Math.random() * (high - low));
  },

  randint(args) {
    if (args.length !== 2) throw new Error("randint(low, high) takes two numbers");
    const [a, b] = args.map((x, i) => num(x, ["randint low", "randint high"][i]));
    const low = Math.ceil(Math.min(a, b));
    const high = Math.floor(Math.max(a, b));
    if (high < low) throw new Error("randint() needs a range that contains a whole number");
    return new Dyn(() => low + Math.floor(Math.random() * (high - low + 1)));
  },

  lineto(args) {
    if (args.length === 2) {
      const [to, seconds] = args.map((x, i) => num(x, ["lineto to", "lineto seconds"][i]));
      if (seconds <= 0) throw new Error("lineto seconds must be greater than 0");
      return makeLinetoDyn(undefined, to, seconds);
    }
    if (args.length === 3) {
      const [from, to, seconds] = args.map((x, i) => num(x, ["lineto from", "lineto to", "lineto seconds"][i]));
      if (seconds <= 0) throw new Error("lineto seconds must be greater than 0");
      return makeLinetoDyn(from, to, seconds);
    }
    throw new Error("lineto(to, seconds) or lineto(from, to, seconds)");
  },
};

// ---- players ----

// A bracketed group that splits one step into equal sub-steps.
class Sub {
  constructor(items) {
    this.items = items;
  }
}

// "." is a rest; any other character must be a known drum voice.
function drumChar(c) {
  if (c === ".") return REST;
  if (!DRUMS[c]) throw new Error(`Unknown drum character '${c}'. Available: ${Object.keys(DRUMS).join(" ")} and . for a rest`);
  return c;
}

function parseDrums(str, pos = 0, closer = null) {
  const items = [];
  while (pos < str.length) {
    const c = str[pos];
    if (c === closer) return { items, pos: pos + 1 };
    if (c === "(") {
      const j = str.indexOf(")", pos);
      if (j < 0) throw new Error("Unclosed '(' in drum pattern");
      items.push(new Chord([...str.slice(pos + 1, j)].map(drumChar)));
      pos = j + 1;
    } else if (c === "[") {
      const inner = parseDrums(str, pos + 1, "]");
      if (!inner.items.length) throw new Error("Empty '[]' in drum pattern");
      items.push(new Sub(inner.items));
      pos = inner.pos;
    } else if (c === "]") {
      throw new Error("Unmatched ']' in drum pattern");
    } else {
      items.push(drumChar(c));
      pos++;
    }
  }
  if (closer) throw new Error("Unclosed '[' in drum pattern");
  return { items, pos };
}

// Whitespace is only for readability and is dropped before parsing.
function drumPattern(v) {
  return typeof v === "string" ? parseDrums(v.replace(/\s+/g, "")).items : v;
}

// Marks a player whose bus was killed: its notes are dropped instead of being sent to
// a slot that may later belong to another bus.
const DEAD_BUS = -1;

const asList = (v, dflt) => (v === undefined ? [dflt] : Array.isArray(v) ? v : [v]);
const MAX_STEPS_PER_TICK = 512;
// How many of a player's most recently emitted beats to remember, to tell whether a
// redefinition's target bar line was already sent a note. A wide lookahead relative to a
// short step duration can let a few steps race past that point before the swap is
// processed, so one remembered beat is not always enough -- see tick()'s swap logic.
const RECENT_EMITS_LIMIT = 32;

// Reads a number. Time-varying values (cosr) are evaluated at `beat`; where no beat is
// given (settings that are not tied to a step) they are rejected.
function num(v, what, beat) {
  while (v instanceof Chord || v instanceof Dyn) {
    if (v instanceof Dyn && beat === undefined) throw new Error(`'${what}' cannot change over time, use a plain number`);
    v = v instanceof Dyn ? v.at(beat) : v.notes[0];
  }
  if (typeof v !== "number" || !Number.isFinite(v)) throw new Error(`'${what}' must be a finite number`);
  return v;
}

function inRange(v, min, max, what) {
  const n = num(v, what);
  if (n < min || n > max) throw new Error(`'${what}' must be between ${min} and ${max}`);
  return n;
}

// A fractional degree lands proportionally between its two neighbouring scale steps,
// so a lineto() or cosr() on the degree glides smoothly instead of creeping one
// semitone and then jumping whenever the next step is further away than that.
function degreeToMidi(d, scale, root, oct) {
  const n = scale.length;
  const stepMidi = (i) => scale[((i % n) + n) % n] + Math.floor(i / n) * 12;
  const idx = Math.floor(d);
  const lo = stepMidi(idx);
  return 12 * oct + root + lo + (d - idx) * (stepMidi(idx + 1) - lo);
}

// oct is clamped, but a large degree (a custom scale wraps octaves with no bound of its
// own via Math.floor(idx / n) * 12), an extreme root, or a custom scale full of large
// numbers can still push the midi number arbitrarily far. Clamp the final Hz value
// itself so no combination of those can send a synth a frequency that aliases.
function midiToFreq(midi) {
  const hz = 440 * 2 ** ((midi - 69) / 12);
  return clamp(hz, LIMITS.minFreq, LIMITS.maxFreq);
}

export function createFox(engine, { onTempo, onBar, onError, onLog }) {
  const say = (message, kind = "info") => onLog?.(message, kind);

  // Delayed console lines (log players); cancelled when everything is cleared.
  const timers = new Set();
  const later = (fn, ms) => {
    const id = setTimeout(() => {
      timers.delete(id);
      fn();
    }, ms);
    timers.add(id);
  };
  const cancelTimers = () => {
    timers.forEach(clearTimeout);
    timers.clear();
  };
  const players = new Map();
  const reverbs = new Map();
  const drones = new Map();
  const buses = new Map();
  // Last raw value resolved for each drone's or bus's own parameter, keyed by
  // "name:key", so a lineto(to, seconds) re-evaluated later knows what "wherever it
  // currently is" means. Updated every tick in resolveDroneChannels/resolveBusChannels;
  // cleared when the drone or bus is killed.
  const paramMemory = new Map();
  const INITIAL_DEFAULTS = { scale: "major", root: 0, updateUnit: "bar" };
  const defaults = { ...INITIAL_DEFAULTS };
  let timer = null;

  // Every name belongs to exactly one kind of thing. Throws if `name` is already taken by
  // another kind; `hints` adds a kind-specific suggestion to the message.
  const KINDS = { player: players, reverb: reverbs, drone: drones, bus: buses };
  function claimName(name, kind, hints = {}) {
    for (const [other, map] of Object.entries(KINDS)) {
      if (other !== kind && map.has(name)) throw new Error(`'${name}' is a ${other}, pick another name${hints[other] ?? ""}`);
    }
  }

  // Names that already mean something inside a pattern. A reverb (the only kind of
  // definition a pattern can refer to by name) called one of these would shadow it, so
  // [0, r, 2] or range(4) would silently stop working.
  const RESERVED_NAMES = new Set(["r", "P", ...Object.keys(FUNCTIONS)]);
  function checkNotReserved(name, kind) {
    if (RESERVED_NAMES.has(name)) throw new Error(`'${name}' already means something in patterns (r, P and the function names are reserved), pick another name for the ${kind}`);
  }

  // Every spec that can hold a send or a bus route: running and pending players,
  // drones and buses.
  function* allSpecs() {
    for (const p of players.values()) {
      if (p.spec) yield p.spec;
      if (p.pending?.spec) yield p.pending.spec;
    }
    yield* drones.values();
    yield* buses.values();
  }

  // A killed reverb's slot may be handed to the next new reverb, so everything still
  // sending to it is detached now: those sends go silent (as documented) instead of
  // later feeding whichever reverb reuses the slot. Returns the names affected.
  function detachReverb(slot) {
    const affected = new Set();
    for (const spec of allSpecs()) {
      if (!spec.sends?.some((x) => x.slot === slot)) continue; // log() specs have no sends
      spec.sends = spec.sends.filter((x) => x.slot !== slot);
      affected.add(spec.label ?? spec.name);
      if (spec.name) paramMemory.delete(`${spec.name}:send${slot}`);
    }
    return [...affected];
  }

  // The same for a killed bus: players routed to it go silent until re-evaluated.
  function detachBus(slot) {
    const affected = new Set();
    for (const spec of allSpecs()) {
      if (spec.bus !== slot) continue;
      spec.bus = DEAD_BUS;
      affected.add(spec.label);
    }
    return [...affected];
  }

  // The lowest slot number not in `used`.
  function freeSlot(used, count, what) {
    for (let k = 0; k < count; k++) if (!used.has(k)) return k;
    throw new Error(`At most ${count} ${what} at a time`);
  }

  // Drops everything paramMemory remembers about a killed drone or bus.
  function forget(name) {
    for (const k of paramMemory.keys()) if (k.startsWith(`${name}:`)) paramMemory.delete(k);
  }

  // Stops every player and silences whatever is still sounding.
  function silenceAll() {
    players.clear();
    cancelTimers();
    engine.silence();
  }

  function scaleOf(v) {
    if (Array.isArray(v)) {
      if (!v.length || v.some((x) => typeof x !== "number" || !Number.isFinite(x))) throw new Error("A custom scale needs a non-empty list of numbers");
      return v;
    }
    const s = SCALES[v];
    if (!s) throw new Error(`Unknown scale '${v}'. Available: ${Object.keys(SCALES).join(", ")}`);
    return s;
  }

  function buildSends(v) {
    const list = v === undefined ? [] : Array.isArray(v) ? v : [v];
    if (list.length > MAX_SENDS) throw new Error(`At most ${MAX_SENDS} sends at once`);
    return list.map((x) => {
      if (!(x instanceof SendRef)) throw new Error("send= expects reverb names, e.g. send=rev1(0.2) or send=[rev1(0.2), rev2]");
      return { slot: x.slot, amount: asList(x.amount, DEFAULT_SEND) };
    });
  }

  // A drone's or bus's current send amounts at `now`, clamped for Csound; the raw values
  // are remembered once it is running (see resolveDroneChannels).
  function resolveSends(spec, now, remember) {
    return spec.sends.map((x) => {
      const raw = num(pick(x.amount, 0), "send amount", now.beat);
      if (remember) paramMemory.set(`${spec.name}:send${x.slot}`, raw);
      return [x.slot, clamp(raw, 0, 1)];
    });
  }

  // A drone plays one pitch, not a pattern, so a chord makes no sense there.
  function droneDegree(call) {
    const d = call.kwargs.degree ?? call.args[0] ?? PLAYER_PARAMS.degree.default;
    if (d instanceof Chord) throw new Error("A drone plays a single pitch; chords are not supported");
    if (Array.isArray(d)) throw new Error("A drone plays a single pitch, not a list");
    return d;
  }

  // A drone: one continuous voice (no pattern/dur), built from a built-in synth marked
  // "drone" in the registry. Its parameters are resolved fresh on every tick, so plain
  // numbers just stay put and cosr()/random() keep the sound moving continuously.
  function buildDroneSpec(name, call) {
    const s = SYNTHS[call.name];
    if (!s) throw new Error(`Unknown synth '${call.name}'. Built-in: ${Object.keys(SYNTHS).join(", ")}. Add dur= to use play, log or your own instrument as a player.`);
    if (!s.drone) throw new Error(`'${call.name}' can't be used as a drone (it always decays to silence). Add dur=... to use it as a player.`);
    const kw = call.kwargs;
    const extraKeys = droneParamKeys(s);
    const allowed = new Set(["degree", "amp", "oct", "pan", "root", "scale", "send", ...extraKeys]);
    for (const key of Object.keys(kw)) {
      if (!allowed.has(key)) throw new Error(`Unknown drone parameter '${key}'. Available: ${[...allowed].join(", ")}`);
    }
    const spec = {
      drone: true,
      name,
      instr: s.instr,
      degree: droneDegree(call),
      amp: kw.amp ?? PLAYER_PARAMS.amp.default,
      oct: kw.oct ?? PLAYER_PARAMS.oct.default,
      pan: kw.pan ?? PLAYER_PARAMS.pan.default,
      root: kw.root,
      scale: kw.scale ?? null,
      sends: buildSends(kw.send),
      extras: extraKeys.map((key) => ({ key, p: s.params[key], value: kw[key] ?? s.params[key].default })),
    };
    if (spec.scale !== null) scaleOf(spec.scale);
    bindLinetoAll(paramMemory, name, [
      [spec.degree, "degree"], [spec.oct, "oct"], [spec.amp, "amp"], [spec.pan, "pan"],
      ...spec.sends.map((x) => [x.amount, `send${x.slot}`]),
      ...spec.extras.map((e) => [e.value, e.key]),
    ]);
    resolveDroneChannels(spec, { beat: 0, bpm: 120 }); // dry run: surface errors immediately
    return spec;
  }

  function armLineto(spec, now) {
    armLinetoAll(now, [spec.degree, spec.oct, spec.amp, spec.pan, ...spec.sends.map((x) => x.amount), ...spec.extras.map((e) => e.value)]);
  }

  // Works out a drone's current channel values at the given beat/bpm. Also remembers
  // every raw value in paramMemory, so a later lineto(to, seconds) on this drone knows
  // where to start from -- but only once it is actually running (spec.slot is set once
  // defineDrone assigns one; buildDroneSpec's own dry-run validation call happens
  // before that, and must not overwrite a real remembered value with a throwaway one).
  function resolveDroneChannels(spec, now) {
    const remember = spec.slot !== undefined;
    const oct = clamp(num(spec.oct, "oct", now.beat), PLAYER_PARAMS.oct.min, PLAYER_PARAMS.oct.max);
    const root = spec.root !== undefined ? num(spec.root, "root", now.beat) : defaults.root;
    const scale = scaleOf(spec.scale ?? defaults.scale);
    const degree = num(spec.degree, "degree", now.beat);
    const midi = degreeToMidi(degree, scale, root, oct);
    const freq = midiToFreq(midi);
    // Same headroom factor a player's single note uses, so amp=1 means the same
    // loudness whether it is a drone or a player.
    const rawAmp = num(spec.amp, "amp", now.beat);
    const amp = VOICE_GAIN * rawAmp;
    const rawPan = num(spec.pan, "pan", now.beat);
    const pan = clamp((rawPan + 1) / 2, 0, 1);
    const sends = resolveSends(spec, now, remember);
    const extras = spec.extras.map(({ key, p, value }) => {
      const raw = num(value, key, now.beat);
      if (remember) paramMemory.set(`${spec.name}:${key}`, raw);
      const v = clamp(raw, p.min, p.max);
      return p.unit === "beats" ? (v * 60) / now.bpm : v;
    });
    if (remember) {
      paramMemory.set(`${spec.name}:degree`, degree);
      paramMemory.set(`${spec.name}:oct`, oct);
      paramMemory.set(`${spec.name}:amp`, rawAmp);
      paramMemory.set(`${spec.name}:pan`, rawPan);
    }
    return { amp, freq, pan, sends, extras };
  }

  function defineDrone(name, call) {
    claimName(name, "drone", { player: " (or add dur= to redefine it as one)" });
    const spec = buildDroneSpec(name, call);
    const now = requireNow();
    armLineto(spec, now);
    const existing = drones.get(name);
    const slot = existing?.slot ?? freeSlot(new Set([...drones.values()].map((d) => d.slot)), LIMITS.droneSlots, "drones");
    spec.slot = slot;
    drones.set(name, spec);
    engine.defineDrone(slot, spec.instr, resolveDroneChannels(spec, now));
    say(`${name}: ${call.name} drone ${existing ? "updated" : "starts"}`);
  }

  // A bus is a mixing group: amp/pan control everything routed to it together, and
  // send= feeds the combined signal to reverbs; all of them can be re-evaluated live or
  // driven with cosr()/lineto(), refreshed every tick exactly like a drone's own
  // parameters (see forEachLineto/paramMemory above).
  function buildBusSpec(name, call) {
    if (call.args.length) throw new Error("bus() takes named parameters only, e.g. bus(amp=1, pan=0)");
    for (const key of Object.keys(call.kwargs)) {
      if (!(key in BUS_DEFAULTS) && key !== "send") throw new Error(`Unknown bus parameter '${key}'. Available: ${[...Object.keys(BUS_DEFAULTS), "send"].join(", ")}`);
    }
    const spec = { name, amp: call.kwargs.amp ?? BUS_DEFAULTS.amp, pan: call.kwargs.pan ?? BUS_DEFAULTS.pan, sends: buildSends(call.kwargs.send) };
    bindLinetoAll(paramMemory, name, [[spec.amp, "amp"], [spec.pan, "pan"], ...spec.sends.map((x) => [x.amount, `send${x.slot}`])]);
    resolveBusChannels(spec, { beat: 0, bpm: 120 }); // dry run: surface errors immediately
    return spec;
  }

  function armBusLineto(spec, now) {
    armLinetoAll(now, [spec.amp, spec.pan, ...spec.sends.map((x) => x.amount)]);
  }

  // Works out a bus's current amp/pan/sends at the given beat/bpm, and remembers the
  // raw values in paramMemory once it is actually running (see resolveDroneChannels).
  function resolveBusChannels(spec, now) {
    const remember = spec.slot !== undefined;
    const amp = num(spec.amp, "amp", now.beat);
    const rawPan = num(spec.pan, "pan", now.beat);
    const pan = clamp(rawPan, -1, 1);
    const sends = resolveSends(spec, now, remember);
    if (remember) {
      paramMemory.set(`${spec.name}:amp`, amp);
      paramMemory.set(`${spec.name}:pan`, rawPan);
    }
    return { amp, pan, sends };
  }

  function defineBus(name, call) {
    claimName(name, "bus");
    checkNotReserved(name, "bus");
    const spec = buildBusSpec(name, call);
    const now = requireNow();
    armBusLineto(spec, now);
    const existing = buses.get(name);
    const slot = existing?.slot ?? freeSlot(new Set([...buses.values()].map((b) => b.slot)), LIMITS.busSlots, "buses");
    spec.slot = slot;
    buses.set(name, spec);
    engine.defineBus(slot, resolveBusChannels(spec, now));
    say(`${name}: bus ${existing ? "updated" : "starts"}`);
  }

  // log(value, dur=1) is a player that prints its value every step instead of playing.
  function buildLogSpec({ args, kwargs: kw }) {
    for (const key of Object.keys(kw)) if (key !== "dur") throw new Error(`log() only takes dur, not '${key}'`);
    if (args.length !== 1) throw new Error("log() takes one value, e.g. log(cosr(5, 3, 4), dur=1/2)");
    const values = asList(args[0]);
    if (!values.length) throw new Error("log() needs at least one value");
    const spec = { log: true, degree: values, dur: asList(kw.dur, PLAYER_PARAMS.dur.default) };
    if (!spec.dur.length) throw new Error("'dur' needs at least one value");
    for (let i = 0; i < 2 * Math.max(values.length, spec.dur.length); i++) emitStep(spec, i, 0, true);
    return spec;
  }

  function buildSpec(call) {
    const { name, args, kwargs: kw } = call;
    let instr;
    let drums = false;
    const alias = engine.resolveInstrument(name);
    if (name === "log" && alias === undefined) return buildLogSpec(call);
    if (alias !== undefined) instr = alias;
    else if (name === "play") drums = true;
    else if (SYNTHS[name]) instr = SYNTHS[name].instr;
    else if (/^i\d+$/.test(name)) instr = Number(name.slice(1));
    else {
      throw new Error(`Unknown synth '${name}'. Built-in: ${Object.keys(SYNTHS).join(", ")}, play, log, or i<N> / an instrument name from your code.`);
    }
    // A bus-routed variant instrument only exists for built-in synths and drums
    // (generated once at startup, see engine.js's busVariantInstrSource); a named or
    // numbered instrument from the player's own code has no such variant.
    if (call.bus !== null && call.bus !== undefined && (alias !== undefined || /^i\d+$/.test(name))) {
      throw new Error(`'${name}@...' is not supported: routing to a bus only works with built-in synths and play(), not your own instruments.`);
    }
    const synthParams = (alias === undefined && SYNTHS[name]?.params) || {};
    for (const key of Object.keys(kw)) {
      if (!(key in PLAYER_PARAMS) && !(key in synthParams)) {
        throw new Error(`Unknown parameter '${key}'. Available: ${[...Object.keys(PLAYER_PARAMS), ...Object.keys(synthParams)].join(", ")}`);
      }
    }
    let degree = kw.degree ?? args[0] ?? (drums ? [] : [PLAYER_PARAMS.degree.default]);
    if (drums) degree = drumPattern(degree);
    const spec = {
      instr,
      drums,
      bus: call.bus ?? null,
      degree: asList(degree, PLAYER_PARAMS.degree.default),
      dur: asList(kw.dur, PLAYER_PARAMS.dur.default),
      amp: asList(kw.amp, PLAYER_PARAMS.amp.default),
      oct: asList(kw.oct, PLAYER_PARAMS.oct.default),
      sus: kw.sus === undefined ? null : asList(kw.sus),
      pan: asList(kw.pan, PLAYER_PARAMS.pan.default),
      root: kw.root === undefined ? null : asList(kw.root),
      scale: kw.scale ?? null,
      sends: buildSends(kw.send),
      extras: Object.entries(synthParams).map(([key, p]) => ({ key, p, values: asList(kw[key], p.default) })),
    };
    for (const key of ["degree", "dur", "amp", "oct", "sus", "pan", "root"]) {
      if (spec[key] && !spec[key].length) throw new Error(`'${key}' needs at least one value`);
    }
    for (const x of spec.extras) if (!x.values.length) throw new Error(`'${x.key}' needs at least one value`);
    if (spec.scale !== null) scaleOf(spec.scale);
    for (let i = 0; i < 2 * Math.max(...[spec.degree, spec.dur, spec.amp, spec.oct, spec.pan].map((l) => l.length)); i++) {
      emitStep(spec, i, 0, true);
    }
    return spec;
  }

  // Returns the step duration and emits its notes at the given beat.
  // With dry=true nothing is sent; it only checks that the values are usable.
  function emitStep(spec, i, at, dry = false, bpm = 120, beat = at) {
    if (spec.log) {
      const dur = Math.max(num(pick(spec.dur, i), "dur", at), 0.01);
      const text = show(pick(spec.degree, i), at);
      // Notes are handed over ahead of time; the console line waits until the beat itself.
      if (!dry) later(() => say(`${spec.label}: ${text}`, "value"), Math.max(0, ((at - beat) * 60000) / bpm));
      return dur;
    }
    const dur = Math.max(num(pick(spec.dur, i), "dur", at), 0.01);
    // Floored like dur: Csound reads a zero or negative duration as "hold forever", so a
    // sus that dips below zero (sus=cosr(0.5, 1, 4)) would leave a stuck note every step.
    const sus = spec.sus ? Math.max(num(pick(spec.sus, i), "sus", at), 0.01) : dur;
    const amp = num(pick(spec.amp, i), "amp", at);
    const pan = clamp((num(pick(spec.pan, i), "pan", at) + 1) / 2, 0, 1);

    const sends = spec.sends.map((x) => [x.slot, clamp(num(pick(x.amount, i), "send amount", at), 0, 1)]);
    // A synth's own parameters, clamped to their range; "beats" values are handed over in seconds.
    const extras = spec.extras.map(({ key, p, values }) => {
      const v = clamp(num(pick(values, i), key, at), p.min, p.max);
      return p.unit === "beats" ? (v * 60) / bpm : v;
    });

    const emitNote = (item, t, s, gain) => {
      if (spec.drums) {
        const instr = DRUMS[item]?.instr;
        if (instr && !dry && spec.bus !== DEAD_BUS) engine.note(t, instr, s, gain, 0, pan, sends, extras, spec.bus);
      } else {
        const oct = clamp(num(pick(spec.oct, i), "oct", t), PLAYER_PARAMS.oct.min, PLAYER_PARAMS.oct.max);
        const root = spec.root ? num(pick(spec.root, i), "root", t) : defaults.root;
        const midi = degreeToMidi(num(item, "degree", t), scaleOf(spec.scale ?? defaults.scale), root, oct);
        if (!dry && spec.bus !== DEAD_BUS) engine.note(t, spec.instr, s, gain, midiToFreq(midi), pan, sends, extras, spec.bus);
      }
    };

    const walk = (item, t, span, s) => {
      item = resolve(item, t);
      if (item === REST) return;
      if (item instanceof Sub) {
        const w = span / item.items.length;
        item.items.forEach((x, k) => walk(x, round6(t + k * w), w, s / item.items.length));
        return;
      }
      const voices = (item instanceof Chord ? item.notes : [item]).map((x) => resolve(x, t)).filter((x) => x !== REST);
      const gain = (VOICE_GAIN * amp) / Math.sqrt(Math.max(1, voices.length));
      for (const v of voices) emitNote(v, t, s, gain);
    };

    walk(pick(spec.degree, i), at, dur, sus);
    return dur;
  }

  const round6 = (x) => Math.round(x * 1e6) / 1e6;

  function tick() {
    const now = engine.now();
    if (!now) return;
    const horizon = now.beat + (LOOKAHEAD_S * now.bpm) / 60;
    for (const [name, p] of players) {
      try {
        for (let n = 0; n < MAX_STEPS_PER_TICK; n++) {
          if (p.pending && p.next >= p.pending.at - EPS) {
            p.spec = p.pending.spec;
            // Notes are handed to Csound up to LOOKAHEAD_S ahead of time, so the old spec
            // may already have sent a note for this exact bar line before the redefinition
            // was processed -- and with a short step duration, a wide lookahead can let it
            // race a few steps past that point before this check even runs, so it's not
            // enough to look at only the single most-recently emitted beat; check the recent
            // history instead, and keep walking forward for as long as it was. The new spec
            // always starts its own step 0 exactly on the bar line (grid-aligned, whatever
            // the old spec's step size was) -- each step already covered by the old spec is
            // skipped as a dry run so its duration still advances the schedule and idx lands
            // on the first step that genuinely hasn't sounded yet, instead of resetting to
            // step 0 at a time that no longer matches it (which played the wrong step of the
            // pattern late).
            p.next = p.pending.at;
            p.idx = 0;
            p.pending = null;
            if (!p.spec) {
              players.delete(name);
              break;
            }
            while (p.recentEmits?.has(round6(p.next))) {
              const skippedDur = emitStep(p.spec, p.idx, p.next, true, now.bpm, now.beat);
              p.next = round6(p.next + skippedDur);
              p.idx++;
            }
            continue;
          }
          if (!(p.next < horizon)) break;
          (p.recentEmits ??= new Set()).add(round6(p.next));
          if (p.recentEmits.size > RECENT_EMITS_LIMIT) p.recentEmits.delete(p.recentEmits.values().next().value);
          const dur = emitStep(p.spec, p.idx, p.next, false, now.bpm, now.beat);
          p.next = round6(p.next + dur);
          p.idx++;
        }
      } catch (e) {
        players.delete(name);
        onError?.(`Player '${name}' stopped: ${e.message}`);
      }
    }
    // Drones: refresh every channel every tick, so plain values just stay put and
    // cosr()/random() keep flowing continuously instead of only at note-start.
    for (const [name, spec] of drones) {
      try {
        engine.updateDrone(spec.slot, resolveDroneChannels(spec, now));
      } catch (e) {
        drones.delete(name);
        engine.stopDrone(spec.slot);
        onError?.(`Drone '${name}' stopped: ${e.message}`);
      }
    }
    // Buses: same continuous refresh, for amp/pan driven by cosr()/lineto().
    for (const [name, spec] of buses) {
      try {
        engine.updateBus(spec.slot, resolveBusChannels(spec, now));
      } catch (e) {
        buses.delete(name);
        engine.stopBus(spec.slot);
        onError?.(`Bus '${name}' stopped: ${e.message}`);
      }
    }
  }

  // Where a new/changed player, or a kill, lands: the next bar line by default, or (with
  // "updates beat") the next whole beat instead -- a faster response at the cost of no
  // longer always landing on a musically-aligned bar. Either way the same lead time
  // applies, so there is always enough real time left for the launcher to schedule it.
  function nextTarget(now) {
    const unit = defaults.updateUnit === "beat" ? 1 : now.bar;
    const b = now.beat + (NEXT_BAR_LEAD_S * now.bpm) / 60;
    return (Math.floor(b / unit) + 1) * unit;
  }

  // The 1-based bar number a bar-line position falls on (the same numbering as the bar.beat display).
  const barOf = (at, now) => Math.round(at / now.bar) + 1;

  // Console wording for a target: "bar N" when landing on an actual bar line (the
  // default), "beat N" when "updates beat" is on and it may land anywhere in the bar.
  const describeTarget = (at, now) => (defaults.updateUnit === "beat" ? `beat ${at}` : `bar ${barOf(at, now)}`);

  function requireNow() {
    const now = engine.now();
    if (!now) throw new Error("Clock is not ready yet, try again in a moment.");
    return now;
  }

  function defineReverb(name, call) {
    claimName(name, "reverb");
    checkNotReserved(name, "reverb");
    for (const key of Object.keys(call.kwargs)) {
      if (!(key in REVERB_DEFAULTS)) throw new Error(`Unknown reverb parameter '${key}'. Available: ${Object.keys(REVERB_DEFAULTS).join(", ")}`);
    }
    if (call.args.length) throw new Error("reverb() takes named parameters only, e.g. reverb(decay=0.9)");
    const existed = reverbs.has(name);
    const slot = reverbs.get(name) ?? freeSlot(new Set(reverbs.values()), LIMITS.reverbSlots, "reverbs");
    reverbs.set(name, slot);
    const params = {};
    for (const [key, dflt] of Object.entries(REVERB_DEFAULTS)) params[key] = num(call.kwargs[key] ?? dflt, key);
    engine.defineReverb(slot, params);
    say(`${name}: reverb ${existed ? "updated" : "defined"} (${Object.entries(params).map(([k, v]) => `${k}=${v}`).join(", ")})`);
  }

  // Stops one player (at the next bar), or removes one reverb, drone or bus
  // (immediately: none of those were ever on the bar grid).
  function killOne(name) {
    const detached = (names) => (names.length ? ` (${names.join(", ")} no longer send${names.length > 1 ? "" : "s"} to it)` : "");
    if (reverbs.has(name)) {
      const slot = reverbs.get(name);
      engine.stopReverb(slot);
      reverbs.delete(name);
      say(`${name} killed: reverb removed${detached(detachReverb(slot))}`, "kill");
    } else if (drones.has(name)) {
      engine.stopDrone(drones.get(name).slot);
      drones.delete(name);
      forget(name);
      say(`${name} killed: drone stopped`, "kill");
    } else if (buses.has(name)) {
      const { slot } = buses.get(name);
      engine.stopBus(slot);
      buses.delete(name);
      forget(name);
      const silenced = detachBus(slot);
      say(`${name} killed: bus stopped${silenced.length ? ` (${silenced.join(", ")} now silent until re-evaluated)` : ""}`, "kill");
    } else if (players.has(name)) {
      const now = requireNow();
      const at = nextTarget(now);
      players.get(name).pending = { at, spec: null };
      say(`${name} killed: stops at ${describeTarget(at, now)}`, "kill");
    } else {
      throw new Error(`No player, reverb, drone or bus named '${name}'`);
    }
  }

  const ctx = {
    reverbSlot(name) {
      return reverbs.get(name);
    },

    busSlot(name) {
      return buses.get(name)?.slot;
    },

    reverbNames() {
      return reverbs.keys();
    },

    define(name, call) {
      // Only a player's notes have bus-routed variants; say so instead of quietly
      // playing a drone, bus, reverb or log somewhere other than where it was sent.
      if (call.bus !== null) {
        const what =
          call.name === "reverb" ? "A reverb" :
          call.name === "bus" ? "A bus" :
          call.name === "log" ? "log()" :
          call.kwargs.dur === undefined ? "A drone" : null;
        if (what) throw new Error(`${what} cannot be routed to a bus with @; only players (a synth or play() with dur=) can.`);
      }
      if (call.name === "reverb") return defineReverb(name, call);
      if (call.name === "bus") return defineBus(name, call);
      if (call.name !== "log" && call.kwargs.dur === undefined) return defineDrone(name, call);
      claimName(name, "player", { drone: " (or drop dur= to redefine it as one)" });
      const spec = buildSpec(call);
      spec.label = name;
      const now = requireNow();
      const at = nextTarget(now);
      let p = players.get(name);
      const existed = Boolean(p);
      if (!p) {
        p = { spec: null, next: at, idx: 0, pending: null };
        players.set(name, p);
      }
      p.pending = { at, spec };
      say(`${name}: ${call.name} ${existed ? "changes" : "starts"} at ${describeTarget(at, now)}`);
    },

    set(word, value) {
      if (word === "tempo") {
        const v = inRange(value, LIMITS.minBpm, LIMITS.maxBpm, "tempo");
        engine.setTempo(v);
        onTempo?.(v);
        say(`tempo ${v}`);
      } else if (word === "bar") {
        const v = inRange(value, 1, LIMITS.maxBar, "bar");
        engine.setBar(v);
        onBar?.(v);
        say(`bar ${v}`);
      } else if (word === "scale") {
        scaleOf(value);
        defaults.scale = value;
        say(`scale ${Array.isArray(value) ? `[${value.join(", ")}]` : value}`);
      } else if (word === "root") {
        defaults.root = num(value, "root");
        say(`root ${defaults.root}`);
      } else if (word === "updates") {
        if (value !== "bar" && value !== "beat") throw new Error('updates must be "bar" or "beat"');
        defaults.updateUnit = value;
        say(`updates "${value}"`);
      }
    },

    // "kill name" or "kill pattern*": a literal name kills one player/reverb/drone/bus;
    // a pattern with "*" kills every one of them whose name matches.
    kill(pattern) {
      if (!pattern.includes("*")) return killOne(pattern);
      const escape = (part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp("^" + pattern.split("*").map(escape).join(".*") + "$");
      const names = [...players.keys(), ...reverbs.keys(), ...drones.keys(), ...buses.keys()].filter((n) => re.test(n));
      if (!names.length) throw new Error(`No player, reverb, drone or bus matches '${pattern}'`);
      for (const n of names) killOne(n);
    },

    clear() {
      silenceAll();
      say("clear: all players stopped, instruments silenced", "kill");
    },
  };

  return {
    run(code) {
      new Parser(code, ctx).run();
    },

    start() {
      timer = setInterval(tick, LIMITS.droneUpdateMs);
    },

    stop() {
      clearInterval(timer);
      players.clear();
      reverbs.clear();
      drones.clear();
      buses.clear();
      paramMemory.clear();
      cancelTimers();
      // A new session starts from the same defaults as the clock (tempo/bar) does.
      Object.assign(defaults, INITIAL_DEFAULTS);
    },

    // Ctrl+.: stops every player and silences every running instrument.
    clear: silenceAll,
  };
}
