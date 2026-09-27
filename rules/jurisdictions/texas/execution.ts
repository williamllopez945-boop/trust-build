import { draftMeta, type Rule } from "../../../src/domain/rules.ts";

const NAMES: Record<string, string> = {
  trust_agreement: "Trust agreement",
  pour_over_will: "Pour-over will",
  durable_poa: "Durable power of attorney",
  medical_poa: "Medical power of attorney",
  directive_to_physicians: "Directive to physicians",
  hipaa_authorization: "HIPAA authorization",
  certification_of_trust: "Certification of trust",
  guardian_designation: "Designation of guardian",
  deed: "Deed",
};

export const executionRules: Rule[] = [
  {
    id: "tx.exec.formalities",
    module: "execution",
    description: "Documents reviewed but not yet executed.",
    meta: draftMeta(["Tex. Estates Code §251.051, §251.104 (wills)", "Tex. Estates Code §751.0021 (durable POA)"]),
    evaluate(h) {
      return h.plan.documents
        .filter((d) => d.stage === "attorney_reviewed")
        .map((d) => ({
          severity: "review" as const,
          reviewer: "attorney" as const,
          title: `Signing ceremony pending: ${NAMES[d.kind] ?? d.kind}`,
          detail: "Confirm with the attorney which signatures, witnesses, notarization, and self-proving affidavit this document needs, and schedule execution with them. FamilyVault never finalizes or signs documents.",
          subjectIds: [d.id],
          references: ["Tex. Estates Code §251.051, §251.104 (wills)", "Tex. Estates Code §751.0021 (durable POA)"],
        }));
    },
  },
  {
    id: "tx.exec.storage_reference",
    module: "execution",
    description: "Executed documents should have a storage reference.",
    meta: draftMeta(["General estate-planning practice (no specific statute)"]),
    evaluate(h) {
      return h.plan.documents
        .filter((d) => d.stage === "executed" && !d.storageReference)
        .map((d) => ({
          severity: "info" as const,
          reviewer: "family" as const,
          title: `Where is the original? ${NAMES[d.kind] ?? d.kind}`,
          detail: "Record where the signed original is kept (for example, safe or attorney's vault). Do not upload the document itself.",
          subjectIds: [d.id],
        }));
    },
  },
];
