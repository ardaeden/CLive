# samples

Put sound files here (WAV, MP3, OGG or FLAC) to use them with `cloud`'s `src=`
parameter, e.g. `g1: cloud(0, src="choir.wav")`. Subfolders work too:
`src="voices/choir.wav"`.

Files are loaded as mono and cut to `LIMITS.maxSampleSeconds` (see the Limits help page).
