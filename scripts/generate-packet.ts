/**
 * Generate the attorney-review packet for the FICTIONAL demo household:
 *   npm run packet            -> prints Markdown to stdout
 *   npm run packet -- out.md  -> writes to a file (keep real packets out of Git)
 */
import { writeFileSync } from "node:fs";
import { demoHousehold } from "../sample-data/demo-household.ts";
import { generateAttorneyPacket } from "../src/packet/attorneyPacket.ts";
import { ruleSetsFor } from "../rules/index.ts";

const md = generateAttorneyPacket(demoHousehold, ruleSetsFor(demoHousehold.plan.jurisdiction));
const out = process.argv[2];
if (out) {
  writeFileSync(out, md);
  console.error(`Wrote ${out}`);
} else {
  process.stdout.write(md + "\n");
}
