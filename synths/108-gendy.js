// Built-in synth: gendy. See registry.js for the shared field contract (p3-p12) that
// every built-in synth's `body` follows.
export const gendy = {
  instr: 108,
  doc: "Dynamic stochastic synthesis (Xenakis's GENDYN): instead of a fixed waveform, the shape of the wave itself takes a random walk every cycle, so the tone is grainy and always slightly different. It follows the note's pitch loosely rather than playing it cleanly. Can be used as a drone.",
  drone: true,
  params: {
    spread: {
      default: 0.3,
      min: 0,
      max: 1,
      doc: "How far the wave is allowed to wander from the note's pitch. 0 stays close to a stable tone, 1 lets it roam more than two octaves and starts to feel pitchless.",
    },
    wander: {
      default: 0.5,
      min: 0,
      max: 1,
      doc: "How much the loudness of each cycle drifts. 0 is nearly steady, 1 is fully random.",
    },
    jitter: {
      default: 0.5,
      min: 0,
      max: 1,
      doc: "How much the timing of each cycle drifts. Low values are smoother, high values sound grainier and noisier.",
    },
    points: {
      default: 12,
      min: 4,
      max: 64,
      doc: "Number of breakpoints packed into each cycle. Few points give a simple, rounder tone; many points pack more detail into each cycle and sound busier and brighter.",
    },
  },
  udo: `
opcode Gendy_dsp, aa, kkkkkkk
  kamp, kfreq, kpan, kspread, kwander, kjitter, kpoints xin
  kminfreq = kfreq / (1 + kspread * 3)
  kmaxfreq = kfreq * (1 + kspread * 3)
  ; spread can multiply the high end by up to 4x; without this, a high oct/degree
  ; combined with a high spread pushes kmaxfreq past Nyquist and gendy aliases into
  ; broadband noise instead of a pitched tone. Keep it under a safe fraction of sr.
  kmaxfreq = min(kmaxfreq, sr * 0.4)
  kminfreq = min(kminfreq, kmaxfreq)
  ; Packing many breakpoints into a cycle that is only a handful of samples long (a
  ; high pitch, or points pushed toward its max) makes gendy's own internal duration
  ; math unstable and it outputs huge amplitude spikes instead of a tone -- not
  ; clipping, an actual numeric blow-up. Cap points to what the cycle can hold at
  ; this frequency (at least 2 samples per breakpoint) so it always stays in range.
  kmaxpts = int(max(4, sr / (kmaxfreq * 2)))
  kpts = int(min(max(kpoints, 4), kmaxpts))
  kenv madsr 0.01, 0.1, 0.7, 0.2
  asig gendy kamp * kenv, 1, 1, 0.5, 0.5, kminfreq, kmaxfreq, kwander, kjitter, 64, kpts
  aL, aR pan2 asig, kpan
  xout aL, aR
endop
`,
  body: `
  aL, aR Gendy_dsp p4, p5, p6, p13, p14, p15, p16
  outs aL, aR
  revsend aL, aR, p7, p8, p9, p10, p11, p12
  `,
};
