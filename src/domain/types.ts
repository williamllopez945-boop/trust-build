/**
 * Core FamilyVault domain model.
 *
 * The estate is a graph: people and entities are nodes, and relationships,
 * roles and asset interests are typed edges. Nothing here renders a legal
 * conclusion; statuses describe how certain *our data* is, not what the law says.
 */

/** How settled a piece of information is. */
export const DATA_STATUSES = [
  "known",
  "confirmed",
  "unknown",
  "needs_review",
  "attorney_required",
] as const;
export type DataStatus = (typeof DATA_STATUSES)[number];

/** A value plus how certain we are about it. */
export interface Tracked<T> {
  value: T | null;
  status: DataStatus;
  note?: string;
}

export type ISODate = string; // YYYY-MM-DD

// ---------------------------------------------------------------------------
// People and entities
// ---------------------------------------------------------------------------

export type PersonKind = "person" | "trust" | "charity" | "entity";

export interface Person {
  id: string;
  kind: PersonKind;
  /** Display name. In Git this must be fictional (sample data only). */
  displayName: string;
  isMinor?: boolean;
  hasSpecialNeeds?: Tracked<boolean>;
  isGrantor?: boolean;
  notes?: string;
}

export type RelationshipType =
  | "spouse"
  | "child"
  | "stepchild"
  | "grandchild"
  | "parent"
  | "sibling"
  | "other_family"
  | "friend";

export interface Relationship {
  id: string;
  from: string; // person id
  to: string; // person id
  type: RelationshipType;
  status: DataStatus;
}

// ---------------------------------------------------------------------------
// Fiduciaries
// ---------------------------------------------------------------------------

export type FiduciaryRole =
  | "trustee"
  | "successor_trustee"
  | "guardian_of_person"
  | "guardian_of_estate"
  | "executor"
  | "financial_agent" // durable power of attorney
  | "healthcare_agent"; // medical power of attorney

export interface FiduciaryAppointment {
  id: string;
  personId: string;
  role: FiduciaryRole;
  /** 1 = primary, 2 = first alternate, ... */
  order: number;
  /** For guardians: which minor(s) this appointment covers. */
  forPersonIds?: string[];
  status: DataStatus;
  /** Set only by an explicitly confirmed decision. */
  decisionId?: string;
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

/**
 * How an asset passes at death. This split is deliberate:
 * ownership-controlled assets can be retitled (funded) into a trust;
 * beneficiary-controlled assets pass by designation and are generally
 * NOT retitled into a trust.
 */
export type AssetControl = "ownership" | "beneficiary_designation";

export type AssetCategory =
  | "real_estate"
  | "bank"
  | "brokerage"
  | "business_interest"
  | "vehicle"
  | "personal_property"
  | "digital"
  | "ira"
  | "401k"
  | "tsp"
  | "life_insurance"
  | "annuity"
  | "hsa";

export const BENEFICIARY_CONTROLLED: ReadonlySet<AssetCategory> = new Set<AssetCategory>([
  "ira",
  "401k",
  "tsp",
  "life_insurance",
  "annuity",
  "hsa",
]);

export function controlFor(category: AssetCategory): AssetControl {
  return BENEFICIARY_CONTROLLED.has(category) ? "beneficiary_designation" : "ownership";
}

/** Characterization for community-property states such as Texas. */
export type PropertyCharacter = "community" | "separate_grantor_a" | "separate_grantor_b" | "mixed";

export type FundingMethod =
  | "deed" // real estate
  | "retitle" // bank / brokerage
  | "assignment" // personal property, some business interests
  | "beneficiary_designation" // retirement, insurance
  | "leave_outside" // intentionally left out (e.g. some vehicles)
  | "instructions" // digital assets: access instructions, not title
  | "undecided";

export type FundingState =
  | "funded"
  | "in_progress"
  | "not_started"
  | "review"
  | "designation_current"
  | "designation_needs_update"
  | "left_outside"
  | "instructions_missing";

export interface BeneficiaryDesignation {
  personId: string;
  tier: "primary" | "contingent";
  sharePercent: number;
}

export interface Asset {
  id: string;
  label: string;
  category: AssetCategory;
  /** Last 4 digits at most, never a full account number. */
  refLast4?: string;
  approximateValue?: Tracked<number>;
  titledTo: Tracked<string[]>; // person ids
  character?: Tracked<PropertyCharacter>;
  isHomestead?: Tracked<boolean>;
  hasMortgage?: Tracked<boolean>;
  funding: {
    method: FundingMethod;
    state: FundingState;
    deedRecorded?: Tracked<boolean>;
    lastVerified?: ISODate;
  };
  /** Only meaningful for beneficiary-controlled assets. */
  designations?: Tracked<BeneficiaryDesignation[]>;
  notes?: string;
}

// ---------------------------------------------------------------------------
// Trust and plan documents
// ---------------------------------------------------------------------------

export type TrustType = "revocable_joint" | "revocable_individual" | "irrevocable" | "undecided";

export type DocumentStage = "not_started" | "drafting" | "attorney_reviewed" | "executed";

export type PlanDocumentKind =
  | "trust_agreement"
  | "pour_over_will"
  | "durable_poa"
  | "medical_poa"
  | "directive_to_physicians"
  | "hipaa_authorization"
  | "certification_of_trust"
  | "guardian_designation"
  | "deed";

export interface PlanDocument {
  id: string;
  kind: PlanDocumentKind;
  forPersonId?: string;
  stage: DocumentStage;
  /** Where the original lives, never the document itself. */
  storageReference?: string;
}

export interface DistributionRule {
  id: string;
  beneficiaryId: string;
  tier: "primary" | "contingent";
  sharePercent: Tracked<number>;
  terms: Tracked<string>; // e.g. "held in trust until age 30 (sample)"
  decisionId?: string;
}

export interface TrustPlan {
  name: string;
  jurisdiction: string; // e.g. "texas"
  type: Tracked<TrustType>;
  distributions: DistributionRule[];
  documents: PlanDocument[];
  digitalAssetInstructions: Tracked<string>;
  incapacityPlan: {
    definitionOfIncapacity: Tracked<string>;
    notes?: string;
  };
}

// ---------------------------------------------------------------------------
// Household (root aggregate)
// ---------------------------------------------------------------------------

export interface Household {
  /** Data-format version; see src/domain/schema.ts. */
  schemaVersion: number;
  id: string;
  label: string;
  /** Every household stored in Git must set this to true. */
  isFictional: boolean;
  maritalStatus: Tracked<"married" | "single" | "widowed" | "divorced">;
  people: Person[];
  relationships: Relationship[];
  fiduciaries: FiduciaryAppointment[];
  assets: Asset[];
  plan: TrustPlan;
  decisions: import("./decisions.ts").Decision[];
  audit: import("./audit.ts").AuditEntry[];
  /** Proposed changes awaiting review/confirmation (schema v2+). */
  pendingChanges?: import("./changes.ts").ChangeSet[];
  /** Archived entities; nothing is hard-deleted (schema v2+). */
  archived?: import("./entities.ts").ArchivedEntity[];
  lastAnnualReview?: ISODate;
}
