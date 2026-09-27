/** Jurisdiction-neutral planning checks that apply everywhere. */
import { draftMeta, type JurisdictionRuleSet, type Rule } from "../../../src/domain/rules.ts";
import { fiduciariesFor, minors } from "../../../src/domain/estateGraph.ts";
import { controlFor } from "../../../src/domain/types.ts";
import { lastCompletedReview } from "../../../src/domain/annualReview.ts";

const rules: Rule[] = [
  {
    id: "common.successor_trustee",
    module: "fiduciaries",
    description: "At least one successor trustee.",
    meta: draftMeta(["General estate-planning practice (no specific statute)"]),
    evaluate(h) {
      if (fiduciariesFor(h, "successor_trustee").length > 0) return [];
      return [{ severity: "review", reviewer: "family", title: "No successor trustee named", detail: "Decide (with explicit confirmation) who would manage the trust if the initial trustee cannot.", subjectIds: [] }];
    },
  },
  {
    id: "common.guardians_for_minors",
    module: "fiduciaries",
    description: "Guardian and alternate for each minor.",
    meta: draftMeta(["General estate-planning practice (no specific statute)"]),
    evaluate(h) {
      return minors(h)
        .filter((m) => h.fiduciaries.filter((f) => f.role === "guardian_of_person" && (f.forPersonIds ?? []).includes(m.id)).length < 2)
        .map((m) => ({ severity: "review" as const, reviewer: "family" as const, title: `Guardian or alternate missing for ${m.displayName}`, detail: "Name a guardian and at least one alternate; the attorney will advise which document records the choice.", subjectIds: [m.id] }));
    },
  },
  {
    id: "common.distribution_shares",
    module: "beneficiaries",
    description: "Primary trust distribution shares total 100%.",
    meta: draftMeta(["General estate-planning practice (no specific statute)"]),
    evaluate(h) {
      const primaries = h.plan.distributions.filter((d) => d.tier === "primary");
      if (primaries.length === 0) {
        return [{ severity: "review", reviewer: "family", title: "No trust beneficiaries recorded", detail: "Record who benefits from the trust. FamilyVault never suggests beneficiaries.", subjectIds: [] }];
      }
      if (primaries.some((d) => d.sharePercent.value === null)) {
        return [{ severity: "review", reviewer: "family", title: "Beneficiary share not recorded", detail: "One or more primary trust shares are blank.", subjectIds: primaries.map((d) => d.beneficiaryId) }];
      }
      const sum = primaries.reduce((s, d) => s + (d.sharePercent.value ?? 0), 0);
      return sum === 100 ? [] : [{ severity: "review", reviewer: "family", title: `Primary trust shares total ${sum}%`, detail: "Review the primary shares; they appear not to total 100%.", subjectIds: primaries.map((d) => d.beneficiaryId) }];
    },
  },
  {
    id: "common.unconfirmed_sensitive",
    module: "decisions",
    description: "Distribution and fiduciary entries without a confirmed decision.",
    meta: draftMeta(["General estate-planning practice (no specific statute)"]),
    evaluate(h) {
      const confirmed = new Set(h.decisions.filter((d) => d.state === "confirmed" || d.state === "professionally_reviewed").map((d) => d.id));
      const pending = [
        ...h.plan.distributions.filter((d) => !d.decisionId || !confirmed.has(d.decisionId)).map((d) => d.beneficiaryId),
        ...h.fiduciaries.filter((f) => !f.decisionId || !confirmed.has(f.decisionId)).map((f) => f.personId),
      ];
      if (pending.length === 0) return [];
      return [{ severity: "review", reviewer: "family", title: `${pending.length} beneficiary/fiduciary ${pending.length === 1 ? "choice" : "choices"} not explicitly confirmed`, detail: "Each dispositive or fiduciary choice needs an explicit read-back confirmation before it goes to the attorney as settled.", subjectIds: [...new Set(pending)] }];
    },
  },
  {
    id: "common.pending_conflicts",
    module: "decisions",
    description: "Proposed changes that conflict with confirmed facts.",
    meta: draftMeta(["General estate-planning practice (no specific statute)"]),
    evaluate(h) {
      const conflicts = (h.pendingChanges ?? []).filter((c) => c.conflicts.length > 0);
      return conflicts.map((c) => ({
        severity: "review" as const,
        reviewer: "family" as const,
        title: `Conflicting information: ${c.label}`,
        detail: "A new answer differs from information previously confirmed. Decide whether to keep the confirmed value or replace it; discuss with the attorney if unsure.",
        subjectIds: [c.entityId],
      }));
    },
  },
  {
    id: "common.digital_assets",
    module: "funding",
    description: "Digital asset instructions.",
    meta: draftMeta(["General estate-planning practice (no specific statute)"]),
    evaluate(h) {
      const digital = h.assets.filter((a) => a.category === "digital");
      if (h.plan.digitalAssetInstructions.status === "confirmed" && digital.every((a) => a.funding.state !== "instructions_missing")) return [];
      return [{ severity: "review", reviewer: "attorney", title: "Digital asset instructions missing", detail: "Document where access instructions are kept (never the passwords themselves) and ask the attorney about fiduciary access authority.", subjectIds: digital.map((a) => a.id) }];
    },
  },
  {
    id: "common.unfunded_assets",
    module: "funding",
    description: "Ownership-controlled assets not yet funded.",
    meta: draftMeta(["General estate-planning practice (no specific statute)"]),
    evaluate(h) {
      const open = h.assets.filter((a) => controlFor(a.category) === "ownership" && ["not_started", "in_progress", "review"].includes(a.funding.state));
      return open.length ? [{ severity: "info", reviewer: "family", title: `${open.length} asset(s) not yet funded or decided`, detail: "An unfunded asset stays outside the trust. See the funding tracker.", subjectIds: open.map((a) => a.id) }] : [];
    },
  },
  {
    id: "common.review_life_events",
    module: "maintenance",
    description: "Life events reported in the most recent annual review.",
    meta: draftMeta(["General estate-planning practice (no specific statute)"]),
    evaluate(h) {
      const r = lastCompletedReview(h);
      if (!r) return [];
      return r.lifeEvents.filter((e) => e.answer).map((e) => ({
        severity: "attorney_required" as const,
        reviewer: "attorney" as const,
        title: `Life event reported: ${e.question.replace(/\?$/, "")}`,
        detail: `Reported in the annual review on ${r.completedAt!.slice(0, 10)}${e.note ? ` ("${e.note}")` : ""}. Ask the attorney whether the plan, beneficiary designations, or fiduciaries should be updated.`,
        subjectIds: [],
      }));
    },
  },
  {
    id: "common.review_followups",
    module: "maintenance",
    description: "Checklist items marked as needing attention in the most recent annual review.",
    meta: draftMeta(["General estate-planning practice (no specific statute)"]),
    evaluate(h) {
      const r = lastCompletedReview(h);
      if (!r) return [];
      return r.items.filter((i) => i.status === "needs_attention").map((i) => ({
        severity: "review" as const,
        reviewer: "family" as const,
        title: `Annual review follow-up: ${i.label}`,
        detail: i.note ?? "Marked as needing attention.",
        subjectIds: i.subjectId ? [i.subjectId] : [],
      }));
    },
  },
  {
    id: "common.annual_review",
    module: "maintenance",
    description: "Annual review within the last 12 months.",
    meta: draftMeta(["General estate-planning practice (no specific statute)"]),
    evaluate(h) {
      const last = h.lastAnnualReview ? Date.parse(h.lastAnnualReview) : NaN;
      if (!Number.isNaN(last) && Date.now() - last < 366 * 24 * 3600 * 1000) return [];
      return [{ severity: "info", reviewer: "family", title: "Annual review due", detail: "Review assets, designations, fiduciaries, and life events.", subjectIds: [] }];
    },
  },
];

export const commonRuleSet: JurisdictionRuleSet = { jurisdiction: "common", displayName: "All jurisdictions", rules };
