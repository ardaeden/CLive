// Built-in synth: cloud. See registry.js for the shared field contract (p3-p12) that
// every built-in synth's `body` follows.
export const cloud = {
  instr: 111,
  doc: "Granular synthesis: a cloud of tiny overlapping grains, each a short windowed slice of a waveform at the note's pitch. Few, short grains crackle and flutter; many, long ones melt into a smooth, shimmering tone. Every parameter except attack and release keeps moving live on a drone, so cosr() and lineto() can open a cloud up slowly. Can be used as a drone. Grains are cheap one by one, but high density and size together on many voices at once (a dozen notes at density=200, size=300) is more than the audio thread can keep up with.",
  drone: true,
  // attack/release shape a player's note; a drone fades in and out on its own.
  droneExtras: ["density", "size", "spray", "detune", "wave", "width", "src", "position"],
  // The source waveforms (sine, triangle, saw, noise) and the grain window are shared
  // global tables; each voice morphs its own copy between the waveforms with ftmorf.
  // src= replaces them with a sample file's table (see engine.js's sample()).
  udo: `
giCloudSine ftgen 0, 0, 2048, 10, 1
giCloudTri ftgen 0, 0, 2048, 10, 1, 0, 1/9, 0, 1/25, 0, 1/49, 0, 1/81
giCloudSaw ftgen 0, 0, 2048, 10, 1, 1/2, 1/3, 1/4, 1/5, 1/6, 1/7, 1/8, 1/9, 1/10, 1/11, 1/12, 1/13, 1/14, 1/15, 1/16
giCloudNoise ftgen 0, 0, 2048, 21, 1
giCloudWaves ftgen 0, 0, 4, -2, giCloudSine, giCloudTri, giCloudSaw, giCloudNoise
; Makeup gain per waveform (all are normalized to the same peak, not the same loudness).
giCloudLevel ftgen 0, 0, 4, -2, 1.15, 1, 1.6, 1
giCloudWin ftgen 0, 0, 2048, 20, 2

; Two grain streams. grain3 adds kphs to the phase of every sounding grain, not only to
; where a new one starts, and both modes are built around that:
; - Waveform (kmode 0): the grains' own frequency is 0 and kphs is one running phasor
;   at the note's pitch, so all grains read the same continuous oscillator. Letting each
;   run at the note's frequency from its own start phase instead locks the pitch to a
;   multiple of the grain rate (440 Hz at 30 grains/s sounds as 450).
; - Sample (kmode 1): kphs is the position in the file, and the grains run at the
;   playback rate minus the speed the position moves at, so scanning through the file
;   (position=lineto(...)) does not also change the pitch. The position is glided
;   linearly between updates to keep that speed steady.
; kfmd still detunes each grain. The phase must be exact to the sample, so this part
; alone runs with ksmps 1.
opcode Cloud_grains, aa, kkkkkkkki
  kmode, kcps, kpos, kfmd, kpmd, kgdur, kdens, kfn, iseed xin
  setksmps 1
  kph phasor kcps
  kpos2 lineto kpos, 0.02
  kprev init i(kpos)
  kspeed = (kpos2 - kprev) * sr
  kprev = kpos2
  kgcps = (kmode == 0 ? 0 : kcps - kspeed)
  kphs = (kmode == 0 ? kph : kpos2)
  a1 grain3 kgcps, kphs, kfmd, kpmd, kgdur, kdens, 64, kfn, giCloudWin, 0, 0, iseed
  a2 grain3 kgcps, kphs, kfmd, kpmd, kgdur, kdens, 64, kfn, giCloudWin, 0, 0, iseed + 7919
  xout a1, a2
endop

opcode Cloud_dsp, aa, kkkkkkkkkkk
  kamp, kfreq, kpan, kdens, ksize, kspray, kdetune, kwave, kwidth, ksrc, kpos xin
  ; A short fade of its own, so a drone starts and stops (kill) without a click.
  kenv madsr 0.02, 0, 1, 0.3
  iwave ftgentmp 0, 0, 2048, 10, 1
  kwv = limit(kwave, 0, 2.999)
  ftmorf kwv, giCloudWaves, iwave
  kgdur = limit(ksize, 5, 300) / 1000
  kd = limit(kdens, 1, 200)
  kmode = (ksrc > 0 ? 1 : 0)
  if kmode == 0 then
    kfn = iwave
    kcps = kfreq
    kpmd = kspray
    kwgain tablei kwv, giCloudLevel
  else
    ; A file plays at its own pitch on middle C (degree 0, oct 5, root 0). spray
    ; scatters grains up to half a second around the position.
    kfn = ksrc
    klen tableng kfn
    kcps = (kfreq / 261.6256) * sr / klen
    kpmd = kspray * min(1, 0.5 * sr / klen)
    kwgain = 1
  endif
  ; Two independent streams of half the density each, one per side: width blends
  ; them from mono (0) to fully decorrelated stereo (1).
  kjit random -1, 1
  kdhalf = kd * 0.5 * (1 + 0.6 * kspray * kjit)
  kfmd = kcps * 0.5 * kdetune
  ; Overlapping grains add up, so the level follows 1/sqrt(overlap) to stay steady
  ; whatever density and size do.
  kgain = kamp * kenv * kwgain / sqrt(max(1, kd * kgdur))
  iseed = 1 + int(abs(frac(times:i() * 7.31 + i(kfreq) * 0.0137)) * 1000000)
  a1, a2 Cloud_grains kmode, kcps, limit(kpos, 0, 1), kfmd, kpmd, kgdur, kdhalf, kfn, iseed
  kw = limit(kwidth, 0, 1)
  ; Mixing the two streams together (low width) loses about 3 dB; make it up.
  kg = kgain * (1 + 0.414 * (1 - kw))
  aL = (a1 * (1 + kw) + a2 * (1 - kw)) * 0.5 * kg
  aR = (a2 * (1 + kw) + a1 * (1 - kw)) * 0.5 * kg
  ; Equal-power pan, the same law (and centre level) as pan2 in the other synths.
  kp = limit(kpan, 0, 1) * 1.5707963
  xout aL * cos(kp), aR * sin(kp)
endop
`,
  params: {
    density: {
      default: 40,
      min: 1,
      max: 200,
      doc: "Grains per second. Below about 15 you hear separate grains flutter; higher values fuse into a continuous tone.",
    },
    size: {
      default: 80,
      min: 5,
      max: 300,
      doc: "Length of each grain in milliseconds. Short grains crackle and blur the pitch; long ones sound smooth and tonal.",
    },
    spray: {
      default: 0.3,
      min: 0,
      max: 1,
      doc: "Randomness of where each grain starts in the waveform and of when it starts. 0 is an even, steady stream; higher values sound rougher and more restless.",
    },
    detune: {
      default: 0.1,
      min: 0,
      max: 1,
      doc: "Random pitch of each grain around the note. 0 plays the note cleanly, small values (0.05 to 0.2) give a chorus-like shimmer, 1 scatters grains up to half the note's frequency either way.",
    },
    wave: {
      default: 1,
      min: 0,
      max: 3,
      doc: "Waveform inside the grains: 0 sine, 1 triangle, 2 saw, 3 noise. Values in between blend the two neighbours, so wave=cosr(1.5, 1.5, 32) slowly sweeps through all of them.",
    },
    width: {
      default: 0.7,
      min: 0,
      max: 1,
      doc: "Stereo spread of the grains: 0 is mono (still placed by pan), 1 sends a different stream of grains to each side.",
    },
    attack: {
      default: 0.5,
      min: 0.01,
      max: 16,
      unit: "beats",
      doc: "Fade-in time of a player's note, in beats. A drone always fades in quickly on its own.",
    },
    release: {
      default: 1,
      min: 0.01,
      max: 32,
      unit: "beats",
      doc: "Fade-out time after a player's note ends, in beats.",
    },
    src: {
      default: "",
      kind: "sample",
      shown: "none",
      doc: "A sound file to take the grains from instead of the waveforms, e.g. src=\"choir.wav\": WAV, MP3, OGG or FLAC, put in the samples folder (subfolders work: src=\"voices/choir.wav\"). It is loaded the first time it is used; the console says when it is ready, and the cloud stays silent until then. The file plays at its own pitch on middle C (degree 0, oct 5, root 0), and wave no longer applies. A list, src=[\"a.wav\", \"b.wav\"], changes file step by step on a player.",
    },
    // kind "position": scaled to the part of the table the file fills, for the src
    // chosen on the same step, so it has to come after src.
    position: {
      default: 0,
      min: 0,
      max: 1,
      kind: "position",
      doc: "Where in the src file the grains come from, from 0 (the start) to 1 (the end). Hold it still to freeze a moment of the sound; on a drone, position=lineto(0, 1, 60) stretches the whole file over a minute without changing its pitch. spray scatters grains up to half a second around it.",
    },
  },
  body: `
  kenv madsr max(p19, 0.005), 0, 1, max(p20, 0.01)
  aL, aR Cloud_dsp p4 * kenv, p5, p6, p13, p14, p15, p16, p17, p18, p21, p22
  outs aL, aR
  revsend aL, aR, p7, p8, p9, p10, p11, p12
  `,
};
