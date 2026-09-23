// Built-in synth: pluck. See registry.js for the shared field contract (p3-p12) that
// every built-in synth's `body` follows.
export const pluck = {
  instr: 101,
  doc: "Plucked string (Karplus-Strong). The string decays on its own; decay only sets the longest it may ring, so sus has no effect. It cannot be used as a drone, since it always rings down to silence.",
  params: {
    decay: {
      default: 4,
      min: 0.05,
      max: 64,
      unit: "beats",
      doc: "Longest time the string may ring, in beats. Short values give staccato plucks (the ring is cut off with a quick fade), long values let the natural decay finish.",
    },
    bright: {
      default: 1,
      min: 0,
      max: 1,
      doc: "Tone brightness from 0 (dark, soft) to 1 (open). The low-pass cutoff follows the pitch, so it sounds even across the keyboard, and darker settings are made up in level. Try bright=cosr(0.6, 0.4, 16).",
    },
    stretch: {
      default: 1,
      min: 1,
      max: 64,
      doc: "Stretched averaging: 1 is the plain string. Larger values average the string less often, so the pluck gets brighter and noisier, buzzy or metallic when very large. 2 to 8 is the useful range.",
    },
  },
  body: `
  idecay = max(p13, 0.05)
  p3 = idecay
  ifade = min(0.1, idecay * 0.5)
  kenv linseg 1, idecay - ifade, 1, ifade, 0
  icut = min(p5 * 2 ^ (1 + p14 * 6), 18000)
  if p15 > 1 then
    asig pluck p4 * kenv, p5, p5, 0, 2, p15
  else
    asig pluck p4 * kenv, p5, p5, 0, 1
  endif
  asig butterlp asig, icut
  asig = asig * (1 + 2.5 * (1 - p14) ^ 2)
  aL, aR pan2 asig, p6
  outs aL, aR
  revsend aL, aR, p7, p8, p9, p10, p11, p12
  `,
};
