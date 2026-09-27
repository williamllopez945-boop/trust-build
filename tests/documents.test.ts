import { describe, expect, it } from "vitest";
import { applyChange, proposeChange, submitChange, type ChangeInput } from "../src/domain/changes.ts";
import { documentProgress, recommendedDocuments, sensitiveContent } from "../src/domain/documents.ts";
import { runRules } from "../src/domain/rules.ts";
import { parseHousehold, SchemaError } from "../src/domain/schema.ts";
import { generateAttorneyPacket } from "../src/packet/attorneyPacket.ts";
import { ruleSetsFor } from "../rules/index.ts";
import { demo } from "./fixtures.ts";

const now = new Date("2026-10-01T12:00:00Z");
const user = { source: "form" as const, actor: "user" as const, confidence: "stated" as const };
const doc = (after: Record<string, unknown>, op: ChangeInput["op"] = "create", entityId?: string): ChangeInput => ({ kind: "document", op, entityId, after, provenance: user });
const flagIds = (h: ReturnType<typeof demo>) => runRules(h, ruleSetsFor("texas")).map((f) => `${f.ruleId}:${f.subjectIds.join(",")}`);

describe("recommended documents", () => {
  it("builds a household-specific checklist and matches tracked documents", () => {
    const rec = recommendedDocuments(demo());
    const keys = rec.map((r) => r.key);
    expect(keys).toContain("trust_agreement");
    for (const g of ["p-alex", "p-jordan"]) {
      for (const k of ["pour_over_will", "durable_poa", "medical_poa", "directive_to_physicians", "hipaa_authorization", "guardian_designation"]) expect(keys).toContain(`${k}:${g}`);
    }
    expect(keys).toContain("deed:a-home");
    expect(keys).not.toContain("certification_of_trust"); // only once the trust is signed
    expect(rec.find((r) => r.key === "durable_poa:p-alex")?.tracked?.stage).toBe("executed");
    expect(rec.find((r) => r.key === "durable_poa:p-jordan")?.tracked).toBeUndefined();
  });

  it("omits guardian designations when there are no minors, and adds certification once the trust is signed", () => {
    const h = demo();
    h.people = h.people.map((p) => ({ ...p, isMinor: false }));
    h.plan.documents = h.plan.documents.map((d) => (d.kind === "trust_agreement" ? { ...d, stage: "executed", executedOn: "2026-02-01" } : d));
    const keys = recommendedDocuments(h).map((r) => r.key);
    expect(keys.some((k) => k.startsWith("guardian_designation"))).toBe(false);
    expect(keys).toContain("certification_of_trust");
  });

  it("reports progress", () => {
    expect(documentProgress(demo())).toMatchObject({ recommended: 14, tracked: 6, signed: 3 });
  });
});

describe("tracking documents through the change pipeline", () => {
  it("starting a new document is an important fact needing confirmation", () => {
    const cs = proposeChange(demo(), doc({ kind: "hipaa_authorization", forPersonId: "p-jordan", stage: "not_started" }), now);
    expect(cs.problems).toEqual([]);
    expect(cs.gate).toBe("confirm");
  });

  it("moving a document forward is confirmed and clears the related flag", () => {
    const h = demo();
    expect(flagIds(h)).toContain("tx.will.pour_over_missing:p-jordan");
    const cs = proposeChange(h, doc({ stage: "drafting" }, "update", "doc-will-j"), now);
    expect(cs.problems).toEqual([]);
    expect(cs.gate).toBe("confirm");
    expect(cs.label).toBe("Pour-over will: Jordan Example (Attorney drafting)");
    const next = applyChange(h, cs, { by: "user" }, now).household;
    expect(flagIds(next)).not.toContain("tx.will.pour_over_missing:p-jordan");
  });

  it("recording only where the original is kept is recorded immediately", () => {
    const r = submitChange(demo(), doc({ storageReference: "Attorney's vault (sample)" }, "update", "doc-mpoa-a"), now);
    expect(r.applied).toBe(true);
    expect(r.household.plan.documents.find((d) => d.id === "doc-mpoa-a")?.storageReference).toBe("Attorney's vault (sample)");
    expect(flagIds(r.household)).not.toContain("tx.exec.storage_reference:doc-mpoa-a");
  });

  it("marking a document signed is audited with the stage change", () => {
    const h = demo();
    const cs = proposeChange(h, doc({ stage: "executed", executedOn: "2026-09-15" }, "update", "doc-will-a"), now);
    expect(cs.problems).toEqual([]);
    const next = applyChange(h, cs, { by: "user" }, now).household;
    expect(next.audit.at(-1)?.detail?.fields).toEqual(expect.arrayContaining([{ path: "stage", old: "attorney_reviewed", new: "executed" }]));
    expect(flagIds(next)).toContain("tx.exec.storage_reference:doc-will-a");
  });
});

describe("document validation", () => {
  const problems = (after: Record<string, unknown>, op: ChangeInput["op"] = "create", id?: string) => proposeChange(demo(), doc(after, op, id), now).problems.join(" ");

  it.each([
    ["signed without a date", { kind: "hipaa_authorization", forPersonId: "p-jordan", stage: "executed" }, /date it was signed/],
    ["signed in the future", { kind: "hipaa_authorization", forPersonId: "p-jordan", stage: "executed", executedOn: "2027-01-01" }, /future/],
    ["date without signing", { kind: "hipaa_authorization", forPersonId: "p-jordan", stage: "drafting", executedOn: "2026-01-01" }, /only applies once/],
    ["personal document without a person", { kind: "medical_poa", stage: "drafting" }, /Choose whose/],
    ["household document tied to a person", { kind: "trust_agreement", forPersonId: "p-alex", stage: "drafting" }, /belongs to the household/],
    ["deed without a property", { kind: "deed", stage: "drafting" }, /Choose the property/],
    ["deed for a non-real-estate asset", { kind: "deed", forAssetId: "a-checking", stage: "drafting" }, /only be tracked for real estate/],
    ["duplicate", { kind: "durable_poa", forPersonId: "p-alex", stage: "drafting" }, /already tracked/],
    ["unknown kind", { kind: "novel", stage: "drafting" }, /document type/],
  ])("rejects %s", (_n, after, re) => {
    expect(problems(after)).toMatch(re);
  });

  it("rejects sensitive data in the location or notes", () => {
    const acct = ["12345", "678"].join("");
    expect(problems({ storageReference: `Bank box ${acct}` }, "update", "doc-poa-a")).toMatch(/long number/);
    expect(problems({ notes: ["password", ": hunter2"].join("") }, "update", "doc-poa-a")).toMatch(/password/);
    expect(sensitiveContent("Home safe, folder A")).toBeNull();
  });

  it("blocks archiving a property or person a document refers to", () => {
    expect(proposeChange(demo(), { kind: "asset", op: "archive", entityId: "a-home", provenance: user }, now).problems.join()).toMatch(/document doc-deed-home/);
    const h = demo();
    h.people.push({ id: "p-x", kind: "person", displayName: "X Sample" });
    h.plan.documents.push({ id: "doc-x", kind: "hipaa_authorization", forPersonId: "p-x", stage: "drafting" });
    expect(proposeChange(h, { kind: "person", op: "archive", entityId: "p-x", provenance: user }, now).problems.join()).toMatch(/document doc-x/);
  });

  it("schema validation rejects an invalid stored stage", () => {
    const h = demo();
    (h.plan.documents[0] as { stage: string }).stage = "finalized";
    expect(() => parseHousehold(h)).toThrow(SchemaError);
  });
});

it("the attorney packet shows signing dates and untracked common documents", () => {
  const md = generateAttorneyPacket(demo(), ruleSetsFor("texas"), now);
  const section = md.split("## 15.")[1].split("## 16.")[0];
  expect(section).toContain("does not hold, draft, or sign");
  expect(section).toContain("2026-01-20");
  expect(section).toContain("Deed to trustee");
  expect(section).toMatch(/not yet tracked:.*HIPAA authorization: Jordan Example/);
});
