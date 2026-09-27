import type { Rule } from "../../../src/domain/rules.ts";

export const realPropertyRules: Rule[] = [
  {
    id: "tx.deed.recording_unverified",
    module: "real-property",
    description: "Real estate marked funded without a verified recorded deed.",
    evaluate(h) {
      return h.assets
        .filter((a) => a.category === "real_estate" && a.funding.state === "funded" && a.funding.deedRecorded?.value !== true)
        .map((a) => ({
          severity: "review" as const,
          reviewer: "attorney" as const,
          title: `Deed recording not verified: ${a.label}`,
          detail: "Confirm the deed to the trustee was signed, acknowledged, and recorded in the county real property records, and keep a reference to the recorded copy (not the deed itself) here.",
          subjectIds: [a.id],
        }));
    },
  },
  {
    id: "tx.deed.mortgage_and_title",
    module: "real-property",
    description: "Mortgaged real estate being deeded to the trust.",
    evaluate(h) {
      return h.assets
        .filter((a) => a.category === "real_estate" && a.funding.method === "deed" && a.hasMortgage?.value === true)
        .map((a) => ({
          severity: "review" as const,
          reviewer: "attorney" as const,
          title: `Mortgage and title insurance review: ${a.label}`,
          detail: "Ask the attorney to review lender notice, due-on-sale treatment of transfers to a revocable trust, and whether the owner's title policy continues to cover the trustee.",
          subjectIds: [a.id],
          references: ["12 U.S.C. §1701j-3(d)(8) (transfers into inter vivos trusts)"],
        }));
    },
  },
];
