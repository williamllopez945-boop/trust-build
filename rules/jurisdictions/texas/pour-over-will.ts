import { draftMeta, type Rule } from "../../../src/domain/rules.ts";
import { grantors } from "../../../src/domain/estateGraph.ts";
import { docStage } from "./helpers.ts";

export const pourOverWillRules: Rule[] = [
  {
    id: "tx.will.pour_over_missing",
    module: "pour-over-will",
    description: "Each grantor should have a pour-over will reviewed.",
    meta: draftMeta(["Tex. Estates Code §254.001 (devises to trustee)"]),
    evaluate(h) {
      return grantors(h)
        .filter((g) => docStage(h, "pour_over_will", g.id) === "not_started")
        .map((g) => ({
          severity: "review" as const,
          reviewer: "attorney" as const,
          title: `No pour-over will started for ${g.displayName}`,
          detail: "Ask the attorney about a pour-over will to catch assets left outside the trust, and about naming an executor and (if there are minor children) guardians.",
          subjectIds: [g.id],
          references: ["Tex. Estates Code §254.001 (devises to trustee)"],
        }));
    },
  },
];
