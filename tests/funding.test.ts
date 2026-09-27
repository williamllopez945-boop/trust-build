import { describe, expect, it } from "vitest";
import { allowedMethods, fundingRow, fundingSummary } from "../src/domain/funding.ts";
import { controlFor } from "../src/domain/types.ts";
import { demo } from "./fixtures.ts";

describe("asset treatment model", () => {
  it("separates ownership- and beneficiary-controlled assets", () => {
    for (const c of ["ira", "401k", "tsp", "life_insurance", "annuity"] as const) expect(controlFor(c)).toBe("beneficiary_designation");
    for (const c of ["real_estate", "bank", "brokerage", "business_interest", "personal_property"] as const) expect(controlFor(c)).toBe("ownership");
  });

  it("never offers retitling for beneficiary-controlled assets", () => {
    expect(allowedMethods({ category: "ira" })).not.toContain("retitle");
    expect(allowedMethods({ category: "401k" })).not.toContain("deed");
  });

  it("shows a retirement account marked as retitled as a review item, never funded", () => {
    const a = demo().assets.find((x) => x.id === "a-ira")!;
    a.funding = { method: "retitle", state: "funded" };
    const row = fundingRow(a);
    expect(row.badge).toBe("review");
    expect(row.done).toBe(false);
    expect(row.text).toMatch(/not retitled/);
  });
});

it("matches the handoff's funding dashboard for the demo household", () => {
  const s = fundingSummary(demo().assets);
  const byId = Object.fromEntries(s.rows.map((r) => [r.assetId, r.badge]));
  expect(byId).toEqual({
    "a-home": "funded",
    "a-checking": "funded",
    "a-brokerage": "review",
    "a-vehicle": "outside",
    "a-ira": "designation",
    "a-401k": "review",
    "a-life": "designation",
    "a-personal": "funded",
    "a-digital": "missing",
  });
  expect(s.done).toBe(6);
  expect(s.percent).toBe(67);
});
