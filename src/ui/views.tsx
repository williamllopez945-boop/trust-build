import { useMemo, useState } from "react";
import { buildEstateGraph, fiduciariesFor, nameOf, TRUST_NODE_ID } from "../domain/estateGraph.ts";
import { BADGE_ICON, fundingSummary } from "../domain/funding.ts";
import { confirmDecision, statusOf, unresolved, type Decision, type Reviewer } from "../domain/decisions.ts";
import { auditEntry, type AuditEntry } from "../domain/audit.ts";
import { recordProfessionalOutcome, type ChangeInput } from "../domain/changes.ts";
import type { EntityKind } from "../domain/entities.ts";
import { REFERENCE_CAVEAT, type ReviewFlag } from "../domain/rules.ts";
import { controlFor, type FiduciaryRole, type FundingState, type Household } from "../domain/types.ts";
import { answerQuestion, askProfessional, nextQuestion, seeksProfessionalAdvice, skipQuestion, type IntakeState } from "../intake/intake.ts";
import type { IntakeAnswer } from "../intake/mapping.ts";
import { QUESTIONS, type IntakeQuestion } from "../intake/questions.ts";
import { EntityForm } from "./forms.tsx";
import { generateAttorneyPacket } from "../packet/attorneyPacket.ts";
import { ruleSetsFor } from "../../rules/index.ts";
import { Progress, StatusPill, Table } from "./components.tsx";

export interface ViewProps {
  h: Household;
  flags: ReviewFlag[];
  update: (fn: (h: Household) => Household) => void;
  /** Send a proposed change through the change pipeline. */
  submit: (input: ChangeInput) => void;
  goto: (view: string) => void;
}

type Obj = Record<string, unknown>;
type Editing = { kind: EntityKind; entity: Obj | null; isNew?: boolean } | null;

const formProvenance = { source: "form" as const, actor: "user" as const, confidence: "stated" as const };

/** Hook: which entity (if any) is open in a form, and how to save/archive it. */
function useEditor(submit: ViewProps["submit"]) {
  const [editing, setEditing] = useState<Editing>(null);
  const save = (draft: Obj) => {
    if (!editing) return;
    const { kind, entity, isNew } = editing;
    const create = isNew || (!entity && kind !== "household" && kind !== "plan");
    submit({ kind, op: create ? "create" : "update", entityId: create ? undefined : (entity?.id as string | undefined), after: draft, provenance: formProvenance });
    setEditing(null);
  };
  const archive = (kind: EntityKind, id: string, label: string) => submit({ kind, op: "archive", entityId: id, label: `Archive ${label}`, provenance: formProvenance });
  const form = (h: Household) => editing && <EntityForm key={`${editing.kind}-${String(editing.entity?.id ?? "new")}`} h={h} kind={editing.kind} entity={editing.entity} isNew={editing.isNew} onSubmit={save} onCancel={() => setEditing(null)} />;
  return { editing, setEditing, archive, form };
}

const Actions = ({ onEdit, onArchive }: { onEdit: () => void; onArchive?: () => void }) => (
  <span className="row no-print"><button className="link" onClick={onEdit}>Edit</button>{onArchive && <button className="link" onClick={onArchive}>Archive</button>}</span>
);

const addAudit = (h: Household, entries: AuditEntry[]): Household => ({ ...h, audit: [...h.audit, ...entries] });

// ---------------------------------------------------------------------------

export function Dashboard({ h, flags }: ViewProps) {
  const funding = fundingSummary(h.assets);
  const open = unresolved(h.decisions);
  const count = (s: ReviewFlag["severity"]) => flags.filter((f) => f.severity === s).length;
  return (
    <>
      <h2>{h.plan.name}</h2>
      <div className="grid">
        <div className="card"><div className="muted">Funding progress</div><div className="stat">{funding.percent}%</div><Progress percent={funding.percent} /><div className="muted">{funding.done} of {funding.total} assets resolved</div></div>
        <div className="card"><div className="muted">Attorney-required flags</div><div className="stat s-attorney_required">{count("attorney_required")}</div><div className="muted">{count("review")} review · {count("info")} info</div></div>
        <div className="card"><div className="muted">Unresolved decisions</div><div className="stat">{open.length}</div><div className="muted">{open.filter((d) => d.state === "awaiting_professional_review").length} awaiting attorney/CPA</div></div>
        <div className="card"><div className="muted">People in estate graph</div><div className="stat">{h.people.length}</div><div className="muted">{h.assets.length} assets · {h.fiduciaries.length} fiduciary roles</div></div>
      </div>
      <div className="card">
        <h3>Funding at a glance</h3>
        <Table headers={["Asset", "Status"]} rows={funding.rows.map((r) => [r.label, `${BADGE_ICON[r.badge]} ${r.text}`])} />
      </div>
      <div className="card">
        <h3>Top review flags</h3>
        <Table headers={["Severity", "Flag"]} rows={flags.slice(0, 5).map((f) => [<StatusPill status={f.severity} />, f.title])} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

const EDGE_COLOR: Record<string, string> = {
  relationship: "var(--muted)", fiduciary: "var(--info)", owns: "var(--line)", funded_into: "var(--ok)",
  beneficiary_primary: "var(--warn)", beneficiary_contingent: "var(--warn)", trust_distribution: "var(--accent)",
};

export function EstateMap({ h }: ViewProps) {
  const g = useMemo(() => buildEstateGraph(h), [h]);
  const people = g.nodes.filter((n) => n.type === "person");
  const assets = g.nodes.filter((n) => n.type === "asset");
  const rowH = 44;
  const height = Math.max(people.length, assets.length) * rowH + 40;
  const pos = new Map<string, { x: number; y: number }>();
  people.forEach((n, i) => pos.set(n.id, { x: 200, y: 30 + i * rowH }));
  assets.forEach((n, i) => pos.set(n.id, { x: 800, y: 30 + i * rowH }));
  pos.set(TRUST_NODE_ID, { x: 500, y: height / 2 });
  const [filter, setFilter] = useState<string>("all");
  const edges = g.edges.filter((e) => e.type !== "relationship" && (filter === "all" || e.type === filter));
  return (
    <>
      <h2>Estate map</h2>
      <p className="muted">People (left), the trust (center), and assets (right). Edges are typed: fiduciary roles, ownership, funding, designations, and trust distributions.</p>
      <div className="row no-print">
        <label>Show edges:&nbsp;</label>
        <select style={{ width: "auto" }} value={filter} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">all</option>
          {Object.keys(EDGE_COLOR).filter((k) => k !== "relationship").map((k) => <option key={k} value={k}>{k.replace(/_/g, " ")}</option>)}
        </select>
      </div>
      <div className="card" style={{ overflowX: "auto" }}>
        <svg viewBox={`0 0 1100 ${height}`} width="100%" style={{ minWidth: 760 }} role="img" aria-label="Estate graph">
          {edges.map((e, i) => {
            const a = pos.get(e.from), b = pos.get(e.to);
            if (!a || !b) return null;
            return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={EDGE_COLOR[e.type]} strokeWidth={1.5} strokeDasharray={e.type === "beneficiary_contingent" ? "4 3" : undefined}><title>{`${nameOf(h, e.from)} → ${e.label}`}</title></line>;
          })}
          {[...people, ...assets].map((n) => {
            const p = pos.get(n.id)!;
            return <g key={n.id}><circle cx={p.x} cy={p.y} r={6} fill={n.type === "person" ? "var(--info)" : "var(--warn)"} /><text x={n.type === "person" ? p.x - 12 : p.x + 12} y={p.y + 4} textAnchor={n.type === "person" ? "end" : "start"}>{n.label}</text></g>;
          })}
          {(() => { const p = pos.get(TRUST_NODE_ID)!; return <g><rect x={p.x - 140} y={p.y - 22} width={280} height={44} rx={8} fill="var(--panel)" stroke="var(--accent)" strokeWidth={2} /><text x={p.x} y={p.y + 4} textAnchor="middle">{h.plan.name}</text></g>; })()}
        </svg>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

const ROLE_GROUPS: [string, FiduciaryRole[]][] = [
  ["Trustees", ["trustee", "successor_trustee"]],
  ["Guardians", ["guardian_of_person", "guardian_of_estate"]],
  ["Agents & executor", ["financial_agent", "healthcare_agent", "executor"]],
];

export function People({ h, submit }: ViewProps) {
  const ed = useEditor(submit);
  return (
    <>
      <h2>People & fiduciaries</h2>
      {ed.form(h)}
      <div className="card">
        <div className="row"><h3 style={{ margin: 0 }}>Household & plan</h3>
          <button className="link" onClick={() => ed.setEditing({ kind: "household", entity: { label: h.label, maritalStatus: h.maritalStatus, lastAnnualReview: h.lastAnnualReview } })}>Edit household</button>
          <button className="link" onClick={() => ed.setEditing({ kind: "plan", entity: { name: h.plan.name, type: h.plan.type, digitalAssetInstructions: h.plan.digitalAssetInstructions, incapacityPlan: h.plan.incapacityPlan } })}>Edit plan</button>
        </div>
        <Table headers={["Item", "Value", "Status"]} rows={[
          ["Marital status", h.maritalStatus.value ?? "—", <StatusPill status={h.maritalStatus.status} />],
          ["Trust structure", h.plan.type.value?.replace(/_/g, " ") ?? "—", <StatusPill status={h.plan.type.status} />],
          ["Definition of incapacity", h.plan.incapacityPlan.definitionOfIncapacity.value ?? "—", <StatusPill status={h.plan.incapacityPlan.definitionOfIncapacity.status} />],
          ["Digital asset instructions", h.plan.digitalAssetInstructions.value ?? "—", <StatusPill status={h.plan.digitalAssetInstructions.status} />],
        ]} />
      </div>
      <div className="card">
        <div className="row"><h3 style={{ margin: 0 }}>People</h3><button className="secondary" onClick={() => ed.setEditing({ kind: "person", entity: null })}>Add person</button><button className="secondary" onClick={() => ed.setEditing({ kind: "relationship", entity: null })}>Add relationship</button></div>
        <Table headers={["Name", "Kind", "Grantor", "Minor", "Relationships", ""]} rows={h.people.map((p) => [
          p.displayName, p.kind, p.isGrantor ? "yes" : "", p.isMinor ? "yes" : "",
          h.relationships.filter((r) => r.to === p.id).map((r) => `${r.type} of ${nameOf(h, r.from)}`).join("; "),
          <Actions onEdit={() => ed.setEditing({ kind: "person", entity: p as unknown as Obj })} onArchive={() => ed.archive("person", p.id, p.displayName)} />,
        ])} />
      </div>
      {ROLE_GROUPS.map(([title, roles]) => (
        <div className="card" key={title}>
          <div className="row"><h3 style={{ margin: 0 }}>{title}</h3><button className="secondary" onClick={() => ed.setEditing({ kind: "fiduciary", entity: { personId: "", role: roles[0], order: 1, status: "known" } as Obj, isNew: true })}>Add</button></div>
          <Table headers={["Role", "Order", "Person", "For", "Status", ""]} rows={roles.flatMap((role) => fiduciariesFor(h, role).map((f) => [
            role.replace(/_/g, " "), f.order === 1 ? "primary" : `alternate ${f.order - 1}`, nameOf(h, f.personId),
            (f.forPersonIds ?? []).map((id) => nameOf(h, id)).join(", "), <StatusPill status={f.status} />,
            <Actions onEdit={() => ed.setEditing({ kind: "fiduciary", entity: f as unknown as Obj })} onArchive={() => ed.archive("fiduciary", f.id, `${role.replace(/_/g, " ")} ${nameOf(h, f.personId)}`)} />,
          ]))} />
        </div>
      ))}
      <p className="muted">Fiduciary choices always require explicit read-back confirmation in Review. FamilyVault never suggests who should serve.</p>
    </>
  );
}

// ---------------------------------------------------------------------------

export function Assets({ h, submit }: ViewProps) {
  const ed = useEditor(submit);
  const own = h.assets.filter((a) => controlFor(a.category) === "ownership");
  const ben = h.assets.filter((a) => controlFor(a.category) === "beneficiary_designation");
  const row = (a: Household["assets"][number]) => [
    a.label, a.category.replace(/_/g, " "), a.refLast4 ? `…${a.refLast4}` : "—",
    a.approximateValue?.value != null ? `~$${a.approximateValue.value.toLocaleString("en-US")}` : "—",
    (a.titledTo.value ?? []).map((id) => nameOf(h, id)).join(", "),
    a.character?.value ?? "—", <StatusPill status={a.character?.status ?? "unknown"} />,
    <Actions onEdit={() => ed.setEditing({ kind: "asset", entity: a as unknown as Obj })} onArchive={() => ed.archive("asset", a.id, a.label)} />,
  ];
  const headers = ["Asset", "Category", "Ref", "Approx. value", "Titled to", "Character", "Status", ""];
  return (
    <>
      <h2>Assets</h2>
      <div className="row no-print" style={{ marginBottom: 12 }}><button className="secondary" onClick={() => ed.setEditing({ kind: "asset", entity: null })}>Add asset</button></div>
      {ed.form(h)}
      <div className="card"><h3>Ownership-controlled</h3><p className="muted">Can be funded into the trust by deed, retitling, or assignment.</p><Table headers={headers} rows={own.map(row)} /></div>
      <div className="card"><h3>Beneficiary-controlled</h3><p className="muted">Pass by beneficiary designation. These are coordinated with the plan, not retitled into the trust.</p><Table headers={headers} rows={ben.map(row)} /></div>
    </>
  );
}

// ---------------------------------------------------------------------------

export function Designations({ h, flags, submit }: ViewProps) {
  const ed = useEditor(submit);
  const ben = h.assets.filter((a) => controlFor(a.category) === "beneficiary_designation");
  return (
    <>
      <h2>Beneficiaries</h2>
      {ed.form(h)}
      <div className="card">
        <div className="row"><h3 style={{ margin: 0 }}>Trust beneficiaries</h3><button className="secondary" onClick={() => ed.setEditing({ kind: "distribution", entity: null })}>Add beneficiary</button></div>
        <Table headers={["Beneficiary", "Tier", "Share", "Terms", "Confirmed", ""]} rows={h.plan.distributions.map((d) => {
          const dec = h.decisions.find((x) => x.id === d.decisionId);
          return [nameOf(h, d.beneficiaryId), d.tier, d.sharePercent.value != null ? `${d.sharePercent.value}%` : "—", d.terms.value ?? "—",
            <StatusPill status={dec ? statusOf(dec) : "needs_review"} />,
            <Actions onEdit={() => ed.setEditing({ kind: "distribution", entity: d as unknown as Obj })} onArchive={() => ed.archive("distribution", d.id, `share for ${nameOf(h, d.beneficiaryId)}`)} />];
        })} />
        <p className="muted">Who inherits is always your decision and requires explicit read-back confirmation in Review.</p>
      </div>
      <h3>Beneficiary-designation review</h3>
      {ben.map((a) => {
        const ds = a.designations?.value ?? [];
        const f = flags.filter((x) => x.subjectIds.includes(a.id));
        return (
          <div className="card" key={a.id}>
            <div className="row"><h3 style={{ margin: 0 }}>{a.label}</h3><StatusPill status={a.designations?.status ?? "unknown"} /><Actions onEdit={() => ed.setEditing({ kind: "asset", entity: a as unknown as Obj })} /></div>
            <Table headers={["Tier", "Beneficiary", "Share"]} rows={ds.map((d) => [d.tier, nameOf(h, d.personId), `${d.sharePercent}%`])} />
            {f.map((x) => <p key={x.ruleId} className={`s-${x.severity}`}>⚑ {x.title}</p>)}
          </div>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------

function AnswerInputField({ h, q, onAnswer }: { h: Household; q: IntakeQuestion; onAnswer: (a: IntakeAnswer) => void }) {
  const [choice, setChoice] = useState("");
  const [people, setPeople] = useState<{ displayName: string; isMinor: boolean }[]>([{ displayName: "", isMinor: false }]);
  const [assetId, setAssetId] = useState<string>("");
  const [chars, setChars] = useState<Record<string, string>>({});
  const [ordered, setOrdered] = useState<string[]>([""]);
  const [shares, setShares] = useState<{ personId: string; sharePercent: number }[]>([{ personId: "", sharePercent: 100 }]);
  const [terms, setTerms] = useState<Record<string, string>>({});
  const [text, setText] = useState("");
  const personSelect = (value: string, onChange: (v: string) => void) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} style={{ width: "auto" }}>
      <option value="">— choose —</option>
      {h.people.map((p) => <option key={p.id} value={p.id}>{p.displayName}</option>)}
    </select>
  );
  const submitBtn = (a: () => IntakeAnswer) => <button className="primary" onClick={() => onAnswer(a())}>Propose changes</button>;

  switch (q.input.kind) {
    case "choice":
      return <div className="row">{q.input.options.map((o) => <label key={o.value} className="check"><input type="radio" name={q.id} checked={choice === o.value} onChange={() => setChoice(o.value)} />{o.label}</label>)}{submitBtn(() => ({ kind: "choice", value: choice }))}</div>;
    case "new_people":
      return <div>{people.map((p, i) => <div className="row" key={i}><input placeholder="Name (fictional in demo)" value={p.displayName} onChange={(e) => setPeople(people.map((x, j) => (j === i ? { ...x, displayName: e.target.value } : x)))} style={{ maxWidth: 320 }} /><label className="check"><input type="checkbox" checked={p.isMinor} onChange={(e) => setPeople(people.map((x, j) => (j === i ? { ...x, isMinor: e.target.checked } : x)))} />minor</label></div>)}<div className="row"><button className="secondary" onClick={() => setPeople([...people, { displayName: "", isMinor: false }])}>Add another</button>{submitBtn(() => ({ kind: "new_people", people }))}</div></div>;
    case "pick_asset":
      return <div className="row"><select value={assetId} onChange={(e) => setAssetId(e.target.value)} style={{ width: "auto" }}><option value="">None of these</option>{h.assets.filter((a) => a.category === "real_estate").map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}</select>{submitBtn(() => ({ kind: "pick_asset", assetId: assetId || null }))}</div>;
    case "asset_character":
      return <div><Table headers={["Asset", "Your belief"]} rows={h.assets.map((a) => [a.label, <select value={chars[a.id] ?? ""} onChange={(e) => setChars({ ...chars, [a.id]: e.target.value })}><option value="">(skip)</option><option value="community">community</option><option value="separate_grantor_a">separate (grantor A)</option><option value="separate_grantor_b">separate (grantor B)</option><option value="mixed">mixed</option><option value="unsure">not sure</option></select>])} />{submitBtn(() => ({ kind: "asset_character", characters: Object.fromEntries(Object.entries(chars).filter(([, v]) => v)) as Record<string, never> }))}</div>;
    case "ordered_people":
      return <div>{ordered.map((id, i) => <div className="row" key={i}><span className="muted">{i === 0 ? "Primary" : `Alternate ${i}`}</span>{personSelect(id, (v) => setOrdered(ordered.map((x, j) => (j === i ? v : x))))}</div>)}<div className="row"><button className="secondary" onClick={() => setOrdered([...ordered, ""])}>Add alternate</button>{submitBtn(() => ({ kind: "ordered_people", personIds: ordered }))}</div><p className="muted">Need someone not listed? Add them under People first.</p></div>;
    case "shares":
      return <div>{shares.map((r, i) => <div className="row" key={i}>{personSelect(r.personId, (v) => setShares(shares.map((x, j) => (j === i ? { ...x, personId: v } : x))))}<input type="number" min={0} max={100} value={r.sharePercent} onChange={(e) => setShares(shares.map((x, j) => (j === i ? { ...x, sharePercent: Number(e.target.value) } : x)))} style={{ width: 90 }} />%</div>)}<div className="row"><button className="secondary" onClick={() => setShares([...shares, { personId: "", sharePercent: 0 }])}>Add beneficiary</button>{submitBtn(() => ({ kind: "shares", rows: shares }))}</div></div>;
    case "distribution_terms":
      return <div><Table headers={["Beneficiary", "Terms"]} rows={h.plan.distributions.filter((d) => d.tier === "primary").map((d) => [nameOf(h, d.beneficiaryId), <input placeholder={d.terms.value ?? "e.g. outright"} value={terms[d.id] ?? ""} onChange={(e) => setTerms({ ...terms, [d.id]: e.target.value })} />])} />{submitBtn(() => ({ kind: "distribution_terms", terms }))}</div>;
    case "text":
      return <div><textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="In your own words" /><div className="row" style={{ marginTop: 8 }}>{submitBtn(() => ({ kind: "text", text }))}</div></div>;
  }
}

export function Decisions({ h, update, goto, intake, setIntake }: ViewProps & { intake: IntakeState; setIntake: (s: IntakeState) => void }) {
  const q = nextQuestion(intake);
  const [message, setMessage] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [outcomes, setOutcomes] = useState<Record<string, { reviewer: Reviewer; note: string }>>({});

  const onAnswer = (answer: IntakeAnswer) => {
    if (!q) return;
    try {
      const r = answerQuestion(h, intake, q, answer);
      setIntake(r.state);
      if (r.kind === "proposed") {
        update(() => r.household);
        setMessage(`${r.changes.length} proposed change(s) added to Review${r.changes.some((c) => c.conflicts.length) ? ", including a conflict with confirmed information" : ""}. Nothing has been applied yet.`);
      } else {
        setMessage(r.kind === "nothing_to_change" ? r.message : null);
      }
    } catch (e) {
      setMessage((e as Error).message);
    }
  };

  const ask = () => {
    if (!q || !question.trim()) return;
    const r = askProfessional(h, intake, q, question);
    if (r.kind === "routed_to_professional") {
      update(() => r.household);
      setIntake(r.state);
      setMessage(r.message);
    }
    setQuestion("");
  };

  const confirmLegacy = (d: Decision, ack?: string) => {
    const r = confirmDecision(d, { confirmedBy: "user", acknowledgedReadBack: ack });
    update((x) => addAudit({ ...x, decisions: x.decisions.map((y) => (y.id === d.id ? r.decision : y)) }, r.audit));
  };

  const legacyPending = h.decisions.filter((d) => d.state === "proposed");
  const review = h.decisions.filter((d) => d.state === "awaiting_professional_review");

  return (
    <>
      <h2>Trust decision intake</h2>
      {message && <div className="toast"><span>{message}</span>{(h.pendingChanges ?? []).length > 0 && <button className="link" onClick={() => goto("review")}>Go to Review</button>}</div>}
      <div className="card">
        {q ? (
          <>
            <div className="muted">Question {QUESTIONS.indexOf(q) + 1} of {QUESTIONS.length} · {q.section} · {q.sensitivity.replace("_", " ")}</div>
            <h3>{q.prompt}</h3>
            {q.help && <p className="muted">{q.help}</p>}
            <AnswerInputField key={q.id} h={h} q={q} onAnswer={onAnswer} />
            <details style={{ marginTop: 12 }}>
              <summary className="muted">Have a legal or tax question about this instead?</summary>
              <textarea rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="Your question for the attorney or CPA" />
              <div className="row" style={{ marginTop: 6 }}>
                <button className="secondary" onClick={ask}>Add to attorney/CPA list</button>
                {question && !seeksProfessionalAdvice(question) && <span className="muted">This will be recorded as a question, not answered.</span>}
              </div>
            </details>
            <div className="row" style={{ marginTop: 8 }}><button className="secondary" onClick={() => setIntake(skipQuestion(intake, q))}>Skip for now</button></div>
          </>
        ) : <p>All intake questions are answered or skipped. <button className="link" onClick={() => setIntake({ answeredIds: [], skippedIds: [] })}>Start over</button></p>}
      </div>

      {legacyPending.length > 0 && (
        <div className="card">
          <h3>Earlier decisions awaiting confirmation</h3>
          {legacyPending.map((d) => (
            <div key={d.id}>
              <strong>{d.topic}</strong> <StatusPill status={statusOf(d)} />
              {d.readBack ? (<><div className="readback">{d.readBack}</div><button className="primary" onClick={() => confirmLegacy(d, d.readBack)}>I confirm exactly this</button></>)
                : (<div className="row"><span>{d.answer}</span><button className="primary" onClick={() => confirmLegacy(d)}>Confirm</button></div>)}
              <hr />
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h3>Sent to attorney / CPA</h3>
        <p className="muted">Legal and tax items are never decided by FamilyVault. Record the professional's outcome here after your meeting.</p>
        <Table headers={["Topic", "Your note", "Record outcome"]} rows={review.map((d) => {
          const o = outcomes[d.id] ?? { reviewer: "attorney" as Reviewer, note: "" };
          return [d.topic, d.answer,
            <div className="row">
              <select value={o.reviewer} onChange={(e) => setOutcomes({ ...outcomes, [d.id]: { ...o, reviewer: e.target.value as Reviewer } })} style={{ width: "auto" }}><option value="attorney">attorney</option><option value="cpa">CPA</option></select>
              <input placeholder="Outcome / who reviewed" value={o.note} onChange={(e) => setOutcomes({ ...outcomes, [d.id]: { ...o, note: e.target.value } })} style={{ maxWidth: 240 }} />
              <button className="secondary" disabled={!o.note.trim()} onClick={() => update((x) => recordProfessionalOutcome(x, d.id, o))}>Record</button>
            </div>];
        })} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

export function Flags({ h, flags }: ViewProps) {
  const [sev, setSev] = useState<string>("all");
  const shown = flags.filter((f) => sev === "all" || f.severity === sev);
  return (
    <>
      <h2>Review flags ({h.plan.jurisdiction})</h2>
      <p className="banner">Flags identify issues for an attorney or CPA to review. They are not legal conclusions. {REFERENCE_CAVEAT}</p>
      <div className="row no-print"><label>Severity:&nbsp;</label>
        <select style={{ width: "auto" }} value={sev} onChange={(e) => setSev(e.target.value)}>
          {["all", "attorney_required", "review", "info"].map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>
      {shown.map((f, i) => (
        <div className="card" key={`${f.ruleId}-${i}`}>
          <div className="row"><StatusPill status={f.severity} /><strong>{f.title}</strong></div>
          <p>{f.detail}</p>
          <div className="muted">{f.jurisdiction}/{f.module} · reviewer: {f.reviewer.replace(/_/g, " ")} · rule {f.ruleId} · {f.ruleVerified ? "attorney-verified" : "draft rule (not attorney-verified)"}, last reviewed {f.ruleLastReviewed}</div>
          {f.references && <div className="muted">References to verify: {f.references.join("; ")}</div>}
        </div>
      ))}
    </>
  );
}

// ---------------------------------------------------------------------------

const STATES_FOR: Record<"ownership" | "beneficiary_designation", FundingState[]> = {
  ownership: ["not_started", "in_progress", "review", "funded", "left_outside", "instructions_missing"],
  beneficiary_designation: ["review", "designation_needs_update", "designation_current"],
};

export function Funding({ h, submit }: ViewProps) {
  const s = fundingSummary(h.assets);
  const setState = (id: string, state: FundingState) => {
    const a = h.assets.find((x) => x.id === id)!;
    submit({ kind: "asset", op: "update", entityId: id, label: `Funding status: ${a.label}`, after: { funding: { ...a.funding, state, lastVerified: new Date().toISOString().slice(0, 10) } }, provenance: formProvenance });
  };
  return (
    <>
      <h2>Funding tracker</h2>
      <div className="card"><div className="row"><strong>{s.done}/{s.total} resolved ({s.percent}%)</strong></div><Progress percent={s.percent} /></div>
      <div className="card">
        <Table headers={["Asset", "Control", "Status", "Update"]} rows={s.rows.map((r) => {
          const a = h.assets.find((x) => x.id === r.assetId)!;
          return [r.label, r.control === "ownership" ? "ownership" : "designation", `${BADGE_ICON[r.badge]} ${r.text}`,
            <select value={a.funding.state} onChange={(e) => setState(a.id, e.target.value as FundingState)}>
              {STATES_FOR[r.control].map((st) => <option key={st} value={st}>{st.replace(/_/g, " ")}</option>)}
            </select>];
        })} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

export function Packet({ h, update }: ViewProps) {
  const md = useMemo(() => generateAttorneyPacket(h, ruleSetsFor(h.plan.jurisdiction)), [h]);
  const download = () => {
    const url = URL.createObjectURL(new Blob([md], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `attorney-packet-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
    update((x) => addAudit(x, [auditEntry("packet.generated", x.id, "Attorney review packet exported")]));
  };
  return (
    <>
      <h2>Attorney review packet</h2>
      <p className="muted no-print">Markdown export for your attorney. Use Print to save as PDF. Exported packets contain family data; keep them out of Git.</p>
      <div className="row no-print"><button className="primary" onClick={download}>Download .md</button><button className="secondary" onClick={() => window.print()}>Print / save as PDF</button></div>
      <pre className="packet">{md}</pre>
    </>
  );
}

// ---------------------------------------------------------------------------

export function Audit({ h }: ViewProps) {
  const rows = [...h.audit].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <>
      <h2>Audit / change log</h2>
      <p className="muted">Append-only. Stores structured summaries, never raw intake text or transcripts.</p>
      <div className="card"><Table headers={["When", "Actor", "Action", "Summary"]} rows={rows.map((e) => [e.at.replace("T", " ").slice(0, 16), e.actor, e.action, e.summary])} /></div>
    </>
  );
}
