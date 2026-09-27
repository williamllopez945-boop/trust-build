/**
 * Decision capture with sensitivity-based gates.
 *
 *   factual          -> record
 *   important_fact   -> confirm
 *   dispositive      -> explicit read-back confirmation (who inherits what)
 *   fiduciary        -> explicit read-back confirmation (trustees, guardians, agents)
 *   legal_tax        -> cannot be settled by the user; requires attorney/CPA review
 *
 * Guardrails enforced here (not just in the UI):
 *   - answers must come from the user; an assistant may never supply the
 *     value of a dispositive or fiduciary decision
 *   - sensitive decisions require the exact read-back to be acknowledged
 *   - nothing is ever auto-finalized
 */
import { auditEntry, type AuditEntry } from "./audit.ts";
import type { DataStatus } from "./types.ts";

export type Sensitivity = "factual" | "important_fact" | "dispositive" | "fiduciary" | "legal_tax";

export type DecisionState =
  | "proposed"
  | "recorded"
  | "confirmed"
  | "awaiting_professional_review"
  | "professionally_reviewed"
  | "superseded";

export type Reviewer = "attorney" | "cpa";

export interface Decision {
  id: string;
  topic: string; // e.g. "Primary successor trustee"
  sensitivity: Sensitivity;
  /** The structured answer, as the user gave it. */
  answer: string;
  answeredBy: "user" | "assistant";
  state: DecisionState;
  readBack?: string;
  reviewer?: Reviewer;
  reviewNote?: string;
  createdAt: string;
  updatedAt: string;
  supersedes?: string;
}

export class DecisionGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecisionGuardError";
  }
}

export const REQUIRES_READBACK: ReadonlySet<Sensitivity> = new Set(["dispositive", "fiduciary"]);

export function gateFor(sensitivity: Sensitivity): "record" | "confirm" | "explicit_confirm" | "professional_review" {
  switch (sensitivity) {
    case "factual":
      return "record";
    case "important_fact":
      return "confirm";
    case "dispositive":
    case "fiduciary":
      return "explicit_confirm";
    case "legal_tax":
      return "professional_review";
  }
}

/** Map a decision's state to the shared data-status vocabulary. */
export function statusOf(decision: Decision): DataStatus {
  switch (decision.state) {
    case "recorded":
      return "known";
    case "confirmed":
    case "professionally_reviewed":
      return "confirmed";
    case "awaiting_professional_review":
      return "attorney_required";
    case "proposed":
      return "needs_review";
    case "superseded":
      return "unknown";
  }
}

/** The exact statement the user must acknowledge for a sensitive decision. */
export function buildReadBack(topic: string, answer: string): string {
  return `You are choosing: "${answer}" for "${topic}". This is your decision, not a suggestion. Confirm to record it.`;
}

export interface DecisionResult {
  decision: Decision;
  audit: AuditEntry[];
}

export function proposeDecision(
  input: { id: string; topic: string; sensitivity: Sensitivity; answer: string; answeredBy: "user" | "assistant" },
  now: Date = new Date(),
): DecisionResult {
  const answer = input.answer.trim();
  if (!answer) {
    throw new DecisionGuardError("An answer is required; FamilyVault never fills in answers.");
  }
  if (input.answeredBy !== "user" && (REQUIRES_READBACK.has(input.sensitivity) || input.sensitivity === "legal_tax")) {
    throw new DecisionGuardError(
      `Only the user can supply a ${input.sensitivity} decision. The assistant may not choose beneficiaries, fiduciaries, or legal/tax positions.`,
    );
  }
  const ts = now.toISOString();
  const gate = gateFor(input.sensitivity);
  const decision: Decision = {
    ...input,
    answer,
    state: gate === "record" ? "recorded" : gate === "professional_review" ? "awaiting_professional_review" : "proposed",
    readBack: REQUIRES_READBACK.has(input.sensitivity) ? buildReadBack(input.topic, answer) : undefined,
    reviewer: gate === "professional_review" ? "attorney" : undefined,
    createdAt: ts,
    updatedAt: ts,
  };
  const audit = [auditEntry("decision.proposed", decision.id, `${decision.sensitivity}: ${decision.topic}`, input.answeredBy === "user" ? "user" : "system", now)];
  if (decision.state === "recorded") {
    audit.push(auditEntry("decision.recorded", decision.id, decision.topic, "user", now));
  } else if (decision.state === "awaiting_professional_review") {
    audit.push(auditEntry("decision.sent_for_review", decision.id, `${decision.topic} → attorney/CPA review`, "system", now));
  }
  return { decision, audit };
}

/**
 * Confirm a proposed decision.
 * For dispositive/fiduciary decisions `acknowledgedReadBack` must equal the
 * decision's read-back text exactly; anything else is rejected.
 */
export function confirmDecision(
  decision: Decision,
  confirmation: { confirmedBy: "user" | "assistant"; acknowledgedReadBack?: string },
  now: Date = new Date(),
): DecisionResult {
  if (confirmation.confirmedBy !== "user") {
    throw new DecisionGuardError("Only the user can confirm a decision.");
  }
  if (decision.state === "awaiting_professional_review") {
    throw new DecisionGuardError("Legal/tax-sensitive decisions are settled by attorney or CPA review, not user confirmation.");
  }
  if (decision.state !== "proposed") {
    throw new DecisionGuardError(`Cannot confirm a decision in state "${decision.state}".`);
  }
  if (REQUIRES_READBACK.has(decision.sensitivity) && confirmation.acknowledgedReadBack !== decision.readBack) {
    return {
      decision,
      audit: [auditEntry("decision.confirmation_rejected", decision.id, "Read-back not acknowledged exactly", "system", now)],
    };
  }
  const updated: Decision = { ...decision, state: "confirmed", updatedAt: now.toISOString() };
  return { decision: updated, audit: [auditEntry("decision.confirmed", decision.id, decision.topic, "user", now)] };
}

export function recordProfessionalReview(
  decision: Decision,
  review: { reviewer: Reviewer; note: string },
  now: Date = new Date(),
): DecisionResult {
  if (decision.state !== "awaiting_professional_review") {
    throw new DecisionGuardError("Only decisions awaiting professional review can be marked reviewed.");
  }
  if (!review.note.trim()) {
    throw new DecisionGuardError("A review note (who reviewed and the outcome) is required.");
  }
  const updated: Decision = {
    ...decision,
    state: "professionally_reviewed",
    reviewer: review.reviewer,
    reviewNote: review.note.trim(),
    updatedAt: now.toISOString(),
  };
  return {
    decision: updated,
    audit: [auditEntry("decision.professionally_reviewed", decision.id, `${decision.topic} reviewed by ${review.reviewer}`, review.reviewer, now)],
  };
}

/** Replace a decision with a new one; the old one is kept and marked superseded. */
export function supersede(old: Decision, replacement: Decision, now: Date = new Date()): { old: Decision; replacement: Decision; audit: AuditEntry[] } {
  return {
    old: { ...old, state: "superseded", updatedAt: now.toISOString() },
    replacement: { ...replacement, supersedes: old.id },
    audit: [auditEntry("decision.superseded", old.id, `Superseded by ${replacement.id}`, "user", now)],
  };
}

export function unresolved(decisions: readonly Decision[]): Decision[] {
  return decisions.filter((d) => d.state === "proposed" || d.state === "awaiting_professional_review");
}
