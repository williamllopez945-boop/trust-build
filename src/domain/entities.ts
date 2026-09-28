/**
 * Uniform access to the editable entities of a Household, so every create,
 * update, and archive goes through one code path (src/domain/changes.ts).
 * Archived entities are moved to `h.archived`, never deleted.
 */
import type { Household } from "./types.ts";

export type EntityKind = "person" | "relationship" | "fiduciary" | "asset" | "distribution" | "document" | "household" | "plan";

export const SINGLETON_KINDS: ReadonlySet<EntityKind> = new Set(["household", "plan"]);

export interface ArchivedEntity {
  kind: EntityKind;
  entity: Record<string, unknown>;
  archivedAt: string;
  changeId: string;
}

type Entity = Record<string, unknown> & { id?: string };

const HOUSEHOLD_FIELDS = ["label", "maritalStatus", "lastAnnualReview"] as const;
const PLAN_FIELDS = ["name", "type", "digitalAssetInstructions", "incapacityPlan"] as const;

function list(h: Household, kind: EntityKind): Entity[] {
  switch (kind) {
    case "person": return h.people as unknown as Entity[];
    case "relationship": return h.relationships as unknown as Entity[];
    case "fiduciary": return h.fiduciaries as unknown as Entity[];
    case "asset": return h.assets as unknown as Entity[];
    case "distribution": return h.plan.distributions as unknown as Entity[];
    case "document": return h.plan.documents as unknown as Entity[];
    default: throw new Error(`${kind} is not a list entity`);
  }
}

function pick(obj: Record<string, unknown>, keys: readonly string[]): Entity {
  return Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));
}

export function getEntity(h: Household, kind: EntityKind, id: string): Entity | null {
  if (kind === "household") return pick(h as unknown as Record<string, unknown>, HOUSEHOLD_FIELDS);
  if (kind === "plan") return pick(h.plan as unknown as Record<string, unknown>, PLAN_FIELDS);
  return list(h, kind).find((e) => e.id === id) ?? null;
}

function withList(h: Household, kind: EntityKind, next: Entity[]): Household {
  switch (kind) {
    case "person": return { ...h, people: next as unknown as Household["people"] };
    case "relationship": return { ...h, relationships: next as unknown as Household["relationships"] };
    case "fiduciary": return { ...h, fiduciaries: next as unknown as Household["fiduciaries"] };
    case "asset": return { ...h, assets: next as unknown as Household["assets"] };
    case "distribution": return { ...h, plan: { ...h.plan, distributions: next as unknown as Household["plan"]["distributions"] } };
    case "document": return { ...h, plan: { ...h.plan, documents: next as unknown as Household["plan"]["documents"] } };
    default: throw new Error(`${kind} is not a list entity`);
  }
}

/** Insert or replace an entity. */
export function putEntity(h: Household, kind: EntityKind, entity: Entity): Household {
  if (kind === "household") return { ...h, ...pick(entity, HOUSEHOLD_FIELDS) } as Household;
  if (kind === "plan") return { ...h, plan: { ...h.plan, ...pick(entity, PLAN_FIELDS) } } as Household;
  const current = list(h, kind);
  const exists = current.some((e) => e.id === entity.id);
  return withList(h, kind, exists ? current.map((e) => (e.id === entity.id ? entity : e)) : [...current, entity]);
}

export function archiveEntity(h: Household, kind: EntityKind, id: string, changeId: string, at: string): Household {
  if (SINGLETON_KINDS.has(kind)) throw new Error(`${kind} cannot be archived`);
  const entity = getEntity(h, kind, id);
  if (!entity) throw new Error(`${kind} ${id} not found`);
  const next = withList(h, kind, list(h, kind).filter((e) => e.id !== id));
  return { ...next, archived: [...(h.archived ?? []), { kind, entity, archivedAt: at, changeId }] };
}

/** Other entities that point at a person (blocks archiving that person). */
export function referencesTo(h: Household, personId: string): string[] {
  const refs: string[] = [];
  for (const f of h.fiduciaries) if (f.personId === personId || (f.forPersonIds ?? []).includes(personId)) refs.push(`fiduciary ${f.id} (${f.role})`);
  for (const d of h.plan.distributions) if (d.beneficiaryId === personId) refs.push(`distribution ${d.id}`);
  for (const r of h.relationships) if (r.from === personId || r.to === personId) refs.push(`relationship ${r.id}`);
  for (const d of h.plan.documents) if (d.forPersonId === personId) refs.push(`document ${d.id} (${d.kind})`);
  for (const a of h.assets) {
    if ((a.titledTo.value ?? []).includes(personId)) refs.push(`asset ${a.id} (titled to)`);
    if ((a.designations?.value ?? []).some((d) => d.personId === personId)) refs.push(`asset ${a.id} (designation)`);
  }
  return refs;
}

/** Documents that point at an asset (blocks archiving that asset). */
export function assetReferences(h: Household, assetId: string): string[] {
  return h.plan.documents.filter((d) => d.forAssetId === assetId).map((d) => `document ${d.id} (${d.kind})`);
}

export function newId(prefix: string, now: Date = new Date()): string {
  return `${prefix}-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
