import { describe, expect, it } from "vitest";
import { generateAttorneyPacket } from "../src/packet/attorneyPacket.ts";
import { ruleSetsFor } from "../rules/index.ts";
import { decryptJson, encryptJson, loadVault, saveVault } from "../src/storage/vault.ts";
import { buildEstateGraph } from "../src/domain/estateGraph.ts";
import { demo } from "./fixtures.ts";

describe("attorney review packet", () => {
  const md = generateAttorneyPacket(demo(), ruleSetsFor("texas"), new Date("2026-06-01T00:00:00Z"));

  it("contains every required section", () => {
    for (const heading of [
      "Household summary", "Dependents", "Trustees and successors", "Guardians and alternates",
      "Trust beneficiaries and contingents", "Asset inventory", "Real property", "Retirement accounts and insurance",
      "Unresolved decisions", "Attorney-review flags", "Funding status and gaps", "Decision and change history",
      "Confirmed facts", "Conflicts and pending changes", "Beneficiary-designation issues", "Rule sources", "Annual review history",
    ]) {
      expect(md).toContain(heading);
    }
  });

  it("states it is not legal advice and marks sample data", () => {
    expect(md).toMatch(/not legal or tax advice/);
    expect(md).toMatch(/fictional/);
  });

  it("labels legal/tax items as not determined by the software", () => {
    const flagsSection = md.split("## 13.")[1].split("## 14.")[0];
    expect(flagsSection).toContain("FamilyVault did not determine this");
    expect(md.split("## 11.")[1].split("## 12.")[0]).toContain("FamilyVault did not determine this");
  });

  it("lists confirmed facts, funding gaps, and rule sources", () => {
    expect(md.split("## 10.")[1].split("## 11.")[0]).toContain("Sam Placeholder");
    expect(md.split("## 14.")[1].split("## 15.")[0]).toContain("Deed recording not verified");
    expect(md.split("## 18.")[1]).toContain("Tex. Prop. Code §41.0021");
  });

  it("lists only children of the grantors as dependents", () => {
    const deps = md.split("## 2. Dependents")[1].split("## 3.")[0];
    expect(deps).toContain("Riley Example");
    expect(deps).not.toContain("Sam Placeholder");
  });
});

describe("estate graph", () => {
  it("is a typed graph with trust, people, assets, and designation edges", () => {
    const g = buildEstateGraph(demo());
    expect(g.nodes.some((n) => n.type === "trust")).toBe(true);
    const types = new Set(g.edges.map((e) => e.type));
    for (const t of ["relationship", "fiduciary", "owns", "funded_into", "beneficiary_primary", "trust_distribution"]) expect(types).toContain(t);
    expect(g.edges.some((e) => e.from === "a-ira" && e.type === "funded_into")).toBe(false);
  });
});

describe("encrypted local vault", () => {
  const pass = "correct horse battery staple";

  it("round-trips data and never stores plaintext", async () => {
    const blob = await encryptJson({ name: "Alex Example" }, pass);
    expect(JSON.stringify(blob)).not.toContain("Alex");
    expect(await decryptJson(blob, pass)).toEqual({ name: "Alex Example" });
  });

  it("rejects the wrong passphrase and short passphrases", async () => {
    const blob = await encryptJson({ a: 1 }, pass);
    await expect(decryptJson(blob, "wrong passphrase!!")).rejects.toThrow(/wrong passphrase/);
    await expect(encryptJson({}, "short")).rejects.toThrow();
  });

  it("saves and loads through a storage backend", async () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    await saveVault({ x: 1 }, pass, storage);
    expect(await loadVault(pass, storage)).toEqual({ x: 1 });
  });
});
