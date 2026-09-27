/**
 * Funding tracker. Ownership-controlled assets are "funded" by deed,
 * retitling or assignment. Beneficiary-controlled assets are coordinated
 * through designations and are never shown as retitled into the trust.
 */
import { controlFor, type Asset, type AssetControl, type FundingMethod, type FundingState } from "./types.ts";

export type FundingBadge = "funded" | "review" | "outside" | "designation" | "missing";

/** How an asset relates to the trust. */
export type FundingTreatment = "ownership_transfer" | "beneficiary_designation" | "outside_trust" | "review_only";

/**
 * complete        -> nothing left to do
 * incomplete      -> work remains (see blockers / nextAction)
 * not_applicable  -> intentionally outside the trust; excluded from progress
 */
export type FundingCompletion = "complete" | "incomplete" | "not_applicable";

export interface FundingRow {
  assetId: string;
  label: string;
  control: AssetControl;
  badge: FundingBadge;
  text: string;
  treatment: FundingTreatment;
  completion: FundingCompletion;
  /** Reasons the asset cannot be considered complete. */
  blockers: string[];
  nextAction: string;
  lastReviewed: string | null;
  reviewStale: boolean;
  /** complete or not_applicable (kept for the dashboard badge logic) */
  done: boolean;
}

export const TREATMENT_TEXT: Record<FundingTreatment, string> = {
  ownership_transfer: "ownership transfer",
  beneficiary_designation: "beneficiary designation",
  outside_trust: "intentionally outside trust",
  review_only: "review needed",
};

const METHOD_TEXT: Record<FundingMethod, string> = {
  deed: "deed",
  retitle: "retitle",
  assignment: "assignment",
  beneficiary_designation: "beneficiary designation",
  leave_outside: "leave outside / review",
  instructions: "access instructions",
  undecided: "method undecided",
};

/** Methods that are valid for each control type. */
export function allowedMethods(asset: Pick<Asset, "category">): FundingMethod[] {
  if (controlFor(asset.category) === "beneficiary_designation") {
    return ["beneficiary_designation", "undecided"];
  }
  if (asset.category === "real_estate") return ["deed", "leave_outside", "undecided"];
  if (asset.category === "digital") return ["instructions", "undecided"];
  return ["retitle", "assignment", "leave_outside", "undecided"];
}

export function isMethodAllowed(asset: Pick<Asset, "category">, method: FundingMethod): boolean {
  return allowedMethods(asset).includes(method);
}

function treatmentOf(asset: Asset): FundingTreatment {
  if (!isMethodAllowed(asset, asset.funding.method) || asset.funding.method === "undecided") return "review_only";
  if (controlFor(asset.category) === "beneficiary_designation") return "beneficiary_designation";
  if (asset.funding.method === "leave_outside") return "outside_trust";
  if (asset.funding.method === "instructions") return "review_only";
  return "ownership_transfer";
}

function blockersFor(asset: Asset): string[] {
  const b: string[] = [];
  const control = controlFor(asset.category);
  const s = asset.funding.state;
  if (!isMethodAllowed(asset, asset.funding.method)) {
    b.push(control === "beneficiary_designation"
      ? "Marked as retitled; beneficiary-controlled assets pass by designation, not trust title"
      : `"${asset.funding.method}" is not a valid funding method for this asset`);
  }
  if (asset.funding.method === "undecided") b.push("Funding method not decided");
  if (control === "beneficiary_designation") {
    const ds = asset.designations?.value ?? [];
    if (ds.length === 0 || asset.designations?.status === "unknown") b.push("Current beneficiary designation not on file");
    for (const tier of ["primary", "contingent"] as const) {
      const t = ds.filter((d) => d.tier === tier);
      const sum = t.reduce((x, d) => x + d.sharePercent, 0);
      if (t.length && sum !== 100) b.push(`${tier} designation shares total ${sum}%`);
    }
    if (s === "designation_needs_update") b.push("Designation needs updating with the plan administrator/insurer");
    if (s === "review") b.push("Designation strategy under review");
  } else {
    if (asset.category === "real_estate" && s === "funded" && asset.funding.deedRecorded?.value !== true) b.push("Deed recording not verified");
    if (s === "instructions_missing") b.push("Access instructions not documented");
    if (s === "review") b.push("Funding approach under review");
  }
  if (asset.character?.value === "mixed") b.push("Mixed community/separate character needs attorney review");
  return b;
}

function nextActionFor(asset: Asset, treatment: FundingTreatment, completion: FundingCompletion, blockers: string[]): string {
  if (completion === "not_applicable") return "None. Confirm it should stay outside the trust at the annual review.";
  if (completion === "complete") return "None. Re-check at the annual review.";
  const s = asset.funding.state;
  if (blockers.some((x) => x.startsWith("Marked as retitled"))) return "Change the funding method to beneficiary designation and review the designation with the attorney/CPA.";
  if (blockers.includes("Funding method not decided")) return "Decide with the attorney how this asset should be handled.";
  if (blockers.includes("Deed recording not verified")) return "Confirm the deed was recorded and note where the recorded copy is kept.";
  if (blockers.includes("Current beneficiary designation not on file")) return "Request the current beneficiary designation from the administrator or insurer.";
  if (blockers.some((x) => x.includes("shares total"))) return "Correct the designation shares so each tier totals 100%.";
  if (blockers.includes("Access instructions not documented")) return "Write down where access instructions are kept (never the passwords).";
  if (treatment === "beneficiary_designation") return "Update the designation to match the plan, then mark it current.";
  if (s === "not_started") return asset.category === "real_estate" ? "Have the attorney prepare the deed to the trustee." : "Ask the institution how to retitle to the trustee.";
  if (s === "in_progress") return "Follow up with the institution or attorney to finish the transfer.";
  return blockers[0] ? `Resolve: ${blockers[0]}.` : "Review with the attorney.";
}

const DAY = 24 * 3600 * 1000;

export function fundingRow(asset: Asset, today: Date = new Date()): FundingRow {
  const control = controlFor(asset.category);
  const s: FundingState = asset.funding.state;
  let badge: FundingBadge;
  let done: boolean;

  if (!isMethodAllowed(asset, asset.funding.method)) {
    badge = "review";
    done = false;
  } else if (control === "beneficiary_designation") {
    badge = s === "designation_current" ? "designation" : "review";
    done = s === "designation_current";
  } else if (s === "funded") {
    badge = "funded";
    done = true;
  } else if (s === "left_outside") {
    badge = "outside";
    done = true;
  } else if (s === "instructions_missing") {
    badge = "missing";
    done = false;
  } else {
    badge = "review";
    done = false;
  }

  let text = METHOD_TEXT[asset.funding.method];
  if (control === "ownership" && s === "funded") text = `funded (${asset.funding.method === "retitle" ? "retitled" : text})`;
  if (control === "ownership" && (s === "review" || s === "in_progress" || s === "not_started")) {
    text = `${s.replace("_", " ")} (${text})`;
  }
  if (s === "instructions_missing") text = "instructions missing";
  if (control === "beneficiary_designation" && s === "designation_needs_update") text = "beneficiary designation: update needed";
  if (!isMethodAllowed(asset, asset.funding.method)) {
    text = control === "beneficiary_designation"
      ? "review: beneficiary-controlled assets are coordinated by designation, not retitled"
      : `review: "${asset.funding.method}" is not a valid method for this asset`;
  }

  const treatment = treatmentOf(asset);
  const blockers = blockersFor(asset);
  let completion: FundingCompletion;
  if (treatment === "outside_trust" && s === "left_outside" && blockers.length === 0) completion = "not_applicable";
  else if (done && blockers.length === 0) completion = "complete";
  else completion = "incomplete";
  // A "funded" asset with open blockers (e.g. unverified deed) shows as review, not a check mark.
  if (completion === "incomplete" && (badge === "funded" || badge === "designation")) badge = "review";
  const lastReviewed = asset.funding.lastVerified ?? null;
  const reviewStale = !lastReviewed || today.getTime() - Date.parse(lastReviewed) > 366 * DAY;

  return {
    assetId: asset.id, label: asset.label, control, badge, text, treatment, completion, blockers,
    nextAction: nextActionFor(asset, treatment, completion, blockers),
    lastReviewed, reviewStale,
    done: completion !== "incomplete",
  };
}

export interface FundingSummary {
  rows: FundingRow[];
  /** Complete assets among those that apply. */
  done: number;
  /** Assets that apply (excludes not_applicable). */
  total: number;
  percent: number;
  notApplicable: number;
  blocked: number;
  byTreatment: Record<FundingTreatment, { complete: number; total: number }>;
}

export function fundingSummary(assets: readonly Asset[], today: Date = new Date()): FundingSummary {
  const rows = assets.map((a) => fundingRow(a, today));
  const applicable = rows.filter((r) => r.completion !== "not_applicable");
  const done = applicable.filter((r) => r.completion === "complete").length;
  const total = applicable.length;
  const byTreatment = Object.fromEntries(
    (["ownership_transfer", "beneficiary_designation", "outside_trust", "review_only"] as const).map((t) => [
      t,
      { complete: rows.filter((r) => r.treatment === t && r.completion !== "incomplete").length, total: rows.filter((r) => r.treatment === t).length },
    ]),
  ) as FundingSummary["byTreatment"];
  return {
    rows, done, total,
    percent: total === 0 ? 0 : Math.round((done / total) * 100),
    notApplicable: rows.length - total,
    blocked: applicable.filter((r) => r.blockers.length > 0).length,
    byTreatment,
  };
}

export const BADGE_ICON: Record<FundingBadge, string> = {
  funded: "✅",
  review: "⚠️",
  outside: "➖",
  designation: "🔵",
  missing: "⚠️",
};
