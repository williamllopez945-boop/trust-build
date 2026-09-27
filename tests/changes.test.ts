import { describe, expect, it } from "vitest";
import {
  applyChange,
  diff,
  proposeChange,
  queueChange,
  recordProfessionalOutcome,
  rejectChange,
  submitChange,
  type ChangeInput,
} from "../src/domain/changes.ts";
import { DecisionGuardError } from "../src/domain/decisions.ts";
import { runRules } from "../src/domain/rules.ts";
import { ruleSetsFor } from "../rules/index.ts";
import { demo } from "./fixtures.ts";

const now = new Date("2026-06-01T12:00:00Z");
const user = { source: "form" as const, actor: "user" as const, confidence: "stated" as const };
const input = (x: Omit<ChangeInput, "provenance">): ChangeInput => ({ ...x, provenance: user });

describe("diff", () => {
  it("reports field-level old and new values", () => {
    expect(diff({ a: 1, t: { value: "x", status: "known" } }, { a: 1, t: { value: "y", status: "known" } })).toEqual([{ path: "t.value", old: "x", new: "y" }]);
  });
});

describe("factual changes", () => {
  it("are recorded immediately with a field-level audit entry", () => {
    const r = submitChange(demo(), input({ kind: "person", op: "update", entityId: "p-morgan", after: { displayName: "Morgan Sample-Renamed" } }), now);
    expect(r.applied).toBe(true);
    expect(r.household.people.find((p) => p.id === "p-morgan")?.displayName).toBe("Morgan Sample-Renamed");
    const entry = r.household.audit.at(-1)!;
    expect(entry.action).toBe("change.applied");
    expect(entry.detail).toMatchObject({
      kind: "person", entityId: "p-morgan", op: "update", confirmation: "recorded", reviewRequirement: "record",
      fields: [{ path: "displayName", old: "Morgan Sample", new: "Morgan Sample-Renamed" }],
    });
    expect(entry.detail?.rulesVersion).toBeTruthy();
    expect(entry.detail?.schemaVersion).toBe(3);
    expect(entry.detail?.source).toContain("form");
  });
});

describe("sensitive changes are never auto-applied", () => {
  it("queues a new fiduciary for explicit read-back confirmation", () => {
    const r = submitChange(demo(), input({ kind: "fiduciary", op: "create", after: { personId: "p-casey", role: "financial_agent", order: 2, status: "confirmed" } }), now);
    expect(r.applied).toBe(false);
    expect(r.change.gate).toBe("explicit_confirm");
    expect(r.change.readBack).toContain("Casey Example");
    // a form cannot pre-mark something confirmed
    expect((r.change.after as { status: string }).status).toBe("known");
    expect(r.household.pendingChanges).toHaveLength(1);
  });

  it("applies only with the exact read-back, then confirms it and records a decision", () => {
    const h = demo();
    const cs = proposeChange(h, input({ kind: "fiduciary", op: "create", after: { personId: "p-casey", role: "financial_agent", order: 2, status: "known" } }), now);
    expect(() => applyChange(h, cs, { by: "user" }, now)).toThrow(DecisionGuardError);
    expect(() => applyChange(h, cs, { by: "user", acknowledgedReadBack: "yes" }, now)).toThrow(DecisionGuardError);
    const r = applyChange(h, cs, { by: "user", acknowledgedReadBack: cs.readBack }, now);
    const f = r.household.fiduciaries.find((x) => x.id === cs.entityId)!;
    expect(f.status).toBe("confirmed");
    expect(f.decisionId).toBe(r.decision?.id);
    expect(r.decision?.state).toBe("confirmed");
    expect(r.decision?.linked?.changeId).toBe(cs.id);
  });

  it("never lets an assistant propose or apply sensitive changes", () => {
    const h = demo();
    expect(() => proposeChange(h, { kind: "distribution", op: "create", after: { beneficiaryId: "p-casey", tier: "contingent", sharePercent: { value: 10, status: "known" }, terms: { value: null, status: "unknown" } }, provenance: { ...user, actor: "assistant" } }, now)).toThrow(DecisionGuardError);
    const cs = proposeChange(h, input({ kind: "person", op: "update", entityId: "p-morgan", after: { notes: "sample" } }), now);
    expect(() => applyChange(h, cs, { by: "assistant" }, now)).toThrow(DecisionGuardError);
  });

  it("treats beneficiary designation edits as dispositive", () => {
    const cs = proposeChange(demo(), input({ kind: "asset", op: "update", entityId: "a-401k", after: { designations: { value: [{ personId: "p-alex", tier: "primary", sharePercent: 100 }, { personId: "p-casey", tier: "contingent", sharePercent: 50 }, { personId: "p-riley", tier: "contingent", sharePercent: 50 }], status: "known" } } }), now);
    expect(cs.sensitivity).toBe("dispositive");
    expect(cs.readBack).toBeTruthy();
  });

  it("confirms important facts with a simple confirmation", () => {
    const h = demo();
    const cs = proposeChange(h, input({ kind: "asset", op: "update", entityId: "a-personal", after: { titledTo: { value: ["p-alex"], status: "known" } } }), now);
    expect(cs.gate).toBe("confirm");
    expect(cs.readBack).toBeUndefined();
    const r = applyChange(h, cs, { by: "user" }, now);
    expect(r.household.assets.find((a) => a.id === "a-personal")?.titledTo).toEqual({ value: ["p-alex"], status: "confirmed" });
  });
});

describe("conflicts with confirmed facts", () => {
  it("re-stating a confirmed value is not a change or a downgrade", () => {
    const cs = proposeChange(demo(), input({ kind: "household", op: "update", after: { maritalStatus: { value: "married", status: "known" } } }), now);
    expect(cs.fields).toEqual([]);
    const flagged = proposeChange(demo(), input({ kind: "household", op: "update", after: { maritalStatus: { value: "married", status: "needs_review" } } }), now);
    expect(flagged.fields).toEqual([{ path: "maritalStatus.status", old: "confirmed", new: "needs_review" }]);
  });

  const change = () => proposeChange(demo(), input({ kind: "household", op: "update", after: { maritalStatus: { value: "single", status: "known" } } }), now);

  it("are detected, not silently overwritten", () => {
    const cs = change();
    expect(cs.conflicts).toEqual([{ path: "maritalStatus.value", confirmedValue: "married", proposedValue: "single" }]);
    expect(cs.readBack).toMatch(/previously confirmed/);
    const h = queueChange(demo(), cs, now);
    expect(h.audit.at(-1)?.action).toBe("change.conflict_flagged");
    expect(h.maritalStatus.value).toBe("married");
    expect(runRules(h, ruleSetsFor("texas")).some((f) => f.ruleId === "common.pending_conflicts")).toBe(true);
  });

  it("require an explicit replace plus read-back to apply", () => {
    const cs = change();
    const h = demo();
    expect(() => applyChange(h, cs, { by: "user", acknowledgedReadBack: cs.readBack }, now)).toThrow(/conflicts/);
    const r = applyChange(h, cs, { by: "user", acknowledgedReadBack: cs.readBack, conflictResolution: "replace_confirmed" }, now);
    expect(r.household.maritalStatus).toEqual({ value: "single", status: "confirmed" });
  });

  it("can be resolved by keeping the existing value", () => {
    const cs = change();
    const r = rejectChange(queueChange(demo(), cs, now), cs, "kept confirmed value", now);
    expect(r.household.maritalStatus.value).toBe("married");
    expect(r.household.pendingChanges).toHaveLength(0);
    expect(r.audit[0].action).toBe("change.rejected");
  });
});

describe("legal/tax changes", () => {
  it("are applied as a preference marked attorney_required until a professional records the outcome", () => {
    const h = demo();
    const cs = proposeChange(h, input({ kind: "plan", op: "update", after: { type: { value: "revocable_individual", status: "known" } } }), now);
    expect(cs.gate).toBe("professional_review");
    const r = applyChange(h, cs, { by: "user" }, now);
    expect(r.household.plan.type).toEqual({ value: "revocable_individual", status: "attorney_required" });
    expect(r.decision?.state).toBe("awaiting_professional_review");
    const reviewed = recordProfessionalOutcome(r.household, r.decision!.id, { reviewer: "attorney", note: "Discussed at sample meeting" }, now);
    expect(reviewed.plan.type.status).toBe("confirmed");
    expect(reviewed.decisions.find((d) => d.id === r.decision!.id)?.state).toBe("professionally_reviewed");
  });
});

describe("archive and validation", () => {
  it("lets a batch add a person and their relationship, applied in order", () => {
    let h = demo();
    const person = proposeChange(h, input({ kind: "person", op: "create", after: { id: "p-new", kind: "person", displayName: "New Sample" } }), now);
    h = queueChange(h, person, now);
    const rel = proposeChange(h, input({ kind: "relationship", op: "create", after: { from: "p-alex", to: "p-new", type: "child", status: "known" } }), now);
    expect(rel.problems).toEqual([]);
    h = queueChange(h, rel, now);
    expect(() => applyChange(h, rel, { by: "user" }, now)).toThrow(/apply the change that adds them first/);
    h = applyChange(h, person, { by: "user" }, now).household;
    h = applyChange(h, rel, { by: "user" }, now).household;
    expect(h.relationships.some((r) => r.to === "p-new")).toBe(true);
  });

  it("blocks archiving a person who is still referenced", () => {
    const cs = proposeChange(demo(), input({ kind: "person", op: "archive", entityId: "p-sam" }), now);
    expect(cs.problems[0]).toMatch(/Still referenced/);
    expect(() => applyChange(demo(), cs, { by: "user", acknowledgedReadBack: cs.readBack }, now)).toThrow();
  });

  it("archives instead of deleting", () => {
    const h = demo();
    h.people.push({ id: "p-temp", kind: "person", displayName: "Temp Sample" });
    const cs = proposeChange(h, input({ kind: "person", op: "archive", entityId: "p-temp" }), now);
    const r = applyChange(h, cs, { by: "user" }, now);
    expect(r.household.people.some((p) => p.id === "p-temp")).toBe(false);
    expect(r.household.archived?.[0]).toMatchObject({ kind: "person", entity: { id: "p-temp" }, changeId: cs.id });
  });

  it("rejects full account numbers and unknown people", () => {
    const acct = ["98765", "4321"].join("");
    expect(proposeChange(demo(), input({ kind: "asset", op: "update", entityId: "a-checking", after: { refLast4: acct } }), now).problems.join()).toMatch(/last 4/);
    expect(proposeChange(demo(), input({ kind: "fiduciary", op: "create", after: { personId: "nobody", role: "executor", order: 1, status: "known" } }), now).problems.length).toBeGreaterThan(0);
  });
});
