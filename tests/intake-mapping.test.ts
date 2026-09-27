import { describe, expect, it } from "vitest";
import { answerQuestion, askProfessional, emptyIntake, nextQuestion, seeksProfessionalAdvice, skipQuestion } from "../src/intake/intake.ts";
import { IntakeMappingError } from "../src/intake/mapping.ts";
import { QUESTIONS } from "../src/intake/questions.ts";
import { demo } from "./fixtures.ts";

const now = new Date("2026-06-01T12:00:00Z");
const q = (id: string) => QUESTIONS.find((x) => x.id === id)!;

describe("guided intake", () => {
  it("presents exactly one question at a time, in order", () => {
    let s = emptyIntake();
    expect(nextQuestion(s)?.id).toBe(QUESTIONS[0].id);
    s = skipQuestion(s, QUESTIONS[0]);
    expect(nextQuestion(s)?.id).toBe(QUESTIONS[1].id);
  });

  it("proposes graph changes but never applies them", () => {
    const h = demo();
    const r = answerQuestion(h, emptyIntake(), q("q.dependents"), { kind: "new_people", people: [{ displayName: "Jamie Example", isMinor: true }] }, now);
    if (r.kind !== "proposed") throw new Error(r.kind);
    expect(r.household.people).toHaveLength(h.people.length); // not applied
    expect(r.household.pendingChanges?.map((c) => c.kind)).toEqual(["person", "relationship", "relationship"]);
    for (const c of r.changes) {
      expect(c.state).toBe("pending");
      expect(c.provenance).toMatchObject({ source: "intake", actor: "user", intakeQuestionId: "q.dependents" });
      expect(c.batchId).toBe(r.changes[0].batchId);
    }
  });

  it("flags an answer that conflicts with a confirmed fact", () => {
    const r = answerQuestion(demo(), emptyIntake(), q("q.marital"), { kind: "choice", value: "single" }, now);
    if (r.kind !== "proposed") throw new Error(r.kind);
    expect(r.changes[0].conflicts).toHaveLength(1);
    expect(r.household.maritalStatus.value).toBe("married");
  });

  it("reports no change when the answer matches what is recorded", () => {
    expect(answerQuestion(demo(), emptyIntake(), q("q.marital"), { kind: "choice", value: "married" }, now).kind).toBe("nothing_to_change");
  });

  it("updates existing fiduciary slots instead of duplicating them", () => {
    const r = answerQuestion(demo(), emptyIntake(), q("q.successor_trustee"), { kind: "ordered_people", personIds: ["p-morgan", "p-sam"] }, now);
    if (r.kind !== "proposed") throw new Error(r.kind);
    expect(r.changes.map((c) => [c.op, c.entityId])).toEqual([["update", "f3"], ["update", "f4"]]);
    expect(r.changes[0].conflicts.length).toBeGreaterThan(0); // f3 was confirmed as Sam
    expect(r.changes.every((c) => c.gate === "explicit_confirm")).toBe(true);
  });

  it("requires beneficiary shares to total 100%", () => {
    expect(() => answerQuestion(demo(), emptyIntake(), q("q.beneficiaries"), { kind: "shares", rows: [{ personId: "p-casey", sharePercent: 60 }, { personId: "p-riley", sharePercent: 30 }] }, now)).toThrow(IntakeMappingError);
  });

  it("maps a trust-structure preference to a legal/tax change", () => {
    const r = answerQuestion(demo(), emptyIntake(), q("q.trust_type"), { kind: "choice", value: "revocable_individual" }, now);
    if (r.kind !== "proposed") throw new Error(r.kind);
    expect(r.changes[0].gate).toBe("professional_review");
  });

  it("rejects an answer of the wrong shape", () => {
    expect(() => answerQuestion(demo(), emptyIntake(), q("q.marital"), { kind: "text", text: "married" }, now)).toThrow(IntakeMappingError);
  });

  it("never invents: blank text proposes nothing", () => {
    expect(answerQuestion(demo(), emptyIntake(), q("q.incapacity"), { kind: "text", text: "  " }, now).kind).toBe("nothing_to_change");
  });

  it("routes advice-seeking questions to the attorney/CPA list", () => {
    expect(seeksProfessionalAdvice("Who should be our trustee?")).toBe(true);
    const r = askProfessional(demo(), emptyIntake(), q("q.successor_trustee"), "Should we pick a relative? What are the tax effects?", now);
    expect(r.kind).toBe("routed_to_professional");
    if (r.kind === "routed_to_professional") expect(r.household.decisions.at(-1)?.state).toBe("awaiting_professional_review");
  });
});
