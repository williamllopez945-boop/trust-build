/**
 * Append-only audit/change log. Entries hold structured summaries only:
 * never raw intake payloads, transcripts, or model reasoning.
 */
import type { ISODate } from "./types.ts";

export type AuditAction =
  | "decision.proposed"
  | "decision.recorded"
  | "decision.confirmed"
  | "decision.confirmation_rejected"
  | "decision.sent_for_review"
  | "decision.professionally_reviewed"
  | "decision.superseded"
  | "asset.funding_updated"
  | "review.annual_completed"
  | "packet.generated"
  | "change.applied"
  | "change.rejected"
  | "change.conflict_flagged"
  | "backup.exported"
  | "backup.imported";

/** Field-level detail recorded for every applied or rejected change. */
export interface ChangeAuditDetail {
  kind: string;
  entityId: string;
  op: "create" | "update" | "archive";
  fields: { path: string; old: unknown; new: unknown }[];
  source: string;
  confirmation: string; // how it was confirmed (recorded / confirmed / read-back / attorney)
  reviewRequirement: string; // gate that applied
  rulesVersion: string;
  schemaVersion: number;
}

export interface AuditEntry {
  id: string;
  at: string; // ISO timestamp
  actor: "user" | "system" | "attorney" | "cpa";
  action: AuditAction;
  subjectId: string;
  summary: string;
  detail?: ChangeAuditDetail;
}

let counter = 0;

export function auditEntry(
  action: AuditAction,
  subjectId: string,
  summary: string,
  actor: AuditEntry["actor"] = "user",
  now: Date = new Date(),
  detail?: ChangeAuditDetail,
): AuditEntry {
  counter += 1;
  return {
    id: `audit-${now.getTime()}-${counter}`,
    at: now.toISOString(),
    actor,
    action,
    subjectId,
    summary,
    ...(detail ? { detail } : {}),
  };
}

/** Returns a new log; existing entries are never modified or removed. */
export function appendAudit(log: readonly AuditEntry[], ...entries: AuditEntry[]): AuditEntry[] {
  return [...log, ...entries];
}

export function toDate(iso: string): ISODate {
  return iso.slice(0, 10);
}
