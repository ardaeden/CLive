# CLive

A browser-based live-coding environment for [Csound](https://csound.com/), built as a
no-build static web app. Csound itself runs entirely client-side via WebAssembly
(`@csound/browser`, bundled locally in `lib/`) -- no native Csound install, no Node,
no server-side audio processing.

On top of plain Csound orchestra/score code, CLive adds a small player language for
live coding: named, re-evaluable voices (`p1: pluck([0, 2, 4], dur=1/2)`), drones,
mixing buses, reverb sends, and beat-locked scheduling so redefining something never
breaks the groove.

## Running it

Requires Python 3 (for the static file server) and a modern browser (Chrome/Edge/Firefox).

```
python server.py
```

or, on Windows, just double-click `start.bat`. Then open <http://127.0.0.1:8000>.

The server sets the `Cross-Origin-Opener-Policy`/`Cross-Origin-Embedder-Policy`
headers Csound's WASM build needs for `SharedArrayBuffer`; opening `index.html`
directly as a `file://` URL will not work.

## Learning the language

Press **Start**, then `Ctrl+Enter` on the example in the editor. The **Help** link
opens a full reference (functions, synths, drum voices, commands, limits) generated
live from `registry.js` -- the single source of truth every part of the app reads
from, so the docs can never go stale.

## Project layout

- `registry.js` -- every synth, drum voice, scale, player parameter, command,
  function and help-page paragraph, in one place.
- `synths/` -- one file per built-in synth (its Csound DSP, parameters and docs).
- `engine.js` -- the master clock, Csound orchestra generation, and the
  bar-quantized launcher that schedules notes ahead of time.
- `fox.js` -- the player language: tokenizer, parser and beat-locked scheduler.
- `app.js` -- the editor UI (tabs, syntax highlighting, shortcuts, oscilloscope).
- `docs/` -- the help pages; each is a thin HTML shell rendered by `docs/help.js`
  from `registry.js`.
- `highlight.js` -- shared syntax highlighter for the editor and the help pages.
