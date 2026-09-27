/**
 * Maps structured intake answers to proposed estate-graph changes.
 *
 * The mapping never invents values: every change is built only from what the
 * user selected or typed. Proposals go to the review queue; nothing is applied
 * here. Existing entities are updated in place (so conflicts with confirmed
 * facts are detected) rather than duplicated.
 */
import type { ChangeInput } from "../domain/changes.ts";
import { grantors, minors } from "../domain/estateGraph.ts";
import { newId } from "../domain/entities.ts";
import type { FiduciaryRole, Household, PropertyCharacter } from "../domain/types.ts";
import type { IntakeQuestion } from "./questions.ts";

export type IntakeAnswer =
  | { kind: "choice"; value: string }
  | { kind: "new_people"; people: { displayName: string; isMinor: boolean }[] }
  | { kind: "pick_asset"; assetId: string | null }
  | { kind: "asset_character"; characters: Record<string, PropertyCharacter | "unsure"> }
  | { kind: "ordered_people"; personIds: string[] }
  | { kind: "shares"; rows: { personId: string; sharePercent: number }[] }
  | { kind: "distribution_terms"; terms: Record<string, string> }
  | { kind: "text"; text: string };

export class IntakeMappingError extends Error {}

export function mapIntakeAnswer(h: Household, q: IntakeQuestion, answer: IntakeAnswer, now: Date = new Date()): ChangeInput[] {
  if (answer.kind !== q.input.kind) throw new IntakeMappingError(`Question ${q.id} expects a ${q.input.kind} answer.`);
  const batchId = newId("batch", now);
  const provenance = { source: "intake" as const, actor: "user" as const, confidence: "stated" as const, intakeQuestionId: q.id };
  const base = { batchId, provenance };

  switch (answer.kind) {
    case "choice": {
      if (q.input.kind !== "choice" || !q.input.options.some((o) => o.value === answer.value)) throw new IntakeMappingError("Choose one of the listed options.");
      if (q.id === "q.marital") {
        return [{ ...base, kind: "household", op: "update", label: "Marital status", after: { maritalStatus: { value: answer.value, status: "known" } } }];
      }
      if (q.id === "q.trust_type") {
        return [{ ...base, kind: "plan", op: "update", label: "Trust structure preference", after: { type: { value: answer.value, status: "known" } } }];
      }
      throw new IntakeMappingError(`No mapping for ${q.id}.`);
    }

    case "new_people": {
      const rel = q.input.kind === "new_people" ? q.input.relationship : "child";
      const out: ChangeInput[] = [];
      for (const [i, p] of answer.people.entries()) {
        const name = p.displayName.trim();
        if (!name) continue;
        const existing = h.people.find((x) => x.displayName.toLowerCase() === name.toLowerCase());
        const personId = existing?.id ?? newId(`p${i}`, now);
        if (!existing) out.push({ ...base, kind: "person", op: "create", label: `Add ${name}`, after: { id: personId, kind: "person", displayName: name, isMinor: p.isMinor } });
        for (const g of grantors(h)) {
          if (h.relationships.some((r) => r.from === g.id && r.to === personId)) continue;
          out.push({ ...base, kind: "relationship", op: "create", label: `${name} is ${rel} of ${g.displayName}`, after: { id: newId(`r${i}`, now), from: g.id, to: personId, type: rel, status: "known" } });
        }
      }
      return out;
    }

    case "pick_asset": {
      return h.assets
        .filter((a) => a.category === "real_estate")
        .filter((a) => (a.isHomestead?.value ?? null) !== (a.id === answer.assetId))
        .map((a) => ({ ...base, kind: "asset" as const, op: "update" as const, label: `Homestead status: ${a.label}`, entityId: a.id, after: { isHomestead: { value: a.id === answer.assetId, status: "known" } } }));
    }

    case "asset_character": {
      const out: ChangeInput[] = [];
      for (const [assetId, c] of Object.entries(answer.characters)) {
        const a = h.assets.find((x) => x.id === assetId);
        if (!a) continue;
        const next = c === "unsure" ? { value: a.character?.value ?? null, status: "needs_review" } : { value: c, status: "known" };
        if (JSON.stringify(next) === JSON.stringify(a.character)) continue;
        out.push({ ...base, kind: "asset", op: "update", entityId: assetId, label: `Property character: ${a.label}`, after: { character: next } });
      }
      return out;
    }

    case "ordered_people": {
      const role: FiduciaryRole = q.id === "q.guardian" ? "guardian_of_person" : "successor_trustee";
      const ids = answer.personIds.filter(Boolean);
      if (new Set(ids).size !== ids.length) throw new IntakeMappingError("Each person can be listed only once.");
      const forPersonIds = role === "guardian_of_person" ? minors(h).map((m) => m.id) : undefined;
      const current = h.fiduciaries.filter((f) => f.role === role);
      return ids.map((personId, i) => {
        const order = i + 1;
        const existing = current.find((f) => f.order === order);
        const label = `${role === "guardian_of_person" ? "Guardian" : "Successor trustee"} ${order === 1 ? "(primary)" : `(alternate ${order - 1})`}`;
        return existing
          ? { ...base, kind: "fiduciary" as const, op: "update" as const, entityId: existing.id, label, after: { personId, ...(forPersonIds ? { forPersonIds } : {}) } }
          : { ...base, kind: "fiduciary" as const, op: "create" as const, label, after: { id: newId("f", now), personId, role, order, status: "known", ...(forPersonIds ? { forPersonIds } : {}) } };
      });
    }

    case "shares": {
      const rows = answer.rows.filter((r) => r.personId);
      const total = rows.reduce((s, r) => s + r.sharePercent, 0);
      if (rows.length && total !== 100) throw new IntakeMappingError(`Shares total ${total}%. They must total 100%.`);
      return rows.map((r) => {
        const existing = h.plan.distributions.find((d) => d.tier === "primary" && d.beneficiaryId === r.personId);
        const label = `Trust share for ${h.people.find((p) => p.id === r.personId)?.displayName ?? r.personId}`;
        return existing
          ? { ...base, kind: "distribution" as const, op: "update" as const, entityId: existing.id, label, after: { sharePercent: { value: r.sharePercent, status: "known" } } }
          : { ...base, kind: "distribution" as const, op: "create" as const, label, after: { id: newId("dist", now), beneficiaryId: r.personId, tier: "primary", sharePercent: { value: r.sharePercent, status: "known" }, terms: { value: null, status: "unknown" } } };
      });
    }

    case "distribution_terms": {
      const out: ChangeInput[] = [];
      for (const [distId, text] of Object.entries(answer.terms)) {
        const d = h.plan.distributions.find((x) => x.id === distId);
        if (!d || !text.trim() || d.terms.value === text.trim()) continue;
        out.push({ ...base, kind: "distribution", op: "update", entityId: distId, label: `Distribution terms for ${h.people.find((p) => p.id === d.beneficiaryId)?.displayName ?? d.beneficiaryId}`, after: { terms: { value: text.trim(), status: "known" } } });
      }
      return out;
    }

    case "text": {
      const text = answer.text.trim();
      if (!text) return [];
      if (q.id === "q.incapacity") {
        return [{ ...base, kind: "plan", op: "update", label: "Definition of incapacity", after: { incapacityPlan: { ...h.plan.incapacityPlan, definitionOfIncapacity: { value: text, status: "known" } } } }];
      }
      throw new IntakeMappingError(`No mapping for ${q.id}.`);
    }
  }
}
