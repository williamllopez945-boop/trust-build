/**
 * Jurisdiction-pluggable review-rule engine.
 *
 * Rules inspect a Household and emit review flags. A flag says "a
 * professional should look at this"; it never says what the law requires
 * or whether something is valid. The engine enforces that wording.
 */
import type { Household } from "./types.ts";

export type FlagSeverity = "info" | "review" | "attorney_required";

export interface ReviewFlag {
  ruleId: string;
  jurisdiction: string;
  module: string;
  severity: FlagSeverity;
  reviewer: "attorney" | "cpa" | "attorney_or_cpa" | "family";
  title: string;
  /** Why this was flagged, phrased as a question or item to review. */
  detail: string;
  subjectIds: string[];
  /** Pointers for the professional to verify; not authority for a conclusion. */
  references?: string[];
  /** Copied from the rule so every flag shows whether its rule is attorney-verified. */
  ruleVerified?: boolean;
  ruleLastReviewed?: string;
}

/**
 * Provenance for a rule. Every rule starts as a draft written from general
 * planning knowledge; `attorneyVerified` flips only after a licensed attorney
 * reviews the rule's trigger and wording (record who and when in `verifiedBy`).
 */
export interface RuleMeta {
  /** Sources for the professional to verify; never authority for a conclusion. */
  references: string[];
  /** Date the rule logic took effect in FamilyVault (YYYY-MM-DD). */
  effectiveDate: string;
  /** Date the rule was last reviewed against current law/practice. */
  lastReviewed: string;
  attorneyVerified: boolean;
  verifiedBy?: string;
}

export const RULES_VERSION = "2026.09.1";

/** Metadata for a rule that has NOT been verified by an attorney. */
export function draftMeta(references: string[], dates: { effectiveDate?: string; lastReviewed?: string } = {}): RuleMeta {
  return {
    references,
    effectiveDate: dates.effectiveDate ?? "2026-09-27",
    lastReviewed: dates.lastReviewed ?? "2026-09-27",
    attorneyVerified: false,
  };
}

export interface Rule {
  id: string;
  module: string;
  description: string;
  meta: RuleMeta;
  evaluate(h: Household): Omit<ReviewFlag, "ruleId" | "jurisdiction" | "module">[];
}

export interface JurisdictionRuleSet {
  jurisdiction: string;
  displayName: string;
  rules: Rule[];
}

export const REFERENCE_CAVEAT = "References are starting points for professional review; verify current law.";

/**
 * Phrases that would turn a review flag into a legal conclusion or
 * reassurance. Rule text containing any of these is rejected.
 */
const CONCLUSORY = [
  /\bis (legally )?(valid|invalid|enforceable|unenforceable)\b/i,
  /\b(is|are) (legal|illegal|compliant|non-?compliant)\b/i,
  /\bcomplies with\b/i,
  /\bguarantee[sd]?\b/i,
  /\byou are (protected|covered|safe)\b/i,
  /\bno need to (consult|review|see)\b/i,
  /\bthis (satisfies|meets) (the )?(law|statute|requirement)/i,
  /\bwill avoid (probate|tax)/i,
];

export class ConclusoryFlagError extends Error {}

export function assertNonConclusory(text: string, ruleId: string): void {
  for (const re of CONCLUSORY) {
    if (re.test(text)) {
      throw new ConclusoryFlagError(`Rule ${ruleId} produced conclusory language (${re}): "${text}"`);
    }
  }
}

export function runRules(h: Household, sets: readonly JurisdictionRuleSet[]): ReviewFlag[] {
  const flags: ReviewFlag[] = [];
  for (const set of sets) {
    for (const rule of set.rules) {
      for (const f of rule.evaluate(h)) {
        const flag: ReviewFlag = {
          ...f,
          references: f.references ?? (rule.meta.references.length ? rule.meta.references : undefined),
          ruleId: rule.id,
          jurisdiction: set.jurisdiction,
          module: rule.module,
          ruleVerified: rule.meta.attorneyVerified,
          ruleLastReviewed: rule.meta.lastReviewed,
        };
        assertNonConclusory(`${flag.title} ${flag.detail}`, rule.id);
        flags.push(flag);
      }
    }
  }
  const rank: Record<FlagSeverity, number> = { attorney_required: 0, review: 1, info: 2 };
  return flags.sort((a, b) => rank[a.severity] - rank[b.severity] || a.ruleId.localeCompare(b.ruleId));
}
