import { useState } from "react";
import { createHousehold, type NewHouseholdInput } from "../domain/newHousehold.ts";
import type { Household } from "../domain/types.ts";
import { JURISDICTIONS } from "../../rules/index.ts";

export function NewHouseholdSetup({ current, dirty, onCreate, onLoadDemo }: {
  current: Household;
  dirty: boolean;
  onCreate: (h: Household) => void;
  onLoadDemo: () => void;
}) {
  const [form, setForm] = useState<NewHouseholdInput>({
    label: "", jurisdiction: "texas", maritalStatus: "married", grantorNames: ["", ""], trustName: "", acknowledgedPrivacy: false,
  });
  const [localCopy, setLocalCopy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<NewHouseholdInput>) => setForm((f) => ({ ...f, ...patch }));
  const married = form.maritalStatus === "married";

  const create = () => {
    try {
      if (!localCopy) throw new Error("Confirm you are running a private, local copy.");
      if (dirty && !window.confirm("The current household has unsaved changes. Discard them and start a new household?")) return;
      onCreate(createHousehold({ ...form, grantorNames: married ? form.grantorNames : form.grantorNames.slice(0, 1) }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <>
      <h2>Start a new household</h2>
      <div className="banner" role="alert">
        <strong>Real information only in a private, local copy.</strong> Never enter real family data in a public build or a shared/hosted copy. Data is kept only in this browser until you <em>Save to vault</em> (encrypted) or export an encrypted backup.
      </div>
      <div className="card form">
        <label className="field"><span>Household label (shown only on this device)</span><input value={form.label} onChange={(e) => set({ label: e.target.value })} placeholder="e.g. Our family" /></label>
        <label className="field"><span>Trust name (optional, can change later)</span><input value={form.trustName} onChange={(e) => set({ trustName: e.target.value })} /></label>
        <label className="field"><span>State whose law will govern the trust</span>
          <select value={form.jurisdiction} onChange={(e) => set({ jurisdiction: e.target.value })}>
            {Object.values(JURISDICTIONS).map((j) => <option key={j.jurisdiction} value={j.jurisdiction}>{j.displayName}</option>)}
            <option value="other">Other state (general checks only; no state rules yet)</option>
          </select>
        </label>
        <label className="field"><span>Marital status</span>
          <select value={form.maritalStatus ?? ""} onChange={(e) => set({ maritalStatus: (e.target.value || null) as NewHouseholdInput["maritalStatus"] })}>
            <option value="married">married</option><option value="single">single</option><option value="widowed">widowed</option><option value="divorced">divorced</option>
          </select>
        </label>
        <label className="field"><span>Grantor (person creating the trust)</span><input value={form.grantorNames[0]} onChange={(e) => set({ grantorNames: [e.target.value, form.grantorNames[1]] })} /></label>
        {married && <label className="field"><span>Spouse (second grantor, leave empty if not a joint plan)</span><input value={form.grantorNames[1]} onChange={(e) => set({ grantorNames: [form.grantorNames[0], e.target.value] })} /></label>}
        <label className="check"><input type="checkbox" checked={localCopy} onChange={(e) => setLocalCopy(e.target.checked)} />I am running FamilyVault locally from a private copy, not a public or hosted build.</label>
        <label className="check"><input type="checkbox" checked={form.acknowledgedPrivacy} onChange={(e) => set({ acknowledgedPrivacy: e.target.checked })} />I understand real data must never be committed to Git, and I will save it to the encrypted vault or an encrypted backup.</label>
        {error && <p className="s-attorney_required">{error}</p>}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="primary" onClick={create}>Create household</button>
          {!current.isFictional && <button className="secondary" onClick={onLoadDemo}>Switch to the fictional demo</button>}
        </div>
        <p className="muted">Only the grantors and marital status are created now. Add everything else with the forms and guided intake; nothing is filled in for you.</p>
      </div>
      {current.isFictional && <p className="muted">You are currently viewing the fictional demo household.</p>}
    </>
  );
}
