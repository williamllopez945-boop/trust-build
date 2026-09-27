import type { Rule } from "../../../src/domain/rules.ts";
import { fiduciariesFor, grantors } from "../../../src/domain/estateGraph.ts";

export const trustCreationRules: Rule[] = [
  {
    id: "tx.trust.type_undecided",
    module: "trust-creation",
    description: "Trust type (revocable/irrevocable, joint/individual) is not settled.",
    evaluate(h) {
      if (h.plan.type.value && h.plan.type.value !== "undecided" && h.plan.type.status === "confirmed") return [];
      return [{
        severity: "attorney_required",
        reviewer: "attorney",
        title: "Trust type not settled",
        detail: "Review with the attorney whether a revocable or irrevocable, joint or individual trust fits the household's goals. Texas trusts are generally presumed revocable unless the instrument says otherwise; confirm how the draft states this.",
        subjectIds: [],
        references: ["Tex. Prop. Code §112.051 (revocation, modification, amendment by settlor)"],
      }];
    },
  },
  {
    id: "tx.trust.merger_check",
    module: "trust-creation",
    description: "Sole trustee who is also the sole beneficiary.",
    evaluate(h) {
      const trustees = fiduciariesFor(h, "trustee");
      const beneficiaryIds = new Set(h.plan.distributions.map((d) => d.beneficiaryId));
      if (trustees.length === 1 && beneficiaryIds.size === 1 && beneficiaryIds.has(trustees[0].personId)) {
        return [{
          severity: "attorney_required",
          reviewer: "attorney",
          title: "Same person is sole trustee and sole beneficiary",
          detail: "Ask the attorney to review whether this structure raises a merger issue and how the draft addresses it.",
          subjectIds: [trustees[0].personId],
          references: ["Tex. Prop. Code §112.034 (merger)"],
        }];
      }
      return [];
    },
  },
  {
    id: "tx.trust.grantors_identified",
    module: "trust-creation",
    description: "At least one grantor is identified.",
    evaluate(h) {
      if (grantors(h).length > 0) return [];
      return [{
        severity: "review",
        reviewer: "family",
        title: "No grantor identified",
        detail: "Mark who is creating the trust before preparing the attorney packet.",
        subjectIds: [],
      }];
    },
  },
];
