/**
 * Household data-format versioning, migration, and validation.
 *
 * Anything loaded from storage or an import file goes through
 * `parseHousehold`, which migrates older versions forward and rejects data
 * it cannot safely interpret (it never guesses or silently drops fields).
 */
import { DATA_STATUSES, type Household } from "./types.ts";

export const CURRENT_SCHEMA_VERSION = 3;

export class SchemaError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Household data is not valid:\n- ${problems.join("\n- ")}`);
    this.name = "SchemaError";
    this.problems = problems;
  }
}

type Migration = (h: Record<string, unknown>) => Record<string, unknown>;

/** MIGRATIONS[n] upgrades version n to n + 1. */
const MIGRATIONS: Record<number, Migration> = {
  // v0: MVP data saved before schemaVersion existed. Same shape.
  0: (h) => ({ ...h, schemaVersion: 1 }),
  // v1 -> v2: change pipeline adds a review queue and an archive.
  1: (h) => ({ ...h, schemaVersion: 2, pendingChanges: h.pendingChanges ?? [], archived: h.archived ?? [] }),
  // v2 -> v3: annual review history.
  2: (h) => ({ ...h, schemaVersion: 3, annualReviews: h.annualReviews ?? [] }),
};

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const STATUSES = new Set<string>(DATA_STATUSES);

function checkTracked(x: unknown, path: string, problems: string[]) {
  if (x === undefined) return;
  if (!isObj(x) || !("value" in x) || !STATUSES.has(String(x.status))) problems.push(`${path}: expected { value, status } with a valid status`);
}

export function validateHousehold(h: Record<string, unknown>): string[] {
  const problems: string[] = [];
  for (const k of ["id", "label"]) if (typeof h[k] !== "string") problems.push(`${k}: expected string`);
  if (typeof h.isFictional !== "boolean") problems.push("isFictional: expected boolean");
  for (const k of ["people", "relationships", "fiduciaries", "assets", "decisions", "audit", "pendingChanges", "archived", "annualReviews"]) {
    if (!Array.isArray(h[k])) problems.push(`${k}: expected array`);
  }
  checkTracked(h.maritalStatus, "maritalStatus", problems);
  if (!isObj(h.plan)) problems.push("plan: expected object");
  else {
    if (typeof h.plan.jurisdiction !== "string") problems.push("plan.jurisdiction: expected string");
    if (!Array.isArray(h.plan.distributions)) problems.push("plan.distributions: expected array");
    if (!Array.isArray(h.plan.documents)) problems.push("plan.documents: expected array");
  }
  const ids = new Set<string>();
  for (const [i, p] of arr(h.people).entries()) {
    if (!isObj(p) || typeof p.id !== "string" || typeof p.displayName !== "string") problems.push(`people[${i}]: expected id and displayName`);
    else if (ids.has(p.id)) problems.push(`people[${i}]: duplicate id ${p.id}`);
    else ids.add(p.id);
  }
  for (const [i, a] of arr(h.assets).entries()) {
    if (!isObj(a) || typeof a.id !== "string" || typeof a.category !== "string" || !isObj(a.funding)) problems.push(`assets[${i}]: expected id, category, funding`);
    else {
      checkTracked(a.titledTo, `assets[${i}].titledTo`, problems);
      if (typeof a.refLast4 === "string" && !/^\d{0,4}$/.test(a.refLast4)) problems.push(`assets[${i}].refLast4: at most 4 digits`);
    }
  }
  if (isObj(h.plan)) {
    for (const [i, d] of arr(h.plan.documents).entries()) {
      if (!isObj(d) || typeof d.id !== "string" || typeof d.kind !== "string" || !["not_started", "drafting", "attorney_reviewed", "executed"].includes(String(d.stage))) {
        problems.push(`plan.documents[${i}]: expected id, kind, and a valid stage`);
      }
    }
  }
  for (const [i, f] of arr(h.fiduciaries).entries()) {
    if (!isObj(f) || !STATUSES.has(String(f.status))) problems.push(`fiduciaries[${i}]: invalid status`);
  }
  return problems;
}

/** Migrate and validate untrusted input into a Household, or throw SchemaError. */
export function parseHousehold(raw: unknown): Household {
  if (!isObj(raw)) throw new SchemaError(["expected a household object"]);
  let h: Record<string, unknown> = { ...raw };
  let v = typeof h.schemaVersion === "number" ? h.schemaVersion : 0;
  if (!Number.isInteger(v) || v < 0) throw new SchemaError([`schemaVersion: invalid value ${String(h.schemaVersion)}`]);
  if (v > CURRENT_SCHEMA_VERSION) {
    throw new SchemaError([`schemaVersion ${v} was written by a newer FamilyVault (this build supports up to ${CURRENT_SCHEMA_VERSION}). Update the app before loading it.`]);
  }
  while (v < CURRENT_SCHEMA_VERSION) {
    const m = MIGRATIONS[v];
    if (!m) throw new SchemaError([`no migration from schemaVersion ${v}`]);
    h = m(h);
    v += 1;
  }
  const problems = validateHousehold(h);
  if (problems.length) throw new SchemaError(problems);
  return h as unknown as Household;
}
