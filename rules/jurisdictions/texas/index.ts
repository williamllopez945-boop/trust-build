import type { JurisdictionRuleSet } from "../../../src/domain/rules.ts";
import { communityPropertyRules } from "./community-property.ts";
import { executionRules } from "./execution.ts";
import { homesteadRules } from "./homestead.ts";
import { pourOverWillRules } from "./pour-over-will.ts";
import { powersOfAttorneyRules } from "./powers-of-attorney.ts";
import { realPropertyRules } from "./real-property.ts";
import { retirementRules } from "./retirement.ts";
import { trustCreationRules } from "./trust-creation.ts";

export const texasRuleSet: JurisdictionRuleSet = {
  jurisdiction: "texas",
  displayName: "Texas",
  rules: [
    ...trustCreationRules,
    ...homesteadRules,
    ...communityPropertyRules,
    ...realPropertyRules,
    ...pourOverWillRules,
    ...powersOfAttorneyRules,
    ...executionRules,
    ...retirementRules,
  ],
};
