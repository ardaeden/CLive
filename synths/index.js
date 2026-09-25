// Collects every built-in synth into one SYNTHS object, in display order. The file
// names carry each synth's own instr number for at-a-glance browsing; that number is
// only a convenience label, not a source of truth -- the real one is each file's own
// `instr` field. registry.js checks those numbers (together with the drums') for
// collisions and for the ranges the engine derives other instruments from.
import { pluck } from "./101-pluck.js";
import { bass } from "./102-bass.js";
import { saw } from "./103-saw.js";
import { pad } from "./104-pad.js";
import { fmkeys } from "./105-fmkeys.js";
import { fmpad } from "./106-fmpad.js";
import { fmbass } from "./107-fmbass.js";
import { gendy } from "./108-gendy.js";
import { reso } from "./109-reso.js";
import { wood } from "./110-wood.js";

export const SYNTHS = { pluck, bass, saw, pad, fmkeys, fmpad, fmbass, gendy, reso, wood };
