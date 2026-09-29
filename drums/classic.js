// The classic kit: play("...") without kit=. The key is the character in the pattern.
// Drum voices share the synths' field contract (see registry.js), and get play()'s
// decay, tune and tone as p13, p14 and p15. At their defaults (1, 0, 0.5) every time,
// pitch and filter below comes out at its original value.
export const classic = {
  x: {
    name: "kick",
    instr: 201,
    doc: "Sine sweep from 150 Hz down to 40 Hz. tone is ignored.",
    body: `
  idec = 0.5 * p13
  itune = 2 ^ (p14 / 12)
  p3 = idec + 0.1
  kfreq expseg 150 * itune, 0.05, 55 * itune, idec, 40 * itune
  aenv expseg 1, idec, 0.001
  asig oscili p4 * aenv, kfreq
  aL, aR pan2 asig * 1.5, p6
  outs aL, aR
  revsend aL, aR, p7, p8, p9, p10, p11, p12
  `,
  },
  o: {
    name: "snare",
    instr: 202,
    doc: "High-passed noise plus a short 185 Hz body. tone moves the noise brighter or darker.",
    body: `
  itune = 2 ^ (p14 / 12)
  p3 = 0.1 + 0.25 * p13
  aenv expseg 1, 0.25 * p13, 0.001
  abenv expseg 1, 0.1 * p13, 0.001
  anz noise 1, 0
  anz butterhp anz, min(1200 * itune * 2 ^ ((p15 - 0.5) * 2), 16000)
  abody oscili 1, 185 * itune
  asig = (anz * 0.7 * aenv + abody * 0.5 * abenv) * p4
  aL, aR pan2 asig, p6
  outs aL, aR
  revsend aL, aR, p7, p8, p9, p10, p11, p12
  `,
  },
  "-": {
    name: "closed hat",
    instr: 203,
    doc: "Short high-passed noise burst. tone moves it brighter or darker.",
    body: `
  p3 = 0.04 + 0.06 * p13
  aenv expseg 1, 0.06 * p13, 0.001
  anz noise 1, 0
  anz butterhp anz, min(7000 * 2 ^ (p14 / 12) * 2 ^ ((p15 - 0.5) * 2), 16000)
  aL, aR pan2 anz * aenv * p4 * 1.8, p6
  outs aL, aR
  revsend aL, aR, p7, p8, p9, p10, p11, p12
  `,
  },
  "=": {
    name: "open hat",
    instr: 204,
    doc: "Longer high-passed noise burst. tone moves it brighter or darker.",
    body: `
  p3 = 0.1 + 0.4 * p13
  aenv expseg 1, 0.4 * p13, 0.001
  anz noise 1, 0
  anz butterhp anz, min(6500 * 2 ^ (p14 / 12) * 2 ^ ((p15 - 0.5) * 2), 16000)
  aL, aR pan2 anz * aenv * p4 * 1.5, p6
  outs aL, aR
  revsend aL, aR, p7, p8, p9, p10, p11, p12
  `,
  },
  "*": {
    name: "clap",
    instr: 205,
    doc: "Band-passed noise burst. tone moves it brighter or darker.",
    body: `
  p3 = 0.05 + 0.25 * p13
  aenv expseg 1, 0.25 * p13, 0.001
  anz noise 1, 0
  ibright = 2 ^ ((p15 - 0.5) * 2)
  anz butterbp anz, min(1200 * 2 ^ (p14 / 12) * ibright, 16000), 600 * ibright
  ; a narrow bandpass on white noise throws away most of its energy, so this needs
  ; a much bigger makeup gain than the other drums to sit at a comparable level.
  aL, aR pan2 anz * aenv * p4 * 4.5, p6
  outs aL, aR
  revsend aL, aR, p7, p8, p9, p10, p11, p12
  `,
  },
};
