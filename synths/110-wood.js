// Built-in synth: wood. See registry.js for the shared field contract (p3-p12) that
// every built-in synth's `body` follows.
export const wood = {
  instr: 110,
  doc: "Woodblock (modal synthesis): a mallet tap rings four tuned modes of a wooden bar plus a short, low knock from the hollow body. Plays the note's pitch cleanly, so it works for melodies as well as clave-like rhythms. It cannot be used as a drone, since it always decays to silence.",
  params: {
    decay: {
      default: 0.25,
      min: 0.03,
      max: 4,
      unit: "beats",
      doc: "How long the block rings, in beats. Real woodblocks are short (0.1 to 0.5); long values turn it into a marimba-like bar.",
    },
    hard: {
      default: 0.6,
      min: 0,
      max: 1,
      doc: "Mallet hardness: 0 is a soft, round tok, 1 a sharp, bright click that brings out the upper modes. The level is made up, so it changes tone, not loudness.",
    },
    hollow: {
      default: 0.3,
      min: 0,
      max: 1,
      doc: "Level of the hollow body's knock, a short resonance below the note. Higher values sound more like a temple block or a slit drum.",
    },
    bend: {
      default: 0,
      min: 0,
      max: 12,
      doc: "Pitch drop at the strike, in semitones: the note starts this much higher and falls to its pitch within about 150 ms. Small values (0.5 to 2) sound like a real block hit hard; large ones give an electronic 'bloop'.",
    },
  },
  body: `
  idecay = max(p13, 0.03)
  ihard = p14
  ihollow = p15
  ibend = p16
  p3 = idecay + 0.05
  ; Exciter: a short noise tap; a harder mallet is shorter and brighter. A shorter tap
  ; carries less energy, which is made up so hard and soft hits are equally loud.
  anz noise 1, 0
  itap = 0.0008 + 0.004 * (1 - ihard)
  aenvx expseg 1, itap, 0.0001, 1, 0.0001
  aexc butterlp anz * aenvx * sqrt(0.0048 / itap), min(p5 * (1.5 + 14 * ihard ^ 2), 18000)
  kbend expseg 1, 0.15, 0.001, 1, 0.001
  kf = p5 * 2 ^ (ibend * kbend / 12)
  ; Modes of a wooden bar at their frequency ratios. Q is set from the decay time
  ; (T60 = 6.91 * Q / (pi * f)); the higher modes die faster, as in real wood.
  inyq = sr * 0.45
  iq1 = $M_PI * p5 * idecay / 6.91
  a1 mode aexc, kf, iq1
  a2 mode aexc, min(kf * 2.777, inyq), max(iq1 / 2.777 ^ 0.8 * 2.777, 1)
  a3 mode aexc, min(kf * 5.18, inyq), max(iq1 / 5.18 ^ 0.8 * 5.18, 1)
  a4 mode aexc, min(kf * 7.107, inyq), max(iq1 / 7.107 ^ 0.8 * 7.107, 1)
  ; The hollow body: a lower, very short knock.
  ah mode aexc, p5 * 0.62, max($M_PI * p5 * 0.62 * 0.06 / 6.91, 1)
  asig = a1 + (a2 * 0.5 + a3 * 0.3 + a4 * 0.2) * (0.3 + 0.7 * ihard) + ah * ihollow * 0.8
  kenv linseg 1, p3 - 0.02, 1, 0.02, 0
  asig = asig * p4 * kenv * 0.75
  aL, aR pan2 asig, p6
  outs aL, aR
  revsend aL, aR, p7, p8, p9, p10, p11, p12
  `,
};
