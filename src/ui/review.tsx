import { useState } from "react";
import { applyChange, currentProblems, GATE_LABEL, describeFields, describeValue, rejectChange, visibleFields, type ChangeSet } from "../domain/changes.ts";
import type { Household } from "../domain/types.ts";
import { StatusPill } from "./components.tsx";

const GATE_TEXT: Record<ChangeSet["gate"], string> = {
  record: "Record",
  confirm: "Confirm",
  explicit_confirm: "I confirm exactly this",
  professional_review: "Record as my preference (attorney/CPA review required)",
};

export function Review({ h, update }: { h: Household; update: (fn: (h: Household) => Household) => void }) {
  const [error, setError] = useState<string | null>(null);
  const pending = h.pendingChanges ?? [];
  const batches = new Map<string, ChangeSet[]>();
  for (const c of pending) batches.set(c.batchId ?? c.id, [...(batches.get(c.batchId ?? c.id) ?? []), c]);

  const act = (fn: () => Household) => {
    try {
      const next = fn();
      update(() => next);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <h2>Review proposed changes</h2>
      <p className="muted">Nothing here has been applied yet. Each change shows where it came from, what it would change, and what confirmation it needs.</p>
      {error && <p className="banner" role="alert">{error}</p>}
      {pending.length === 0 && <div className="card"><p>No changes waiting for review.</p></div>}
      {[...batches.entries()].map(([batchId, changes]) => (
        <div className="card" key={batchId}>
          <div className="muted">
            {changes[0].provenance.source}{changes[0].provenance.intakeQuestionId ? ` · ${changes[0].provenance.intakeQuestionId}` : ""} · {changes[0].provenance.at.replace("T", " ").slice(0, 16)} · {changes.length} change(s)
          </div>
          {changes.map((c) => ({ c, problems: currentProblems(h, c) })).map(({ c, problems }) => (
            <div key={c.id} className="change">
              <div className="row">
                <strong>{c.op} · {c.label}</strong>
                <StatusPill status={c.sensitivity} />
                <span className="muted">needs: {GATE_LABEL[c.gate]} · confidence: {c.provenance.confidence} · by {c.provenance.actor}</span>
              </div>
              {c.op !== "archive" && (
                <table>
                  <thead><tr><th>Field</th><th>Current</th><th>Proposed</th></tr></thead>
                  <tbody>
                    {visibleFields(c.fields).map((f) => (
                      <tr key={f.path} className={c.conflicts.some((x) => x.path === f.path) ? "conflict" : undefined}>
                        <td>{f.path.replace(/\.value$/, "")}</td><td>{describeValue(h, f.old)}</td><td>{describeValue(h, f.new)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {c.conflicts.length > 0 && <p className="s-attorney_required">⚠ Conflicts with confirmed information: {c.conflicts.map((x) => x.path).join(", ")}. It will not be overwritten unless you explicitly replace it.</p>}
              {problems.length > 0 && <p className="s-attorney_required">Cannot apply yet: {problems.join(" ")}</p>}
              {c.readBack && <div className="readback">{c.readBack}</div>}
              <div className="row">
                {c.conflicts.length > 0 ? (
                  <>
                    <button className="secondary" onClick={() => act(() => rejectChange(h, c, "kept confirmed value").household)}>Keep confirmed value</button>
                    <button className="primary" disabled={problems.length > 0} onClick={() => act(() => applyChange(h, c, { by: "user", acknowledgedReadBack: c.readBack, conflictResolution: "replace_confirmed" }).household)}>Replace confirmed value</button>
                  </>
                ) : (
                  <>
                    <button className="primary" disabled={problems.length > 0} onClick={() => act(() => applyChange(h, c, { by: "user", acknowledgedReadBack: c.readBack }).household)}>{GATE_TEXT[c.gate]}</button>
                    <button className="secondary" onClick={() => act(() => rejectChange(h, c, "discarded").household)}>Discard</button>
                  </>
                )}
              </div>
              <details><summary className="muted">Plain-language summary</summary><ul>{describeFields(h, c.fields).map((l) => <li key={l}>{l}</li>)}</ul></details>
            </div>
          ))}
        </div>
      ))}
    </>
  );
}
