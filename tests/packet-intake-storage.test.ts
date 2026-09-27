import { describe, expect, it } from "vitest";
import { generateAttorneyPacket } from "../src/packet/attorneyPacket.ts";
import { ruleSetsFor } from "../rules/index.ts";
import { answerQuestion, emptyIntake, nextQuestion, seeksProfessionalAdvice, skipQuestion } from "../src/intake/intake.ts";
import { QUESTIONS } from "../src/intake/questions.ts";
import { decryptJson, encryptJson, loadVault, saveVault } from "../src/storage/vault.ts";
import { buildEstateGraph } from "../src/domain/estateGraph.ts";
import { demo } from "./fixtures.ts";

describe("attorney review packet", () => {
  const md = generateAttorneyPacket(demo(), ruleSetsFor("texas"), new Date("2026-06-01T00:00:00Z"));

  it("contains every required section", () => {
    for (const heading of [
      "Household summary", "Dependents", "Trustees and successors", "Guardians and alternates",
      "Trust beneficiaries and contingents", "Asset inventory", "Real property", "Retirement accounts and insurance",
      "Unresolved decisions", "Attorney-review flags", "Funding status", "Decision and change log",
    ]) {
      expect(md).toContain(heading);
    }
  });

  it("states it is not legal advice and marks sample data", () => {
    expect(md).toMatch(/not legal or tax advice/);
    expect(md).toMatch(/fictional/);
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

describe("guided intake", () => {
  it("presents exactly one question at a time, in order", () => {
    let s = emptyIntake();
    expect(nextQuestion(s)?.id).toBe(QUESTIONS[0].id);
    const r = answerQuestion(s, QUESTIONS[0], "married");
    if (r.kind !== "decision") throw new Error("expected decision");
    s = r.state;
    expect(nextQuestion(s)?.id).toBe(QUESTIONS[1].id);
    s = skipQuestion(s, QUESTIONS[1]);
    expect(nextQuestion(s)?.id).toBe(QUESTIONS[2].id);
  });

  it("does not record empty answers", () => {
    expect(answerQuestion(emptyIntake(), QUESTIONS[0], "  ").kind).toBe("empty");
  });

  it("requires read-back for fiduciary answers", () => {
    const q = QUESTIONS.find((x) => x.sensitivity === "fiduciary")!;
    const r = answerQuestion(emptyIntake(), q, "Sam Placeholder, then Morgan Sample");
    expect(r.kind === "decision" && r.needsReadBack).toBe(true);
  });

  it("routes advice-seeking answers to professional review instead of answering", () => {
    expect(seeksProfessionalAdvice("Who should be our trustee?")).toBe(true);
    const q = QUESTIONS.find((x) => x.sensitivity === "fiduciary")!;
    const r = answerQuestion(emptyIntake(), q, "Should we pick my brother? What are the tax effects?");
    expect(r.kind).toBe("routed_to_professional");
    if (r.kind === "routed_to_professional") expect(r.decision.state).toBe("awaiting_professional_review");
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
