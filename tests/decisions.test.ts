import { describe, expect, it } from "vitest";
import {
  confirmDecision,
  DecisionGuardError,
  gateFor,
  proposeDecision,
  recordProfessionalReview,
  statusOf,
  supersede,
} from "../src/domain/decisions.ts";

const now = new Date("2026-05-01T12:00:00Z");

describe("decision sensitivity gates", () => {
  it("maps each sensitivity to the required gate", () => {
    expect(gateFor("factual")).toBe("record");
    expect(gateFor("important_fact")).toBe("confirm");
    expect(gateFor("dispositive")).toBe("explicit_confirm");
    expect(gateFor("fiduciary")).toBe("explicit_confirm");
    expect(gateFor("legal_tax")).toBe("professional_review");
  });

  it("records factual answers immediately", () => {
    const { decision, audit } = proposeDecision({ id: "d1", topic: "Marital status", sensitivity: "factual", answer: "married", answeredBy: "user" }, now);
    expect(decision.state).toBe("recorded");
    expect(statusOf(decision)).toBe("known");
    expect(audit.map((a) => a.action)).toEqual(["decision.proposed", "decision.recorded"]);
  });

  it("requires a simple confirmation for important facts", () => {
    const { decision } = proposeDecision({ id: "d2", topic: "Homestead", sensitivity: "important_fact", answer: "Sample residence", answeredBy: "user" }, now);
    expect(decision.state).toBe("proposed");
    expect(decision.readBack).toBeUndefined();
    expect(confirmDecision(decision, { confirmedBy: "user" }, now).decision.state).toBe("confirmed");
  });
});

describe("explicit read-back confirmation", () => {
  const propose = () =>
    proposeDecision({ id: "d3", topic: "Successor trustee", sensitivity: "fiduciary", answer: "Sam Placeholder", answeredBy: "user" }, now).decision;

  it("produces a read-back naming the choice", () => {
    const d = propose();
    expect(d.state).toBe("proposed");
    expect(d.readBack).toContain("Sam Placeholder");
    expect(d.readBack).toContain("Successor trustee");
  });

  it("rejects confirmation without the exact read-back", () => {
    const d = propose();
    for (const ack of [undefined, "", "yes", d.readBack!.toUpperCase()]) {
      const r = confirmDecision(d, { confirmedBy: "user", acknowledgedReadBack: ack }, now);
      expect(r.decision.state).toBe("proposed");
      expect(r.audit[0].action).toBe("decision.confirmation_rejected");
    }
  });

  it("confirms with the exact read-back", () => {
    const d = propose();
    const r = confirmDecision(d, { confirmedBy: "user", acknowledgedReadBack: d.readBack }, now);
    expect(r.decision.state).toBe("confirmed");
    expect(statusOf(r.decision)).toBe("confirmed");
  });

  it("never lets the assistant confirm", () => {
    const d = propose();
    expect(() => confirmDecision(d, { confirmedBy: "assistant", acknowledgedReadBack: d.readBack }, now)).toThrow(DecisionGuardError);
  });
});

describe("AI guardrails", () => {
  it.each(["dispositive", "fiduciary", "legal_tax"] as const)("the assistant cannot supply a %s answer", (sensitivity) => {
    expect(() => proposeDecision({ id: "x", topic: "t", sensitivity, answer: "Someone", answeredBy: "assistant" }, now)).toThrow(DecisionGuardError);
  });

  it("never invents an answer: blank answers are rejected", () => {
    expect(() => proposeDecision({ id: "x", topic: "t", sensitivity: "factual", answer: "   ", answeredBy: "user" }, now)).toThrow(DecisionGuardError);
  });
});

describe("legal/tax decisions", () => {
  const propose = () =>
    proposeDecision({ id: "d4", topic: "Trust structure", sensitivity: "legal_tax", answer: "Prefer joint trust", answeredBy: "user" }, now).decision;

  it("go straight to professional review and cannot be user-confirmed", () => {
    const d = propose();
    expect(d.state).toBe("awaiting_professional_review");
    expect(statusOf(d)).toBe("attorney_required");
    expect(() => confirmDecision(d, { confirmedBy: "user" }, now)).toThrow(/attorney or CPA/);
  });

  it("are settled only by a recorded professional review with a note", () => {
    const d = propose();
    expect(() => recordProfessionalReview(d, { reviewer: "attorney", note: " " }, now)).toThrow();
    const r = recordProfessionalReview(d, { reviewer: "attorney", note: "Reviewed at sample meeting" }, now);
    expect(r.decision.state).toBe("professionally_reviewed");
    expect(r.audit[0].actor).toBe("attorney");
  });
});

it("superseding keeps the old decision and links the new one", () => {
  const a = proposeDecision({ id: "a", topic: "t", sensitivity: "factual", answer: "1", answeredBy: "user" }, now).decision;
  const b = proposeDecision({ id: "b", topic: "t", sensitivity: "factual", answer: "2", answeredBy: "user" }, now).decision;
  const r = supersede(a, b, now);
  expect(r.old.state).toBe("superseded");
  expect(r.replacement.supersedes).toBe("a");
});
