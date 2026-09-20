import type { Rule } from "../rule.js";
import { nam001 } from "./nam/nam001.js";
import { nam002 } from "./nam/nam002.js";
import { nam003 } from "./nam/nam003.js";
import { nam004 } from "./nam/nam004.js";
import { nam005 } from "./nam/nam005.js";
import { sch001 } from "./sch/sch001.js";
import { sch003 } from "./sch/sch003.js";
import { sch005 } from "./sch/sch005.js";
import { sch006 } from "./sch/sch006.js";
import { sch007 } from "./sch/sch007.js";
import { sch008 } from "./sch/sch008.js";
import { sch021 } from "./sch/sch021.js";

/** The full static rule catalog implemented in this slice (§9.1, §9.3). */
// Intentionally not alphabetical/registration-ordered: this is what makes
// the runner's own sort step (§4.3 determinism) load-bearing rather than
// coincidentally satisfied by insertion order.
export const staticRules: Rule[] = [
  sch021,
  nam004,
  sch007,
  nam001,
  sch003,
  nam005,
  sch008,
  nam002,
  sch001,
  nam003,
  sch006,
  sch005,
];

export {
  nam001,
  nam002,
  nam003,
  nam004,
  nam005,
  sch001,
  sch003,
  sch005,
  sch006,
  sch007,
  sch008,
  sch021,
};
