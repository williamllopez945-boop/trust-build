/**
 * Start a new (real) household from scratch.
 *
 * The shell is empty. Grantors and the spouse relationship are added through
 * the change pipeline, so they are validated and audited like any other change.
 * The user's click on "Create household" is the confirmation for these
 * important facts. Nothing is invented: every name comes from the setup form.
 */
import { applyChange, proposeChange } from "./changes.ts";
import { auditEntry } from "./audit.ts";
import { newId } from "./entities.ts";
import { CURRENT_SCHEMA_VERSION } from "./schema.ts";
import type { Household } from "./types.ts";

export interface NewHouseholdInput {
  label: string;
  jurisdiction: string;
  maritalStatus: "married" | "single" | "widowed" | "divorced" | null;
  grantorNames: string[];
  trustName?: string;
  /** The user acknowledged the privacy boundary (private local copy, encrypted vault). */
  acknowledgedPrivacy: boolean;
}

export class NewHouseholdError extends Error {}

export function emptyHousehold(label: string, jurisdiction: string, now: Date = new Date()): Household {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    id: newId("household", now),
    label,
    isFictional: false,
    maritalStatus: { value: null, status: "unknown" },
    people: [],
    relationships: [],
    fiduciaries: [],
    assets: [],
    plan: {
      name: "Family Living Trust (draft name)",
      jurisdiction,
      type: { value: null, status: "unknown" },
      distributions: [],
      documents: [],
      digitalAssetInstructions: { value: null, status: "unknown" },
      incapacityPlan: { definitionOfIncapacity: { value: null, status: "unknown" } },
    },
    decisions: [],
    audit: [auditEntry("household.created", "household", `New household created (${jurisdiction})`, "user", now)],
    pendingChanges: [],
    archived: [],
    annualReviews: [],
  };
}

export function createHousehold(input: NewHouseholdInput, now: Date = new Date()): Household {
  if (!input.acknowledgedPrivacy) throw new NewHouseholdError("Confirm the privacy acknowledgement before entering real information.");
  const label = input.label.trim();
  if (!label) throw new NewHouseholdError("Give the household a label (it is only shown on this device).");
  const names = input.grantorNames.map((n) => n.trim()).filter(Boolean);
  if (names.length === 0) throw new NewHouseholdError("Enter at least one grantor (the person creating the trust).");
  if (names.length > 2) throw new NewHouseholdError("A household can have at most two grantors.");
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) throw new NewHouseholdError("Grantor names must be different.");
  if (names.length === 2 && input.maritalStatus !== "married") throw new NewHouseholdError("Two grantors are supported for married couples; otherwise start separate households.");

  let h = emptyHousehold(label, input.jurisdiction, now);
  const provenance = { source: "form" as const, actor: "user" as const, confidence: "stated" as const, note: "new household setup" };
  const batchId = newId("setup", now);
  const run = (input2: Parameters<typeof proposeChange>[1]) => {
    const cs = proposeChange(h, input2, now);
    h = applyChange(h, cs, { by: "user", acknowledgedReadBack: cs.readBack }, now).household;
  };

  if (input.maritalStatus) run({ kind: "household", op: "update", batchId, label: "Marital status", provenance, after: { maritalStatus: { value: input.maritalStatus, status: "known" } } });
  if (input.trustName?.trim()) run({ kind: "plan", op: "update", batchId, label: "Trust name", provenance, after: { name: input.trustName.trim() } });
  const ids = names.map((displayName, i) => {
    const id = newId(`grantor${i}`, now);
    run({ kind: "person", op: "create", batchId, label: `Grantor ${displayName}`, provenance, after: { id, kind: "person", displayName, isGrantor: true } });
    return id;
  });
  if (ids.length === 2) {
    run({ kind: "relationship", op: "create", batchId, label: "Spouses", provenance, after: { id: newId("rel", now), from: ids[0], to: ids[1], type: "spouse", status: "known" } });
  }
  return h;
}
