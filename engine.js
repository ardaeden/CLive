// Master clock and beat-locked launcher. All times are in beats, so tempo
// changes keep every rhythmic element locked to the same grid.
import { LIMITS, COMMAND_WORDS, SYNTHS, DRUM_VOICES, DRUM_EXTRA_PARAMS, REVERB_PARAMS, DELAY_PARAMS, BUS_PARAMS, csoundSource, droneParamKeys } from "./registry.js";

// Send slots: each reverb or delay takes one, and owns the send bus (a zak pair) of that
// number, which players, drones and buses send into (and delays, into reverbs).
const SEND_SLOTS = LIMITS.sendSlots;
const REVERB_PARAM_NAMES = Object.keys(REVERB_PARAMS);
const DRONE_SLOTS = LIMITS.droneSlots;
// Sample files get Csound table numbers from here up, one per file per session.
const SAMPLE_TABLE_BASE = 5000;
const BUS_SLOTS = LIMITS.busSlots;
const BUS_PARAM_NAMES = Object.keys(BUS_PARAMS);
// Drones with the most extra parameters (cloud) need 8 generic channels; every
// dronable synth just uses as many of them as it has.
const MAX_DRONE_EXTRAS = 8;
// Synths that can run as a drone (a single, continuously running instance).
const DRONABLE_SYNTHS = Object.fromEntries(Object.entries(SYNTHS).filter(([, s]) => s.drone));
for (const [name, s] of Object.entries(DRONABLE_SYNTHS)) {
  if (droneParamKeys(s).length > MAX_DRONE_EXTRAS) throw new Error(`Drone '${name}' has more live parameters than MAX_DRONE_EXTRAS (${MAX_DRONE_EXTRAS}) allows`);
}

const BUILTIN_SOURCE = [
  ...Object.values(SYNTHS).map((s) => s.udo ?? ""),
  ...Object.values(SYNTHS).map((s) => s.droneUdo ?? ""),
  ...DRUM_VOICES.map((d) => d.udo ?? ""),
  ...Object.entries(SYNTHS).map(([name, s]) => csoundSource(name, s.instr, s.body)),
  ...DRUM_VOICES.map((d) => csoundSource(d.name, d.instr, d.body)),
].join("\n\n");
const REVERB_CHANNELS = Array.from({ length: SEND_SLOTS }, (_, slot) =>
  REVERB_PARAM_NAMES.map((p) => `chn_k "rev${slot}_${p}", 1`).join("\n"),
).join("\n");
const reverbInstance = (slot) => (9980 + (slot + 1) / 100).toFixed(2);

// A bus's own amp/pan channels plus its three send pairs, one set per slot.
const BUS_SEND_NAMES = ["s1slot", "s1amt", "s2slot", "s2amt", "s3slot", "s3amt"];
const BUS_CHANNELS = Array.from({ length: BUS_SLOTS }, (_, slot) =>
  [...BUS_PARAM_NAMES, ...BUS_SEND_NAMES].map((p) => `chn_k "bus${slot}_${p}", 1`).join("\n"),
).join("\n");
const busReturnInstance = (slot) => (9975 + (slot + 1) / 100).toFixed(2);

// A delay's parameters plus its three send pairs, one set per send slot (a delay takes a
// send slot, like a reverb). Its return runs as instr 9977.<slot>.
const DELAY_PARAM_NAMES = Object.keys(DELAY_PARAMS);
const DELAY_CHANNELS = Array.from({ length: SEND_SLOTS }, (_, slot) =>
  [...DELAY_PARAM_NAMES, ...BUS_SEND_NAMES].map((p) => `chn_k "dly${slot}_${p}", 1`).join("\n"),
).join("\n");
const delayInstance = (slot) => (9977 + (slot + 1) / 100).toFixed(2);
// Longest delay line in seconds; delay time= is capped to it however slow the tempo.
const DELAY_MAX_SECONDS = 6;
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
    `ibusslot = p${busSlotField}\n  zawm aL, 2 * (${SEND_SLOTS} + ibusslot), 1\n  zawm aR, 2 * (${SEND_SLOTS} + ibusslot) + 1, 1`,
  );
  return csoundSource(`${name} (bus)`, busVariantInstance(instr), busBody);
}
const BUS_VARIANT_SOURCE = [
  ...Object.entries(SYNTHS).map(([name, s]) => busVariantInstrSource(name, s.instr, s.body, 13 + Object.keys(s.params ?? {}).length)),
  ...DRUM_VOICES.map((d) => busVariantInstrSource(d.name, d.instr, d.body, 13 + Object.keys(DRUM_EXTRA_PARAMS).length)),
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

// Drone and bus parameters arrive from JS every LIMITS.droneUpdateMs as steps; a step
// in a level (amp, pan, a send) is an audible click, so every value glides linearly to
// the next over that same interval. Table numbers (src=) are the exception: a value
// between two of them means nothing.
const GLIDE = LIMITS.droneUpdateMs / 1000;

// The Csound source of one dronable synth's continuous-voice instrument: reads its
// params from this slot's channels (written from JS) instead of fixed p-fields. The
// voice calls the last opcode in the synth's udo: helpers it uses come before it.
function droneInstrSource(name, s) {
  const call = [...(s.droneUdo ?? s.udo).matchAll(/^opcode\s+(\w+)/gm)].pop()[1];
  const extras = droneExtras(s);
  const reads = extras.map(({ key, live }, i) => {
    const ch = `x${i + 1}`;
    const lines = [`  S${ch} sprintf "drone%d_${ch}", islot`];
    if (!live) lines.push(`  k${ch} chnget S${ch}`, `  i${ch} = i(k${ch})`);
    else if (s.params[key].kind === "sample") lines.push(`  k${ch} chnget S${ch}`);
    else lines.push(`  k${ch} lineto chnget:k(S${ch}), ${GLIDE}`);
    return lines.join("\n");
  });
  const args = extras.map(({ live }, i) => (live ? `kx${i + 1}` : `ix${i + 1}`));
  const body = `
  islot = p4
  Samp sprintf "drone%d_amp", islot
  Sfreq sprintf "drone%d_freq", islot
  Span sprintf "drone%d_pan", islot
  kamp lineto chnget:k(Samp), ${GLIDE}
  kfreq lineto chnget:k(Sfreq), ${GLIDE}
  kpan lineto chnget:k(Span), ${GLIDE}
${reads.join("\n")}
  ; The voice runs at unit level in the centre, and level and pan are applied here per
  ; sample instead: a k-rate glide still moves in 32-sample steps, which buzz on a
  ; moving amp or pan. Every dronable synth is linear in amp and pans with pan2's
  ; equal-power law (0.707 each side in the centre), so this sounds the same; a new
  ; dronable synth has to keep to that.
  aL0, aR0 ${call} 1, kfreq, 0.5${args.length ? ", " + args.join(", ") : ""}
  aamp interp kamp
  apan interp limit(kpan, 0, 1) * 1.5707963
  aL = aL0 * aamp * cos(apan) * 1.4142136
  aR = aR0 * aamp * sin(apan) * 1.4142136
  outs aL, aR
  ; Send slots are read at k-rate too, so re-pointing send= at another reverb or delay
  ; takes effect on the running drone, not only the next time it starts.
  Ss1 sprintf "drone%d_s1slot", islot
  Sa1 sprintf "drone%d_s1amt", islot
  Ss2 sprintf "drone%d_s2slot", islot
  Sa2 sprintf "drone%d_s2amt", islot
  Ss3 sprintf "drone%d_s3slot", islot
  Sa3 sprintf "drone%d_s3amt", islot
  revsendk1 aL, aR, chnget:k(Ss1), lineto:k(chnget:k(Sa1), ${GLIDE})
  revsendk1 aL, aR, chnget:k(Ss2), lineto:k(chnget:k(Sa2), ${GLIDE})
  revsendk1 aL, aR, chnget:k(Ss3), lineto:k(chnget:k(Sa3), ${GLIDE})`;
  return csoundSource(`${name} (drone)`, droneInstance(s.instr), body);
}
const DRONE_INSTR_SOURCE = Object.entries(DRONABLE_SYNTHS)
  .map(([name, s]) => droneInstrSource(name, s))
  .join("\n\n");

const HEADER = `
ksmps = 32
nchnls = 2
0dbfs = 1

; Send buses: zak a-channels 2*slot (left) and 2*slot+1 (right), one slot per reverb or
; delay, followed by 2 more per mixing bus slot (offset by the send slots).
zakinit ${(SEND_SLOTS + BUS_SLOTS) * 2}, 1
${REVERB_CHANNELS}

; Delay parameter channels (and send pairs), written from JS and read live by each delay return.
${DELAY_CHANNELS}

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

// Sends, the bus, delay and reverb returns, and the built-in instruments from the registry.
const SYNTH_SOURCE = `
; revsend aL, aR, p7, p8, p9, p10, p11, p12 mixes a note's signal into up to three
; send buses (reverbs or delays). Call it after outs in your own instruments. Pairs are
; (slot, amount).
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

; Like revsend1, but the send slot is k-rate too, so a running drone, bus or delay
; return can be pointed at a different reverb or delay without restarting it.
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
; send= goes to reverbs or delays after amp/pan (post-fader); it runs before the delay
; (9977) and reverb (9980) returns, so they hear it in the same cycle.
instr 9975
  islot = p4
  Samp sprintf "bus%d_amp", islot
  Span sprintf "bus%d_pan", islot
  ; Glided like a drone's parameters, and the gains interpolated per sample, so a
  ; moving amp or pan (cosr(), random()) does not click.
  kamp lineto chnget:k(Samp), ${GLIDE}
  kpan lineto chnget:k(Span), ${GLIDE}
  aInL zar 2 * (${SEND_SLOTS} + islot)
  aInR zar 2 * (${SEND_SLOTS} + islot) + 1
  kpanL = (kpan <= 0 ? 1 : 1 - kpan)
  kpanR = (kpan >= 0 ? 1 : 1 + kpan)
  againL interp kamp * kpanL
  againR interp kamp * kpanR
  aOutL = aInL * againL
  aOutR = aInR * againR
  outs aOutL, aOutR
  Ss1 sprintf "bus%d_s1slot", islot
  Sa1 sprintf "bus%d_s1amt", islot
  Ss2 sprintf "bus%d_s2slot", islot
  Sa2 sprintf "bus%d_s2amt", islot
  Ss3 sprintf "bus%d_s3slot", islot
  Sa3 sprintf "bus%d_s3amt", islot
  revsendk1 aOutL, aOutR, chnget:k(Ss1), lineto:k(chnget:k(Sa1), ${GLIDE})
  revsendk1 aOutL, aOutR, chnget:k(Ss2), lineto:k(chnget:k(Sa2), ${GLIDE})
  revsendk1 aOutL, aOutR, chnget:k(Ss3), lineto:k(chnget:k(Sa3), ${GLIDE})
endin

; Delay return: p4 = slot. Two delay lines (left, right) fed back through a high-pass,
; a low-pass and a soft saturator, with optional ping-pong crossing, tape wow and
; flutter on the time, and sends of its own (after level) to reverbs.
; Parameters come from the dly<slot>_* channels and glide like a bus's. It runs after
; the bus returns (9975), which may send to it, and before the reverbs (9980), which it
; may send to.
instr 9977
  islot = p4
${DELAY_PARAM_NAMES.map((p) => `  S${p} sprintf "dly%d_${p}", islot\n  k${p} lineto chnget:k(S${p}), ${GLIDE}`).join("\n")}
  ; A new time glides over about 80 ms, like tape speeding up or slowing down, instead
  ; of jumping (which would click); the repeats bend in pitch meanwhile.
  ktime portk ktime, 0.08
  kspread portk kspread, 0.08
  ksecL = limit(ktime * 60 / gkbpm, 0.002, ${DELAY_MAX_SECONDS - 0.01})
  ksecR = limit((ktime + kspread) * 60 / gkbpm, 0.002, ${DELAY_MAX_SECONDS - 0.01})
  aInL zar 2 * islot
  aInR zar 2 * islot + 1
  ; Wow (slow) and flutter (fast), a little out of phase between the sides.
  awowL oscili 0.004, 0.6
  awowR oscili 0.004, 0.6, -1, 0.3
  aflL oscili 0.0003, 6.3
  aflR oscili 0.0003, 6.3, -1, 0.5
  atL = interp(ksecL) + (awowL + aflL) * kwobble
  atR = interp(ksecR) + (awowR + aflR) * kwobble
  adumpL delayr ${DELAY_MAX_SECONDS}
  atapL deltap3 atL
  adumpR delayr ${DELAY_MAX_SECONDS}
  atapR deltap3 atR
  ; Each repeat passes the filters and the saturator once more: tanh(g * x) / g leaves
  ; small signals alone and never exceeds 1 / g, so any feedback stays bounded.
  ; The gains below are interpolated per sample, so a moving drive, feedback or
  ; ping-pong does not step every 32 samples.
  ag interp 1 + 3 * kdrive
  afb interp kfeedback
  app interp kpingpong
  arL butterhp atapL, klowcut
  arL butterlp arL, khighcut
  arR butterhp atapR, klowcut
  arR butterlp arR, khighcut
  arL = tanh(arL * ag) / ag
  arR = tanh(arR * ag) / ag
  ; Ping-pong: the input enters on the left (as mono) and every repeat crosses sides.
  amono = (aInL + aInR) * 0.7071
  awL = (1 - app) * aInL + app * amono + afb * ((1 - app) * arL + app * arR)
  awR = (1 - app) * aInR + afb * ((1 - app) * arR + app * arL)
  ; delayw pairs with delayr in the order they were opened: first with first.
  delayw awL
  delayw awR
  ; kill fades the repeats out over a tenth of a second instead of cutting them.
  kfade linsegr 1, 1, 1, 0.1, 0
  again interp klevel * kfade
  aOutL = arL * again
  aOutR = arR * again
  outs aOutL, aOutR
  Ss1 sprintf "dly%d_s1slot", islot
  Sa1 sprintf "dly%d_s1amt", islot
  Ss2 sprintf "dly%d_s2slot", islot
  Sa2 sprintf "dly%d_s2amt", islot
  Ss3 sprintf "dly%d_s3slot", islot
  Sa3 sprintf "dly%d_s3amt", islot
  revsendk1 aOutL, aOutR, chnget:k(Ss1), lineto:k(chnget:k(Sa1), ${GLIDE})
  revsendk1 aOutL, aOutR, chnget:k(Ss2), lineto:k(chnget:k(Sa2), ${GLIDE})
  revsendk1 aOutL, aOutR, chnget:k(Ss3), lineto:k(chnget:k(Sa3), ${GLIDE})
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

; Clears all send buses (reverb, delay and mixing bus) after the returns have read them.
instr 9985
  zacl 0, ${(SEND_SLOTS + BUS_SLOTS) * 2 - 1}
endin

${BUILTIN_SOURCE}

${BUS_VARIANT_SOURCE}

${DRONE_INSTR_SOURCE}
`;

// Bus-routed variants are note-triggered like the plain ones, so silence() (which stops
// every player) needs to know about them too; the bus return instrument itself is not
// included here, since it keeps running like a reverb's -- kill it by name instead.
const BASE_INSTRS = [...Object.values(SYNTHS), ...DRUM_VOICES].map((x) => x.instr);
const BUILTIN_INSTRS = [...BASE_INSTRS.map(String), ...BASE_INSTRS.map((instr) => String(busVariantInstance(instr)))];
const FOX_START = [
  // name: synth(...) or name: synth@busname(...) — a definition. Requires a call on
  // the same line so a bare Csound label ("loop:") is never mistaken for a player
  // statement.
  /^\s*[A-Za-z_]\w*\s*:\s*[A-Za-z_]\w*\s*(@\s*[A-Za-z_]\w*\s*)?\(/,
  // A reserved command word at the start of the line: kill d1, tempo 108, clear, ...
  new RegExp(`^\\s*(${COMMAND_WORDS.join("|")})\\b`),
];
const SCORE_LINE = /^\s*[ifeatqrsmnvxy](\s|$)/;

function bracketDelta(line) {
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
    // Each part keeps one entry per source line (blank where the line belongs to
    // another part), so line numbers in compile and player errors match the editor.
    fox.push(kind === "fox" ? line : "");
    orc.push(kind === "orc" ? line : "");
    if (kind === "score") {
      const t = line.trim();
      if (t && !t.startsWith(";")) score.push(t);
    }
  });
  return { orc: orc.join("\n"), score, fox: fox.join("\n") };
}

// Rewrites "i" events with a positive numeric p1 into bar-quantized launcher
// events; anything else (f, e, turnoffs, strings) is sent as is.
function quantize(line) {
  const f = line.trim().split(/\s+/);
  const numeric = f.slice(1).every((x) => x !== "" && !Number.isNaN(Number(x)));
  if (f[0] !== "i" || f.length < 4 || !numeric || Number(f[1]) <= 0) return line;
  return `i 9991 0 3600 -1 ${f.length - 1} ${f.slice(1).join(" ")}`;
}

export function createEngine(Csound, { onMessage }) {
  let csound = null;
  let audioCtx = null;
  let running = false;
  let bpm = 120;
  let bar = 4;
  let clock = null;
  let pollTimer = null;
  let polling = false;
  const instrs = new Set(BUILTIN_INSTRS);
  const reverbsRunning = new Set();
  const delaysRunning = new Set();
  const dronesRunning = new Map();
  const busesRunning = new Set();
  const aliases = new Map();
  // Last value written to each control channel this session. Drones and buses are
  // refreshed every tick (LIMITS.droneUpdateMs), but most of their values sit still, and
  // every write is a message to the audio thread -- so only changes are sent.
  const channelCache = new Map();
  // Sample files: decoded once per page and kept across Stop/Start (name -> promise of
  // the samples), but copied into a Csound table per session (name -> { table, promise }),
  // since a new Csound instance starts with no tables of its own.
  const decoded = new Map();
  const sampleTables = new Map();
  let nextSampleTable = SAMPLE_TABLE_BASE;

  // Mono, at the context's sample rate, at most LIMITS.maxSampleSeconds long and
  // normalized to a peak of 1, so every file plays at a comparable level.
  function decodeSample(name) {
    if (!decoded.has(name)) {
      const promise = (async () => {
        // server.py serves samples at an address without the file's extension, which
        // download managers leave alone (see server.py); any other server gets the plain
        // path. A 404 from server.py itself (it marks its replies) means the file is missing.
        let res = await fetch(`sample?f=${encodeURIComponent(name)}`);
        if (res.status === 404 && !res.headers.get("X-CLive")) res = await fetch(`samples/${name.split("/").map(encodeURIComponent).join("/")}`);
        if (res.status === 204) throw new Error(`Sample '${name}' was intercepted (${res.statusText || "empty reply"}): a download manager such as IDM is catching the request; run CLive with server.py, or exclude 127.0.0.1 in the download manager`);
        if (!res.ok) throw new Error(`Sample '${name}' not found: put the file in the samples folder`);
        const bytes = await res.arrayBuffer();
        let audio;
        try {
          audio = await audioCtx.decodeAudioData(bytes);
        } catch (e) {
          throw new Error(`Sample '${name}' could not be decoded (${e?.message ?? e}): use WAV, MP3, OGG or FLAC`);
        }
        const length = Math.min(audio.length, Math.round(LIMITS.maxSampleSeconds * audio.sampleRate));
        if (!length) throw new Error(`Sample '${name}' is empty`);
        const data = new Float64Array(length);
        for (let c = 0; c < audio.numberOfChannels; c++) {
          const ch = audio.getChannelData(c);
          for (let i = 0; i < length; i++) data[i] += ch[i] / audio.numberOfChannels;
        }
        let peak = 0;
        for (let i = 0; i < length; i++) peak = Math.max(peak, Math.abs(data[i]));
        if (peak > 0) for (let i = 0; i < length; i++) data[i] /= peak;
        return { data, seconds: length / audio.sampleRate, trimmed: length < audio.length };
      })();
      // A failed file is tried again the next time it is asked for (it may have been fixed).
      promise.catch(() => decoded.delete(name));
      decoded.set(name, promise);
    }
    return decoded.get(name);
  }

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

  // The engine creates the AudioContext, so it closes it too: Csound's destroy() leaves
  // it running, and browsers refuse new contexts once a handful are open.
  async function closeAudio() {
    const ctx = audioCtx;
    audioCtx = null;
    if (ctx && ctx.state !== "closed") await ctx.close().catch(() => {});
  }

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
      // Csound's own default is the browser's smallest buffer ("interactive"), which
      // drops out whenever one render quantum runs long.
      audioCtx = new AudioContext({ latencyHint: LIMITS.outputLatencySeconds });
      csound = await Csound({ audioContext: audioCtx });
      if (!csound) {
        await closeAudio();
        throw new Error("Csound failed to start (WebAudio/WASM not supported).");
      }
      try {
        csound.on("message", onMessage);
        await csound.setOption("-odac");
        await csound.setOption("-m0");
        // No ASCII drawings of function tables in the console: cloud makes one per note.
        await csound.setOption("-d");
        await csound.setOption("--sample-accurate");
        if ((await csound.compileOrc(HEADER)) !== 0) throw new Error("Failed to compile header.");
        await csound.start();
        await csound.readScore("f0 z");
        if ((await csound.compileOrc(SYNTH_SOURCE)) !== 0) throw new Error("Failed to compile built-in synths.");
        await csound.inputMessage("i 9990 0 -1");
        await csound.inputMessage("i 9985 0 -1");

        const node = await csound.getNode();
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 2048;
        node.connect(analyser);

        // A new Csound session knows none of the instruments, reverbs, tables or channel
        // values of the previous one.
        channelCache.clear();
        sampleTables.clear();
        nextSampleTable = SAMPLE_TABLE_BASE;
        instrs.clear();
        BUILTIN_INSTRS.forEach((n) => instrs.add(n));
        aliases.clear();
        reverbsRunning.clear();
        delaysRunning.clear();
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
        await closeAudio();
        throw e;
      }
    },

    // Estimated current beat, extrapolated from the last polled clock value.
    now() {
      if (!running || !clock) return null;
      const dt = (performance.now() - clock.t) / 1000;
      return { beat: clock.beat + (dt * bpm) / 60, bpm, bar };
    },

    // Seconds between Csound rendering a sample and it leaving the speakers. now() is
    // Csound's time, so anything shown to the user in step with the sound (the bar.beat
    // display, log() lines) waits this long; scheduling itself does not need it.
    outputLatency() {
      return audioCtx ? (audioCtx.outputLatency || audioCtx.baseLatency || 0) : 0;
    },

    resolveInstrument(name) {
      return aliases.get(name);
    },

    // A sample file's table in this session. `table` is its number once it is ready
    // (undefined while it loads or after it failed), and `fraction` how much of that
    // table the file fills (the rest is padding); `promise` settles with the load's
    // details or its error; `fresh` is true only for the call that started loading it.
    // A file that failed stays failed (no retry on every note) until `retry` is set,
    // which the player language does when the line using it is evaluated again.
    sample(name, retry = false) {
      const known = sampleTables.get(name);
      if (known && !(known.failed && retry)) return { ...known, fresh: false };
      const session = csound;
      const entry = { table: undefined };
      entry.promise = decodeSample(name).then(async (s) => {
        if (csound !== session) throw Object.assign(new Error("Stopped before the sample was loaded"), { quiet: true });
        // Grain opcodes (grain3) address a table as if its length were a power of two,
        // so the file is padded with silence up to one; `fraction` is the part of the
        // table the file itself takes up, for scaling positions within it.
        const size = 2 ** Math.ceil(Math.log2(s.data.length));
        const padded = new Float64Array(size);
        padded.set(s.data);
        const table = nextSampleTable++;
        if ((await csound.compileOrc(`giCliveSample ftgen ${table}, 0, ${size}, -2, 0`)) !== 0) {
          throw new Error(`Sample '${name}': Csound could not make a table for it`);
        }
        await csound.tableCopyIn(table, padded);
        Object.assign(entry, { table, fraction: s.data.length / size });
        return { table, seconds: s.seconds, trimmed: s.trimmed };
      });
      entry.promise.catch(() => {
        entry.failed = true;
      });
      sampleTables.set(name, entry);
      return { ...entry, fresh: true };
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
    // three [slot, amount] pairs for the send buses. extras: the synth's own
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

    // Writes a delay's parameter and send channels without touching whether its return
    // is running -- used every tick for cosr()/lineto()-driven values, like a bus.
    async updateDelay(slot, { params, sends }) {
      const prefix = `dly${slot}_`;
      await Promise.all([...Object.entries(params).map(([k, v]) => setChannel(prefix + k, v)), ...sendWrites(prefix, sends)]);
    },

    // Writes the delay's channels and starts its return if it is not already running.
    async defineDelay(slot, channels) {
      await this.updateDelay(slot, channels);
      if (delaysRunning.has(slot)) return;
      delaysRunning.add(slot);
      await csound.inputMessage(`i ${delayInstance(slot)} 0 -1 ${slot}`);
    },

    // Its repeats fade out over a tenth of a second (linsegr in instr 9977).
    async stopDelay(slot) {
      if (!delaysRunning.has(slot)) return;
      delaysRunning.delete(slot);
      await csound.inputMessage(`i -${delayInstance(slot)} 0 0`);
    },

    // Writes a drone's channels without touching whether it is running: amp/freq/pan
    // are plain numbers, sends up to three [slot, amount] pairs, extras positional.
    async updateDrone(slot, { amp, freq, pan, sends, extras }) {
      const prefix = `drone${slot}_`;
      await Promise.all([
        setChannel(`${prefix}amp`, amp),
        setChannel(`${prefix}freq`, freq),
        setChannel(`${prefix}pan`, pan),
        ...sendWrites(prefix, sends),
        ...extras.map((v, i) => setChannel(`${prefix}x${i + 1}`, v)),
      ]);
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
    async updateBus(slot, { amp, pan, sends }) {
      const prefix = `bus${slot}_`;
      await Promise.all([setChannel(`${prefix}amp`, amp), setChannel(`${prefix}pan`, pan), ...sendWrites(prefix, sends)]);
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
        await closeAudio();
      }
    },
  };
}
