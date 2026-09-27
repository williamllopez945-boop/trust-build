import { describe, expect, it } from "vitest";
import {
  answerLifeEvent,
  completeAnnualReview,
  currentReview,
  LIFE_EVENTS,
  reviewBlockers,
  startAnnualReview,
  updateReviewItem,
} from "../src/domain/annualReview.ts";
import { DecisionGuardError } from "../src/domain/decisions.ts";
import { runRules } from "../src/domain/rules.ts";
import { ruleSetsFor } from "../rules/index.ts";
import { demo } from "./fixtures.ts";

const now = new Date("2026-10-01T12:00:00Z");
const flagsFor = (h: ReturnType<typeof demo>) => runRules(h, ruleSetsFor("texas"));

function resolveAll(h: ReturnType<typeof demo>, lifeEventYes: string[] = []) {
  const r = currentReview(h)!;
  for (const i of r.items) h = updateReviewItem(h, r.id, i.id, "done");
  for (const e of LIFE_EVENTS) h = answerLifeEvent(h, r.id, e.id, lifeEventYes.includes(e.id), lifeEventYes.includes(e.id) ? "sample note" : undefined);
  return h;
}

describe("annual review", () => {
  it("builds a checklist from the household", () => {
    const h = startAnnualReview(demo(), 5, now);
    const r = currentReview(h)!;
    const labels = r.items.map((i) => i.label);
    expect(labels).toContain("Re-check the beneficiary designation for IRA");
    expect(labels).toContain("Confirm title and funding for Brokerage");
    expect(labels).toContain("Confirm Vehicle should still stay outside the trust");
    expect(labels.some((l) => l.startsWith("Confirm Sam Placeholder is still willing and able to serve as successor trustee"))).toBe(true);
    expect(labels).toContain("Go through the 5 open review flag(s)");
    expect(r.lifeEvents).toHaveLength(LIFE_EVENTS.length);
    expect(h.audit.at(-1)?.action).toBe("review.annual_started");
  });

  it("allows only one review in progress", () => {
    const h = startAnnualReview(demo(), 0, now);
    expect(() => startAnnualReview(h, 0, now)).toThrow(DecisionGuardError);
  });

  it("cannot be completed until every item and life event is resolved", () => {
    let h = startAnnualReview(demo(), 0, now);
    const r = currentReview(h)!;
    expect(reviewBlockers(r)).toHaveLength(2);
    expect(() => completeAnnualReview(h, r.id, now)).toThrow(/Cannot complete/);
    h = resolveAll(h);
    expect(reviewBlockers(currentReview(h)!)).toEqual([]);
  });

  it("requires a note for items that need attention", () => {
    const h = startAnnualReview(demo(), 0, now);
    const r = currentReview(h)!;
    expect(() => updateReviewItem(h, r.id, r.items[0].id, "needs_attention", " ")).toThrow(/note/);
  });

  it("completing updates lastAnnualReview through the audited change pipeline", () => {
    let h = startAnnualReview(demo(), 0, now);
    const id = currentReview(h)!.id;
    h = completeAnnualReview(resolveAll(h), id, now);
    expect(currentReview(h)).toBeUndefined();
    expect(h.lastAnnualReview).toBe("2026-10-01");
    expect(h.audit.some((a) => a.action === "change.applied" && a.detail?.fields.some((f) => f.path === "lastAnnualReview"))).toBe(true);
    expect(h.audit.at(-1)?.action).toBe("review.annual_completed");
    expect(() => updateReviewItem(h, id, "ri-1", "open")).toThrow(/already completed/);
  });

  it("turns reported life events and follow-ups into review flags", () => {
    let h = startAnnualReview(demo(), 0, now);
    const r = currentReview(h)!;
    h = resolveAll(h, ["le.birth"]);
    h = updateReviewItem(h, r.id, r.items[0].id, "needs_attention", "Deed copy not found (sample)");
    h = completeAnnualReview(h, r.id, now);
    const flags = flagsFor(h);
    const life = flags.find((f) => f.ruleId === "common.review_life_events");
    expect(life?.severity).toBe("attorney_required");
    expect(life?.detail).toContain("sample note");
    expect(flags.some((f) => f.ruleId === "common.review_followups" && f.detail.includes("Deed copy not found"))).toBe(true);
  });
});
