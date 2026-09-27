/**
 * Generic, spec-driven entity forms. A form only produces a *proposal*:
 * saving calls onSubmit with the edited entity, and the change pipeline
 * decides whether it is recorded, confirmed, or queued for review.
 */
import { useState } from "react";
import type { EntityKind } from "../domain/entities.ts";
import type { Household } from "../domain/types.ts";
import { DOCUMENT_KINDS, DOCUMENT_STAGES, kindInfo } from "../domain/documents.ts";

type Obj = Record<string, unknown>;

export type FieldType =
  | "text" | "number" | "checkbox" | "select" | "person" | "people" | "asset" | "date"
  | "tracked-text" | "tracked-number" | "tracked-select" | "tracked-bool" | "tracked-people" | "designations";

export interface FieldSpec {
  path: string;
  label: string;
  type: FieldType;
  options?: string[];
  /** Display labels for select options, when they differ from the stored value. */
  optionLabels?: Record<string, string>;
  help?: string;
  /** Show the field only when this returns true for the current draft. */
  showIf?: (draft: Record<string, unknown>) => boolean;
}

const opts = (...xs: string[]) => xs;

export const FORM_SPECS: Record<EntityKind, FieldSpec[]> = {
  person: [
    { path: "displayName", label: "Name", type: "text", help: "Fictional names only in a public/demo build." },
    { path: "kind", label: "Type", type: "select", options: opts("person", "trust", "charity", "entity") },
    { path: "isGrantor", label: "Grantor (creating the trust)", type: "checkbox" },
    { path: "isMinor", label: "Minor", type: "checkbox" },
    { path: "hasSpecialNeeds", label: "Special needs", type: "tracked-bool" },
    { path: "notes", label: "Notes", type: "text" },
  ],
  relationship: [
    { path: "from", label: "Person", type: "person" },
    { path: "type", label: "Relationship", type: "select", options: opts("spouse", "child", "stepchild", "grandchild", "parent", "sibling", "other_family", "friend") },
    { path: "to", label: "Of", type: "person" },
  ],
  fiduciary: [
    { path: "personId", label: "Person", type: "person" },
    { path: "role", label: "Role", type: "select", options: opts("trustee", "successor_trustee", "guardian_of_person", "guardian_of_estate", "executor", "financial_agent", "healthcare_agent") },
    { path: "order", label: "Order (1 = primary, 2+ = alternates)", type: "number" },
    { path: "forPersonIds", label: "For (guardians/agents)", type: "people" },
  ],
  asset: [
    { path: "label", label: "Description", type: "text" },
    { path: "category", label: "Category", type: "select", options: opts("real_estate", "bank", "brokerage", "business_interest", "vehicle", "personal_property", "digital", "ira", "401k", "tsp", "life_insurance", "annuity", "hsa") },
    { path: "refLast4", label: "Last 4 digits only", type: "text", help: "Never enter a full account number." },
    { path: "approximateValue", label: "Approximate value ($)", type: "tracked-number" },
    { path: "titledTo", label: "Titled to / owned by", type: "tracked-people" },
    { path: "character", label: "Community or separate", type: "tracked-select", options: opts("community", "separate_grantor_a", "separate_grantor_b", "mixed") },
    { path: "isHomestead", label: "Residence homestead", type: "tracked-bool" },
    { path: "hasMortgage", label: "Has mortgage", type: "tracked-bool" },
    { path: "funding.method", label: "Funding method", type: "select", options: opts("deed", "retitle", "assignment", "beneficiary_designation", "leave_outside", "instructions", "undecided") },
    { path: "funding.deedRecorded", label: "Deed recorded", type: "tracked-bool" },
    { path: "designations", label: "Beneficiary designations (retirement/insurance)", type: "designations", showIf: (d) => ["ira", "401k", "tsp", "life_insurance", "annuity", "hsa"].includes(String(d.category)) },
    { path: "notes", label: "Notes", type: "text" },
  ],
  distribution: [
    { path: "beneficiaryId", label: "Beneficiary", type: "person" },
    { path: "tier", label: "Tier", type: "select", options: opts("primary", "contingent") },
    { path: "sharePercent", label: "Share (%)", type: "tracked-number" },
    { path: "terms", label: "Terms (e.g. outright, or held until an age)", type: "tracked-text" },
  ],
  document: [
    { path: "kind", label: "Document", type: "select", options: DOCUMENT_KINDS.map((k) => k.kind), optionLabels: Object.fromEntries(DOCUMENT_KINDS.map((k) => [k.kind, k.label])) },
    { path: "forPersonId", label: "Whose document", type: "person", showIf: (d) => kindInfo(String(d.kind))?.scope === "person" },
    { path: "forAssetId", label: "Property being deeded", type: "asset", showIf: (d) => kindInfo(String(d.kind))?.scope === "asset" },
    { path: "stage", label: "Stage", type: "select", options: DOCUMENT_STAGES.map((s) => s.stage), optionLabels: Object.fromEntries(DOCUMENT_STAGES.map((s) => [s.stage, s.label])), help: "Record where things stand with your attorney. FamilyVault never drafts, finalizes, or signs documents." },
    { path: "executedOn", label: "Date signed (YYYY-MM-DD)", type: "date", showIf: (d) => d.stage === "executed" },
    { path: "storageReference", label: "Where the signed original is kept", type: "text", help: "A location only, e.g. \"attorney's vault\" or \"home safe, folder A\". Never upload the document or enter account numbers." },
    { path: "notes", label: "Notes", type: "text" },
  ],
  household: [
    { path: "label", label: "Household label", type: "text" },
    { path: "maritalStatus", label: "Marital status", type: "tracked-select", options: opts("married", "single", "widowed", "divorced") },
    { path: "lastAnnualReview", label: "Last annual review (YYYY-MM-DD)", type: "text" },
  ],
  plan: [
    { path: "name", label: "Trust name", type: "text" },
    { path: "type", label: "Trust structure (legal decision: attorney review)", type: "tracked-select", options: opts("revocable_joint", "revocable_individual", "irrevocable", "undecided") },
    { path: "digitalAssetInstructions", label: "Where digital-asset instructions are kept (never passwords)", type: "tracked-text" },
    { path: "incapacityPlan.definitionOfIncapacity", label: "Definition of incapacity", type: "tracked-text" },
  ],
};

export const DEFAULTS: Partial<Record<EntityKind, Obj>> = {
  person: { kind: "person", displayName: "" },
  relationship: { from: "", to: "", type: "child", status: "known" },
  fiduciary: { personId: "", role: "successor_trustee", order: 1, status: "known" },
  asset: { label: "", category: "bank", titledTo: { value: [], status: "unknown" }, funding: { method: "undecided", state: "not_started" } },
  distribution: { beneficiaryId: "", tier: "primary", sharePercent: { value: null, status: "unknown" }, terms: { value: null, status: "unknown" } },
  document: { kind: "trust_agreement", stage: "not_started" },
};

const EDITABLE_STATUSES = ["known", "unknown", "needs_review", "attorney_required"];

function getPath(o: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((cur, k) => (cur && typeof cur === "object" ? (cur as Obj)[k] : undefined), o);
}

function setPath(o: Obj, path: string, value: unknown): Obj {
  const [head, ...rest] = path.split(".");
  if (rest.length === 0) return { ...o, [head]: value };
  return { ...o, [head]: setPath(((o[head] as Obj) ?? {}), rest.join("."), value) };
}

function PersonSelect({ h, value, onChange }: { h: Household; value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">— choose —</option>
      {h.people.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
    </select>
  );
}

function PeopleChecks({ h, value, onChange }: { h: Household; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="row">
      {h.people.map((p) => (
        <label key={p.id} className="check">
          <input type="checkbox" checked={value.includes(p.id)} onChange={(e) => onChange(e.target.checked ? [...value, p.id] : value.filter((x) => x !== p.id))} />
          {p.displayName}
        </label>
      ))}
    </div>
  );
}

function Tracked({ current, onChange, children }: { current: Obj | undefined; onChange: (t: Obj) => void; children: (value: unknown, set: (v: unknown) => void) => React.ReactNode }) {
  const t = current ?? { value: null, status: "unknown" };
  const statuses = t.status === "confirmed" ? ["confirmed", ...EDITABLE_STATUSES] : EDITABLE_STATUSES;
  return (
    <div className="tracked">
      <div className="tracked-value">{children(t.value, (v) => onChange({ ...t, value: v, status: t.status === "unknown" && v !== null && v !== "" ? "known" : t.status }))}</div>
      <select aria-label="status" value={String(t.status)} onChange={(e) => onChange({ ...t, status: e.target.value })}>
        {statuses.map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}
      </select>
    </div>
  );
}

function Designations({ h, value, onChange }: { h: Household; value: Obj[]; onChange: (v: Obj[]) => void }) {
  const set = (i: number, k: string, v: unknown) => onChange(value.map((d, j) => (j === i ? { ...d, [k]: v } : d)));
  return (
    <div>
      {value.map((d, i) => (
        <div className="row" key={i}>
          <select value={String(d.tier)} onChange={(e) => set(i, "tier", e.target.value)} style={{ width: "auto" }}>
            <option value="primary">primary</option><option value="contingent">contingent</option>
          </select>
          <select value={String(d.personId)} onChange={(e) => set(i, "personId", e.target.value)} style={{ width: "auto" }}>
            <option value="">— choose —</option>
            <option value="trust">{h.plan.name} (trust)</option>
            {h.people.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
          </select>
          <input type="number" min={0} max={100} value={Number(d.sharePercent)} onChange={(e) => set(i, "sharePercent", Number(e.target.value))} style={{ width: 90 }} />%
          <button className="secondary" type="button" onClick={() => onChange(value.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <button className="secondary" type="button" onClick={() => onChange([...value, { personId: "", tier: "primary", sharePercent: 100 }])}>Add designation</button>
    </div>
  );
}

export function EntityForm({ h, kind, entity, isNew, onSubmit, onCancel }: {
  h: Household;
  kind: EntityKind;
  entity: Obj | null;
  isNew?: boolean;
  onSubmit: (draft: Obj) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Obj>(() => structuredClone(entity ?? DEFAULTS[kind] ?? {}));
  const update = (path: string, v: unknown) => setDraft((d) => setPath(d, path, v));

  const field = (f: FieldSpec) => {
    const v = getPath(draft, f.path);
    switch (f.type) {
      case "text": return <input value={String(v ?? "")} onChange={(e) => update(f.path, e.target.value || undefined)} />;
      case "number": return <input type="number" value={Number(v ?? 0)} onChange={(e) => update(f.path, Number(e.target.value))} />;
      case "checkbox": return <input type="checkbox" checked={Boolean(v)} onChange={(e) => update(f.path, e.target.checked)} style={{ width: "auto" }} />;
      case "select": return <select value={String(v ?? "")} onChange={(e) => update(f.path, e.target.value)}>{f.options!.map((o) => <option key={o} value={o}>{f.optionLabels?.[o] ?? o.replace(/_/g, " ")}</option>)}</select>;
      case "asset": return (
        <select value={String(v ?? "")} onChange={(e) => update(f.path, e.target.value || undefined)}>
          <option value="">— choose —</option>
          {h.assets.filter((a) => a.category === "real_estate").map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
        </select>
      );
      case "date": return <input type="date" value={String(v ?? "")} onChange={(e) => update(f.path, e.target.value || undefined)} />;
      case "person": return <PersonSelect h={h} value={String(v ?? "")} onChange={(x) => update(f.path, x)} />;
      case "people": return <PeopleChecks h={h} value={(v as string[]) ?? []} onChange={(x) => update(f.path, x.length ? x : undefined)} />;
      case "tracked-text": return <Tracked current={v as Obj} onChange={(t) => update(f.path, t)}>{(val, set) => <input value={String(val ?? "")} onChange={(e) => set(e.target.value || null)} />}</Tracked>;
      case "tracked-number": return <Tracked current={v as Obj} onChange={(t) => update(f.path, t)}>{(val, set) => <input type="number" value={val === null || val === undefined ? "" : Number(val)} onChange={(e) => set(e.target.value === "" ? null : Number(e.target.value))} />}</Tracked>;
      case "tracked-select": return <Tracked current={v as Obj} onChange={(t) => update(f.path, t)}>{(val, set) => <select value={String(val ?? "")} onChange={(e) => set(e.target.value || null)}><option value="">— unknown —</option>{f.options!.map((o) => <option key={o} value={o}>{o.replace(/_/g, " ")}</option>)}</select>}</Tracked>;
      case "tracked-bool": return <Tracked current={v as Obj} onChange={(t) => update(f.path, t)}>{(val, set) => <select value={val === null || val === undefined ? "" : String(val)} onChange={(e) => set(e.target.value === "" ? null : e.target.value === "true")}><option value="">— unknown —</option><option value="true">yes</option><option value="false">no</option></select>}</Tracked>;
      case "tracked-people": return <Tracked current={v as Obj} onChange={(t) => update(f.path, t)}>{(val, set) => <PeopleChecks h={h} value={(val as string[]) ?? []} onChange={set} />}</Tracked>;
      case "designations": return <Tracked current={v as Obj} onChange={(t) => update(f.path, t)}>{(val, set) => <Designations h={h} value={(val as Obj[]) ?? []} onChange={set} />}</Tracked>;
    }
  };

  return (
    <form className="card form" onSubmit={(e) => {
      e.preventDefault();
      // Drop values of fields that are hidden for this draft (e.g. a deed's property after switching to a will).
      let clean = draft;
      for (const f of FORM_SPECS[kind]) if (f.showIf && !f.showIf(draft) && getPath(clean, f.path) !== undefined) clean = setPath(clean, f.path, undefined);
      onSubmit(clean);
    }}>
      <h3>{entity && !isNew ? "Edit" : "Add"} {kind}</h3>
      {FORM_SPECS[kind].filter((f) => !f.showIf || f.showIf(draft)).map((f) => (
        <label key={f.path} className="field">
          <span>{f.label}</span>
          {field(f)}
          {f.help && <small className="muted">{f.help}</small>}
        </label>
      ))}
      <p className="muted">Saving proposes this change. Beneficiary, fiduciary, and legal/tax changes, or anything that replaces confirmed information, go to Review for confirmation.</p>
      <div className="row">
        <button className="primary" type="submit">Save</button>
        <button className="secondary" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}
