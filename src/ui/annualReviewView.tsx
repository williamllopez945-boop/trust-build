import { useState } from "react";
import {
  answerLifeEvent,
  completeAnnualReview,
  currentReview,
  reviewBlockers,
  startAnnualReview,
  updateReviewItem,
  type AnnualReviewItem,
} from "../domain/annualReview.ts";
import type { ReviewFlag } from "../domain/rules.ts";
import type { Household } from "../domain/types.ts";
import { StatusPill, Table } from "./components.tsx";

const CATEGORY_TEXT: Record<AnnualReviewItem["category"], string> = {
  assets: "Assets and funding",
  designations: "Beneficiary designations",
  fiduciaries: "Fiduciaries",
  beneficiaries: "Beneficiaries",
  documents: "Documents",
  flags: "Review flags",
  pending: "Pending changes",
};

export function AnnualReviewView({ h, flags, update }: { h: Household; flags: ReviewFlag[]; update: (fn: (h: Household) => Household) => void }) {
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const r = currentReview(h);
  const act = (fn: (x: Household) => Household) => {
    try {
      const next = fn(h);
      update(() => next);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const history = [...(h.annualReviews ?? [])].filter((x) => x.completedAt).reverse();

  if (!r) {
    return (
      <>
        <h2>Annual review</h2>
        <div className="card">
          <p>Last completed review: <strong>{h.lastAnnualReview ?? "never"}</strong></p>
          <p className="muted">A review walks through every asset, beneficiary designation, fiduciary, and signed document, and asks about life events since the last review. Reported life events become attorney-review flags.</p>
          <button className="primary" onClick={() => act((x) => startAnnualReview(x, flags.length))}>Start annual review</button>
        </div>
        <div className="card">
          <h3>History</h3>
          <Table headers={["Completed", "Life events reported", "Needs attention"]} rows={history.map((x) => [
            x.completedAt!.slice(0, 10),
            x.lifeEvents.filter((e) => e.answer).map((e) => e.question).join("; ") || "none",
            x.items.filter((i) => i.status === "needs_attention").map((i) => `${i.label}: ${i.note}`).join("; ") || "none",
          ])} />
        </div>
        {error && <p className="banner">{error}</p>}
      </>
    );
  }

  const blockers = reviewBlockers(r);
  const categories = [...new Set(r.items.map((i) => i.category))];
  const done = r.items.filter((i) => i.status !== "open").length;

  return (
    <>
      <h2>Annual review in progress</h2>
      <p className="muted">Started {r.startedAt.slice(0, 10)} · {done}/{r.items.length} items resolved</p>
      {error && <p className="banner" role="alert">{error}</p>}
      <div className="card">
        <h3>Life events since the last review</h3>
        {r.lifeEvents.map((e) => (
          <div key={e.id} className="row" style={{ marginBottom: 8 }}>
            <span style={{ flex: "1 1 320px" }}>{e.question}</span>
            <label className="check"><input type="radio" name={e.id} checked={e.answer === false} onChange={() => act((x) => answerLifeEvent(x, r.id, e.id, false))} />no</label>
            <label className="check"><input type="radio" name={e.id} checked={e.answer === true} onChange={() => act((x) => answerLifeEvent(x, r.id, e.id, true, notes[e.id]))} />yes</label>
            {e.answer && <input placeholder="What happened? (general terms)" style={{ maxWidth: 280 }} value={notes[e.id] ?? e.note ?? ""} onChange={(ev) => setNotes({ ...notes, [e.id]: ev.target.value })} onBlur={() => act((x) => answerLifeEvent(x, r.id, e.id, true, notes[e.id]))} />}
          </div>
        ))}
      </div>
      {categories.map((c) => (
        <div className="card" key={c}>
          <h3>{CATEGORY_TEXT[c]}</h3>
          {r.items.filter((i) => i.category === c).map((i) => (
            <div key={i.id} className="change">
              <div className="row"><strong>{i.label}</strong><StatusPill status={i.status} /></div>
              {i.detail && <div className="muted">{i.detail}</div>}
              {i.note && <div>Note: {i.note}</div>}
              <div className="row" style={{ marginTop: 6 }}>
                <button className="secondary" onClick={() => act((x) => updateReviewItem(x, r.id, i.id, "done"))}>Done</button>
                <input placeholder="Note (required for needs attention)" style={{ maxWidth: 300 }} value={notes[i.id] ?? ""} onChange={(ev) => setNotes({ ...notes, [i.id]: ev.target.value })} />
                <button className="secondary" onClick={() => act((x) => updateReviewItem(x, r.id, i.id, "needs_attention", notes[i.id]))}>Needs attention</button>
                {i.status !== "open" && <button className="link" onClick={() => act((x) => updateReviewItem(x, r.id, i.id, "open"))}>Reopen</button>}
              </div>
            </div>
          ))}
        </div>
      ))}
      <div className="card">
        {blockers.length > 0 && <p className="s-review">Before completing: {blockers.join("; ")}.</p>}
        <button className="primary" disabled={blockers.length > 0} onClick={() => act((x) => completeAnnualReview(x, r.id))}>Complete annual review</button>
      </div>
    </>
  );
}
