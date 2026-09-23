// Built-in synth: saw. See registry.js for the shared field contract (p3-p12) that
// every built-in synth's `body` follows.
export const saw = {
  instr: 103,
  doc: "Two slightly detuned sawtooth oscillators, low-passed. A general purpose lead or keys sound. Can be used as a drone.",
  drone: true,
  udo: `
opcode Saw_dsp, aa, kkk
  kamp, kfreq, kpan xin
  kenv madsr 0.01, 0.1, 0.7, 0.25
  a1 vco2 kamp * kenv, kfreq * 0.997
  a2 vco2 kamp * kenv, kfreq * 1.003
  asig butterlp (a1 + a2) * 0.5, 5000
  aL, aR pan2 asig, kpan
  xout aL, aR
endop
`,
  body: `
  aL, aR Saw_dsp p4, p5, p6
  outs aL, aR
  revsend aL, aR, p7, p8, p9, p10, p11, p12
  `,
};
