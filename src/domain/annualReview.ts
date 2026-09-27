/**
 * Annual review workflow.
 *
 * A review is a dated checklist generated from the household as it stands
 * when the review starts, plus a fixed set of life-event questions. A review
 * can only be completed once every item is resolved (done, or needs attention
 * with a note) and every life-event question is answered. Completing it
 * updates `lastAnnualReview` through the change pipeline, so it is audited.
 * "Yes" life events and needs-attention items become review flags for the attorney.
 */
import { auditEntry } from "./audit.ts";
import { applyChange, proposeChange } from "./changes.ts";
import { DecisionGuardError } from "./decisions.ts";
import { newId } from "./entities.ts";
import { fiduciariesFor, nameOf } from "./estateGraph.ts";
import { controlFor, type FiduciaryRole, type Household } from "./types.ts";

export type ReviewItemStatus = "open" | "done" | "needs_attention";

export interface AnnualReviewItem {
  id: string;
  category: "assets" | "designations" | "fiduciaries" | "documents" | "beneficiaries" | "flags" | "pending";
  label: string;
  detail?: string;
  subjectId?: string;
  status: ReviewItemStatus;
  note?: string;
}

export interface LifeEventAnswer {
  id: string;
  question: string;
  answer: boolean | null;
  note?: string;
}

export interface AnnualReview {
  id: string;
  startedAt: string;
  completedAt?: string;
  items: AnnualReviewItem[];
  lifeEvents: LifeEventAnswer[];
}

export const LIFE_EVENTS: { id: string; question: string }[] = [
  { id: "le.marriage", question: "Has anyone in the plan married, divorced, or separated?" },
  { id: "le.birth", question: "Has a child or grandchild been born or adopted?" },
  { id: "le.death", question: "Has a beneficiary, fiduciary, or grantor died or become incapacitated?" },
  { id: "le.move", question: "Has the household moved, or bought property, in another state?" },
  { id: "le.assets", question: "Were any significant assets bought, sold, inherited, or opened?" },
  { id: "le.fiduciary", question: "Is any trustee, guardian, or agent no longer willing or able to serve?" },
  { id: "le.beneficiary", question: "Have a beneficiary's circumstances changed (turned adult, special needs, finances)?" },
];

const ROLE_TEXT: Partial<Record<FiduciaryRole, string>> = {
  successor_trustee: "successor trustee",
  guardian_of_person: "guardian",
  financial_agent: "financial agent",
  healthcare_agent: "healthcare agent",
  executor: "executor",
};

export function currentReview(h: Household): AnnualReview | undefined {
  return (h.annualReviews ?? []).find((r) => !r.completedAt);
}

export function lastCompletedReview(h: Household): AnnualReview | undefined {
  return [...(h.annualReviews ?? [])].filter((r) => r.completedAt).sort((a, b) => b.completedAt!.localeCompare(a.completedAt!))[0];
}

export function buildChecklist(h: Household, openFlagCount: number): AnnualReviewItem[] {
  const items: AnnualReviewItem[] = [];
  const add = (item: Omit<AnnualReviewItem, "id" | "status">) => items.push({ ...item, id: `ri-${items.length + 1}`, status: "open" });

  for (const a of h.assets) {
    if (controlFor(a.category) === "beneficiary_designation") {
      add({ category: "designations", subjectId: a.id, label: `Re-check the beneficiary designation for ${a.label}`, detail: "Request the current designation from the administrator or insurer and compare it with the plan." });
    } else if (a.funding.method === "leave_outside") {
      add({ category: "assets", subjectId: a.id, label: `Confirm ${a.label} should still stay outside the trust` });
    } else {
      add({ category: "assets", subjectId: a.id, label: `Confirm title and funding for ${a.label}`, detail: `Currently: ${a.funding.state.replace(/_/g, " ")} (${a.funding.method.replace(/_/g, " ")}).` });
    }
  }
  add({ category: "assets", label: "List any new accounts, property, or policies acquired this year" });

  for (const role of Object.keys(ROLE_TEXT) as FiduciaryRole[]) {
    for (const f of fiduciariesFor(h, role)) {
      add({ category: "fiduciaries", subjectId: f.personId, label: `Confirm ${nameOf(h, f.personId)} is still willing and able to serve as ${ROLE_TEXT[role]}${f.order > 1 ? ` (alternate ${f.order - 1})` : ""}` });
    }
  }

  add({ category: "beneficiaries", label: "Review trust beneficiaries, contingent beneficiaries, and distribution terms" });

  for (const d of h.plan.documents.filter((x) => x.stage === "executed")) {
    add({ category: "documents", subjectId: d.id, label: `Confirm the signed ${d.kind.replace(/_/g, " ")}${d.forPersonId ? ` for ${nameOf(h, d.forPersonId)}` : ""} is where recorded`, detail: d.storageReference ? `Recorded location: ${d.storageReference}` : "No storage location recorded yet." });
  }
  const unfinished = h.plan.documents.filter((x) => x.stage !== "executed").length;
  if (unfinished) add({ category: "documents", label: `Follow up on ${unfinished} plan document(s) not yet signed` });

  if (openFlagCount) add({ category: "flags", label: `Go through the ${openFlagCount} open review flag(s)` });
  const pending = (h.pendingChanges ?? []).length;
  if (pending) add({ category: "pending", label: `Resolve ${pending} proposed change(s) waiting in Review` });
  return items;
}

function replaceReview(h: Household, review: AnnualReview): Household {
  return { ...h, annualReviews: (h.annualReviews ?? []).map((r) => (r.id === review.id ? review : r)) };
}

function getOpenReview(h: Household, reviewId: string): AnnualReview {
  const r = (h.annualReviews ?? []).find((x) => x.id === reviewId);
  if (!r) throw new DecisionGuardError("Review not found.");
  if (r.completedAt) throw new DecisionGuardError("This review is already completed.");
  return r;
}

export function startAnnualReview(h: Household, openFlagCount: number, now: Date = new Date()): Household {
  if (currentReview(h)) throw new DecisionGuardError("A review is already in progress.");
  const review: AnnualReview = {
    id: newId("review", now),
    startedAt: now.toISOString(),
    items: buildChecklist(h, openFlagCount),
    lifeEvents: LIFE_EVENTS.map((e) => ({ ...e, answer: null })),
  };
  return {
    ...h,
    annualReviews: [...(h.annualReviews ?? []), review],
    audit: [...h.audit, auditEntry("review.annual_started", review.id, `Annual review started (${review.items.length} items)`, "user", now)],
  };
}

export function updateReviewItem(h: Household, reviewId: string, itemId: string, status: ReviewItemStatus, note?: string): Household {
  const r = getOpenReview(h, reviewId);
  if (status === "needs_attention" && !note?.trim()) throw new DecisionGuardError("Add a short note describing what needs attention.");
  return replaceReview(h, { ...r, items: r.items.map((i) => (i.id === itemId ? { ...i, status, note: note?.trim() || undefined } : i)) });
}

export function answerLifeEvent(h: Household, reviewId: string, eventId: string, answer: boolean, note?: string): Household {
  const r = getOpenReview(h, reviewId);
  return replaceReview(h, { ...r, lifeEvents: r.lifeEvents.map((e) => (e.id === eventId ? { ...e, answer, note: note?.trim() || undefined } : e)) });
}

export function reviewBlockers(r: AnnualReview): string[] {
  const out: string[] = [];
  const open = r.items.filter((i) => i.status === "open").length;
  if (open) out.push(`${open} checklist item(s) still open`);
  const unanswered = r.lifeEvents.filter((e) => e.answer === null).length;
  if (unanswered) out.push(`${unanswered} life-event question(s) unanswered`);
  return out;
}

export function completeAnnualReview(h: Household, reviewId: string, now: Date = new Date()): Household {
  const r = getOpenReview(h, reviewId);
  const blockers = reviewBlockers(r);
  if (blockers.length) throw new DecisionGuardError(`Cannot complete the review: ${blockers.join("; ")}.`);
  let next = replaceReview(h, { ...r, completedAt: now.toISOString() });
  const cs = proposeChange(next, {
    kind: "household", op: "update", label: "Annual review completed",
    after: { lastAnnualReview: now.toISOString().slice(0, 10) },
    provenance: { source: "form", actor: "user", confidence: "stated", note: `annual review ${r.id}` },
  }, now);
  next = applyChange(next, cs, { by: "user" }, now).household;
  const yes = r.lifeEvents.filter((e) => e.answer).length;
  const attention = r.items.filter((i) => i.status === "needs_attention").length;
  return { ...next, audit: [...next.audit, auditEntry("review.annual_completed", r.id, `Annual review completed: ${yes} life event(s), ${attention} item(s) need attention`, "user", now)] };
}
