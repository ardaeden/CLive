// Built-in synth: pad. See registry.js for the shared field contract (p3-p12) that
// every built-in synth's `body` follows.
export const pad = {
  instr: 104,
  doc: "Slow attack, three detuned saws with a sub octave. Made for chords with long sus. Can be used as a drone.",
  drone: true,
  udo: `
opcode Pad_dsp, aa, kkk
  kamp, kfreq, kpan xin
  kenv madsr 0.4, 0.2, 0.8, 0.8
  a1 vco2 kamp * kenv, kfreq * 0.995
  a2 vco2 kamp * kenv, kfreq * 1.005
  a3 vco2 kamp * kenv * 0.5, kfreq * 0.5
  ; moogvcf2 rather than moogladder: same Moog-style low-pass at a fraction of the CPU,
  ; so stacked chords with overlapping releases do not overload the audio thread.
  asig moogvcf2 (a1 + a2 + a3) * 0.4, 1500, 0.1
  aL, aR pan2 asig, kpan
  xout aL, aR
endop
`,
  body: `
  aL, aR Pad_dsp p4, p5, p6
  outs aL, aR
  revsend aL, aR, p7, p8, p9, p10, p11, p12
  `,
};
