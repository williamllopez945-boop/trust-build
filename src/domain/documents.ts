/**
 * Legal document tracking.
 *
 * FamilyVault records *that* a document exists, what stage it is at, and
 * where the signed original is kept. It never stores, drafts, finalizes, or
 * signs the document itself. "Executed" is the family's record that signing
 * already happened with their attorney.
 */
import { grantors, minors } from "./estateGraph.ts";
import type { DocumentStage, Household, PlanDocument, PlanDocumentKind } from "./types.ts";

export interface DocumentKindInfo {
  kind: PlanDocumentKind;
  label: string;
  /** Who/what the document belongs to. */
  scope: "household" | "person" | "asset";
}

export const DOCUMENT_KINDS: DocumentKindInfo[] = [
  { kind: "trust_agreement", label: "Trust agreement", scope: "household" },
  { kind: "certification_of_trust", label: "Certification of trust", scope: "household" },
  { kind: "pour_over_will", label: "Pour-over will", scope: "person" },
  { kind: "durable_poa", label: "Durable power of attorney (financial)", scope: "person" },
  { kind: "medical_poa", label: "Medical power of attorney", scope: "person" },
  { kind: "directive_to_physicians", label: "Directive to physicians", scope: "person" },
  { kind: "hipaa_authorization", label: "HIPAA authorization", scope: "person" },
  { kind: "guardian_designation", label: "Designation of guardian", scope: "person" },
  { kind: "deed", label: "Deed to trustee", scope: "asset" },
];

export const DOCUMENT_STAGES: { stage: DocumentStage; label: string }[] = [
  { stage: "not_started", label: "Not started" },
  { stage: "drafting", label: "Attorney drafting" },
  { stage: "attorney_reviewed", label: "Reviewed, ready to sign" },
  { stage: "executed", label: "Signed (executed)" },
];

export function kindInfo(kind: PlanDocumentKind | string): DocumentKindInfo | undefined {
  return DOCUMENT_KINDS.find((k) => k.kind === kind);
}

export function stageLabel(stage: DocumentStage | string): string {
  return DOCUMENT_STAGES.find((s) => s.stage === stage)?.label ?? String(stage);
}

/**
 * Short text fields (storage location, notes) must not carry sensitive data.
 * A subset of the repository privacy scan, applied to what the user types.
 */
const SENSITIVE: { re: RegExp; what: string }[] = [
  { re: /\b\d{3}-\d{2}-\d{4}\b/, what: "a Social Security number" },
  { re: /(?<![\w.])\d{7,}(?![\w.])/, what: "a long number (account, policy, or ID)" },
  { re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/, what: "an email address" },
  { re: /\b(password|passcode|pin|combination)\b\s*[:=]/i, what: "a password or combination" },
];

export function sensitiveContent(text: string | undefined): string | null {
  if (!text) return null;
  return SENSITIVE.find((s) => s.re.test(text))?.what ?? null;
}

const isIsoDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** Problems with a document as it would be stored. */
export function validateDocument(h: Household, doc: Record<string, unknown>, entityId: string, today: Date = new Date()): string[] {
  const problems: string[] = [];
  const info = kindInfo(String(doc.kind));
  if (!info) return ["Choose a document type."];
  if (!DOCUMENT_STAGES.some((s) => s.stage === doc.stage)) problems.push("Choose a stage.");

  if (info.scope === "person") {
    if (!h.people.some((p) => p.id === doc.forPersonId)) problems.push(`Choose whose ${info.label.toLowerCase()} this is.`);
  } else if (doc.forPersonId) {
    problems.push(`A ${info.label.toLowerCase()} belongs to the household, not one person.`);
  }
  if (info.scope === "asset") {
    const asset = h.assets.find((a) => a.id === doc.forAssetId);
    if (!asset) problems.push("Choose the property this deed transfers.");
    else if (asset.category !== "real_estate") problems.push("A deed can only be tracked for real estate.");
  } else if (doc.forAssetId) {
    problems.push("Only deeds are linked to a property.");
  }

  if (doc.stage === "executed") {
    if (!isIsoDate(doc.executedOn)) problems.push("Enter the date it was signed (YYYY-MM-DD).");
    else if (Date.parse(doc.executedOn) > today.getTime() + 24 * 3600 * 1000) problems.push("The signing date can't be in the future.");
  } else if (doc.executedOn) {
    problems.push("A signing date only applies once the document is signed.");
  }

  for (const field of ["storageReference", "notes"] as const) {
    const what = sensitiveContent(doc[field] as string | undefined);
    if (what) problems.push(`${field === "storageReference" ? "Location" : "Notes"} looks like it contains ${what}. Record only where the original is kept.`);
  }

  const duplicate = h.plan.documents.find((d) =>
    d.id !== entityId && d.kind === doc.kind &&
    (info.scope === "household" || (info.scope === "person" && d.forPersonId === doc.forPersonId) || (info.scope === "asset" && d.forAssetId === doc.forAssetId)));
  if (duplicate) problems.push(`This ${info.label.toLowerCase()} is already tracked. Edit the existing entry instead.`);
  return problems;
}

export interface RecommendedDocument {
  key: string;
  kind: PlanDocumentKind;
  label: string;
  forPersonId?: string;
  forAssetId?: string;
  reason: string;
  tracked?: PlanDocument;
}

/**
 * Documents commonly part of a trust-based plan for this household.
 * A checklist to discuss with the attorney, not a determination of what is required.
 */
export function recommendedDocuments(h: Household): RecommendedDocument[] {
  const out: RecommendedDocument[] = [];
  const find = (kind: PlanDocumentKind, forPersonId?: string, forAssetId?: string) =>
    h.plan.documents.find((d) => d.kind === kind && (forPersonId === undefined || d.forPersonId === forPersonId) && (forAssetId === undefined || d.forAssetId === forAssetId));
  const push = (r: Omit<RecommendedDocument, "key" | "tracked">) =>
    out.push({ ...r, key: [r.kind, r.forPersonId, r.forAssetId].filter(Boolean).join(":"), tracked: find(r.kind, r.forPersonId, r.forAssetId) });

  push({ kind: "trust_agreement", label: "Trust agreement", reason: "The core document that creates the trust." });
  const trust = find("trust_agreement");
  if (trust?.stage === "executed") {
    push({ kind: "certification_of_trust", label: "Certification of trust", reason: "Often requested by banks when retitling accounts to the trustee." });
  }
  for (const g of grantors(h)) {
    push({ kind: "pour_over_will", forPersonId: g.id, label: `Pour-over will: ${g.displayName}`, reason: "Catches assets left outside the trust." });
    push({ kind: "durable_poa", forPersonId: g.id, label: `Financial power of attorney: ${g.displayName}`, reason: "Lets a chosen agent handle finances during incapacity." });
    push({ kind: "medical_poa", forPersonId: g.id, label: `Medical power of attorney: ${g.displayName}`, reason: "Names who makes medical decisions during incapacity." });
    push({ kind: "directive_to_physicians", forPersonId: g.id, label: `Directive to physicians: ${g.displayName}`, reason: "Records end-of-life treatment wishes." });
    push({ kind: "hipaa_authorization", forPersonId: g.id, label: `HIPAA authorization: ${g.displayName}`, reason: "Lets agents obtain medical information." });
    if (minors(h).length > 0) {
      push({ kind: "guardian_designation", forPersonId: g.id, label: `Designation of guardian: ${g.displayName}`, reason: "Records the guardian choice for minor children; ask the attorney which document should hold it." });
    }
  }
  for (const a of h.assets.filter((x) => x.category === "real_estate" && x.funding.method === "deed")) {
    push({ kind: "deed", forAssetId: a.id, label: `Deed to trustee: ${a.label}`, reason: "Transfers the property into the trust; recorded with the county." });
  }
  return out;
}

export function documentProgress(h: Household): { tracked: number; signed: number; recommended: number } {
  const rec = recommendedDocuments(h);
  return {
    recommended: rec.length,
    tracked: rec.filter((r) => r.tracked).length,
    signed: rec.filter((r) => r.tracked?.stage === "executed").length,
  };
}
