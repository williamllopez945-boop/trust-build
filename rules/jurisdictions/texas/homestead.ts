import { draftMeta, type Rule } from "../../../src/domain/rules.ts";

export const homesteadRules: Rule[] = [
  {
    id: "tx.homestead.transfer_review",
    module: "homestead",
    description: "Homestead intended to be deeded into the trust.",
    meta: draftMeta(["Tex. Prop. Code §41.0021 (homestead in qualifying trust)", "Tex. Tax Code §11.13 (residence homestead exemption)"]),
    evaluate(h) {
      return h.assets
        .filter((a) => a.category === "real_estate" && a.isHomestead?.value === true && a.funding.method === "deed")
        .map((a) => ({
          severity: "attorney_required" as const,
          reviewer: "attorney" as const,
          title: `Homestead transfer: ${a.label}`,
          detail: "Review whether the trust terms and deed preserve homestead protections and the residence homestead tax exemption after the transfer, and whether the appraisal district needs to be notified.",
          subjectIds: [a.id],
          references: ["Tex. Prop. Code §41.0021 (homestead in qualifying trust)", "Tex. Tax Code §11.13 (residence homestead exemption)"],
        }));
    },
  },
  {
    id: "tx.homestead.status_unknown",
    module: "homestead",
    description: "Real estate with unknown homestead status.",
    meta: draftMeta(["General estate-planning practice (no specific statute)"]),
    evaluate(h) {
      return h.assets
        .filter((a) => a.category === "real_estate" && (a.isHomestead === undefined || a.isHomestead.status === "unknown"))
        .map((a) => ({
          severity: "review" as const,
          reviewer: "family" as const,
          title: `Homestead status unknown: ${a.label}`,
          detail: "Record whether this property is the household's residence homestead so the attorney can review it.",
          subjectIds: [a.id],
        }));
    },
  },
];
