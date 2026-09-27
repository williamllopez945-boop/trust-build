import type { Rule } from "../../../src/domain/rules.ts";
import { isMarried } from "./helpers.ts";

export const communityPropertyRules: Rule[] = [
  {
    id: "tx.cp.characterization_missing",
    module: "community-property",
    description: "Married household with assets whose community/separate character is unknown.",
    evaluate(h) {
      if (!isMarried(h)) return [];
      return h.assets
        .filter((a) => !a.character || a.character.value === null || a.character.status === "unknown" || a.character.value === "mixed")
        .map((a) => ({
          severity: (a.character?.value === "mixed" ? "attorney_required" : "review") as "attorney_required" | "review",
          reviewer: "attorney" as const,
          title: `Community/separate character to review: ${a.label}`,
          detail: a.character?.value === "mixed"
            ? "This asset may combine community and separate property. Ask the attorney how it should be characterized and tracked inside the trust."
            : "Record whether this asset is believed to be community or separate property; the attorney should review the characterization.",
          subjectIds: [a.id],
          references: ["Tex. Fam. Code ch. 3 (marital property rights)"],
        }));
    },
  },
  {
    id: "tx.cp.joint_trust_separate_property",
    module: "community-property",
    description: "Separate property going into a joint trust.",
    evaluate(h) {
      if (h.plan.type.value !== "revocable_joint") return [];
      const sep = h.assets.filter((a) => a.character?.value?.startsWith("separate") && a.funding.state === "funded");
      if (sep.length === 0) return [];
      return [{
        severity: "attorney_required",
        reviewer: "attorney",
        title: "Separate property in a joint trust",
        detail: "Review how the joint trust tracks separate versus community property, including what happens on revocation or the death of one spouse.",
        subjectIds: sep.map((a) => a.id),
        references: ["Tex. Prop. Code §112.051", "Tex. Fam. Code ch. 3"],
      }];
    },
  },
];
