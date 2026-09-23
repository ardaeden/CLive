// Built-in synth: fmbass. See registry.js for the shared field contract (p3-p12) that
// every built-in synth's `body` follows.
export const fmbass = {
  instr: 107,
  doc: "FM bass. A sine carrier is modulated by a second sine; the modulation is bright at the start of the note (the punch) and settles to a lasting growl. An optional sub-octave sine adds weight. Can be used as a drone: there is no punch to settle from, so it just holds the growl (index, ratio and sub still apply; punch does not).",
  drone: true,
  // A drone has no attack, so punch (an attack-to-settle shape) does not apply; the
  // drone just uses the settled growl directly, continuously, from index/ratio/sub.
  droneExtras: ["index", "ratio", "sub"],
  droneUdo: `
opcode Fmbass_drone_dsp, aa, kkkkkk
  kamp, kfreq, kpan, kindex, kratio, ksub xin
  kenv madsr 0.02, 0.1, 1, 0.1
  kidx = kindex * 0.25
  kmodf = kfreq * kratio
  amod poscil3 kidx * kmodf, kmodf
  acar poscil3 kamp * kenv, kfreq + amod
  asub poscil3 kamp * kenv * ksub * 0.7, kfreq * 0.5
  asig = acar + asub
  aL, aR pan2 asig, kpan
  xout aL, aR
endop
`,
  params: {
    index: {
      default: 5,
      min: 0,
      max: 12,
      doc: "Modulation depth at the attack. It settles to a quarter of this value and stays there, so it sets both the punch and the growl. 0 is a pure sine.",
    },
    ratio: {
      default: 1,
      min: 0.25,
      max: 8,
      doc: "Modulator frequency as a multiple of the note. 1 is a round growl, 2 is hollower and 3 is edgier; values with decimals sound harsh and inharmonic.",
    },
    punch: {
      default: 0.25,
      min: 0.02,
      max: 8,
      unit: "beats",
      doc: "How long the bright attack takes to settle into the growl, in beats. Short values click, long values give a wow-like sweep.",
    },
    sub: {
      default: 0.5,
      min: 0,
      max: 1,
      doc: "Level of a pure sine one octave below the note, for weight on small speakers.",
    },
  },
  body: `
  ipunch = max(p15, 0.01)
  kenv madsr 0.003, 0.15, 0.8, 0.12
  isettle = max(p13 * 0.25, 0.001)
  kidx expseg max(p13, 0.001), ipunch, isettle, 3600, isettle
  imodf = p5 * p14
  amod poscil3 kidx * imodf, imodf
  acar poscil3 p4 * kenv, p5 + amod
  asub poscil3 p4 * kenv * p16 * 0.7, p5 * 0.5
  asig = acar + asub
  aL, aR pan2 asig, p6
  outs aL, aR
  revsend aL, aR, p7, p8, p9, p10, p11, p12
  `,
};
