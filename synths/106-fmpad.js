// Built-in synth: fmpad. See registry.js for the shared field contract (p3-p12) that
// every built-in synth's `body` follows.
export const fmpad = {
  instr: 106,
  doc: "FM pad. Two slightly detuned FM pairs and a sub octave with a slow attack. The modulation depth drifts with a slow LFO so the sound keeps moving. Made for long chords. Can be used as a drone (attack and release are set once when it starts).",
  drone: true,
  params: {
    index: {
      default: 1.5,
      min: 0,
      max: 10,
      doc: "Average modulation depth. Higher values are brighter and more metallic.",
    },
    ratio: {
      default: 2,
      min: 0.25,
      max: 16,
      doc: "Modulator frequency as a multiple of the note. Whole numbers stay harmonic, other values give bell-like tones.",
    },
    attack: {
      default: 1,
      min: 0.02,
      max: 16,
      unit: "beats",
      doc: "Fade-in time in beats.",
    },
    release: {
      default: 2,
      min: 0.05,
      max: 32,
      unit: "beats",
      doc: "Fade-out time in beats after the note ends.",
    },
    motion: {
      default: 0.5,
      min: 0,
      max: 1,
      doc: "How much the modulation depth breathes with the slow LFO. 0 keeps the sound still.",
    },
  },
  udo: `
opcode Fmpad_dsp, aa, kkkkkkkk
  kamp, kfreq, kpan, kindex, kratio, kattack, krelease, kmotion xin
  iatt = max(i(kattack), 0.02)
  irel = max(i(krelease), 0.05)
  kenv madsr iatt, 0.3, 0.8, irel
  klfo lfo 1, 0.17
  kidx = max(kindex * (1 + kmotion * 0.6 * klfo), 0.001)
  kmodf = kfreq * kratio
  amod1 poscil3 kidx * kmodf, kmodf * 1.001
  a1 poscil3 kamp * kenv, kfreq * 0.997 + amod1
  amod2 poscil3 kidx * 0.8 * kmodf, kmodf * 0.999
  a2 poscil3 kamp * kenv, kfreq * 1.003 + amod2
  a3 poscil3 kamp * kenv * 0.4, kfreq * 0.5
  asig butterlp (a1 + a2 + a3) * 0.4, 7000
  aL, aR pan2 asig, kpan
  xout aL, aR
endop
`,
  body: `
  aL, aR Fmpad_dsp p4, p5, p6, p13, p14, p15, p16, p17
  outs aL, aR
  revsend aL, aR, p7, p8, p9, p10, p11, p12
  `,
};
