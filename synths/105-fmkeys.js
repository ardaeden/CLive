// Built-in synth: fmkeys. See registry.js for the shared field contract (p3-p12) that
// every built-in synth's `body` follows.
export const fmkeys = {
  instr: 105,
  doc: "FM electric piano. A sine carrier is modulated by a second sine whose depth (index) starts bright and mellows as the note rings, plus a short bell-like tine at the attack. It cannot be used as a drone, since the tone always decays.",
  params: {
    index: {
      default: 2.5,
      min: 0,
      max: 12,
      doc: "Modulation depth at the attack. It falls to a tenth over the note, so higher values sound bright and metallic at first and mellow later. 0 is a pure sine.",
    },
    ratio: {
      default: 1,
      min: 0.25,
      max: 16,
      doc: "Modulator frequency as a multiple of the note. Whole numbers stay harmonic (1 is warm, 2 is hollow, 3 is glassy), other values give bell-like inharmonic tones.",
    },
    tine: {
      default: 0.5,
      min: 0,
      max: 1,
      doc: "Level of the short, bright tine heard at the very start of the note, the 'tick' of a tine piano.",
    },
    decay: {
      default: 3,
      min: 0.05,
      max: 32,
      unit: "beats",
      doc: "How long the note takes to die away, in beats. The note also stops when sus ends.",
    },
  },
  body: `
  idecay = max(p16, 0.05)
  kenv expsegr 1, idecay, 0.001, 0.25, 0.0001
  kidx expseg max(p13, 0.001), idecay * 0.5, max(p13 * 0.1, 0.001)
  imodf = p5 * p14
  amod poscil3 kidx * imodf, imodf
  acar poscil3 p4 * kenv, p5 + amod
  ktine expseg 1, 0.2, 0.001
  atine poscil3 p4 * p15 * 0.25 * ktine, p5 * 7
  asig = acar + atine
  aL, aR pan2 asig, p6
  outs aL, aR
  revsend aL, aR, p7, p8, p9, p10, p11, p12
  `,
};
