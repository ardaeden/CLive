// Collects every built-in synth into one SYNTHS object, in display order. The file
// names carry each synth's own instr number for at-a-glance browsing; that number is
// only a convenience label, not a source of truth -- the real one is each file's own
// `instr` field, and the check below is what actually guards against two synths
// silently sharing (and colliding on) the same Csound instrument number.
import { pluck } from "./101-pluck.js";
import { bass } from "./102-bass.js";
import { saw } from "./103-saw.js";
import { pad } from "./104-pad.js";
import { fmkeys } from "./105-fmkeys.js";
import { fmpad } from "./106-fmpad.js";
import { fmbass } from "./107-fmbass.js";
import { gendy } from "./108-gendy.js";

export const SYNTHS = { pluck, bass, saw, pad, fmkeys, fmpad, fmbass, gendy };

const byInstr = new Map();
for (const [name, s] of Object.entries(SYNTHS)) {
  const clash = byInstr.get(s.instr);
  if (clash) throw new Error(`SYNTHS: '${name}' and '${clash}' both use instr ${s.instr}`);
  byInstr.set(s.instr, name);
}
