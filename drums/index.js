// Collects the drum kits play() can use, by the name given to kit= (the default is set
// in registry.js's DRUM_PARAMS). Like synths/, each kit lives in its own file.
import { classic } from "./classic.js";
import { tr808 } from "./tr808.js";

export const DRUM_KITS = { classic, 808: tr808 };
