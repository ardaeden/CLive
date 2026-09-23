// Built-in synth: bass. See registry.js for the shared field contract (p3-p12) that
// every built-in synth's `body` follows.
export const bass = {
  instr: 102,
  doc: "Sawtooth bass through a Moog-style low-pass filter that follows the pitch. Works best in low octaves (oct=3). Can be used as a drone.",
  drone: true,
  udo: `
opcode Bass_dsp, aa, kkk
  kamp, kfreq, kpan xin
  kenv madsr 0.005, 0.15, 0.6, 0.12
  asig vco2 kamp * kenv, kfreq
  asig moogvcf2 asig, min(kfreq * 5, 6000), 0.25
  aL, aR pan2 asig, kpan
  xout aL, aR
endop
`,
  body: `
  aL, aR Bass_dsp p4, p5, p6
  outs aL, aR
  revsend aL, aR, p7, p8, p9, p10, p11, p12
  `,
};
