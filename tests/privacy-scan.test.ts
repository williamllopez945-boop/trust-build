import { describe, expect, it } from "vitest";
import { checkPath, checkSampleData, scanRepo, scanText } from "../scripts/privacy-scan.mjs";

// Fake values are assembled at runtime so this test file itself stays clean.
const j = (...p: string[]) => p.join("");
const rules = (text: string, deny: string[] = []) => scanText("notes.md", text, deny).map((f) => f.rule);

describe("content detection", () => {
  it.each([
    ["ssn", `SSN ${j("123", "-", "45", "-", "6789")}`],
    ["ein", `EIN ${j("12", "-", "3456789")}`],
    ["account", `acct ${j("12345", "67890", "12")}`],
    ["card", `card ${j("4111", " ", "1111", " ", "1111", " ", "1111")}`],
    ["private-key", j("-----BEGIN ", "RSA PRIVATE KEY-----")],
    ["aws-key", j("AKIA", "ABCDEFGHIJKLMNOP")],
    ["api-token", j("sk-", "ant-", "a".repeat(30))],
    ["api-token", j("ghp_", "b".repeat(36))],
    ["email", j("jane", "@", "gmail.com")],
    ["phone", j("(214) ", "867", "-", "5309")],
    ["dob", j("DO", "B: ", "01/02/1980")],
    ["street", j("1234 ", "Maple ", "Street")],
  ])("detects %s", (rule, text) => {
    expect(rules(text)).toContain(rule);
  });

  it.each([
    "Checking ending …0000",
    "contact@example.com",
    j("(555) ", "010", "-", "0100"),
    "123 Example Street",
    "Generated 2026-09-27",
    "const ITERATIONS = 310_000;",
    "Tex. Prop. Code §41.0021",
  ])("allows fictional/safe text: %s", (text) => {
    expect(rules(text)).toEqual([]);
  });

  it("honors the allow marker", () => {
    expect(rules(`${j("123", "-", "45", "-", "6789")} // privacy-scan:allow`)).toEqual([]);
  });

  it("blocks terms from the local denylist, case-insensitively", () => {
    expect(rules("Beneficiary: Real Person", ["real person"])).toContain("denylist");
  });
});

describe("path rules", () => {
  it.each([".env", "config/.env.local", "id.pem", "scan.pdf", "deed.jpg", "will.docx", "documents/executed/trust.md", "estate/people.json", "audit/log.json", "household-export.json", "familyvault-backup-2026-01-01.fvault"])(
    "forbids %s",
    (p) => expect(checkPath(p).length).toBeGreaterThan(0),
  );
  it.each(["README.md", "documents/executed/README.md", "estate/README.md", "src/domain/types.ts", "sample-data/demo-household.ts"])("allows %s", (p) => {
    expect(checkPath(p)).toEqual([]);
  });
});

it("requires sample data to declare itself fictional", () => {
  expect(checkSampleData("sample-data/x.json", '{"isFictional": false}')).toHaveLength(1);
  expect(checkSampleData("sample-data/x.ts", "isFictional: true")).toEqual([]);
});

it("the repository itself passes the privacy scan", () => {
  const { findings } = scanRepo();
  expect(findings).toEqual([]);
});
