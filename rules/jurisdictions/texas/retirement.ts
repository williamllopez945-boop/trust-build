import { draftMeta, type Rule } from "../../../src/domain/rules.ts";
import { TRUST_NODE_ID } from "../../../src/domain/estateGraph.ts";
import { controlFor } from "../../../src/domain/types.ts";
import { isMarried } from "./helpers.ts";

export const retirementRules: Rule[] = [
  {
    id: "tx.ret.not_retitled",
    module: "retirement",
    description: "Beneficiary-controlled assets must not be modeled as retitled into the trust.",
    meta: draftMeta(["IRS Publication 590-A / 590-B (IRA contributions and distributions)"]),
    evaluate(h) {
      return h.assets
        .filter((a) => controlFor(a.category) === "beneficiary_designation" && a.funding.method !== "beneficiary_designation" && a.funding.method !== "undecided")
        .map((a) => ({
          severity: "attorney_required" as const,
          reviewer: "attorney_or_cpa" as const,
          title: `Beneficiary-controlled asset marked "${a.funding.method}": ${a.label}`,
          detail: "Retirement accounts, life insurance, and annuities generally pass by beneficiary designation. Changing ownership of a retirement account can have serious tax consequences; review the designation strategy with the attorney and CPA instead.",
          subjectIds: [a.id],
        }));
    },
  },
  {
    id: "tx.ret.designation_unknown",
    module: "retirement",
    description: "Beneficiary designations missing, unknown, or not totaling 100%.",
    meta: draftMeta(["General estate-planning practice (no specific statute)"]),
    evaluate(h) {
      const out = [];
      for (const a of h.assets.filter((x) => controlFor(x.category) === "beneficiary_designation")) {
        const ds = a.designations?.value;
        if (!ds || ds.length === 0 || a.designations?.status === "unknown") {
          out.push({
            severity: "review" as const,
            reviewer: "family" as const,
            title: `Beneficiary designation unknown: ${a.label}`,
            detail: "Request the current designation from the plan administrator or insurer and record it here.",
            subjectIds: [a.id],
          });
          continue;
        }
        for (const tier of ["primary", "contingent"] as const) {
          const t = ds.filter((d) => d.tier === tier);
          const sum = t.reduce((s, d) => s + d.sharePercent, 0);
          if (t.length && sum !== 100) {
            out.push({
              severity: "review" as const,
              reviewer: "family" as const,
              title: `${tier} shares total ${sum}%: ${a.label}`,
              detail: `Review the ${tier} beneficiary shares on file; they appear to total ${sum}%, not 100%.`,
              subjectIds: [a.id],
            });
          }
        }
        if (!ds.some((d) => d.tier === "contingent")) {
          out.push({
            severity: "info" as const,
            reviewer: "family" as const,
            title: `No contingent beneficiary: ${a.label}`,
            detail: "Consider whether a contingent beneficiary should be named.",
            subjectIds: [a.id],
          });
        }
      }
      return out;
    },
  },
  {
    id: "tx.ret.trust_as_beneficiary",
    module: "retirement",
    description: "Trust named as a retirement beneficiary.",
    meta: draftMeta(["Treas. Reg. §1.401(a)(9)-4 (trust as beneficiary)"]),
    evaluate(h) {
      return h.assets
        .filter((a) => ["ira", "401k", "tsp", "annuity"].includes(a.category) && (a.designations?.value ?? []).some((d) => d.personId === TRUST_NODE_ID))
        .map((a) => ({
          severity: "attorney_required" as const,
          reviewer: "attorney_or_cpa" as const,
          title: `Trust named as retirement beneficiary: ${a.label}`,
          detail: "Ask the attorney and CPA to review the trust's retirement-benefit provisions and distribution timing under the required minimum distribution rules before relying on this designation.",
          subjectIds: [a.id],
          references: ["Treas. Reg. §1.401(a)(9)-4 (trust as beneficiary)"],
        }));
    },
  },
  {
    id: "tx.ret.spousal_rights",
    module: "retirement",
    description: "Non-spouse primary beneficiary on an employer plan or community-property account.",
    meta: draftMeta(["29 U.S.C. §1055 (spousal consent)", "Tex. Fam. Code ch. 3"]),
    evaluate(h) {
      if (!isMarried(h)) return [];
      const spouseIds = new Set(h.relationships.filter((r) => r.type === "spouse").flatMap((r) => [r.from, r.to]));
      return h.assets
        .filter((a) => ["401k", "tsp", "ira"].includes(a.category))
        .filter((a) => {
          const primaries = (a.designations?.value ?? []).filter((d) => d.tier === "primary");
          return primaries.length > 0 && primaries.some((d) => !spouseIds.has(d.personId));
        })
        .map((a) => ({
          severity: "attorney_required" as const,
          reviewer: "attorney" as const,
          title: `Non-spouse primary beneficiary: ${a.label}`,
          detail: "Review whether spousal consent or a community-property interest affects this designation (employer plans such as 401(k)/TSP often require written spousal consent).",
          subjectIds: [a.id],
          references: ["29 U.S.C. §1055 (spousal consent)", "Tex. Fam. Code ch. 3"],
        }));
    },
  },
];
