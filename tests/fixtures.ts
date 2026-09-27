import { demoHousehold } from "../sample-data/demo-household.ts";
import type { Household } from "../src/domain/types.ts";

/** Deep copy of the fictional demo household for mutation in tests. */
export function demo(): Household {
  return structuredClone(demoHousehold);
}
