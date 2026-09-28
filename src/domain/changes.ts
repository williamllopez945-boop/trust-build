/**
 * The change pipeline. Every edit, from a form, guided intake, or an
 * attorney's review, becomes a ChangeSet that is:
 *
 *   proposed  -> diffed against current data, classified by sensitivity,
 *                checked for conflicts with confirmed facts and for problems
 *   reviewed  -> recorded (factual), confirmed (important facts), confirmed
 *                with an exact read-back (dispositive/fiduciary, or any change
 *                that would overwrite a confirmed fact), or applied with
 *                attorney_required status pending professional review (legal/tax)
 *   applied   -> written to the household with a field-level audit entry
 *
 * Nothing here auto-confirms. Only the user confirms, and an assistant can
 * never propose dispositive, fiduciary, or legal/tax values.
 */
import { auditEntry, type AuditEntry, type ChangeAuditDetail } from "./audit.ts";
import { DecisionGuardError, gateFor, recordProfessionalReview, type Decision, type Reviewer, type Sensitivity } from "./decisions.ts";
import { archiveEntity, assetReferences, getEntity, newId, putEntity, referencesTo, SINGLETON_KINDS, type EntityKind } from "./entities.ts";
import { kindInfo, stageLabel, validateDocument } from "./documents.ts";
import { TRUST_NODE_ID } from "./estateGraph.ts";
import { RULES_VERSION } from "./rules.ts";
import { CURRENT_SCHEMA_VERSION } from "./schema.ts";
import type { DataStatus, Household } from "./types.ts";

export type ChangeOp = "create" | "update" | "archive";
export type ChangeSource = "form" | "intake" | "import" | "attorney_review";
export type Confidence = "stated" | "believed" | "unsure";

export interface Provenance {
  source: ChangeSource;
  actor: "user" | "assistant" | "attorney" | "cpa";
  at: string;
  confidence: Confidence;
  intakeQuestionId?: string;
  note?: string;
}

export interface FieldChange {
  path: string;
  old: unknown;
  new: unknown;
}

export interface Conflict {
  path: string;
  confirmedValue: unknown;
  proposedValue: unknown;
}

export type Gate = ReturnType<typeof gateFor>;

export interface ChangeSet {
  id: string;
  batchId?: string;
  kind: EntityKind;
  entityId: string;
  op: ChangeOp;
  label: string;
  after: Record<string, unknown> | null;
  fields: FieldChange[];
  sensitivity: Sensitivity;
  gate: Gate;
  provenance: Provenance;
  state: "pending" | "applied" | "rejected";
  conflicts: Conflict[];
  /** Blocking problems; a change with problems cannot be applied. */
  problems: string[];
  readBack?: string;
  createdAt: string;
  resolvedAt?: string;
}

export interface ChangeInput {
  kind: EntityKind;
  op: ChangeOp;
  entityId?: string;
  after?: Record<string, unknown>;
  label?: string;
  batchId?: string;
  provenance: Omit<Provenance, "at">;
}

// ---------------------------------------------------------------------------
// Diffing
// ---------------------------------------------------------------------------

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);

export function flatten(value: unknown, prefix = "", out: Map<string, unknown> = new Map()): Map<string, unknown> {
  if (isObj(value)) {
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      flatten(v, prefix ? `${prefix}.${k}` : k, out);
    }
  } else if (prefix) {
    out.set(prefix, value);
  }
  return out;
}

export function diff(before: unknown, after: unknown): FieldChange[] {
  const a = flatten(before);
  const b = flatten(after);
  const paths = [...new Set([...a.keys(), ...b.keys()])].sort();
  return paths
    .filter((p) => JSON.stringify(a.get(p)) !== JSON.stringify(b.get(p)))
    .map((p) => ({ path: p, old: a.has(p) ? a.get(p) : null, new: b.has(p) ? b.get(p) : null }));
}

function getPath(obj: unknown, segments: string[]): unknown {
  let cur: unknown = obj;
  for (const s of segments) {
    if (!isObj(cur)) return undefined;
    cur = cur[s];
  }
  return cur;
}

/** Nearest object (the path itself or an ancestor, up to the entity root) that carries a `status`. */
function statusOwner(segments: string[], obj: unknown): string[] | null {
  for (let i = segments.length; i >= 0; i--) {
    const candidate = segments.slice(0, i);
    const node = getPath(obj, candidate);
    if (isObj(node) && typeof node.status === "string") return candidate;
  }
  return null;
}

const isStatusPath = (p: string) => p === "status" || p.endsWith(".status");

export function findConflicts(before: unknown, fields: FieldChange[]): Conflict[] {
  if (!before) return [];
  const out: Conflict[] = [];
  for (const f of fields) {
    if (isStatusPath(f.path)) continue;
    const owner = statusOwner(f.path.split("."), before);
    if (owner && (getPath(before, owner) as Obj).status === "confirmed") {
      out.push({ path: f.path, confirmedValue: f.old, proposedValue: f.new });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Sensitivity
// ---------------------------------------------------------------------------

const RANK: Record<Sensitivity, number> = { factual: 0, important_fact: 1, dispositive: 2, fiduciary: 2, legal_tax: 3 };
const max = (a: Sensitivity, b: Sensitivity): Sensitivity => (RANK[b] > RANK[a] ? b : a);

export function sensitivityFor(kind: EntityKind, op: ChangeOp, paths: string[]): Sensitivity {
  const has = (...prefixes: string[]) => paths.some((p) => prefixes.some((x) => p === x || p.startsWith(`${x}.`)));
  switch (kind) {
    case "fiduciary":
      return "fiduciary";
    case "distribution":
      return "dispositive";
    case "asset": {
      let s: Sensitivity = op === "update" ? "factual" : "important_fact";
      if (has("titledTo", "character", "isHomestead", "hasMortgage", "category", "funding.method", "funding.deedRecorded")) s = max(s, "important_fact");
      if (has("designations")) s = max(s, "dispositive");
      return s;
    }
    case "person":
      if (op === "archive") return "important_fact";
      return has("isGrantor", "isMinor", "hasSpecialNeeds", "kind") ? "important_fact" : "factual";
    case "relationship":
      return "important_fact";
    case "document":
      // Where the original is kept, and notes, are simple facts; what the document is and its stage matter more.
      return op === "update" && !has("kind", "stage", "executedOn", "forPersonId", "forAssetId") ? "factual" : "important_fact";
    case "household":
      return has("maritalStatus") ? "important_fact" : "factual";
    case "plan":
      if (has("type")) return "legal_tax";
      return has("incapacityPlan", "digitalAssetInstructions") ? "important_fact" : "factual";
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = new Set(["real_estate", "bank", "brokerage", "business_interest", "vehicle", "personal_property", "digital", "ira", "401k", "tsp", "life_insurance", "annuity", "hsa"]);

/**
 * Validate a change. With `allowPending`, people proposed in the review
 * queue count as existing (so a batch can add a person and their
 * relationships together); at apply time validation is strict.
 */
function validate(h: Household, kind: EntityKind, op: ChangeOp, entityId: string, after: Obj | null, allowPending = false): string[] {
  const problems: string[] = [];
  const pendingPeople = new Set(allowPending ? (h.pendingChanges ?? []).filter((c) => c.kind === "person" && c.op === "create").map((c) => c.entityId) : []);
  const personExists = (id: unknown) => typeof id === "string" && (id === TRUST_NODE_ID || h.people.some((p) => p.id === id) || pendingPeople.has(id));
  if (op === "archive") {
    if (kind === "person") {
      const refs = referencesTo(h, entityId);
      if (refs.length) problems.push(`Still referenced by ${refs.join(", ")}. Archive or change those first.`);
    }
    if (kind === "asset") {
      const refs = assetReferences(h, entityId);
      if (refs.length) problems.push(`Still referenced by ${refs.join(", ")}. Archive or change those first.`);
    }
    return problems;
  }
  if (!after) return ["No data supplied."];
  switch (kind) {
    case "person":
      if (typeof after.displayName !== "string" || !after.displayName.trim()) problems.push("A name is required.");
      break;
    case "relationship":
      if (!personExists(after.from) || !personExists(after.to)) problems.push("Both people must exist (apply the change that adds them first).");
      if (after.from === after.to) problems.push("A relationship needs two different people.");
      break;
    case "fiduciary":
      if (!personExists(after.personId)) problems.push("Choose an existing person for this role.");
      if (!Number.isInteger(after.order) || (after.order as number) < 1) problems.push("Order must be 1 (primary) or higher (alternates).");
      for (const id of (after.forPersonIds as unknown[]) ?? []) if (!personExists(id)) problems.push(`Unknown person ${String(id)}.`);
      break;
    case "distribution": {
      if (!personExists(after.beneficiaryId)) problems.push("Choose an existing beneficiary.");
      const share = (after.sharePercent as Obj | undefined)?.value;
      if (share !== null && share !== undefined && (typeof share !== "number" || share < 0 || share > 100)) problems.push("Share must be between 0 and 100.");
      break;
    }
    case "asset": {
      if (typeof after.label !== "string" || !after.label.trim()) problems.push("An asset description is required.");
      if (!VALID_CATEGORIES.has(String(after.category))) problems.push("Choose a valid asset category.");
      if (after.refLast4 !== undefined && !/^\d{0,4}$/.test(String(after.refLast4))) problems.push("Reference must be at most the last 4 digits. Never enter a full account number.");
      for (const d of ((after.designations as Obj | undefined)?.value as Obj[] | null) ?? []) {
        if (!personExists(d.personId)) problems.push(`Unknown designated beneficiary ${String(d.personId)}.`);
        if (typeof d.sharePercent !== "number" || d.sharePercent < 0 || d.sharePercent > 100) problems.push("Designation shares must be between 0 and 100.");
      }
      for (const id of ((after.titledTo as Obj | undefined)?.value as unknown[] | null) ?? []) if (!personExists(id)) problems.push(`Unknown owner ${String(id)}.`);
      break;
    }
    case "document":
      problems.push(...validateDocument(h, after, entityId));
      break;
    default:
      break;
  }
  return problems;
}

/**
 * An unchanged value keeps its confirmed status: re-stating a confirmed fact
 * with the default "known" status is not a downgrade. Explicitly flagging it
 * (needs_review, unknown, attorney_required) still is.
 */
function preserveConfirmed(before: unknown, after: unknown): unknown {
  if (!isObj(after) || !isObj(before)) return after;
  const out: Obj = {};
  for (const [k, v] of Object.entries(after)) out[k] = preserveConfirmed(before[k], v);
  if (before.status === "confirmed" && out.status === "known") {
    const sameValue = "value" in before ? JSON.stringify(before.value) === JSON.stringify(out.value) : true;
    if (sameValue) out.status = "confirmed";
  }
  return out;
}

/** Forms and intake may not mark anything "confirmed"; only applyChange's gates do. */
function stripNewConfirmations(before: unknown, after: unknown): unknown {
  if (Array.isArray(after)) return after.map((x) => x);
  if (!isObj(after)) return after;
  const out: Obj = {};
  for (const [k, v] of Object.entries(after)) {
    const prev = isObj(before) ? before[k] : undefined;
    if (k === "status" && v === "confirmed" && !(isObj(before) && before.status === "confirmed")) out[k] = "known";
    else out[k] = stripNewConfirmations(prev, v);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Describing changes (read-backs, UI, packet)
// ---------------------------------------------------------------------------

export function describeValue(h: Household, v: unknown): string {
  if (v === null || v === undefined || v === "") return "(empty)";
  if (typeof v === "string") {
    if (v === TRUST_NODE_ID) return h.plan.name;
    const p = h.people.find((x) => x.id === v);
    if (p) return p.displayName;
    const pending = (h.pendingChanges ?? []).find((c) => c.kind === "person" && c.op === "create" && c.entityId === v);
    return pending ? `${String(pending.after?.displayName ?? v)} (pending)` : v;
  }
  if (Array.isArray(v)) return v.length ? v.map((x) => (isObj(x) ? describeObj(h, x) : describeValue(h, x))).join("; ") : "(none)";
  if (isObj(v)) return describeObj(h, v);
  return String(v);
}

function describeObj(h: Household, o: Obj): string {
  if ("personId" in o && "sharePercent" in o) return `${String(o.tier ?? "")} ${describeValue(h, o.personId)} ${String(o.sharePercent)}%`.trim();
  return Object.entries(o).map(([k, v]) => `${k}: ${describeValue(h, v)}`).join(", ");
}

const prettyPath = (p: string) => p.replace(/\.value$/, "").replace(/\./g, " › ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

/** Fields worth showing a person: no internal ids, and no status rows implied by a value change. */
export function visibleFields(fields: FieldChange[]): FieldChange[] {
  const valueChanged = new Set(fields.filter((f) => f.path.endsWith(".value")).map((f) => f.path.slice(0, -".value".length)));
  return fields.filter((f) => f.path !== "id" && !(f.path.endsWith(".status") && valueChanged.has(f.path.slice(0, -".status".length))));
}

export function describeFields(h: Household, fields: FieldChange[]): string[] {
  return fields.filter((f) => !isStatusPath(f.path)).map((f) => `${prettyPath(f.path)}: ${describeValue(h, f.old)} → ${describeValue(h, f.new)}`);
}

function buildChangeReadBack(h: Household, cs: Pick<ChangeSet, "label" | "op" | "fields" | "conflicts">): string {
  const verb = cs.op === "create" ? "adding" : cs.op === "archive" ? "archiving" : "changing";
  const lines = cs.op === "archive" ? [] : describeFields(h, cs.fields);
  const conflictNote = cs.conflicts.length ? " This replaces information you previously confirmed." : "";
  return `You are ${verb} "${cs.label}"${lines.length ? `: ${lines.join("; ")}` : ""}.${conflictNote} This is your decision, not a suggestion. Confirm to apply it.`;
}

function defaultLabel(h: Household, kind: EntityKind, e: Obj, entityId: string): string {
  const name = (id: unknown) => describeValue(h, id);
  switch (kind) {
    case "person": return String(e.displayName ?? entityId);
    case "asset": return String(e.label ?? entityId);
    case "fiduciary": return `${String(e.role ?? "fiduciary").replace(/_/g, " ")}${Number(e.order) > 1 ? ` (alternate ${Number(e.order) - 1})` : ""}: ${name(e.personId)}`;
    case "distribution": return `${String(e.tier ?? "")} trust share for ${name(e.beneficiaryId)}`.trim();
    case "relationship": return `${name(e.to)} is ${String(e.type ?? "related")} of ${name(e.from)}`;
    case "document": {
      const info = kindInfo(String(e.kind));
      const whose = e.forPersonId ? `: ${name(e.forPersonId)}` : e.forAssetId ? `: ${String(h.assets.find((a) => a.id === e.forAssetId)?.label ?? e.forAssetId)}` : "";
      return `${info?.label ?? "Document"}${whose} (${stageLabel(String(e.stage))})`;
    }
    case "household": return "Household details";
    case "plan": return "Trust plan details";
  }
}

export const GATE_LABEL: Record<Gate, string> = {
  record: "recording",
  confirm: "confirmation",
  explicit_confirm: "explicit read-back confirmation",
  professional_review: "attorney/CPA review",
};

// ---------------------------------------------------------------------------
// Propose / apply / reject
// ---------------------------------------------------------------------------

export function proposeChange(h: Household, input: ChangeInput, now: Date = new Date()): ChangeSet {
  const { kind, op } = input;
  if (SINGLETON_KINDS.has(kind) && op !== "update") throw new DecisionGuardError(`${kind} can only be updated.`);
  const entityId = SINGLETON_KINDS.has(kind) ? kind : (input.entityId ?? (input.after?.id as string | undefined) ?? newId(kind, now));
  const before = getEntity(h, kind, entityId);
  const problems: string[] = [];
  if (op === "create" && before) problems.push(`${kind} ${entityId} already exists.`);
  if (op !== "create" && !before) problems.push(`${kind} ${entityId} not found.`);

  let after: Obj | null = null;
  if (op !== "archive") {
    const merged = { ...(before ?? {}), ...(input.after ?? {}) } as Obj;
    if (!SINGLETON_KINDS.has(kind)) merged.id = entityId;
    after = preserveConfirmed(before, stripNewConfirmations(before, merged)) as Obj;
  }
  const fields = op === "archive" ? diff(before, null) : diff(before, after);
  if (op === "update" && fields.length === 0) problems.push("Nothing changed.");
  problems.push(...validate(h, kind, op, entityId, after, true));

  const sensitivity = sensitivityFor(kind, op, fields.map((f) => f.path));
  if (input.provenance.actor === "assistant" && RANK[sensitivity] >= 2) {
    throw new DecisionGuardError(`An assistant may not propose a ${sensitivity} change. Only the user supplies beneficiaries, fiduciaries, and legal/tax choices.`);
  }
  const conflicts = op === "update" ? findConflicts(before, fields) : [];
  const gate = gateFor(sensitivity);
  const label = input.label ?? defaultLabel(h, kind, (after ?? before ?? {}) as Obj, entityId);
  const partial = { label, op, fields, conflicts };
  const needsReadBack = gate === "explicit_confirm" || conflicts.length > 0;
  return {
    id: newId("chg", now),
    batchId: input.batchId,
    kind,
    entityId,
    op,
    label,
    after,
    fields,
    sensitivity,
    gate,
    provenance: { ...input.provenance, at: now.toISOString() },
    state: "pending",
    conflicts,
    problems,
    readBack: needsReadBack ? buildChangeReadBack(h, partial) : undefined,
    createdAt: now.toISOString(),
  };
}

/** Problems with a queued change against the household as it is now. */
export function currentProblems(h: Household, cs: ChangeSet): string[] {
  const before = getEntity(h, cs.kind, cs.entityId);
  const problems: string[] = [];
  if (cs.op === "create" && before) problems.push(`${cs.kind} ${cs.entityId} already exists.`);
  if (cs.op !== "create" && !before) problems.push(`${cs.kind} ${cs.entityId} no longer exists.`);
  if (cs.op === "update" && cs.fields.length === 0) problems.push("Nothing changed.");
  return [...problems, ...validate(h, cs.kind, cs.op, cs.entityId, cs.after)];
}

export interface Confirmation {
  by: "user" | "assistant";
  acknowledgedReadBack?: string;
  /** Required when the change conflicts with a confirmed fact. */
  conflictResolution?: "replace_confirmed";
}

export interface ApplyResult {
  household: Household;
  change: ChangeSet;
  audit: AuditEntry[];
  decision?: Decision;
}

function setStatuses(entity: Obj, paths: string[], status: DataStatus): Obj {
  const out = structuredClone(entity);
  for (const p of paths) {
    if (isStatusPath(p)) continue;
    const owner = statusOwner(p.split("."), out);
    if (owner) (getPath(out, owner) as Obj).status = status;
  }
  return out;
}

function auditDetail(cs: ChangeSet, confirmation: string): ChangeAuditDetail {
  return {
    kind: cs.kind,
    entityId: cs.entityId,
    op: cs.op,
    fields: cs.fields,
    source: `${cs.provenance.source} (${cs.provenance.actor}, ${cs.provenance.confidence})`,
    confirmation,
    reviewRequirement: cs.gate,
    rulesVersion: RULES_VERSION,
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };
}

export function applyChange(h: Household, cs: ChangeSet, confirmation: Confirmation, now: Date = new Date()): ApplyResult {
  if (confirmation.by !== "user") throw new DecisionGuardError("Only the user can apply a change. Nothing is auto-confirmed.");
  if (cs.state !== "pending") throw new DecisionGuardError(`Change is already ${cs.state}.`);
  const problems = currentProblems(h, cs);
  if (problems.length) throw new DecisionGuardError(`Cannot apply: ${problems.join(" ")}`);
  if (cs.conflicts.length && confirmation.conflictResolution !== "replace_confirmed") {
    throw new DecisionGuardError("This change conflicts with confirmed information. Keep the existing value (reject) or explicitly replace it.");
  }
  if (cs.readBack && confirmation.acknowledgedReadBack !== cs.readBack) {
    throw new DecisionGuardError("The read-back was not acknowledged exactly.");
  }

  const ts = now.toISOString();
  const changedPaths = cs.fields.map((f) => f.path);
  let decision: Decision | undefined;
  let confirmationText: string;
  let next: Household;

  if (cs.op === "archive") {
    next = archiveEntity(h, cs.kind, cs.entityId, cs.id, ts);
    confirmationText = cs.readBack ? "read-back confirmed" : "confirmed";
  } else {
    let entity = cs.after as Obj;
    if (cs.gate === "confirm" || cs.gate === "explicit_confirm") {
      entity = setStatuses(entity, changedPaths, "confirmed");
      confirmationText = cs.gate === "explicit_confirm" || cs.conflicts.length ? "read-back confirmed" : "confirmed";
    } else if (cs.gate === "professional_review") {
      entity = setStatuses(entity, changedPaths, "attorney_required");
      confirmationText = "recorded as preference; attorney/CPA review required";
    } else {
      confirmationText = cs.conflicts.length ? "read-back confirmed (replaced confirmed value)" : "recorded";
    }
    if (cs.gate === "explicit_confirm" || cs.gate === "professional_review") {
      decision = {
        id: `dec-${cs.id}`,
        topic: cs.label,
        sensitivity: cs.sensitivity,
        answer: describeFields(h, cs.fields).join("; ") || cs.label,
        answeredBy: "user",
        state: cs.gate === "professional_review" ? "awaiting_professional_review" : "confirmed",
        readBack: cs.readBack,
        reviewer: cs.gate === "professional_review" ? "attorney" : undefined,
        createdAt: ts,
        updatedAt: ts,
        linked: { kind: cs.kind, entityId: cs.entityId, paths: changedPaths, changeId: cs.id },
      };
      if (cs.kind === "fiduciary" || cs.kind === "distribution") entity = { ...entity, decisionId: decision.id };
    }
    next = putEntity(h, cs.kind, entity);
  }

  const change: ChangeSet = { ...cs, state: "applied", resolvedAt: ts };
  const audit = [
    auditEntry("change.applied", cs.entityId, `${cs.op} ${cs.label}`, "user", now, auditDetail(cs, confirmationText)),
  ];
  next = {
    ...next,
    pendingChanges: (next.pendingChanges ?? []).filter((c) => c.id !== cs.id),
    decisions: decision ? [...next.decisions, decision] : next.decisions,
    audit: [...next.audit, ...audit],
  };
  return { household: next, change, audit, decision };
}

/** Keep the existing data; the proposal is recorded as rejected. */
export function rejectChange(h: Household, cs: ChangeSet, reason: string, now: Date = new Date()): { household: Household; audit: AuditEntry[] } {
  const audit = [auditEntry("change.rejected", cs.entityId, `${cs.label}: ${reason}`, "user", now, auditDetail(cs, `rejected: ${reason}`))];
  return {
    household: { ...h, pendingChanges: (h.pendingChanges ?? []).filter((c) => c.id !== cs.id), audit: [...h.audit, ...audit] },
    audit,
  };
}

/** Put a proposal in the review queue (conflicts are logged when flagged). */
export function queueChange(h: Household, cs: ChangeSet, now: Date = new Date()): Household {
  const audit = cs.conflicts.length
    ? [auditEntry("change.conflict_flagged", cs.entityId, `${cs.label}: conflicts with confirmed ${cs.conflicts.map((c) => c.path).join(", ")}`, "system", now, auditDetail(cs, "pending"))]
    : [];
  return { ...h, pendingChanges: [...(h.pendingChanges ?? []), cs], audit: [...h.audit, ...audit] };
}

/**
 * Entry point for forms: an invalid change is refused (nothing is queued, so
 * the user fixes the form), plain factual changes with no conflicts are
 * recorded immediately, and everything else goes to the review queue.
 */
export function submitChange(h: Household, input: ChangeInput, now: Date = new Date()): { household: Household; change: ChangeSet; applied: boolean } {
  const cs = proposeChange(h, input, now);
  if (cs.problems.length) return { household: h, change: cs, applied: false };
  if (cs.gate === "record" && cs.conflicts.length === 0 && input.provenance.actor === "user") {
    const r = applyChange(h, cs, { by: "user" }, now);
    return { household: r.household, change: r.change, applied: true };
  }
  return { household: queueChange(h, cs, now), change: cs, applied: false };
}

/**
 * Record the attorney's or CPA's outcome on a legal/tax decision. Settles
 * the decision and marks its linked fields confirmed.
 */
export function recordProfessionalOutcome(
  h: Household,
  decisionId: string,
  review: { reviewer: Reviewer; note: string },
  now: Date = new Date(),
): Household {
  const d = h.decisions.find((x) => x.id === decisionId);
  if (!d) throw new DecisionGuardError(`Decision ${decisionId} not found.`);
  const r = recordProfessionalReview(d, review, now);
  let next: Household = { ...h, decisions: h.decisions.map((x) => (x.id === d.id ? r.decision : x)), audit: [...h.audit, ...r.audit] };
  if (d.linked) {
    const entity = getEntity(next, d.linked.kind as EntityKind, d.linked.entityId);
    if (entity) next = putEntity(next, d.linked.kind as EntityKind, setStatuses(entity, d.linked.paths, "confirmed"));
  }
  return next;
}

export function pendingConflicts(h: Household): ChangeSet[] {
  return (h.pendingChanges ?? []).filter((c) => c.conflicts.length > 0);
}
