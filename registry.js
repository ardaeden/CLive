// Single source of truth for everything the user can see or type.
//
// The engine, the player language, the highlighter, the editor shortcuts and
// the pages in docs/ all read from this file, so a feature that is added here shows up
// in the help page immediately. Every entry needs a `doc`; entries without one
// are flagged as "undocumented" on the help page.
//
// Built-in synths live one-per-file under synths/ (collected and re-exported below) so
// each is easy to find and edit on its own; everything else stays in this file.
import { SYNTHS } from "./synths/index.js";
import { DRUM_KITS } from "./drums/index.js";
export { SYNTHS };

export const LIMITS = {
  sendSlots: 8,
  maxSends: 3,
  defaultSend: 0.3,
  lookaheadSeconds: 0.5,
  nextBarLeadSeconds: 0.15,
  outputLatencySeconds: 0.05,
  minBpm: 20,
  maxBpm: 400,
  maxBar: 16,
  maxListLength: 4096,
  droneSlots: 8,
  droneUpdateMs: 20,
  minFreq: 16,
  maxFreq: 16000,
  busSlots: 8,
  maxSampleSeconds: 60,
};

export const LIMIT_DOCS = {
  sendSlots: "Send effects -- reverbs and delays together -- that can exist at the same time.",
  maxSends: "Sends (to reverbs or delays) per player, drone, bus or delay.",
  defaultSend: "Send amount used when you write send=rev1 without an amount.",
  lookaheadSeconds: "How far ahead (in seconds) notes are handed to Csound. Notes always start exactly on the beat grid.",
  nextBarLeadSeconds: "A change evaluated within this many seconds of its target (a bar line, or a beat line with updates \"beat\") waits for the following one instead. For scale and root the window is lookaheadSeconds, since notes already handed to Csound keep the scale they were sent with.",
  outputLatencySeconds: "Audio output buffer (in seconds) requested from the browser. Csound renders inside the audio thread, so a bigger buffer rides out brief load peaks (startup, compiling Csound code, many notes starting at once) instead of dropping out. It only delays the sound as a whole; notes stay exactly on the beat grid, and the bar.beat display and log() lines wait for the same delay so they stay in step with what you hear.",
  minBpm: "Lowest tempo accepted by the tempo command and the BPM box.",
  maxBpm: "Highest tempo accepted by the tempo command and the BPM box.",
  maxBar: "Largest number of beats per bar.",
  maxListLength: "Longest list that range() can build.",
  droneSlots: "Drones that can run at the same time.",
  droneUpdateMs: "How often (in milliseconds) a drone's or bus's cosr()/random()/lineto() parameters are refreshed while it runs. Each value glides linearly to the next over this time, and levels and pan are applied per sample, so moving parameters do not click.",
  minFreq: "Lowest frequency (Hz) a note or drone can reach, whatever combination of oct/degree/root/scale produced it.",
  maxFreq: "Highest frequency (Hz) a note or drone can reach, whatever combination of oct/degree/root/scale produced it.",
  busSlots: "Buses that can exist at the same time.",
  maxSampleSeconds: "Longest part of a sample file (src=) that is loaded, in seconds; the rest is cut off. Samples are kept in memory as mono, uncompressed audio, so a long file takes a lot of it.",
};

// Reserved words at the start of a player-language statement. They are only
// special there: a definition "tempo: pluck(...)" is unaffected because the
// parser checks for ": " before treating a word as a command.
export const COMMAND_WORDS = ["tempo", "bar", "scale", "root", "updates", "kill", "clear"];

// Drum kits for play("..."): kit name -> { character in the pattern -> voice }. The
// voices live one kit per file under drums/.
export { DRUM_KITS };

// play()'s own parameters. kit picks the set of voices; decay, tune and tone reach every
// voice as p13-p15 (in this order), so they work with any kit.
export const DRUM_PARAMS = {
  kit: {
    default: "classic",
    kind: "kit",
    shown: '"classic"',
    doc: 'Which set of drum sounds the pattern plays: "classic" or "808". Each kit has its own characters, listed on the Drums page. It is fixed for the player (not a list).',
  },
  decay: {
    default: 1,
    min: 0.1,
    max: 4,
    doc: "Multiplies how long every drum rings: 0.5 is twice as short, 2 twice as long. Like any parameter it can be a list or cosr(), so decay=[1, 0.4] alternates long and short hits.",
  },
  tune: {
    default: 0,
    min: -24,
    max: 24,
    doc: "Pitch of the drums in semitones, up or down.",
  },
  tone: {
    default: 0.5,
    min: 0,
    max: 1,
    doc: "Each drum's own character knob, from 0 to 1: the click of a kick, the snappy noise of a snare, the brightness of a hat. What it does for each sound is listed on the Drums page.",
  },
};

// The ones sent to every drum voice as p13 and up (all but kit).
export const DRUM_EXTRA_PARAMS = Object.fromEntries(Object.entries(DRUM_PARAMS).filter(([, p]) => p.kind !== "kit"));

// Every drum voice of every kit, for compiling them and checking instrument numbers.
export const DRUM_VOICES = Object.values(DRUM_KITS).flatMap((kit) => Object.values(kit));

// Built-in instrument numbers must not collide, and must leave room for what is
// derived from them: aliases for named instruments start at 300, and a dronable synth's
// continuous voice runs at its number + 9800, which has to stay below the bus returns
// (9975). Checked here, where both SYNTHS and the drum voices are known.
{
  const owner = new Map();
  for (const [name, x] of [...Object.entries(SYNTHS), ...DRUM_VOICES.map((d) => [d.name, d])]) {
    if (owner.has(x.instr)) throw new Error(`Built-in '${name}' and '${owner.get(x.instr)}' both use instr ${x.instr}`);
    owner.set(x.instr, name);
    if (!(x.instr >= 1 && x.instr < 300)) throw new Error(`Built-in '${name}' uses instr ${x.instr}; built-ins must be 1-299`);
    if (x.drone && x.instr >= 175) throw new Error(`Dronable synth '${name}' uses instr ${x.instr}; its drone voice (+9800) would collide with the bus returns, keep it below 175`);
  }
}

export const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  pentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  // Traditional Japanese five-note scales.
  hirajoshi: [0, 2, 3, 7, 8],
  kumoi: [0, 2, 3, 7, 9],
  iwato: [0, 1, 5, 6, 10],
  insen: [0, 1, 5, 7, 10],
  yo: [0, 2, 5, 7, 9],
  miyako: [0, 1, 5, 7, 8],
  ryukyu: [0, 4, 5, 7, 11],
};

// Keyword arguments of a player. `default` is what the code uses, `shown` is
// what the help page prints.
export const PLAYER_PARAMS = {
  degree: {
    default: 0,
    shown: "[0]",
    doc: "What to play, usually the first positional argument. Scale degrees (negative and fractional allowed; a fractional degree lands proportionally between its two neighbouring scale steps, so lineto() or cosr() on it glides smoothly), a tuple (0, 2, 4) for a chord, r for a rest. For play() it is the drum string.",
  },
  dur: { default: 1, shown: "required", doc: "Length of every step in beats. A list cycles step by step. Leaving it out entirely (not even dur=1) is what makes a definition a drone instead of a player; see the Drones page." },
  amp: { default: 1, shown: "1", doc: "Loudness multiplier. A list cycles step by step." },
  oct: { default: 5, min: 0, max: 10, shown: "5", doc: "Octave, clamped to 0-10. Degree 0 of C in octave 5 is middle C (261.6 Hz); octave 10 is already a very high, piercing register, so values above it are held there rather than climbing further. The resulting frequency (from oct, degree, root and scale together) is also hard-clamped, see minFreq/maxFreq." },
  sus: { default: null, shown: "same as dur", doc: "Note length in beats, at least 0.01. Synths with their own decay (pluck, wood, drums) ignore it." },
  pan: { default: 0, shown: "0", doc: "Stereo position from -1 (left) to 1 (right). A list cycles step by step." },
  root: { default: null, shown: "root default", doc: "Semitone offset of the scale root (0 = C)." },
  scale: { default: null, shown: "scale default", doc: "Scale name (see the Scales table) or your own list of semitones, e.g. [0, 3, 5, 7, 10]." },
  send: {
    default: null,
    shown: "none",
    doc: "Sends to reverbs and delays: send=rev1(0.3), send=rev1 (amount 0.3) or send=[rev1(0.2), echo1]. The amount can be a list.",
  },
};

export const REVERB_PARAMS = {
  decay: { default: 0.85, doc: "Feedback of the reverb, 0 to 0.99. Higher values give a longer tail." },
  lowcut: { default: 150, doc: "High-pass filter on the reverb input in Hz. Keeps bass and kick out of the tail." },
  highcut: { default: 8000, doc: "Damping in Hz: the tail loses everything above this frequency." },
  level: { default: 0.5, doc: "How loud the reverb return is in the mix." },
};

// A bus is a mixing group: players write their whole signal into it (name@busname(...))
// instead of straight to the output, and the bus's own amp/pan control that combined
// signal. amp/pan can be re-evaluated with plain numbers or with cosr()/lineto(), which
// are re-read every LIMITS.droneUpdateMs like a drone's parameters.
// delay()'s parameters. Like a bus's, they update live (plain numbers, cosr(), lineto()).
export const DELAY_PARAMS = {
  time: { default: 0.75, min: 0.03125, max: 4, doc: "Time between repeats in beats, so it follows the tempo: 1/2 is an eighth note, 3/4 a dotted eighth, 1/3 a triplet. At most 6 seconds, however slow the tempo. Changing it glides like tape speeding up or slowing down, bending the repeats' pitch for a moment." },
  spread: { default: 0, min: -2, max: 2, doc: "Extra time for the right side, in beats: spread=1/4 with time=1/2 repeats every 1/2 beat on the left and every 3/4 on the right, for a wide, uneven stereo echo." },
  feedback: { default: 0.45, min: 0, max: 1, doc: "How much of each repeat comes back again: 0 is a single echo, 0.9 a long trail. A soft saturator in the loop keeps it from blowing up, so values near 1 hold the echoes going and slowly smear them instead." },
  pingpong: { default: 0, min: 0, max: 1, doc: "At 1 the input enters on the left and every repeat jumps to the other side; in between blends that with plain stereo repeats." },
  lowcut: { default: 100, min: 20, max: 2000, doc: "High-pass inside the loop, in Hz: every repeat gets a little thinner." },
  highcut: { default: 5000, min: 500, max: 18000, doc: "Low-pass inside the loop, in Hz: every repeat gets a little darker, like tape." },
  wobble: { default: 0.15, min: 0, max: 1, doc: "Tape wow and flutter: slow and fast wavering of the time, a slight pitch drift and chorus on the repeats." },
  drive: { default: 0.2, min: 0, max: 1, doc: "Saturation of the repeats, from a clean digital echo (0) to a dirty, compressed tape echo (1)." },
  level: { default: 0.6, min: 0, max: 2, doc: "How loud the repeats are in the mix. The delay outputs only the repeats (no dry signal)." },
};

export const BUS_PARAMS = {
  amp: { default: 1, doc: "Loudness multiplier applied to everything routed to this bus." },
  pan: { default: 0, doc: "Stereo balance of the combined bus signal, -1 (left) to 1 (right). This trims the existing left/right levels rather than re-panning a mono source, since each player routed here already panned its own signal." },
};

export const SHORTCUTS = [
  { id: "evalBlock", label: "block/selection", keys: "Ctrl+Enter", doc: "Evaluate the selection, or the block around the cursor (blocks are separated by blank lines). The console logs what happened: when players start, what was compiled and scheduled." },
  { id: "evalLine", label: "line", keys: "Alt+Enter", doc: "Evaluate the current line only; when it is part of a player statement that spans several lines, the whole statement." },
  {
    id: "killLine",
    label: "kill player",
    keys: "Ctrl+Alt+Enter",
    doc: "Kill the player, reverb, delay, drone or bus defined on the current line (the whole statement when it spans several lines). With a selection, kills every one of them defined in it. Players stop at the next bar line (or beat, with updates \"beat\"), like kill name; reverbs, delays, drones and buses stop immediately. The console logs each one in red.",
  },
  { id: "silence", label: "silence", keys: "Ctrl+.", doc: "Stop all players and silence every running instrument, including notes routed to a bus. Reverbs, drones and buses themselves keep running." },
  { id: "indent", label: "indent", keys: "Tab", doc: "Insert two spaces; with a selection, indent every selected line instead of replacing it." },
  { id: "outdent", label: "outdent", keys: "Shift+Tab", doc: "Remove up to two leading spaces from the cursor's line, or from every selected line." },
  { id: "saveScene", label: "save", keys: "Ctrl+S", global: true, doc: "Save the scene -- every tab (name and code), which one is open, and the BPM and Beats/bar boxes -- as a .clive file. Same as the Save button. Where the browser allows it you pick the file and name; otherwise the file is downloaded. Works with the cursor anywhere on the page." },
  { id: "loadScene", label: "load", keys: "Ctrl+O", global: true, doc: "Open a .clive scene: its tabs replace the current ones (you are asked first if they have unsaved changes) and its BPM and Beats/bar are set. Nothing starts playing on its own; evaluate the code to hear it. Same as the Load button." },
];

// Statements the player language understands.
export const COMMANDS = [
  { syntax: "name: synth(degrees, dur=1, amp=1, ...)", doc: "Create or replace a player. The new version starts on the next bar line (or the next beat, with updates \"beat\")." },
  {
    syntax: "name: synth(degree, amp=1, ...)  ; no dur",
    doc: "Create or update a drone: one continuous voice, independent of the bar grid, instead of a repeating pattern. Leaving out dur is what makes it a drone. amp, pan, send and most of the synth's own parameters can be changed live, either by re-evaluating the line or with cosr()/random(), which keep refreshing while it runs. Only synths marked \"drone\" on the Synths page support this.",
  },
  { syntax: "name: log(cosr(5, 3, 4), dur=1/2)", doc: "Prints a value to the console on every step instead of playing a sound, so you can watch cosr(), random(), round() and patterns. The value is worked out at the step's own beat, exactly as a parameter would get it. It takes one value and dur, and is stopped like any player." },
  { syntax: "name: reverb(decay=0.9, ...)", doc: "Create or update a reverb return. Changes apply immediately and keep the reverb running." },
  { syntax: "name: delay(time=3/4, feedback=0.45, ...)", doc: "Create or update a delay: a send effect like a reverb, sent to with send=name(amount). Its time is in beats; every parameter updates live, like a bus's, and it can send its repeats on to reverbs with its own send=. See the Delay page." },
  { syntax: "name: bus(amp=1, pan=0, send=rev1(0.3))", doc: "Create or update a bus: a mixing group. amp, pan and send update immediately, live, the same as a drone's (plain numbers, cosr() or lineto()). send= feeds the whole group to up to three reverbs or delays. See the Buses page." },
  { syntax: "name: synth@busname(degrees, dur=1, ...)", doc: "A player whose whole output goes to a bus instead of straight to the speakers, so the bus's amp/pan control it (and everything else routed there) together. The bus must already exist. send= still works independently." },
  { syntax: "kill name", doc: "Stop a player at the next bar line (or beat, with updates \"beat\"), or remove a reverb, delay, drone or bus immediately. Several names can follow, separated by spaces or commas (kill p1 p2), and * matches any part of a name (kill d*). Anything still sending to a killed reverb or delay, or routed to a killed bus, goes silent until you re-evaluate it." },
  { syntax: "kill d*", doc: "Kill every player, reverb, drone and bus whose name matches. * matches any characters, so kill d* stops d1, d2, d10 ..." },
  { syntax: "tempo 120", doc: "Set the tempo (beats per minute). Everything stays locked because all timing is in beats." },
  { syntax: "bar 4", doc: "Set the number of beats per bar." },
  { syntax: "clear", doc: "Stop every player and silence all instruments, including notes routed to a bus. Reverbs, drones and buses themselves keep running; kill them by name." },
  { syntax: 'scale "minor"', doc: "Default scale for players and drones that do not set scale=. Also takes a custom list: scale [0, 3, 5, 7, 10]. Like a redefined player, the change lands on the next bar line (or beat, with updates \"beat\"), so every player switches together and none changes scale halfway through a bar; the console says where. Notes are handed to Csound up to lookaheadSeconds ahead and cannot be changed after that, so a change evaluated closer than that to the bar line (or after a long pattern step has already sent notes past it) waits for the next bar line after them. Evaluating another scale before then replaces the waiting one." },
  { syntax: "root 2", doc: "Default root (semitones above C) for players and drones that do not set root=. Lands on the next bar line (or beat) exactly like scale." },
  {
    syntax: 'updates "bar" / updates "beat"',
    doc: 'Switches when a new or changed player (and kill, scale and root) takes effect. "bar" (the default) always lands on the next bar line, so a pattern restarts from a musically aligned position. "beat" lands on the next whole beat instead -- usually just a beat or two away rather than up to a full bar, though redefining an already-running player can still land one beat later than that if its old pattern had just played a note on the very beat the new one would take over, to avoid a doubled note -- at the cost of that bar alignment. Useful while sketching, less so once several players need to stay in phase with each other. Classic i score lines always stay bar-quantized, regardless of this setting.',
  },
];

export const PATTERN_SYNTAX = [
  { syntax: "[0, 2, 4]", doc: "A list. Each step takes the next item and wraps around. Every parameter cycles on its own." },
  { syntax: "(0, 2, 4)", doc: "A chord: all notes play on the same step." },
  { syntax: "r", doc: "A rest. Use it inside lists: [0, r, 2, r]." },
  { syntax: "[0, [2, 4]]", doc: "A nested list alternates between its items on every cycle." },
  { syntax: "[0, 2, 4] + 2", doc: "Arithmetic (+ - * / % **) applies to every item. Lists of different lengths cycle." },
  { syntax: "P[0, 2, 4]", doc: "Same as a plain list." },
  { syntax: "1/2", doc: "Fractions are evaluated, handy for dur=1/2." },
  { syntax: "; comment", doc: "Comments start with ; everywhere, in both Csound and player lines." },
];

// Functions usable inside player expressions.
// `rate` says how often a function actually produces a new value -- shown as its own
// column on the Patterns help page, since that's easy to miss just from `doc`, and it's
// what decides whether e.g. random() sounds like one new value per note or a 50-per-second
// flicker (see the Drones page: a drone re-reads its parameters every ~20ms).
export const FUNCTIONS = {
  range: {
    syntax: "range(8)",
    doc: "The list [0 ... 7]. range(2, 6) gives [2, 3, 4, 5].",
    rate: "Once, when the line is evaluated. It builds a fixed list; it does not keep producing new values after that.",
  },
  cosr: {
    syntax: "cosr(center, amplitude, period)",
    doc: "A value that swings like a cosine, locked to the beat clock: center + amplitude * cos(2 * pi * beat / period). The period is in beats. Use it wherever a player accepts a number, e.g. amp=cosr(0.5, 0.3, 8), and combine it with arithmetic. It is read at the start of each step, so it moves in steps, and it cannot be used for reverb settings or for tempo, bar, scale and root.",
    rate: "On a player: once per step. On a drone: continuously, about every 20ms (LIMITS.droneUpdateMs).",
  },
  round: {
    syntax: "round(value)",
    doc: "Rounds to the nearest whole number (halves round up). It works on numbers, lists, chords and on cosr() and random() values, so round(cosr(0, 7, 8)) steps through scale degrees instead of sliding between them. The same goes for oct.",
    rate: "Whatever the value inside it produces -- a plain number never changes, cosr()/random() inside it updates at their own rate.",
  },
  floor: {
    syntax: "floor(value)",
    doc: "Rounds down to a whole number, on the same values as round().",
    rate: "Whatever the value inside it produces -- a plain number never changes, cosr()/random() inside it updates at their own rate.",
  },
  random: {
    syntax: "random(low, high)",
    doc: "A new random number from low up to high every time a step plays. random([0, 2, 4]) picks one item of the list instead. The items can be numbers, chords or r, so random([0, r]) is a coin flip for a rest, and drum lists work too: random([\"o\", \"-\"]). Random durations move notes off the bar grid, so keep dur fixed or use a list of durations that add up.",
    rate: "On a player: once per step. On a drone: a new draw continuously, about every 20ms -- can sound flickery there; wrap it in round()/floor() with a slow cosr() instead if you want it to move more calmly.",
  },
  randint: {
    syntax: "randint(low, high)",
    doc: "Like random(low, high) but gives whole numbers, both ends included: randint(0, 7). Use it for scale degrees, since a fractional degree gives an in-between pitch.",
    rate: "Same as random(): once per step on a player, continuously (about every 20ms) on a drone.",
  },
  lineto: {
    syntax: "lineto(from, to, seconds) or lineto(to, seconds)",
    doc: "A linear ramp in real seconds (converted to beats using the tempo when it starts, so it stays accurate as long as the tempo doesn't change mid-ramp); once it reaches the target it just holds there. lineto(from, to, seconds) always starts at from. lineto(to, seconds) starts from wherever the same parameter is playing right now, so re-evaluating amp=lineto(0, 3) fades a running drone, bus or delay out smoothly from whatever it is currently at, and amp=lineto(0, 1, 4) fades one in from silence. Only works on a drone's own parameters (degree, oct, amp, pan, send amounts, a synth's own live parameters) a bus's (amp, pan, send amounts) or a delay's (all of them, send amounts included), used directly -- not on a player, a reverb, tempo/bar/scale/root, and it cannot be combined with arithmetic (+, *, ...).",
    rate: "Continuously, about every 20ms, on drones, buses and delays only -- there is no per-step form, since it only makes sense on something re-read continuously like that.",
  },
};

export const DRUM_SYNTAX = [
  { syntax: '"x-o-"', doc: "Every character except a space is one step. The step length is dur (default 1 beat). Unknown characters are reported as errors." },
  { syntax: '"x...o..."', doc: "A dot is a rest: one step of silence." },
  { syntax: '"x . . .  o . . ."', doc: "Spaces are ignored, use them to make patterns easier to read. This plays exactly like the pattern above." },
  { syntax: '"(xo)"', doc: "Characters in parentheses play together." },
  { syntax: '"x-[--]o"', doc: "Brackets split one step into equal parts, so [--] is two quick hats. They can be nested: [-[--]]." },
];

// "pluck: p13 decay, ..." for every synth that has parameters; generated so it cannot go stale.
const synthFields = Object.entries(SYNTHS)
  .filter(([, s]) => s.params)
  .map(([name, s]) => `${name}: ${Object.entries(s.params).map(([key, p], i) => `p${13 + i} ${key}${p.unit === "beats" ? " in seconds" : ""}`).join(", ")}`)
  .join("; ");

// Fields of the events built-in synths receive, and what your own instruments should follow.
export const CONTRACT = [
  { field: "p3", doc: "Duration in seconds (sus converted from beats)." },
  { field: "p4", doc: "Amplitude." },
  { field: "p5", doc: "Frequency in Hz (0 for drums)." },
  { field: "p6", doc: "Pan from 0 (left) to 1 (right), for pan2." },
  { field: "p7 - p12", doc: "Sends to reverbs and delays, as (slot, amount) pairs. Pass them to revsend to make an instrument work with send=." },
  { field: "p13 and up", doc: `Extra parameters of a built-in synth, in the order listed for it on the Synths page (${synthFields}). Your own instruments do not receive any.` },
];

// Prose for the help page. Paragraphs support `code` spans.
export const GUIDE = {
  start: {
    title: "Getting started",
    paragraphs: [
      "Press Start, then evaluate the example in the main tab with `Ctrl+Enter`. Text is evaluated in blocks separated by blank lines, so you can change one player without touching the rest.",
      "A file can mix three things: player lines (`d1: play(\"x-o-\")`), plain Csound orchestra code (`instr ... endin`) and classic Csound score lines (`i 1 0 1 220`). Instruments defined in one tab can be used from any other tab.",
      "Everything you evaluate is reported in the console on the right, in blue: for example `> d1: play starts at bar 5`. Kills and errors show in red.",
      "Save keeps the whole scene -- all tabs and the tempo and bar -- in a `.clive` file (`Ctrl+S`), and Load (`Ctrl+O`) brings it back in place of the current tabs. The page title shows the scene's name, with a `*` while it has unsaved changes. Loading does not start anything: evaluate the code when you want to hear it.",
    ],
    example: 'tempo 110\nd1: play("x---o---", dur=1/2)\nb1: bass([0, 0, 3, 5], dur=[1, 1/2, 1/2, 1], oct=3)',
  },
  keys: {
    title: "Keyboard shortcuts",
    paragraphs: ["These work while the cursor is in the editor."],
  },
  timing: {
    title: "Timing",
    paragraphs: [
      "All rhythm is locked to one master clock that runs inside Csound. Durations are in beats, so a tempo change moves everything together.",
      "Whatever you evaluate starts on the next bar line: new or changed players, `kill`, `scale` and `root` changes, and classic `i` score lines. A player that was already running keeps playing until then, and its steps are aligned to the bar. A scale or root change reaches every player on the same bar line, so nothing switches halfway through a bar.",
      "`tempo` and `bar` apply at once: all timing is in beats, so a tempo change moves everything together. Reverbs, drones and buses also change at once, since they are not on the grid.",
      "Tip: keep the durations of a pattern adding up to a whole bar (or a divisor of it) so the pattern loops in time with the bar.",
      "`updates \"beat\"` switches players (and kill, scale and root) to land on the next beat instead of the next bar line, for a much faster response at the cost of that bar alignment. Score `i` lines are unaffected either way. See the Command reference.",
    ],
  },
  players: {
    title: "Players",
    paragraphs: [
      "A player is a named voice that repeats a pattern: `name: synth(pattern, parameters)`. The first argument is the pattern; everything else is a named parameter. Unknown parameters are reported as errors.",
      "To see what a pattern or a `cosr()` really does, use `l1: log(cosr(5, 3, 4), dur=1/2)`: it prints the value on every step (in green, as `l1: 8`) instead of playing a note.",
      "Re-evaluating a line replaces the player on the next bar (or the next beat, with `updates \"beat\"`; see the Timing page). Names are free, but a name that ends in a number (d1, d2, p1) works well with wildcards such as `kill d*`.",
    ],
    example: 'p1: pluck([0, 2, 4, 7], dur=1/2, amp=0.7, scale="minor", pan=[-0.5, 0.5])',
  },
  drones: {
    title: "Drones",
    paragraphs: [
      "A drone is one continuous voice instead of a repeating pattern: leave out dur and give a single degree (or nothing, for degree 0) instead of a list. It starts as soon as you evaluate it, ignores the bar grid, and keeps running until you kill it. (A `scale` or `root` command is the exception: a drone that follows the default picks the change up on the same bar line as the players.) Only synths marked \"drone\" on the Synths page can be used this way; the rest are built around decaying to silence, which does not make sense held forever.",
      "amp, pan, send and most of a synth's own parameters keep updating live while a drone runs, both when you re-evaluate the line with new plain numbers and continuously if you use `cosr()`/`random()` there: those are re-read every few milliseconds instead of once, so `g1: gendy(0, spread=cosr(0.4, 0.3, 8))` actually breathes in and out while it plays, not just once per note. Parameters that shape an envelope over time (fmpad's attack and release, for example) are the exception: Csound needs those fixed when the drone starts, so re-evaluating the line alone will not change them, only `kill` and redefining it will.",
      "`lineto()` fades a drone in or out: `g1: gendy(0, amp=lineto(0, 1, 4))` fades in from silence over 4 seconds, and later re-evaluating `g1: gendy(0, amp=lineto(0, 3))` fades it back out over 3 seconds from whatever it is playing at right now, not from the start of the previous ramp. A bus's amp, pan and send amounts, and every parameter of a delay, can be faded the same way -- see the Buses and Delay pages. It is not accepted anywhere else (a player, a reverb, tempo/bar/scale/root, or combined with arithmetic).",
      "`kill` stops a drone immediately, not at the next bar line, since it was never on the grid to begin with -- for a smooth stop instead of a hard cut, fade out with `lineto()` first and `kill` once it reaches 0.",
    ],
    example: 'rev1: reverb(decay=0.9)\ng1: gendy(0, oct=3, amp=lineto(0, 0.35, 4), spread=cosr(0.3, 0.25, 16), points=cosr(20, 15, 8))\nf1: fmpad(-2, oct=4, amp=0.3, send=rev1(0.4))\nkill g1',
  },
  synths: {
    title: "Synths",
    paragraphs: [
      "Built-in synths and the Csound instruments you define can both be used after the colon. An instrument called `Lead` is used as `Lead(...)`, and a numbered instrument such as `instr 10` as `i10(...)`.",
      "Some built-in synths have extra parameters of their own, listed below. They are written like any other parameter (`pluck([0, 2], bright=0.3)`), can use `cosr()` and `random()`, and unknown ones are reported as errors.",
      "`cloud` can also take its grains from your own sound files. Put WAV, MP3, OGG or FLAC files in the `samples` folder next to the app and name one with `src=\"choir.wav\"`. The file loads the first time it is used (the console says when it is ready, and the cloud stays silent until then) and stays loaded until the page is reloaded; re-evaluating a line that failed to load tries again. Hold `position` still to freeze one moment of the file, or move it with `lineto()` on a drone to stretch the file out without changing its pitch.",
    ],
    example: 'rev1: reverb(decay=0.9)\nc1: cloud([(0, 2, 4), (-1, 1, 4)], dur=4, oct=4, density=30, size=120, wave=cosr(1, 1, 16), send=rev1(0.4))\ng1: cloud(0, oct=4, src="choir.wav", position=lineto(0, 1, 60), size=150, density=40, spray=0.4)',
  },
  drums: {
    title: "Drums",
    paragraphs: [
      "`play()` takes a string instead of a list of degrees. Each character is a drum voice or a `.` rest, and spaces are ignored so you can group steps visually.",
      '`kit="808"` switches to a synthesized 808-style kit with more voices: cowbell, toms, rimshot, claves, maracas and a cymbal besides the kick, snare, clap and hats. `decay`, `tune` and `tone` shape every kit: `decay` stretches or shortens every hit, `tune` shifts the pitch in semitones, and `tone` is each sound\'s own main knob (the kick\'s click, the snare\'s snappy noise, the hats\' brightness). Like any parameter they can be lists or `cosr()`, so `d2: play("-", dur=1/4, kit="808", decay=cosr(1.5, 1, 8))` opens and closes the hats over two bars.',
    ],
    example: 'd1: play("x...o...", dur=1/2)\nd2: play("- [--] - [-=]", dur=1/2, amp=0.5)\n\nb1: play("x..x ..x. x... ..x.", dur=1/4, kit="808", decay=2)\nb2: play(".... o... .... o..*", dur=1/4, kit="808", tone=0.7)\nb3: play("c.c. .c.c l.m.h...", dur=1/4, kit="808", amp=0.6)',
  },
  patterns: {
    title: "Patterns",
    paragraphs: [
      "Pattern arguments are small expressions. Numbers are scale degrees, not semitones.",
      "`cosr()` makes a value that changes with the beat, so a parameter can breathe over several bars while staying in time with everything else. `random()` and `randint()` draw a new value every time a step plays.",
    ],
    example: 'p2: pluck(range(8) * 2, dur=1/4, oct=6, amp=cosr(0.4, 0.3, 8))\np3: pluck([0, randint(1, 7), random([2, 4, r])], dur=1/2)\nc1: pad([(0, 2, 4), (-2, 1, 3)], dur=4, sus=4)',
  },
  scales: {
    title: "Scales",
    paragraphs: ["Set a scale per player with `scale=\"dorian\"` or for everyone with the `scale` command. Degrees wrap around the scale into the next octave. A scale wraps after as many degrees as it has notes: the five-note scales (pentatonic, minorPentatonic and the Japanese scales) after five, so degree 5 is already the next octave, and blues after six."],
  },
  reverb: {
    title: "Reverb send and return",
    paragraphs: [
      "A reverb is a shared return bus. Players send part of their signal to it, and the reverb itself is a running instrument with its own parameters.",
      "Define it with `rev1: reverb(...)`, then send to it from any player with `send=rev1(amount)`. Re-evaluating the reverb line changes its parameters live. A player can send to up to three reverbs or delays (see the Delay page), and the amount can be a list.",
      "After `kill rev1` the sends to it fall silent, and they stay silent: a reverb defined later never picks them up, even if it reuses the same slot. Re-evaluate the players that sent to it (pointing at another reverb) to hear their reverb again.",
    ],
    example: 'rev1: reverb(decay=0.9, lowcut=200, highcut=6000, level=0.5)\nrev2: reverb(decay=0.5, lowcut=400, highcut=9000, level=0.3)\np1: pluck([0, 2, 4], dur=1/2, send=[rev1(0.4), rev2(0.1)])',
  },
  delay: {
    title: "Delay",
    paragraphs: [
      "A delay is a send effect like a reverb: define it with `echo1: delay(...)` and send to it with `send=echo1(amount)` from players, drones and buses. It outputs only the repeats, never the dry sound. Reverbs and delays share the send slots (see sendSlots on the Limits page), and a player can send to up to three of them in any mix: `send=[echo1(0.3), rev1(0.2)]`.",
      "The time is in beats and follows the tempo, and every parameter updates live while it runs, like a bus's: re-evaluate the line, or use `cosr()` and `lineto()`. `feedback=lineto(0.95, 4)` swells the repeats into a long trail over four seconds; bring it back down the same way. A redefinition resets whatever it leaves out, so keep the other parameters on the line.",
      "A delay can send its repeats on to reverbs with its own `send=`, after its level: `echo1: delay(time=3/4, send=rev1(0.4))` puts every echo in the hall. It cannot send to a delay, itself included.",
      "`kill echo1` fades its repeats out in a tenth of a second. As with a reverb, whatever still sent to it falls silent until re-evaluated.",
    ],
    example: 'rev1: reverb(decay=0.9)\necho1: delay(time=3/4, feedback=0.55, pingpong=1, highcut=3500, wobble=0.3, send=rev1(0.3))\np1: pluck([0, 2, 4, 7], dur=1/2, send=echo1(0.35))\n; a slow dub swell, then back\necho1: delay(time=3/4, feedback=lineto(0.97, 4), pingpong=1, highcut=3500, wobble=0.3, drive=0.6, send=rev1(0.3))\necho1: delay(time=3/4, feedback=lineto(0.5, 2), pingpong=1, highcut=3500, wobble=0.3, send=rev1(0.3))',
  },
  buses: {
    title: "Buses",
    paragraphs: [
      "A bus is a mixing group, not a send: define one with `mix1: bus(amp=1, pan=0)`, then a player's whole output (not a copy of it) goes to a bus by writing the bus name after an @ right after the synth, e.g. `p1: pluck@mix1([0, 2, 4], dur=1/2)`. p1 no longer plays on its own; the bus's amp/pan control it and everything else routed there, together, as one group. Every built-in synth and every drum voice (play()) can be routed this way when it plays as a player (with dur=); a named or numbered instrument from your own Csound code cannot, and neither can a drone, a reverb or another bus -- writing @ on one of those is reported as an error.",
      "amp and pan update live while the bus runs, the same as a drone's do: re-evaluate the line with new plain numbers, or use `cosr()`/`lineto()` there and they keep refreshing on their own, about every 20ms.",
      "A bus can feed reverbs and delays too: `mix1: bus(send=rev1(0.4))`, or up to three with `send=[rev1(0.4), rev2(0.1)]`, sends the group's combined signal after its amp and pan (post-fader), so turning the bus down turns its reverb down with it. The amount updates live like amp and pan, and pointing the bus at a different reverb or delay takes effect straight away, without restarting it.",
      "`send=` on a bussed player still works exactly as before and is independent of the bus: the note computes its own reverb send from its own dry signal before that signal is handed to the bus. The two add up, so a player with its own `send=rev1(0.3)` on a bus with `send=rev1(0.4)` reaches rev1 twice; usually you want one or the other.",
      "`kill mix1` stops the bus immediately. Players still routed to it do not error, they just go silent (the same as sending to a killed reverb) -- re-evaluate them, without @mix1 or with a different bus, to hear them again.",
    ],
    example: 'rev1: reverb(decay=0.9)\nmix1: bus(amp=0.8, pan=0, send=rev1(0.3))\np1: pluck@mix1([0, 2, 4, 7], dur=1/2)\np2: pluck@mix1([2, 4, 6, 9], dur=1/2, oct=6, amp=0.6)\n; wash the whole group in reverb, then dry it again (a redefinition resets\n; whatever it leaves out, so keep amp and send on every line)\nmix1: bus(amp=0.8, send=rev1(lineto(0.8, 4)))\nmix1: bus(amp=0.8, send=rev1(lineto(0.3, 2)))\n; fade the whole group out together, then back in\nmix1: bus(amp=lineto(0, 3), send=rev1(0.3))\nmix1: bus(amp=lineto(0, 0.8, 2), send=rev1(0.3))',
  },
  csound: {
    title: "Your own Csound instruments",
    paragraphs: [
      "Instruments are plain Csound. Named instruments (`instr Lead`) get a number automatically. Follow the field contract below so players can drive them, and call `revsend` after `outs` if you want them to accept `send=`.",
      "Instrument numbers 9600 and above are reserved: a built-in synth or drum routed to a bus (name@busname) runs at its own instrument number + 9500, each dronable synth's continuous voice lives at its own instrument number + 9800 (e.g. saw, instr 103, becomes 9903 as a drone), the bus, delay and reverb returns run at 9975, 9977 and 9980 and up, and 9985-9999 belong to send-bus clearing and the clock. Keep your own numbers below 9600. Function tables from 5000 up hold sample files loaded with src=, so number your own tables below that.",
      "Classic score lines work as well. They start on the next bar line: the start time is in beats after it and the duration is in beats.",
      "Score lines call instruments by number. A named instrument is given a number when it is compiled and keeps no name inside Csound, so `i \"Lead\"` cannot reach it: give an instrument a number (`instr 10`) if you want to play it from score lines too. Players can use either kind.",
    ],
    example: 'instr Lead\n  kenv madsr 0.01, 0.1, 0.6, 0.2\n  asig vco2 p4 * kenv, p5\n  aL, aR pan2 asig, p6\n  outs aL, aR\n  revsend aL, aR, p7, p8, p9, p10, p11, p12\nendin\n\nrev1: reverb(decay=0.9)\nl1: Lead([0, 2, 4], dur=1, send=rev1(0.5))\n\ninstr 10\n  aenv expon 1, p3, 0.001\n  asig oscili p4 * aenv, p5\n  outs asig, asig\nendin\n\n; p2 = 0 beats after the next bar line, p3 = 1 beat, p4 = amp, p5 = Hz\ni 10 0 1 0.2 440',
  },
  commands: { title: "Command reference", paragraphs: [] },
  limits: { title: "Limits", paragraphs: [] },
};

// A dronable synth's own parameters usable on a drone, in order (matches the
// channel layout the engine generates for it). A param whose unit is "beats"
// shapes an envelope over time, so Csound can only read it once when the drone
// starts; changing it takes effect the next time the drone is killed and redefined,
// not on a plain redefinition. droneExtras overrides this list for synths whose
// drone behaves differently from its player (fmbass drops "punch").
export function droneParamKeys(s) {
  return s.droneExtras ?? Object.keys(s.params ?? {});
}

// Wraps an instrument body the way the engine compiles it.
export function csoundSource(label, instr, body) {
  return `instr ${instr} ; ${label}\n${body.replace(/^\n/, "").replace(/\s+$/, "")}\nendin`;
}
