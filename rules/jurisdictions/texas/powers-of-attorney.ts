import { draftMeta, type Rule } from "../../../src/domain/rules.ts";
import { fiduciariesFor, grantors } from "../../../src/domain/estateGraph.ts";
import { docStage } from "./helpers.ts";

export const powersOfAttorneyRules: Rule[] = [
  {
    id: "tx.poa.documents_missing",
    module: "powers-of-attorney",
    description: "Incapacity documents for each grantor.",
    meta: draftMeta(["Tex. Estates Code ch. 751–752 (durable POA)", "Tex. Health & Safety Code ch. 166 (advance directives)"]),
    evaluate(h) {
      const out = [];
      for (const g of grantors(h)) {
        const missing = (
          [
            ["durable_poa", "statutory durable power of attorney"],
            ["medical_poa", "medical power of attorney"],
            ["directive_to_physicians", "directive to physicians"],
            ["hipaa_authorization", "HIPAA authorization"],
          ] as const
        ).filter(([kind]) => docStage(h, kind, g.id) === "not_started").map(([, name]) => name);
        if (missing.length) {
          out.push({
            severity: "review" as const,
            reviewer: "attorney" as const,
            title: `Incapacity documents not started for ${g.displayName}`,
            detail: `Discuss with the attorney: ${missing.join(", ")}.`,
            subjectIds: [g.id],
            references: ["Tex. Estates Code ch. 751–752 (durable POA)", "Tex. Health & Safety Code ch. 166 (advance directives)"],
          });
        }
      }
      return out;
    },
  },
  {
    id: "tx.poa.agents_unnamed",
    module: "powers-of-attorney",
    description: "Financial and healthcare agents, with alternates.",
    meta: draftMeta(["General estate-planning practice (no specific statute)"]),
    evaluate(h) {
      const out = [];
      for (const role of ["financial_agent", "healthcare_agent"] as const) {
        const list = fiduciariesFor(h, role);
        if (list.length < 2) {
          out.push({
            severity: "review" as const,
            reviewer: "family" as const,
            title: `${role === "financial_agent" ? "Financial" : "Healthcare"} agent${list.length ? " alternate" : ""} not named`,
            detail: "The family should decide (with explicit confirmation) who would act, plus at least one alternate.",
            subjectIds: list.map((f) => f.personId),
          });
        }
      }
      return out;
    },
  },
];
