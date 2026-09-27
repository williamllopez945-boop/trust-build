import { useMemo, useState } from "react";
import { buildEstateGraph, fiduciariesFor, nameOf, TRUST_NODE_ID } from "../domain/estateGraph.ts";
import { BADGE_ICON, fundingSummary } from "../domain/funding.ts";
import { confirmDecision, statusOf, unresolved, type Decision } from "../domain/decisions.ts";
import { auditEntry, type AuditEntry } from "../domain/audit.ts";
import { REFERENCE_CAVEAT, type ReviewFlag } from "../domain/rules.ts";
import { controlFor, type FiduciaryRole, type FundingState, type Household } from "../domain/types.ts";
import { answerQuestion, nextQuestion, skipQuestion, type IntakeState } from "../intake/intake.ts";
import { QUESTIONS } from "../intake/questions.ts";
import { generateAttorneyPacket } from "../packet/attorneyPacket.ts";
import { ruleSetsFor } from "../../rules/index.ts";
import { Progress, StatusPill, Table } from "./components.tsx";

export interface ViewProps {
  h: Household;
  flags: ReviewFlag[];
  update: (fn: (h: Household) => Household) => void;
}

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

export function People({ h }: ViewProps) {
  return (
    <>
      <h2>People & fiduciaries</h2>
      <div className="card">
        <h3>People</h3>
        <Table headers={["Name", "Kind", "Grantor", "Minor", "Relationships"]} rows={h.people.map((p) => [
          p.displayName, p.kind, p.isGrantor ? "yes" : "", p.isMinor ? "yes" : "",
          h.relationships.filter((r) => r.to === p.id).map((r) => `${r.type} of ${nameOf(h, r.from)}`).join("; "),
        ])} />
      </div>
      {ROLE_GROUPS.map(([title, roles]) => (
        <div className="card" key={title}>
          <h3>{title}</h3>
          <Table headers={["Role", "Order", "Person", "For", "Status"]} rows={roles.flatMap((role) => fiduciariesFor(h, role).map((f) => [
            role.replace(/_/g, " "), f.order === 1 ? "primary" : `alternate ${f.order - 1}`, nameOf(h, f.personId),
            (f.forPersonIds ?? []).map((id) => nameOf(h, id)).join(", "), <StatusPill status={f.status} />,
          ]))} />
        </div>
      ))}
      <p className="muted">Fiduciary choices are recorded only through the Decisions view with explicit read-back confirmation. FamilyVault never suggests who should serve.</p>
    </>
  );
}

// ---------------------------------------------------------------------------

export function Assets({ h }: ViewProps) {
  const own = h.assets.filter((a) => controlFor(a.category) === "ownership");
  const ben = h.assets.filter((a) => controlFor(a.category) === "beneficiary_designation");
  const row = (a: Household["assets"][number]) => [
    a.label, a.category.replace(/_/g, " "), a.refLast4 ? `…${a.refLast4}` : "—",
    a.approximateValue?.value != null ? `~$${a.approximateValue.value.toLocaleString("en-US")}` : "—",
    (a.titledTo.value ?? []).map((id) => nameOf(h, id)).join(", "),
    a.character?.value ?? "—", <StatusPill status={a.character?.status ?? "unknown"} />,
  ];
  const headers = ["Asset", "Category", "Ref", "Approx. value", "Titled to", "Character", "Status"];
  return (
    <>
      <h2>Assets</h2>
      <div className="card"><h3>Ownership-controlled</h3><p className="muted">Can be funded into the trust by deed, retitling, or assignment.</p><Table headers={headers} rows={own.map(row)} /></div>
      <div className="card"><h3>Beneficiary-controlled</h3><p className="muted">Pass by beneficiary designation. These are coordinated with the plan, not retitled into the trust.</p><Table headers={headers} rows={ben.map(row)} /></div>
    </>
  );
}

// ---------------------------------------------------------------------------

export function Designations({ h, flags }: ViewProps) {
  const ben = h.assets.filter((a) => controlFor(a.category) === "beneficiary_designation");
  return (
    <>
      <h2>Beneficiary-designation review</h2>
      {ben.map((a) => {
        const ds = a.designations?.value ?? [];
        const f = flags.filter((x) => x.subjectIds.includes(a.id));
        return (
          <div className="card" key={a.id}>
            <div className="row"><h3 style={{ margin: 0 }}>{a.label}</h3><StatusPill status={a.designations?.status ?? "unknown"} /></div>
            <Table headers={["Tier", "Beneficiary", "Share"]} rows={ds.map((d) => [d.tier, nameOf(h, d.personId), `${d.sharePercent}%`])} />
            {f.map((x) => <p key={x.ruleId} className={`s-${x.severity}`}>⚑ {x.title}</p>)}
          </div>
        );
      })}
    </>
  );
}

// ---------------------------------------------------------------------------

export function Decisions({ h, update, intake, setIntake }: ViewProps & { intake: IntakeState; setIntake: (s: IntakeState) => void }) {
  const q = nextQuestion(intake);
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const submit = () => {
    if (!q) return;
    const r = answerQuestion(intake, q, text);
    if (r.kind === "empty") return setMessage(r.message);
    update((x) => addAudit({ ...x, decisions: [...x.decisions, r.decision] }, r.audit));
    setIntake(r.state);
    setText(""); // raw input is discarded once structured
    setMessage(r.kind === "routed_to_professional" ? r.message : r.needsReadBack ? "Recorded as proposed. Review the read-back below to confirm." : null);
  };

  const confirm = (d: Decision, ack?: string) => {
    const r = confirmDecision(d, { confirmedBy: "user", acknowledgedReadBack: ack });
    update((x) => addAudit({ ...x, decisions: x.decisions.map((y) => (y.id === d.id ? r.decision : y)) }, r.audit));
  };

  const pending = h.decisions.filter((d) => d.state === "proposed");
  const review = h.decisions.filter((d) => d.state === "awaiting_professional_review");

  return (
    <>
      <h2>Trust decision intake</h2>
      <div className="card">
        {q ? (
          <>
            <div className="muted">Question {QUESTIONS.indexOf(q) + 1} of {QUESTIONS.length} · {q.section} · {q.sensitivity.replace("_", " ")}</div>
            <h3>{q.prompt}</h3>
            {q.help && <p className="muted">{q.help}</p>}
            <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="Your answer, in your own words. Use fictional names in demos." />
            <div className="row" style={{ marginTop: 8 }}>
              <button className="primary" onClick={submit}>Record answer</button>
              <button className="secondary" onClick={() => { setIntake(skipQuestion(intake, q)); setText(""); }}>Skip for now</button>
            </div>
          </>
        ) : <p>All intake questions are answered or skipped.</p>}
        {message && <p className="s-review">{message}</p>}
      </div>

      <div className="card">
        <h3>Awaiting your confirmation</h3>
        {pending.length === 0 && <p className="muted">Nothing to confirm.</p>}
        {pending.map((d) => (
          <div key={d.id}>
            <strong>{d.topic}</strong> <StatusPill status={statusOf(d)} />
            {d.readBack ? (
              <>
                <div className="readback">{d.readBack}</div>
                <button className="primary" onClick={() => confirm(d, d.readBack)}>I confirm exactly this</button>
              </>
            ) : (
              <div className="row"><span>{d.answer}</span><button className="primary" onClick={() => confirm(d)}>Confirm</button></div>
            )}
            <hr />
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Sent to attorney / CPA</h3>
        <p className="muted">Legal and tax questions are never answered here. They are listed in the attorney packet.</p>
        <Table headers={["Topic", "Your note"]} rows={review.map((d) => [d.topic, d.answer])} />
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
          <div className="muted">{f.jurisdiction}/{f.module} · reviewer: {f.reviewer.replace(/_/g, " ")} · rule {f.ruleId}</div>
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

export function Funding({ h, update }: ViewProps) {
  const s = fundingSummary(h.assets);
  const setState = (id: string, state: FundingState) =>
    update((x) => addAudit(
      { ...x, assets: x.assets.map((a) => (a.id === id ? { ...a, funding: { ...a.funding, state, lastVerified: new Date().toISOString().slice(0, 10) } } : a)) },
      [auditEntry("asset.funding_updated", id, `Funding status → ${state}`)],
    ));
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
