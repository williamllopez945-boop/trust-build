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

// Matches the handoff's dashboard example, except Home: it is deeded but the
// recording is unverified, so it shows as review rather than a check mark.
it("matches the handoff's funding dashboard for the demo household", () => {
  const s = fundingSummary(demo().assets);
  const byId = Object.fromEntries(s.rows.map((r) => [r.assetId, r.badge]));
  expect(byId).toEqual({
    "a-home": "review",
    "a-checking": "funded",
    "a-brokerage": "review",
    "a-vehicle": "outside",
    "a-ira": "designation",
    "a-401k": "review",
    "a-life": "designation",
    "a-personal": "funded",
    "a-digital": "missing",
  });
});

describe("funding engine", () => {
  const today = new Date("2026-09-27T00:00:00Z");
  const rows = () => Object.fromEntries(fundingSummary(demo().assets, today).rows.map((r) => [r.assetId, r]));

  it("classifies each asset's treatment", () => {
    const r = rows();
    expect(r["a-home"].treatment).toBe("ownership_transfer");
    expect(r["a-ira"].treatment).toBe("beneficiary_designation");
    expect(r["a-vehicle"].treatment).toBe("outside_trust");
    expect(r["a-digital"].treatment).toBe("review_only");
  });

  it("distinguishes not applicable from incomplete and excludes it from progress", () => {
    const s = fundingSummary(demo().assets, today);
    expect(rows()["a-vehicle"].completion).toBe("not_applicable");
    expect(s.notApplicable).toBe(1);
    expect(s.total).toBe(8);
    // home is funded but its deed recording is unverified, so it is not complete
    expect(rows()["a-home"].completion).toBe("incomplete");
    expect(s.done).toBe(4); // checking, IRA, life insurance, personal property
    expect(s.percent).toBe(50);
  });

  it("explains blockers and gives a next action", () => {
    const r = rows();
    expect(r["a-home"].blockers).toContain("Deed recording not verified");
    expect(r["a-home"].nextAction).toMatch(/deed was recorded/);
    expect(r["a-401k"].blockers).toEqual(expect.arrayContaining(["contingent designation shares total 90%", "Designation needs updating with the plan administrator/insurer"]));
    expect(r["a-brokerage"].blockers).toContain("Mixed community/separate character needs attorney review");
    expect(r["a-digital"].nextAction).toMatch(/never the passwords/);
  });

  it("never treats a retitled retirement account as normal funding", () => {
    const a = demo().assets.find((x) => x.id === "a-ira")!;
    a.funding = { method: "retitle", state: "funded" };
    const row = fundingRow(a, today);
    expect(row.treatment).toBe("review_only");
    expect(row.completion).toBe("incomplete");
    expect(row.nextAction).toMatch(/beneficiary designation/);
  });

  it("tracks when each asset was last reviewed", () => {
    const a = demo().assets.find((x) => x.id === "a-checking")!;
    expect(fundingRow(a, today).reviewStale).toBe(true);
    a.funding.lastVerified = "2026-09-01";
    expect(fundingRow(a, today)).toMatchObject({ lastReviewed: "2026-09-01", reviewStale: false });
  });
});
