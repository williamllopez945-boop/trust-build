import { describe, expect, it } from "vitest";
import { createHousehold, NewHouseholdError } from "../src/domain/newHousehold.ts";
import { parseHousehold } from "../src/domain/schema.ts";
import { runRules } from "../src/domain/rules.ts";
import { ruleSetsFor } from "../rules/index.ts";

const now = new Date("2026-10-01T12:00:00Z");
const base = { label: "Our household", jurisdiction: "texas", maritalStatus: "married" as const, grantorNames: ["Pat Sample", "Lee Sample"], acknowledgedPrivacy: true };

describe("new household", () => {
  it("creates a real (non-fictional), valid, empty household with grantors", () => {
    const h = createHousehold({ ...base, trustName: "Sample Family Trust" }, now);
    expect(h.isFictional).toBe(false);
    expect(parseHousehold(h)).toBeTruthy();
    expect(h.people.map((p) => [p.displayName, p.isGrantor])).toEqual([["Pat Sample", true], ["Lee Sample", true]]);
    expect(h.relationships).toHaveLength(1);
    expect(h.relationships[0].type).toBe("spouse");
    expect(h.maritalStatus).toEqual({ value: "married", status: "confirmed" });
    expect(h.plan.name).toBe("Sample Family Trust");
    expect(h.assets).toEqual([]);
    expect(h.plan.distributions).toEqual([]);
  });

  it("records every setup step in the audit log through the change pipeline", () => {
    const h = createHousehold(base, now);
    expect(h.audit[0].action).toBe("household.created");
    const applied = h.audit.filter((a) => a.action === "change.applied");
    expect(applied.length).toBe(4); // marital status, two grantors, spouse relationship
    expect(applied.every((a) => a.detail?.source.startsWith("form"))).toBe(true);
  });

  it("invents nothing: no beneficiaries, fiduciaries, or assets are created", () => {
    const h = createHousehold(base, now);
    expect(h.fiduciaries).toEqual([]);
    const flags = runRules(h, ruleSetsFor("texas"));
    expect(flags.some((f) => f.title === "No successor trustee named")).toBe(true);
    expect(flags.some((f) => f.title === "No trust beneficiaries recorded")).toBe(true);
  });

  it.each([
    ["no privacy acknowledgement", { acknowledgedPrivacy: false }],
    ["no label", { label: " " }],
    ["no grantors", { grantorNames: ["", " "] }],
    ["three grantors", { grantorNames: ["A Sample", "B Sample", "C Sample"] }],
    ["duplicate grantors", { grantorNames: ["Pat Sample", "pat sample"] }],
    ["two grantors, not married", { maritalStatus: "single" as const }],
  ])("refuses %s", (_n, patch) => {
    expect(() => createHousehold({ ...base, ...patch }, now)).toThrow(NewHouseholdError);
  });

  it("supports a single grantor and a general-rules-only jurisdiction", () => {
    const h = createHousehold({ ...base, maritalStatus: "single", grantorNames: ["Pat Sample"], jurisdiction: "other" }, now);
    expect(h.relationships).toEqual([]);
    expect(ruleSetsFor(h.plan.jurisdiction).map((s) => s.jurisdiction)).toEqual(["common"]);
  });
});
