// Master clock and beat-locked launcher. All times are in beats, so tempo
// changes keep every rhythmic element locked to the same grid.
import { LIMITS, COMMAND_WORDS, SYNTHS, DRUMS, REVERB_PARAMS, BUS_PARAMS, csoundSource, droneParamKeys } from "./registry.js";

const REVERB_SLOTS = LIMITS.reverbSlots;
const REVERB_PARAM_NAMES = Object.keys(REVERB_PARAMS);
const DRONE_SLOTS = LIMITS.droneSlots;
const BUS_SLOTS = LIMITS.busSlots;
const BUS_PARAM_NAMES = Object.keys(BUS_PARAMS);
// Drones with the most extra parameters (fmpad) need 5 generic channels; every
// dronable synth just uses as many of them as it has.
const MAX_DRONE_EXTRAS = 5;
// Synths that can run as a drone (a single, continuously running instance).
export const DRONABLE_SYNTHS = Object.fromEntries(Object.entries(SYNTHS).filter(([, s]) => s.drone));

const BUILTIN_SOURCE = [
  ...Object.values(SYNTHS).map((s) => s.udo ?? ""),
  ...Object.values(SYNTHS).map((s) => s.droneUdo ?? ""),
  ...Object.entries(SYNTHS).map(([name, s]) => csoundSource(name, s.instr, s.body)),
  ...Object.values(DRUMS).map((d) => csoundSource(d.name, d.instr, d.body)),
].join("\n\n");
const REVERB_CHANNELS = Array.from({ length: REVERB_SLOTS }, (_, slot) =>
  REVERB_PARAM_NAMES.map((p) => `chn_k "rev${slot}_${p}", 1`).join("\n"),
).join("\n");
const reverbInstance = (slot) => (9980 + (slot + 1) / 100).toFixed(2);

// A bus's own amp/pan channels plus its three reverb send pairs, one set per slot.
const BUS_SEND_NAMES = ["s1slot", "s1amt", "s2slot", "s2amt", "s3slot", "s3amt"];
const BUS_CHANNELS = Array.from({ length: BUS_SLOTS }, (_, slot) =>
  [...BUS_PARAM_NAMES, ...BUS_SEND_NAMES].map((p) => `chn_k "bus${slot}_${p}", 1`).join("\n"),
).join("\n");
const busReturnInstance = (slot) => (9975 + (slot + 1) / 100).toFixed(2);
// Instrument number for a built-in synth or drum's bus-routed variant, derived from
// its note instrument (mirrors droneInstance below, in its own reserved range).
const busVariantInstance = (instr) => instr + 9500;

// The bus-routed variant of a synth/drum's body: identical DSP, but its final
// "outs aL, aR" is replaced with a write into this note's target bus (an extra
// p-field appended right after the synth's own extras) instead of the speakers.
// send= still works unchanged -- it is computed on the same aL/aR just before this.
function busVariantInstrSource(name, instr, body, busSlotField) {
  const busBody = body.replace(
    "outs aL, aR",
    `ibusslot = p${busSlotField}\n  zawm aL, 2 * (${REVERB_SLOTS} + ibusslot), 1\n  zawm aR, 2 * (${REVERB_SLOTS} + ibusslot) + 1, 1`,
  );
  return csoundSource(`${name} (bus)`, busVariantInstance(instr), busBody);
}
const BUS_VARIANT_SOURCE = [
  ...Object.entries(SYNTHS).map(([name, s]) => busVariantInstrSource(name, s.instr, s.body, 13 + Object.keys(s.params ?? {}).length)),
  ...Object.values(DRUMS).map((d) => busVariantInstrSource(d.name, d.instr, d.body, 13)),
].join("\n\n");

// A drone's own params (amp/freq/pan/sends/its synth's extras), one channel set per slot.
const DRONE_CHANNEL_NAMES = [
  "amp", "freq", "pan",
  "s1slot", "s1amt", "s2slot", "s2amt", "s3slot", "s3amt",
  ...Array.from({ length: MAX_DRONE_EXTRAS }, (_, i) => `x${i + 1}`),
];
const DRONE_CHANNELS = Array.from({ length: DRONE_SLOTS }, (_, slot) =>
  DRONE_CHANNEL_NAMES.map((n) => `chn_k "drone${slot}_${n}", 1`).join("\n"),
).join("\n");
// instrument number for a dronable synth's continuous voice, derived from its note instrument.
const droneInstance = (instr) => instr + 9800;

// A dronable synth's own extra parameters for drone mode: which registry params, in
// order, and whether each stays live (k-rate) or is fixed once at the drone's start
// (envelope-shape params measured in beats, since Csound needs those set at init).
function droneExtras(s) {
  return droneParamKeys(s).map((key) => ({ key, live: s.params[key].unit !== "beats" }));
}

// The Csound source of one dronable synth's continuous-voice instrument: reads its
// params from this slot's channels (written from JS) instead of fixed p-fields.
function droneInstrSource(name, s) {
  const call = (s.droneUdo ?? s.udo).match(/^opcode\s+(\w+)/m)[1];
  const extras = droneExtras(s);
  const reads = extras.map(({ key, live }, i) => {
    const ch = `x${i + 1}`;
    const lines = [`  S${ch} sprintf "drone%d_${ch}", islot`, `  k${ch} chnget S${ch}`];
    if (!live) lines.push(`  i${ch} = i(k${ch})`);
    return lines.join("\n");
  });
  const args = extras.map(({ live }, i) => (live ? `kx${i + 1}` : `ix${i + 1}`));
  const body = `
  islot = p4
  Samp sprintf "drone%d_amp", islot
  Sfreq sprintf "drone%d_freq", islot
  Span sprintf "drone%d_pan", islot
  kamp chnget Samp
  kfreq chnget Sfreq
  kpan chnget Span
${reads.join("\n")}
  aL, aR ${call} kamp, kfreq, kpan${args.length ? ", " + args.join(", ") : ""}
  outs aL, aR
  ; Send slots are read at k-rate too, so re-pointing send= at another reverb takes
  ; effect on the running drone, not only the next time it starts.
  Ss1 sprintf "drone%d_s1slot", islot
  Sa1 sprintf "drone%d_s1amt", islot
  Ss2 sprintf "drone%d_s2slot", islot
  Sa2 sprintf "drone%d_s2amt", islot
  Ss3 sprintf "drone%d_s3slot", islot
  Sa3 sprintf "drone%d_s3amt", islot
  revsendk1 aL, aR, chnget:k(Ss1), chnget:k(Sa1)
  revsendk1 aL, aR, chnget:k(Ss2), chnget:k(Sa2)
  revsendk1 aL, aR, chnget:k(Ss3), chnget:k(Sa3)`;
  return csoundSource(`${name} (drone)`, droneInstance(s.instr), body);
}
const DRONE_INSTR_SOURCE = Object.entries(DRONABLE_SYNTHS)
  .map(([name, s]) => droneInstrSource(name, s))
  .join("\n\n");

const HEADER = `
ksmps = 32
nchnls = 2
0dbfs = 1

; Send buses: zak a-channels 2*slot (left) and 2*slot+1 (right), one slot per reverb,
; followed by 2 more per mixing bus slot (offset by the reverb slots).
zakinit ${(REVERB_SLOTS + BUS_SLOTS) * 2}, 1
${REVERB_CHANNELS}

; Bus parameter channels (amp/pan and send pairs), written from JS and read live by each bus return.
${BUS_CHANNELS}

; Drone parameter channels, written from JS and read continuously by drone instruments.
${DRONE_CHANNELS}

gkbeat init 0
gkbpm init 120
gkbar init 4
chn_k "bpm", 1
chn_k "bar", 1
chn_k "beat", 2
chnset 120, "bpm"
chnset 4, "bar"

instr 9990
  gkbpm chnget "bpm"
  gkbar chnget "bar"
  gkbpm = max(gkbpm, 1)
  gkbar = max(gkbar, 1)
  gkbeat += gkbpm / (60 * kr)
  chnset gkbeat, "beat"
endin

; p4 = absolute target beat (negative: next bar line + p2 beats)
; p5 = number of fields, p6... = event fields (p1 p2 p3 ...); p3 is in beats
instr 9991
  itarget0 = p4
  inum = p5
  ip[] init inum
  indx = 0
  while indx < inum do
    ip[indx] = p(indx + 6)
    indx += 1
  od
  ibeat = i(gkbeat)
  ibar = i(gkbar)
  itarget = (itarget0 >= 0 ? itarget0 : (floor(ibeat / ibar) + 1) * ibar + ip[1])
  kdt = ksmps / sr
  kremain = (itarget - gkbeat) * 60 / gkbpm
  if kremain < 2 * kdt then
    kdelay = max(kremain, 0)
    kdur = (ip[2] > 0 ? ip[2] * 60 / gkbpm : ip[2])
    Sline sprintfk "i %.9f %.9f %.9f", ip[0], kdelay, kdur
    kndx = 3
    while kndx < inum do
      Sfld sprintfk " %.9f", ip[kndx]
      Sline strcatk Sline, Sfld
      kndx += 1
    od
    scoreline Sline, 1
    turnoff
  endif
endin

instr 9999
  turnoff2 p4, 0, 1
  turnoff
endin
`;

// Sends, reverb returns and the built-in instruments from the registry.
const SYNTH_SOURCE = `
; revsend aL, aR, p7, p8, p9, p10, p11, p12 mixes a note's signal into up to three
; reverb buses. Call it after outs in your own instruments. Pairs are (slot, amount).
opcode revsend1, 0, aaik
  aInL, aInR, iSlot, kAmt xin
  if iSlot >= 0 && kAmt > 0 then
    zawm aInL * kAmt, 2 * iSlot, 1
    zawm aInR * kAmt, 2 * iSlot + 1, 1
  endif
endop

; Amounts are k-rate (not just i-rate) so a drone can keep them live; players pass
; fixed p-field values, which upconvert to k-rate the same way.
opcode revsend, 0, aaikikik
  aInL, aInR, iS1, kA1, iS2, kA2, iS3, kA3 xin
  revsend1 aInL, aInR, iS1, kA1
  revsend1 aInL, aInR, iS2, kA2
  revsend1 aInL, aInR, iS3, kA3
endop

; Like revsend1, but the reverb slot is k-rate too, so a running drone or bus return
; can be pointed at a different reverb without restarting it.
opcode revsendk1, 0, aakk
  aInL, aInR, kSlot, kAmt xin
  if kSlot >= 0 && kAmt > 0 then
    zawm aInL * kAmt, 2 * kSlot, 1
    zawm aInR * kAmt, 2 * kSlot + 1, 1
  endif
endop

; Bus return: p4 = slot. Sums whatever was routed here -- already-panned stereo
; signals, so this only trims their overall level and left/right balance, it does not
; re-pan a mono source. Must run after every source that writes into it (a high
; instrument number, like the reverb return) and before the send-bus clear. Its own
; send= goes to the reverbs after amp/pan (post-fader); it still runs before the
; reverb returns (9980+), so they hear it in the same cycle.
instr 9975
  islot = p4
  Samp sprintf "bus%d_amp", islot
  Span sprintf "bus%d_pan", islot
  kamp chnget Samp
  kpan chnget Span
  aInL zar 2 * (${REVERB_SLOTS} + islot)
  aInR zar 2 * (${REVERB_SLOTS} + islot) + 1
  kpanL = (kpan <= 0 ? 1 : 1 - kpan)
  kpanR = (kpan >= 0 ? 1 : 1 + kpan)
  aOutL = aInL * kamp * kpanL
  aOutR = aInR * kamp * kpanR
  outs aOutL, aOutR
  Ss1 sprintf "bus%d_s1slot", islot
  Sa1 sprintf "bus%d_s1amt", islot
  Ss2 sprintf "bus%d_s2slot", islot
  Sa2 sprintf "bus%d_s2amt", islot
  Ss3 sprintf "bus%d_s3slot", islot
  Sa3 sprintf "bus%d_s3amt", islot
  revsendk1 aOutL, aOutR, chnget:k(Ss1), chnget:k(Sa1)
  revsendk1 aOutL, aOutR, chnget:k(Ss2), chnget:k(Sa2)
  revsendk1 aOutL, aOutR, chnget:k(Ss3), chnget:k(Sa3)
endin

; Reverb return: p4 = slot. Parameters come from the rev<slot>_* channels.
; It must run after every source, so it gets a very high instrument number.
instr 9980
  islot = p4
  Sdecay sprintf "rev%d_decay", islot
  Slow sprintf "rev%d_lowcut", islot
  Shigh sprintf "rev%d_highcut", islot
  Slevel sprintf "rev%d_level", islot
  kdecay chnget Sdecay
  klow chnget Slow
  khigh chnget Shigh
  klevel chnget Slevel
  aInL zar 2 * islot
  aInR zar 2 * islot + 1
  aInL buthp aInL, max(klow, 20)
  aInR buthp aInR, max(klow, 20)
  aOutL, aOutR reverbsc aInL, aInR, min(kdecay, 0.99), max(khigh, 200)
  outs aOutL * klevel, aOutR * klevel
endin

; Clears all send buses (reverb and mixing bus) after the returns have read them.
instr 9985
  zacl 0, ${(REVERB_SLOTS + BUS_SLOTS) * 2 - 1}
endin

${BUILTIN_SOURCE}

${BUS_VARIANT_SOURCE}

${DRONE_INSTR_SOURCE}
`;

// Bus-routed variants are note-triggered like the plain ones, so silence() (which stops
// every player) needs to know about them too; the bus return instrument itself is not
// included here, since it keeps running like a reverb's -- kill it by name instead.
const BASE_INSTRS = [...Object.values(SYNTHS), ...Object.values(DRUMS)].map((x) => x.instr);
const BUILTIN_INSTRS = [...BASE_INSTRS.map(String), ...BASE_INSTRS.map((instr) => String(busVariantInstance(instr)))];
export const FOX_START = [
  // name: synth(...) or name: synth@busname(...) — a definition. Requires a call on
  // the same line so a bare Csound label ("loop:") is never mistaken for a player
  // statement.
  /^\s*[A-Za-z_]\w*\s*:\s*[A-Za-z_]\w*\s*(@\s*[A-Za-z_]\w*\s*)?\(/,
  // A reserved command word at the start of the line: kill d1, tempo 108, clear, ...
  new RegExp(`^\\s*(${COMMAND_WORDS.join("|")})\\b`),
];
export const SCORE_LINE = /^\s*[ifeatqrsmnvxy](\s|$)/;

export function bracketDelta(line) {
  let d = 0;
  let quote = null;
  for (const c of line) {
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === ";") break;
    else if ("([{".includes(c)) d++;
    else if (")]}".includes(c)) d--;
  }
  return d;
}

// Whether a /* ... */ comment is still open at the end of `line`, given whether one was
// open at its start. Quotes and ; line comments hide a /* the same way Csound reads them.
function blockCommentOpenAfter(line, open) {
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (open) {
      if (c === "*" && line[i + 1] === "/") {
        open = false;
        i++;
      }
    } else if (quote) {
      if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === ";") break;
    else if (c === "/" && line[i + 1] === "*") {
      open = true;
      i++;
    }
  }
  return open;
}

// Classifies every line as player code ("fox"), classic score ("score") or Csound
// orchestra ("orc"). A player statement can span several lines; `statement` is the
// index of the line where the statement containing this line starts (-1 otherwise).
// A line that starts inside a /* */ comment is always "orc" (Csound skips it), so
// commented-out player code or score lines are never run.
export function classifyLines(lines) {
  let depth = 0;
  let foxDepth = 0;
  let statement = -1;
  let inComment = false;
  return lines.map((line, i) => {
    const t = line.trim();
    const commented = inComment;
    inComment = blockCommentOpenAfter(line, inComment);
    if (commented) return { kind: "orc", statement: -1 };
    if (foxDepth > 0) {
      foxDepth += bracketDelta(line);
      return { kind: "fox", statement };
    }
    if (depth === 0 && FOX_START.some((re) => re.test(line))) {
      foxDepth = Math.max(0, bracketDelta(line));
      statement = i;
      return { kind: "fox", statement };
    }
    if (/^(instr|opcode)\b/.test(t)) depth++;
    const kind = depth === 0 && SCORE_LINE.test(line) ? "score" : "orc";
    if (/^(endin|endop)\b/.test(t)) depth = Math.max(0, depth - 1);
    return { kind, statement: -1 };
  });
}

// Splits a block into Csound orchestra, score lines and FoxDot-style player code.
// Normalizes CRLF/CR first: a trailing \r left on a line survives split("\n") (it is
// not whitespace to a "." in a regex), which silently broke the comment-only-line check
// below and the instrument-aliasing regex in evaluate() for any file saved with Windows
// line endings -- e.g. a whole block would wrongly report a compile error and never
// reach fox.run() for the player definitions in the same block.
export function splitCode(code) {
  const lines = code.replace(/\r\n?/g, "\n").split("\n");
  const orc = [];
  const score = [];
  const fox = [];
  classifyLines(lines).forEach(({ kind }, i) => {
    const line = lines[i];
    if (kind === "fox") {
      fox.push(line);
      orc.push("");
    } else if (kind === "score") {
      const t = line.trim();
      if (t && !t.startsWith(";")) score.push(t);
    } else {
      orc.push(line);
    }
  });
  return { orc: orc.join("\n"), score, fox: fox.join("\n") };
}

// Rewrites "i" events with a positive numeric p1 into bar-quantized launcher
// events; anything else (f, e, turnoffs, strings) is sent as is.
export function quantize(line) {
  const f = line.trim().split(/\s+/);
  const numeric = f.slice(1).every((x) => x !== "" && !Number.isNaN(Number(x)));
  if (f[0] !== "i" || f.length < 4 || !numeric || Number(f[1]) <= 0) return line;
  return `i 9991 0 3600 -1 ${f.length - 1} ${f.slice(1).join(" ")}`;
}

export function createEngine(Csound, { onMessage }) {
  let csound = null;
  let running = false;
  let bpm = 120;
  let bar = 4;
  let clock = null;
  let pollTimer = null;
  let polling = false;
  const instrs = new Set(BUILTIN_INSTRS);
  const reverbsRunning = new Set();
  const dronesRunning = new Map();
  const busesRunning = new Set();
  const aliases = new Map();
  // Last value written to each control channel this session. Drones and buses are
  // refreshed every tick (LIMITS.droneUpdateMs), but most of their values sit still, and
  // every write is a message to the audio thread -- so only changes are sent.
  const channelCache = new Map();

  function setChannel(name, value) {
    if (channelCache.get(name) === value) return;
    channelCache.set(name, value);
    return csound.setControlChannel(name, value);
  }

  // Writes up to three [slot, amount] send pairs into prefix + s1slot/s1amt ... s3amt;
  // unused pairs get slot -1 so the Csound side skips them.
  function sendWrites(prefix, sends) {
    return [0, 1, 2].flatMap((i) => {
      const [s, a] = sends[i] ?? [-1, 0];
      return [setChannel(`${prefix}s${i + 1}slot`, s), setChannel(`${prefix}s${i + 1}amt`, a)];
    });
  }

  const aliasFor = (name) => {
    if (!aliases.has(name)) aliases.set(name, 300 + aliases.size);
    return aliases.get(name);
  };

  async function poll() {
    if (polling || !running) return;
    polling = true;
    const t0 = performance.now();
    try {
      const beat = await csound.getControlChannel("beat");
      const t1 = performance.now();
      if (running && typeof beat === "number") clock = { beat, t: (t0 + t1) / 2 };
    } catch {
      // Csound was torn down while the request was in flight.
    } finally {
      polling = false;
    }
  }

  return {
    get running() {
      return running;
    },

    async start() {
      csound = await Csound();
      if (!csound) throw new Error("Csound failed to start (WebAudio/WASM not supported).");
      try {
        csound.on("message", onMessage);
        await csound.setOption("-odac");
        await csound.setOption("-m0");
        await csound.setOption("--sample-accurate");
        if ((await csound.compileOrc(HEADER)) !== 0) throw new Error("Failed to compile header.");
        await csound.start();
        await csound.readScore("f0 z");
        if ((await csound.compileOrc(SYNTH_SOURCE)) !== 0) throw new Error("Failed to compile built-in synths.");
        await csound.inputMessage("i 9990 0 -1");
        await csound.inputMessage("i 9985 0 -1");

        const ctx = await csound.getAudioContext();
        const node = await csound.getNode();
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        node.connect(analyser);

        // A new Csound session knows none of the instruments, reverbs or channel values of
        // the previous one.
        channelCache.clear();
        instrs.clear();
        BUILTIN_INSTRS.forEach((n) => instrs.add(n));
        aliases.clear();
        reverbsRunning.clear();
        dronesRunning.clear();
        busesRunning.clear();
        bpm = 120;
        bar = 4;
        clock = null;
        running = true;
        pollTimer = setInterval(poll, 20);
        return analyser;
      } catch (e) {
        const failed = csound;
        csound = null;
        try {
          await failed.destroy();
        } catch {
          // Nothing more to release.
        }
        throw e;
      }
    },

    // Estimated current beat, extrapolated from the last polled clock value.
    now() {
      if (!running || !clock) return null;
      const dt = (performance.now() - clock.t) / 1000;
      return { beat: clock.beat + (dt * bpm) / 60, bpm, bar };
    },

    resolveInstrument(name) {
      return aliases.get(name);
    },

    // Returns short messages describing what was compiled and scheduled.
    async evaluate(code) {
      const report = [];
      const { orc, score } = splitCode(code);
      const hasOrc = orc
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .some((l) => l.replace(/;.*$/, "").trim());
      if (hasOrc) {
        const text = orc.replace(/^(\s*)instr\s+([A-Za-z_]\w*)[ \t]*(?:;.*)?$/gm, (_, ws, name) => `${ws}instr ${aliasFor(name)} ; ${name}`);
        // Numbers from 9600 up belong to bus variants, drones, returns and the clock;
        // redefining one would silently break them, so refuse before compiling.
        const numbers = [...text.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/^[ \t]*instr[ \t]+([^;\n]+)/gm)]
          .flatMap((m) => m[1].split(",").map((x) => x.trim()))
          .filter((n) => /^\d+(\.\d+)?$/.test(n));
        const reserved = numbers.filter((n) => Number(n) >= 9600);
        if (reserved.length) throw new Error(`instr ${reserved.join(", ")}: numbers 9600 and above are reserved for CLive itself, use a lower number`);
        const rc = await csound.compileOrc(text);
        if (rc !== 0) throw new Error("Orchestra compile error (see console).");
        numbers.forEach((n) => instrs.add(n));
        const defined = [...orc.matchAll(/^[ \t]*instr[ \t]+([^;\n]+)/gm)].flatMap((m) => m[1].split(",").map((x) => x.trim()));
        report.push(defined.length ? `compiled instr ${defined.join(", ")}` : "compiled Csound code");
      }
      let scheduled = 0;
      for (const l of score) {
        const q = quantize(l);
        if (q !== l) scheduled++;
        await csound.inputMessage(q);
      }
      if (scheduled) report.push(`score: ${scheduled} event${scheduled > 1 ? "s" : ""} start at the next bar`);
      if (score.length > scheduled) report.push(`score: ${score.length - scheduled} line${score.length - scheduled > 1 ? "s" : ""} sent now`);
      return report;
    },

    // Schedules one note at an absolute beat. p3 (sus) is in beats. sends: up to
    // three [slot, amount] pairs for the reverb buses. extras: the synth's own
    // parameters, which become p13 and up. busSlot (or null): routes the note's whole
    // output to that mixing bus instead of the speakers, via the synth's bus-routed
    // variant instrument -- send= is unaffected, it still fires from the same instrs.
    async note(target, instr, sus, amp, freq, pan, sends = [], extras = [], busSlot = null) {
      const realInstr = busSlot === null ? instr : busVariantInstance(instr);
      const realExtras = busSlot === null ? extras : [...extras, busSlot];
      const pairs = [0, 1, 2].map((k) => (sends[k] ? `${sends[k][0]} ${sends[k][1]}` : "-1 0")).join(" ");
      const fields = [realInstr, 0, sus, amp, freq, pan, pairs, ...realExtras];
      await csound.inputMessage(`i 9991 0 3600 ${target.toFixed(6)} ${6 + 6 + realExtras.length} ${fields.join(" ")}`);
    },

    // Sets a reverb's parameters and starts its return instrument if needed.
    async defineReverb(slot, params) {
      await Promise.all(Object.entries(params).map(([k, v]) => setChannel(`rev${slot}_${k}`, v)));
      if (!reverbsRunning.has(slot)) {
        reverbsRunning.add(slot);
        await csound.inputMessage(`i ${reverbInstance(slot)} 0 -1 ${slot}`);
      }
    },

    async stopReverb(slot) {
      reverbsRunning.delete(slot);
      await csound.inputMessage(`i -${reverbInstance(slot)} 0 0`);
    },

    // Writes a drone's channels without touching whether it is running: amp/freq/pan
    // are plain numbers, sends up to three [slot, amount] pairs, extras positional.
    async updateDrone(slot, { amp, freq, pan, sends, extras } = {}) {
      const prefix = `drone${slot}_`;
      const writes = [];
      if (amp !== undefined) writes.push(setChannel(`${prefix}amp`, amp));
      if (freq !== undefined) writes.push(setChannel(`${prefix}freq`, freq));
      if (pan !== undefined) writes.push(setChannel(`${prefix}pan`, pan));
      if (sends) writes.push(...sendWrites(prefix, sends));
      if (extras) extras.forEach((v, i) => writes.push(setChannel(`${prefix}x${i + 1}`, v)));
      await Promise.all(writes);
    },

    // Writes the drone's channels and (re)starts its continuous voice if it is not
    // already running this exact synth. Switching a slot to a different synth stops
    // the old voice first.
    async defineDrone(slot, instr, channels) {
      await this.updateDrone(slot, channels);
      if (dronesRunning.get(slot) === instr) return;
      if (dronesRunning.has(slot)) await csound.inputMessage(`i -${droneInstance(dronesRunning.get(slot))} 0 0`);
      dronesRunning.set(slot, instr);
      await csound.inputMessage(`i ${droneInstance(instr)} 0 -1 ${slot}`);
    },

    async stopDrone(slot) {
      const instr = dronesRunning.get(slot);
      if (instr === undefined) return;
      dronesRunning.delete(slot);
      await csound.inputMessage(`i -${droneInstance(instr)} 0 0`);
    },

    // Writes a bus's amp/pan/send channels without touching whether its return instrument
    // is running -- used every tick for cosr()/lineto()-driven values, same as a drone.
    async updateBus(slot, { amp, pan, sends } = {}) {
      const prefix = `bus${slot}_`;
      const writes = [];
      if (amp !== undefined) writes.push(setChannel(`${prefix}amp`, amp));
      if (pan !== undefined) writes.push(setChannel(`${prefix}pan`, pan));
      if (sends) writes.push(...sendWrites(prefix, sends));
      await Promise.all(writes);
    },

    // Writes the bus's channels and starts its return instrument if it is not already running.
    async defineBus(slot, channels) {
      await this.updateBus(slot, channels);
      if (busesRunning.has(slot)) return;
      busesRunning.add(slot);
      await csound.inputMessage(`i ${busReturnInstance(slot)} 0 -1 ${slot}`);
    },

    async stopBus(slot) {
      if (!busesRunning.has(slot)) return;
      busesRunning.delete(slot);
      await csound.inputMessage(`i -${busReturnInstance(slot)} 0 0`);
    },

    async setTempo(value) {
      bpm = value;
      if (running) await setChannel("bpm", value);
    },

    async setBar(beats) {
      bar = beats;
      if (running) await setChannel("bar", beats);
    },

    async silence() {
      if (!running) return;
      for (const n of [...instrs, "9991"]) await csound.inputMessage(`i 9999 0 0.01 ${n}`);
    },

    async stop() {
      running = false;
      clearInterval(pollTimer);
      try {
        await csound.stop();
        await csound.destroy();
      } finally {
        csound = null;
        clock = null;
      }
    },
  };
}
