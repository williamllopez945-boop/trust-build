/**
 * Jurisdiction registry. To add a state, create rules/jurisdictions/<state>/
 * exporting a JurisdictionRuleSet and register it here.
 */
import type { JurisdictionRuleSet } from "../src/domain/rules.ts";
import { commonRuleSet } from "./jurisdictions/common/index.ts";
import { texasRuleSet } from "./jurisdictions/texas/index.ts";

export const JURISDICTIONS: Record<string, JurisdictionRuleSet> = {
  texas: texasRuleSet,
};

export function ruleSetsFor(jurisdiction: string): JurisdictionRuleSet[] {
  const set = JURISDICTIONS[jurisdiction];
  return set ? [commonRuleSet, set] : [commonRuleSet];
}
