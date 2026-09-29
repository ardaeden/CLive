// An 808-style kit: play("...", kit="808"). Every voice is synthesized the way the
// original machine builds it (tuned resonators, a bank of six square waves for the
// metal sounds, bursts of noise for the clap), not played from recordings. decay, tune
// and tone arrive as p13, p14 and p15, like the classic kit; tone is each voice's own
// main knob (see its doc).
export const tr808 = {
  x: {
    name: "808 kick",
    instr: 211,
    doc: "The long, deep boom: a sine that drops quickly from a high pitch to about 49 Hz and rings out. tone adds the click at the start.",
    body: `
  idec = 0.8 * p13
  ifreq = 49 * 2 ^ (p14 / 12)
  p3 = idec + 0.05
  kf expseg ifreq * 3, 0.015, ifreq * 1.5, 0.05, ifreq, idec, ifreq * 0.9
  aenv expseg 1, idec, 0.0005
  abody poscil3 aenv, kf
  aclk expseg 1, 0.006, 0.001
  anz noise 1, 0
  anz butterlp anz, 1000 + 8000 * p15
  asig = tanh((abody + anz * aclk * p15) * 1.5) * p4 * 1.8
  aL, aR pan2 asig, p6
  outs aL, aR
  revsend aL, aR, p7, p8, p9, p10, p11, p12
  `,
  },
  o: {
    name: "808 snare",
    instr: 212,
    doc: "Two tuned drum heads (180 and 330 Hz) and a burst of noise. tone is the snappy knob: more noise, less drum.",
    body: `
  idec = 0.18 * p13
  itune = 2 ^ (p14 / 12)
  p3 = idec * 1.6 + 0.02
  a1 poscil3 0.6, 180 * itune
  a2 poscil3 0.4, 330 * itune
  aenvt expseg 1, idec * 0.8, 0.001
  anz noise 1, 0
  anz butterhp anz, 1800
  anz butterlp anz, 10000
  aenvn expseg 1, idec * 1.6, 0.001
  asig = ((a1 + a2) * aenvt * (1.2 - p15) + anz * aenvn * (0.3 + 1.4 * p15)) * p4
  aL, aR pan2 asig, p6
  outs aL, aR
  revsend aL, aR, p7, p8, p9, p10, p11, p12
  `,
  },
  "*": {
    name: "808 clap",
    instr: 213,
    doc: "Three quick slaps of band-passed noise 10 ms apart, then a short reverberant tail. tone moves the noise band up or down.",
    body: `
  idec = 0.25 * p13
  p3 = 0.03 + idec + 0.02
  aslap linseg 0, 0.0005, 1, 0.0095, 0.1, 0.0005, 1, 0.0095, 0.1, 0.0005, 1, 0.0095, 0.1, 0.0005, 1, 1, 1
  atail expseg 1, 0.0295, 1, idec, 0.001
  anz noise 1, 0
  anz butterbp anz, min(1000 * 2 ^ (p14 / 12) * (0.7 + 0.6 * p15), 15000), 700
  asig = anz * aslap * atail * p4 * 4
  aL, aR pan2 asig, p6
  outs aL, aR
  revsend aL, aR, p7, p8, p9, p10, p11, p12
  `,
  },
  "-": {
    name: "808 closed hat",
    instr: 214,
    doc: "The metallic tick: six square waves at clashing frequencies, high-passed, very short. tone brightens it.",
    // The six-oscillator metal bank, shared by both hats and the cymbal.
    udo: `
opcode Tr808_metal, a, i
  itune xin
  a1 vco2 1, 205.3 * itune, 10
  a2 vco2 1, 304.4 * itune, 10
  a3 vco2 1, 369.6 * itune, 10
  a4 vco2 1, 522.7 * itune, 10
  a5 vco2 1, 540 * itune, 10
  a6 vco2 1, 800 * itune, 10
  xout (a1 + a2 + a3 + a4 + a5 + a6) / 6
endop
`,
    body: `
  idec = 0.045 * p13
  p3 = idec + 0.02
  am Tr808_metal 2 ^ (p14 / 12)
  am butterbp am, 7500, 5000
  am butterhp am, min(6000 + 4000 * p15, 16000)
  aenv expseg 1, idec, 0.001
  asig = am * aenv * p4 * 12
  aL, aR pan2 asig, p6
  outs aL, aR
  revsend aL, aR, p7, p8, p9, p10, p11, p12
  `,
  },
  "=": {
    name: "808 open hat",
    instr: 215,
    doc: "The same metal as the closed hat, ringing longer. tone brightens it.",
    body: `
  idec = 0.35 * p13
  p3 = idec + 0.02
  am Tr808_metal 2 ^ (p14 / 12)
  am butterbp am, 7500, 5000
  am butterhp am, min(5500 + 4000 * p15, 16000)
  aenv expseg 1, idec, 0.001
  asig = am * aenv * p4 * 10
  aL, aR pan2 asig, p6
  outs aL, aR
  revsend aL, aR, p7, p8, p9, p10, p11, p12
  `,
  },
  "~": {
    name: "808 cymbal",
    instr: 216,
    doc: "The metal bank with a lower band mixed in, ringing for over a second. tone brightens it.",
    body: `
  idec = 1.2 * p13
  p3 = idec + 0.02
  am Tr808_metal 2 ^ (p14 / 12)
  alo butterbp am, 3440, 1500
  ahi butterhp am, min(4000 + 4000 * p15, 16000)
  aenv expseg 1, idec, 0.001
  asig = (alo * 0.6 + ahi) * aenv * p4 * 3
  aL, aR pan2 asig, p6
  outs aL, aR
  revsend aL, aR, p7, p8, p9, p10, p11, p12
  `,
  },
  c: {
    name: "808 cowbell",
    instr: 217,
    doc: "Two square waves (540 and 800 Hz) through a band-pass, with a fast drop and a short ring. tone brightens it.",
    body: `
  itune = 2 ^ (p14 / 12)
  idec = 0.3 * p13
  p3 = idec + 0.05
  a1 vco2 0.5, 540 * itune, 10
  a2 vco2 0.5, 800 * itune, 10
  as butterbp a1 + a2, 850 * itune, 700
  as butterlp as, 2000 + 6000 * p15
  aenv expseg 1, 0.015, 0.4, idec, 0.001
  asig = as * aenv * p4 * 1.4
  aL, aR pan2 asig, p6
  outs aL, aR
  revsend aL, aR, p7, p8, p9, p10, p11, p12
  `,
  },
  l: {
    name: "808 low tom",
    instr: 218,
    doc: "A tuned drum head at 85 Hz with a slight pitch drop. tone adds a soft noise hit at the start.",
    // A tom: a sine that settles down onto its pitch, plus a little noise at the attack.
    udo: `
opcode Tr808_tom, a, iii
  ifreq, idec, itone xin
  kf expseg ifreq * 1.3, 0.06, ifreq, idec, ifreq * 0.94
  aenv expseg 1, idec, 0.001
  abody poscil3 aenv, kf
  anz noise 1, 0
  anz butterlp anz, 2500
  anz = anz * expseg:a(1, 0.02, 0.001) * itone * 0.5
  xout abody + anz
endop
`,
    body: `
  idec = 0.45 * p13
  p3 = idec + 0.05
  asig Tr808_tom 85 * 2 ^ (p14 / 12), idec, p15
  asig *= p4 * 1.2
  aL, aR pan2 asig, p6
  outs aL, aR
  revsend aL, aR, p7, p8, p9, p10, p11, p12
  `,
  },
  m: {
    name: "808 mid tom",
    instr: 219,
    doc: "Like the low tom, at 125 Hz and a little shorter.",
    body: `
  idec = 0.35 * p13
  p3 = idec + 0.05
  asig Tr808_tom 125 * 2 ^ (p14 / 12), idec, p15
  asig *= p4 * 1.2
  aL, aR pan2 asig, p6
  outs aL, aR
  revsend aL, aR, p7, p8, p9, p10, p11, p12
  `,
  },
  h: {
    name: "808 high tom",
    instr: 220,
    doc: "Like the low tom, at 180 Hz and shorter still.",
    body: `
  idec = 0.28 * p13
  p3 = idec + 0.05
  asig Tr808_tom 180 * 2 ^ (p14 / 12), idec, p15
  asig *= p4 * 1.2
  aL, aR pan2 asig, p6
  outs aL, aR
  revsend aL, aR, p7, p8, p9, p10, p11, p12
  `,
  },
  k: {
    name: "808 rimshot",
    instr: 221,
    doc: "A very short, hard click from two resonances (480 and 1750 Hz), slightly overdriven. tone adds bite.",
    body: `
  itune = 2 ^ (p14 / 12)
  idec = 0.025 * p13
  p3 = idec * 4 + 0.02
  aenv expseg 1, idec, 0.001
  a1 poscil3 1, 480 * itune
  a2 poscil3 1, 1750 * itune
  asig = tanh((a1 * 0.5 + a2) * aenv * (1.5 + 2 * p15))
  asig butterhp asig, 300
  asig *= p4
  aL, aR pan2 asig, p6
  outs aL, aR
  revsend aL, aR, p7, p8, p9, p10, p11, p12
  `,
  },
  v: {
    name: "808 claves",
    instr: 222,
    doc: "A short, pure wooden tick at 2500 Hz. tone is ignored.",
    body: `
  idec = 0.06 * p13
  p3 = idec * 3 + 0.02
  aenv expseg 1, idec, 0.001
  asig poscil3 aenv, 2500 * 2 ^ (p14 / 12)
  asig *= p4
  aL, aR pan2 asig, p6
  outs aL, aR
  revsend aL, aR, p7, p8, p9, p10, p11, p12
  `,
  },
  s: {
    name: "808 maracas",
    instr: 223,
    doc: "A quick shake of high-passed noise. tone brightens it, and tune moves it up or down.",
    body: `
  idec = 0.04 * p13
  p3 = idec * 3 + 0.02
  aenv expseg 0.001, 0.004, 1, idec, 0.001
  anz noise 1, 0
  anz butterhp anz, min((5000 + 5000 * p15) * 2 ^ (p14 / 12), 16000)
  asig = anz * aenv * p4 * 1.5
  aL, aR pan2 asig, p6
  outs aL, aR
  revsend aL, aR, p7, p8, p9, p10, p11, p12
  `,
  },
};
