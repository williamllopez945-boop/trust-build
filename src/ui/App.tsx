import { useMemo, useState } from "react";
import { demoHousehold } from "../../sample-data/demo-household.ts";
import { runRules } from "../domain/rules.ts";
import type { Household } from "../domain/types.ts";
import { emptyIntake, type IntakeState } from "../intake/intake.ts";
import { hasSavedVault, loadVault, saveVault } from "../storage/vault.ts";
import { ruleSetsFor } from "../../rules/index.ts";
import { Assets, Audit, Dashboard, Decisions, Designations, EstateMap, Flags, Funding, Packet, People } from "./views.tsx";

const VIEWS = [
  ["dashboard", "Dashboard"],
  ["map", "Estate map"],
  ["people", "People & fiduciaries"],
  ["assets", "Assets"],
  ["designations", "Beneficiary designations"],
  ["decisions", "Decision intake"],
  ["flags", "Review flags"],
  ["funding", "Funding tracker"],
  ["packet", "Attorney packet"],
  ["audit", "Audit log"],
] as const;
type ViewId = (typeof VIEWS)[number][0];

export function App() {
  const [h, setH] = useState<Household>(() => structuredClone(demoHousehold));
  const [view, setView] = useState<ViewId>("dashboard");
  const [intake, setIntake] = useState<IntakeState>(emptyIntake);
  const [passphrase, setPassphrase] = useState("");
  const [vaultMsg, setVaultMsg] = useState<string | null>(null);
  const flags = useMemo(() => runRules(h, ruleSetsFor(h.plan.jurisdiction)), [h]);
  const props = { h, flags, update: (fn: (x: Household) => Household) => setH(fn) };

  const unlock = async () => {
    try {
      const loaded = await loadVault<{ household: Household; intake: IntakeState }>(passphrase);
      if (!loaded) return setVaultMsg("No saved vault on this device yet.");
      setH(loaded.household);
      setIntake(loaded.intake);
      setVaultMsg("Vault unlocked.");
    } catch (e) {
      setVaultMsg((e as Error).message);
    }
  };
  const save = async () => {
    try {
      await saveVault({ household: h, intake }, passphrase);
      setVaultMsg("Saved (encrypted) to this browser.");
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
          <button key={id} aria-current={view === id ? "page" : undefined} onClick={() => setView(id)}>{label}</button>
        ))}
        <div style={{ marginTop: 24 }} className="no-print">
          <div className="muted">Encrypted local vault</div>
          <input type="password" autoComplete="off" placeholder="Passphrase (12+ chars)" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
          <div className="row" style={{ marginTop: 6 }}>
            <button className="secondary" onClick={unlock} disabled={!hasSavedVault()}>Unlock</button>
            <button className="primary" onClick={save}>Save</button>
          </div>
          {vaultMsg && <p className="muted">{vaultMsg}</p>}
        </div>
      </nav>
      <main>
        {h.isFictional && <div className="banner">Demo mode: this household is fictional sample data. Real family data should only be entered locally and saved to the encrypted vault, never committed to Git.</div>}
        {view === "dashboard" && <Dashboard {...props} />}
        {view === "map" && <EstateMap {...props} />}
        {view === "people" && <People {...props} />}
        {view === "assets" && <Assets {...props} />}
        {view === "designations" && <Designations {...props} />}
        {view === "decisions" && <Decisions {...props} intake={intake} setIntake={setIntake} />}
        {view === "flags" && <Flags {...props} />}
        {view === "funding" && <Funding {...props} />}
        {view === "packet" && <Packet {...props} />}
        {view === "audit" && <Audit {...props} />}
      </main>
    </div>
  );
}
