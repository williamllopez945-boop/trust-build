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
  | "packet.generated";

export interface AuditEntry {
  id: string;
  at: string; // ISO timestamp
  actor: "user" | "system" | "attorney" | "cpa";
  action: AuditAction;
  subjectId: string;
  summary: string;
}

let counter = 0;

export function auditEntry(
  action: AuditAction,
  subjectId: string,
  summary: string,
  actor: AuditEntry["actor"] = "user",
  now: Date = new Date(),
): AuditEntry {
  counter += 1;
  return {
    id: `audit-${now.getTime()}-${counter}`,
    at: now.toISOString(),
    actor,
    action,
    subjectId,
    summary,
  };
}

/** Returns a new log; existing entries are never modified or removed. */
export function appendAudit(log: readonly AuditEntry[], ...entries: AuditEntry[]): AuditEntry[] {
  return [...log, ...entries];
}

export function toDate(iso: string): ISODate {
  return iso.slice(0, 10);
}
