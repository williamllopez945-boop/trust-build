import type { DocumentStage, Household, PlanDocumentKind } from "../../../src/domain/types.ts";

export function docStage(h: Household, kind: PlanDocumentKind, forPersonId?: string): DocumentStage {
  const doc = h.plan.documents.find((d) => d.kind === kind && (forPersonId === undefined || d.forPersonId === forPersonId));
  return doc?.stage ?? "not_started";
}

export function isMarried(h: Household): boolean {
  return h.maritalStatus.value === "married";
}
