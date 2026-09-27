/**
 * Funding tracker. Ownership-controlled assets are "funded" by deed,
 * retitling or assignment. Beneficiary-controlled assets are coordinated
 * through designations and are never shown as retitled into the trust.
 */
import { controlFor, type Asset, type AssetControl, type FundingMethod, type FundingState } from "./types.ts";

export type FundingBadge = "funded" | "review" | "outside" | "designation" | "missing";

export interface FundingRow {
  assetId: string;
  label: string;
  control: AssetControl;
  badge: FundingBadge;
  text: string;
  done: boolean;
}

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

export function fundingRow(asset: Asset): FundingRow {
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

  return { assetId: asset.id, label: asset.label, control, badge, text, done };
}

export interface FundingSummary {
  rows: FundingRow[];
  done: number;
  total: number;
  percent: number;
}

export function fundingSummary(assets: readonly Asset[]): FundingSummary {
  const rows = assets.map(fundingRow);
  const done = rows.filter((r) => r.done).length;
  const total = rows.length;
  return { rows, done, total, percent: total === 0 ? 0 : Math.round((done / total) * 100) };
}

export const BADGE_ICON: Record<FundingBadge, string> = {
  funded: "✅",
  review: "⚠️",
  outside: "➖",
  designation: "🔵",
  missing: "⚠️",
};
