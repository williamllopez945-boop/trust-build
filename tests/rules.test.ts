import { describe, expect, it } from "vitest";
import { assertNonConclusory, ConclusoryFlagError, runRules, type JurisdictionRuleSet } from "../src/domain/rules.ts";
import { ruleSetsFor, JURISDICTIONS } from "../rules/index.ts";
import { demo } from "./fixtures.ts";

const flagsFor = (h = demo()) => runRules(h, ruleSetsFor("texas"));
const ids = (h = demo()) => flagsFor(h).map((f) => f.ruleId);

describe("Texas rule set", () => {
  it("covers every required review module", () => {
    const modules = new Set(JURISDICTIONS.texas.rules.map((r) => r.module));
    for (const m of ["trust-creation", "homestead", "community-property", "real-property", "pour-over-will", "powers-of-attorney", "execution", "retirement"]) {
      expect(modules).toContain(m);
    }
  });

  it("every flag on the demo household is a review item, not a conclusion", () => {
    const flags = flagsFor();
    expect(flags.length).toBeGreaterThan(0);
    for (const f of flags) {
      expect(() => assertNonConclusory(`${f.title} ${f.detail}`, f.ruleId)).not.toThrow();
      expect(["info", "review", "attorney_required"]).toContain(f.severity);
    }
  });

  it("flags a homestead being deeded into the trust for attorney review", () => {
    const f = flagsFor().find((x) => x.ruleId === "tx.homestead.transfer_review");
    expect(f?.severity).toBe("attorney_required");
    expect(f?.subjectIds).toEqual(["a-home"]);
  });

  it("flags mixed community/separate property", () => {
    expect(flagsFor().some((f) => f.ruleId === "tx.cp.characterization_missing" && f.subjectIds.includes("a-brokerage"))).toBe(true);
  });

  it("skips community-property rules for a single household", () => {
    const h = demo();
    h.maritalStatus = { value: "single", status: "confirmed" };
    expect(ids(h)).not.toContain("tx.cp.characterization_missing");
  });

  it("flags a retirement account modeled as retitled into the trust", () => {
    const h = demo();
    h.assets.find((a) => a.id === "a-ira")!.funding = { method: "retitle", state: "funded" };
    const f = flagsFor(h).find((x) => x.ruleId === "tx.ret.not_retitled");
    expect(f?.severity).toBe("attorney_required");
    expect(f?.detail).toMatch(/beneficiary designation/);
  });

  it("flags designation shares that do not total 100%", () => {
    expect(flagsFor().some((f) => f.ruleId === "tx.ret.designation_unknown" && f.title.includes("90%"))).toBe(true);
  });

  it("flags a non-spouse primary retirement beneficiary for spousal-consent review", () => {
    const h = demo();
    h.assets.find((a) => a.id === "a-401k")!.designations!.value = [{ personId: "p-casey", tier: "primary", sharePercent: 100 }];
    expect(ids(h)).toContain("tx.ret.spousal_rights");
  });

  it("flags the trust named as retirement beneficiary", () => {
    expect(ids()).toContain("tx.ret.trust_as_beneficiary");
  });

  it("flags a funded deed that has not been verified as recorded", () => {
    expect(ids()).toContain("tx.deed.recording_unverified");
    const h = demo();
    h.assets.find((a) => a.id === "a-home")!.funding.deedRecorded = { value: true, status: "confirmed" };
    expect(ids(h)).not.toContain("tx.deed.recording_unverified");
  });

  it("flags missing pour-over wills and incapacity documents per grantor", () => {
    const flags = flagsFor();
    expect(flags.some((f) => f.ruleId === "tx.will.pour_over_missing" && f.subjectIds[0] === "p-jordan")).toBe(true);
    expect(flags.some((f) => f.ruleId === "tx.poa.documents_missing" && f.subjectIds[0] === "p-jordan")).toBe(true);
  });

  it("flags the sole-trustee/sole-beneficiary merger pattern", () => {
    const h = demo();
    h.fiduciaries = h.fiduciaries.filter((f) => f.role !== "trustee");
    h.fiduciaries.push({ id: "t", personId: "p-casey", role: "trustee", order: 1, status: "known" });
    h.plan.distributions = [{ id: "x", beneficiaryId: "p-casey", tier: "primary", sharePercent: { value: 100, status: "known" }, terms: { value: null, status: "unknown" } }];
    expect(ids(h)).toContain("tx.trust.merger_check");
  });

  it("orders attorney_required flags first", () => {
    const sev = flagsFor().map((f) => f.severity);
    expect(sev.indexOf("attorney_required")).toBe(0);
    expect(sev.lastIndexOf("attorney_required")).toBeLessThan(sev.indexOf("review"));
  });
});

describe("rule engine safeguards", () => {
  it.each([
    "This trust is valid.",
    "The deed is legally enforceable.",
    "Your plan complies with Texas law.",
    "This guarantees the exemption.",
    "You are protected from creditors.",
    "No need to consult an attorney.",
    "This will avoid probate.",
  ])("rejects conclusory text: %s", (text) => {
    expect(() => assertNonConclusory(text, "t")).toThrow(ConclusoryFlagError);
  });

  it("refuses to emit a rule's conclusory flag", () => {
    const bad: JurisdictionRuleSet = {
      jurisdiction: "test",
      displayName: "Test",
      rules: [{ id: "bad", module: "x", description: "", evaluate: () => [{ severity: "info", reviewer: "family", title: "Deed", detail: "The deed is valid.", subjectIds: [] }] }],
    };
    expect(() => runRules(demo(), [bad])).toThrow(ConclusoryFlagError);
  });

  it("falls back to common rules for unsupported jurisdictions", () => {
    expect(ruleSetsFor("oklahoma").map((s) => s.jurisdiction)).toEqual(["common"]);
  });
});
