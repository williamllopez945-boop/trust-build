import { useEffect, useMemo, useRef, useState } from "react";
import { demoHousehold } from "../../sample-data/demo-household.ts";
import { runRules } from "../domain/rules.ts";
import type { Household } from "../domain/types.ts";
import { parseHousehold } from "../domain/schema.ts";
import { emptyIntake, type IntakeState } from "../intake/intake.ts";
import { hasSavedVault, loadVault, saveVault } from "../storage/vault.ts";
import { ruleSetsFor } from "../../rules/index.ts";
import { Assets, Audit, Dashboard, Decisions, Designations, EstateMap, Flags, Funding, Packet, People } from "./views.tsx";
import { Review } from "./review.tsx";
import { NewHouseholdSetup } from "./setup.tsx";
import { AnnualReviewView } from "./annualReviewView.tsx";
import { GATE_LABEL, submitChange, type ChangeInput } from "../domain/changes.ts";
import { auditEntry } from "../domain/audit.ts";
import { BACKUP_EXTENSION, backupFileName, exportBackup, importBackup } from "../storage/backup.ts";

const VIEWS = [
  ["dashboard", "Dashboard"],
  ["map", "Estate map"],
  ["people", "People & fiduciaries"],
  ["assets", "Assets"],
  ["designations", "Beneficiaries"],
  ["decisions", "Decision intake"],
  ["review", "Review changes"],
  ["flags", "Review flags"],
  ["funding", "Funding tracker"],
  ["annual", "Annual review"],
  ["packet", "Attorney packet"],
  ["audit", "Audit log"],
  ["setup", "Start new household"],
] as const;
type ViewId = (typeof VIEWS)[number][0];

export function App() {
  const [h, setH] = useState<Household>(() => structuredClone(demoHousehold));
  const [view, setView] = useState<ViewId>("dashboard");
  const [intake, setIntake] = useState<IntakeState>(emptyIntake);
  const [passphrase, setPassphrase] = useState("");
  const [vaultMsg, setVaultMsg] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  // Tracks the last saved/loaded household so real data is never silently lost.
  const saved = useRef<Household | null>(null);
  const dirty = !h.isFictional && saved.current !== h;
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const flags = useMemo(() => runRules(h, ruleSetsFor(h.plan.jurisdiction)), [h]);
  const submit = (input: ChangeInput) => {
    try {
      const r = submitChange(h, input);
      setH(r.household);
      if (r.applied) setToast(`Recorded: ${r.change.label}.`);
      else if (r.change.problems.length) setToast(`Not applied: ${r.change.problems.join(" ")} (see Review)`);
      else setToast(`Sent to Review: "${r.change.label}" needs ${r.change.conflicts.length ? "a decision about conflicting confirmed information" : GATE_LABEL[r.change.gate]}.`);
    } catch (e) {
      setToast((e as Error).message);
    }
  };
  const goto = (v: string) => setView(v as ViewId);
  const props = { h, flags, update: (fn: (x: Household) => Household) => setH(fn), submit, goto };
  const pendingCount = (h.pendingChanges ?? []).length;

  const unlock = async () => {
    try {
      const loaded = await loadVault<{ household: unknown; intake: IntakeState }>(passphrase);
      if (!loaded) return setVaultMsg("No saved vault on this device yet.");
      const parsed = parseHousehold(loaded.household);
      saved.current = parsed;
      setH(parsed);
      setIntake(loaded.intake);
      setVaultMsg("Vault unlocked.");
    } catch (e) {
      setVaultMsg((e as Error).message);
    }
  };
  const save = async () => {
    try {
      await saveVault({ household: h, intake }, passphrase);
      saved.current = h;
      setVaultMsg("Saved (encrypted) to this browser.");
    } catch (e) {
      setVaultMsg((e as Error).message);
    }
  };

  const exportFile = async () => {
    try {
      const withAudit = { ...h, audit: [...h.audit, auditEntry("backup.exported", h.id, "Encrypted backup exported")] };
      const text = await exportBackup({ household: withAudit, intake }, passphrase);
      setH(withAudit);
      saved.current = withAudit;
      const url = URL.createObjectURL(new Blob([text], { type: "application/octet-stream" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = backupFileName();
      a.click();
      URL.revokeObjectURL(url);
      setVaultMsg("Encrypted backup downloaded. Store it outside this repository.");
    } catch (e) {
      setVaultMsg((e as Error).message);
    }
  };
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const r = await importBackup(await file.text(), passphrase);
      if (!window.confirm(`Replace the household on screen with "${r.household.label}" from this backup?`)) return;
      const imported = { ...r.household, audit: [...r.household.audit, auditEntry("backup.imported", r.household.id, `Imported encrypted backup (${file.name.endsWith(BACKUP_EXTENSION) ? "fvault" : "file"})`)] };
      saved.current = null; // imported but not yet saved to this browser's vault
      setH(imported);
      setIntake(r.intake);
      setVaultMsg("Backup imported.");
    } catch (e) {
      setVaultMsg((e as Error).message);
    }
  };

  return (
    <div className="layout">
      <nav>
        <h1>FamilyVault</h1>
        <p>Local-first trust planning. Not legal advice.</p>
        {VIEWS.map(([id, label]) => (
          <button key={id} aria-current={view === id ? "page" : undefined} onClick={() => { setView(id); setToast(null); }}>
            {label}{id === "review" && pendingCount > 0 && <span className="badge">{pendingCount}</span>}
          </button>
        ))}
        <div style={{ marginTop: 24 }} className="no-print">
          <div className="muted">Encrypted local vault</div>
          <input type="password" autoComplete="off" placeholder="Passphrase (12+ chars)" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
          <div className="row" style={{ marginTop: 6 }}>
            <button className="secondary" onClick={unlock} disabled={!hasSavedVault()}>Unlock</button>
            <button className="primary" onClick={save}>Save to vault</button>
          </div>
          <div className="muted" style={{ marginTop: 12 }}>Encrypted backup file</div>
          <div className="row" style={{ marginTop: 6 }}>
            <button className="secondary" onClick={exportFile}>Export</button>
            <label className="secondary filebtn">Import<input type="file" accept={`${BACKUP_EXTENSION},application/json`} onChange={(e) => { void importFile(e.target.files?.[0]); e.target.value = ""; }} hidden /></label>
          </div>
          {vaultMsg && <p className="muted">{vaultMsg}</p>}
        </div>
      </nav>
      <main>
        {!h.isFictional && (
          <div className={dirty ? "banner" : "toast"} role="status">
            <span><strong>{h.label}</strong>: real household. {dirty ? "Unsaved changes: use Save to vault (encrypted) before closing this tab." : "All changes saved to the encrypted vault."}</span>
          </div>
        )}
        {h.isFictional && (
          <div className="banner" role="alert">
            <strong>DEMO DATA ONLY — DO NOT ENTER REAL PERSONAL OR ESTATE INFORMATION IN A PUBLIC BUILD</strong>
            <div>This household is fictional. Real family data belongs only in a local, private copy, saved to the encrypted vault and never committed to Git.</div>
          </div>
        )}
        {toast && <div className="toast" role="status"><span>{toast}</span><span className="row">{pendingCount > 0 && view !== "review" && <button className="link" onClick={() => goto("review")}>Review ({pendingCount})</button>}<button className="link" onClick={() => setToast(null)}>Dismiss</button></span></div>}
        {view === "dashboard" && <Dashboard {...props} />}
        {view === "map" && <EstateMap {...props} />}
        {view === "people" && <People {...props} />}
        {view === "assets" && <Assets {...props} />}
        {view === "designations" && <Designations {...props} />}
        {view === "decisions" && <Decisions {...props} intake={intake} setIntake={setIntake} />}
        {view === "review" && <Review h={h} update={props.update} />}
        {view === "flags" && <Flags {...props} />}
        {view === "funding" && <Funding {...props} />}
        {view === "packet" && <Packet {...props} />}
        {view === "audit" && <Audit {...props} />}
        {view === "annual" && <AnnualReviewView h={h} flags={flags} update={props.update} />}
        {view === "setup" && (
          <NewHouseholdSetup
            current={h}
            dirty={dirty}
            onCreate={(nh) => { saved.current = null; setH(nh); setIntake(emptyIntake()); setView("dashboard"); setToast("New household created. Add people, assets, and decisions, then Save to vault."); }}
            onLoadDemo={() => { if (!dirty || window.confirm("Discard unsaved changes and load the fictional demo?")) { saved.current = null; setH(structuredClone(demoHousehold)); setIntake(emptyIntake()); setView("dashboard"); } }}
          />
        )}
      </main>
    </div>
  );
}
