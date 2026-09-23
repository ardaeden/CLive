// Built-in synth: reso. See registry.js for the shared field contract (p3-p12) that
// every built-in synth's `body` follows.
export const reso = {
  instr: 109,
  doc: "Waveguide resonator: a burst of noise strikes a tuned string resonator (streson), which rings at the note's pitch. A second resonator at another ratio can be mixed in for metallic, bell-like tones, and sustained noise (air) keeps it sounding like a bowed or blown string. High notes ring shorter than low ones, as on a real string. Can be used as a drone, but give it some air, or it rings out after the first strike.",
  drone: true,
  params: {
    ring: {
      default: 0.6,
      min: 0,
      max: 1,
      doc: "How long the resonator rings: 0 is a short knock (about 0.15 s), 1 rings for up to 15 s on low notes. Live on a drone too.",
    },
    bright: {
      default: 0.6,
      min: 0,
      max: 1,
      doc: "Brightness of the noise that excites the resonator, from 0 (dark, woody) to 1 (bright, glassy). The level is made up so it changes tone, not loudness.",
    },
    air: {
      default: 0,
      min: 0,
      max: 1,
      doc: "Sustained noise fed into the resonator for as long as the note is held, like a bow or breath. 0 is only the initial strike; higher values keep the note sounding with a breathy edge.",
    },
    metal: {
      default: 0,
      min: 0,
      max: 1,
      doc: "Mix of the second resonator tuned to ratio times the note. 0 is a plain string, 1 is an even blend that sounds metallic or bell-like at non-whole ratios.",
    },
    ratio: {
      default: 2.76,
      min: 0.25,
      max: 8,
      doc: "Pitch of the second resonator as a multiple of the note (heard only with metal above 0). Whole numbers blend in as harmonics; the default 2.76 is the second mode of a struck bar. Try ratio=cosr(2, 1, 16) with metal=0.7.",
    },
  },
  udo: `
opcode Reso_dsp, aa, kkkkkkkk
  kamp, kfreq, kpan, kring, kbright, kair, kmetal, kratio xin
  kenv madsr 0.002, 0, 1, 0.5
  ; Exciter: a short noise strike at the note start, plus sustained noise (air).
  ; Its level is made up for the low-pass, so bright changes tone, not loudness.
  astrike expseg 1, 0.015, 0.001, 1, 0.001
  anz noise 1, 0
  kcut = min(kfreq * 2 ^ (1 + kbright * 5), 16000)
  aexc butterlp anz * (astrike + kair * 0.1), kcut
  aexc = aexc * sqrt(16000 / kcut)
  ; ring sets a decay time (0.15 to 15 s); the feedback is derived per period from
  ; it. streson's own damping still makes high notes ring shorter, like a real string.
  kt60 = 0.15 * 100 ^ kring
  kfb = min(0.001 ^ (1 / (kfreq * kt60)), 0.99995)
  a1 streson aexc, kfreq, kfb
  a2 streson aexc, min(kfreq * kratio, sr * 0.4), kfb
  ; Divided by 1 + metal: at ratio=1 both strings are in phase and would double.
  asig dcblock2 (a1 + kmetal * a2) / (1 + kmetal)
  asig = asig * kamp * kenv
  aL, aR pan2 asig, kpan
  xout aL, aR
endop
`,
  body: `
  aL, aR Reso_dsp p4, p5, p6, p13, p14, p15, p16, p17
  outs aL, aR
  revsend aL, aR, p7, p8, p9, p10, p11, p12
  `,
};
