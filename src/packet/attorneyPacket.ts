/**
 * Attorney Review Mode: an organized Markdown packet (print to PDF from the
 * browser or any Markdown tool). It summarizes; it is not a legal document.
 */
import { fiduciariesFor, grantors, minors, nameOf } from "../domain/estateGraph.ts";
import { fundingSummary, BADGE_ICON } from "../domain/funding.ts";
import { runRules, REFERENCE_CAVEAT, RULES_VERSION, type JurisdictionRuleSet } from "../domain/rules.ts";
import { statusOf, unresolved } from "../domain/decisions.ts";
import { controlFor, type Household, type FiduciaryRole, type Tracked } from "../domain/types.ts";

const t = <T,>(x: Tracked<T> | undefined, fmt: (v: T) => string = String): string =>
  !x || x.value === null ? `_unknown_ (${x?.status ?? "unknown"})` : `${fmt(x.value)} (${x.status})`;

const money = (n: number) => `~$${n.toLocaleString("en-US")}`;

function table(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return "_None recorded._\n";
  const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.map(esc).join(" | ")} |`),
    "",
  ].join("\n");
}

function fiduciarySection(h: Household, roles: FiduciaryRole[]): string {
  const rows = roles.flatMap((role) =>
    fiduciariesFor(h, role).map((f) => [
      role.replace(/_/g, " "),
      String(f.order),
      nameOf(h, f.personId),
      (f.forPersonIds ?? []).map((id) => nameOf(h, id)).join(", ") || "—",
      f.status,
    ]),
  );
  return table(["Role", "Order", "Person", "For", "Status"], rows);
}

export function generateAttorneyPacket(h: Household, ruleSets: readonly JurisdictionRuleSet[], generatedAt: Date = new Date()): string {
  const flags = runRules(h, ruleSets);
  const funding = fundingSummary(h.assets);
  const out: string[] = [];
  const date = generatedAt.toISOString().slice(0, 10);

  out.push(`# Attorney Review Packet: ${h.plan.name}`, "");
  out.push(`Generated ${date} by FamilyVault. Jurisdiction: **${h.plan.jurisdiction}**.`, "");
  out.push("> This packet organizes the family's information and open questions for professional review. It is **not legal or tax advice**, not a legal document, and reaches no legal conclusions. All flags are items for the attorney/CPA to evaluate.", "");
  if (h.isFictional) out.push("> **Sample data:** this household is fictional.", "");

  out.push("## 1. Household summary", "");
  out.push(`- Household: ${h.label}`);
  out.push(`- Marital status: ${t(h.maritalStatus)}`);
  out.push(`- Grantor(s): ${grantors(h).map((g) => g.displayName).join(", ") || "_none recorded_"}`);
  out.push(`- Trust type: ${t(h.plan.type, (v) => v.replace(/_/g, " "))}`);
  out.push(`- Last annual review: ${h.lastAnnualReview ?? "_never_"}`, "");

  out.push("## 2. Dependents", "");
  const grantorIds = new Set(grantors(h).map((g) => g.id));
  const dependentIds = new Set(
    h.relationships.filter((r) => grantorIds.has(r.from) && ["child", "stepchild", "grandchild"].includes(r.type)).map((r) => r.to),
  );
  out.push(table(["Name", "Relationship", "Minor", "Special needs"], h.people.filter((p) => dependentIds.has(p.id)).map((p) => [p.displayName, h.relationships.find((r) => r.to === p.id && grantorIds.has(r.from))?.type ?? "", p.isMinor ? "yes" : "no", t(p.hasSpecialNeeds, (v) => (v ? "yes" : "no"))])));
  if (minors(h).length === 0) out.push("_No minors recorded._", "");

  out.push("## 3. Trustees and successors", "");
  out.push(fiduciarySection(h, ["trustee", "successor_trustee"]));
  out.push("## 4. Guardians and alternates", "");
  out.push(fiduciarySection(h, ["guardian_of_person", "guardian_of_estate"]));
  out.push("## 5. Agents (incapacity planning)", "");
  out.push(fiduciarySection(h, ["financial_agent", "healthcare_agent", "executor"]));
  out.push(`Definition of incapacity: ${t(h.plan.incapacityPlan.definitionOfIncapacity)}`, "");

  out.push("## 6. Trust beneficiaries and contingents", "");
  out.push(table(["Beneficiary", "Tier", "Share", "Terms", "Confirmed"], h.plan.distributions.map((d) => {
    const dec = h.decisions.find((x) => x.id === d.decisionId);
    return [nameOf(h, d.beneficiaryId), d.tier, t(d.sharePercent, (v) => `${v}%`), t(d.terms), dec ? statusOf(dec) : "not confirmed"];
  })));

  out.push("## 7. Asset inventory", "");
  out.push(table(
    ["Asset", "Category", "Control", "Ref", "Approx. value", "Titled to", "Character"],
    h.assets.map((a) => [
      a.label,
      a.category,
      controlFor(a.category) === "ownership" ? "ownership" : "beneficiary designation",
      a.refLast4 ? `…${a.refLast4}` : "—",
      t(a.approximateValue, money),
      t(a.titledTo, (v) => v.map((id) => nameOf(h, id)).join(", ") || "—"),
      t(a.character),
    ]),
  ));

  out.push("## 8. Real property", "");
  out.push(table(["Property", "Homestead", "Mortgage", "Funding", "Deed recorded"], h.assets.filter((a) => a.category === "real_estate").map((a) => [
    a.label, t(a.isHomestead, (v) => (v ? "yes" : "no")), t(a.hasMortgage, (v) => (v ? "yes" : "no")), a.funding.state, t(a.funding.deedRecorded, (v) => (v ? "yes" : "no")),
  ])));

  out.push("## 9. Retirement accounts and insurance (beneficiary-controlled)", "");
  out.push("_These assets pass by beneficiary designation and are not retitled into the trust._", "");
  out.push(table(["Asset", "Category", "Designations on file", "Status"], h.assets.filter((a) => controlFor(a.category) === "beneficiary_designation").map((a) => [
    a.label,
    a.category,
    (a.designations?.value ?? []).map((d) => `${d.tier}: ${nameOf(h, d.personId)} ${d.sharePercent}%`).join("; ") || "_unknown_",
    a.designations?.status ?? "unknown",
  ])));

  out.push("## 10. Unresolved decisions", "");
  out.push(table(["Topic", "Sensitivity", "State", "User's answer"], unresolved(h.decisions).map((d) => [d.topic, d.sensitivity, d.state, d.answer])));

  out.push("## 11. Attorney-review flags", "");
  out.push(`${flags.length} flag(s), rules version ${RULES_VERSION}. ${REFERENCE_CAVEAT}`, "");
  for (const f of flags) {
    const verified = f.ruleVerified ? "attorney-verified rule" : "draft rule, not attorney-verified";
    out.push(`- **[${f.severity}] ${f.title}** (${f.jurisdiction}/${f.module}, reviewer: ${f.reviewer.replace(/_/g, " ")}; ${verified}, last reviewed ${f.ruleLastReviewed ?? "?"})`);
    out.push(`  ${f.detail}`);
    if (f.references?.length) out.push(`  _References to verify:_ ${f.references.join("; ")}`);
  }
  out.push("");

  out.push("## 12. Funding status", "");
  out.push(`Progress: **${funding.done}/${funding.total} (${funding.percent}%)** resolved.`, "");
  out.push(table(["Asset", "Status"], funding.rows.map((r) => [r.label, `${BADGE_ICON[r.badge]} ${r.text}`])));

  out.push("## 13. Plan documents", "");
  out.push(table(["Document", "For", "Stage", "Original kept at"], h.plan.documents.map((d) => [d.kind.replace(/_/g, " "), d.forPersonId ? nameOf(h, d.forPersonId) : "—", d.stage.replace(/_/g, " "), d.storageReference ?? "—"])));

  out.push("## 14. Decision and change log", "");
  out.push(table(["Date", "Actor", "Action", "Summary"], [...h.audit].sort((a, b) => a.at.localeCompare(b.at)).map((e) => [e.at.slice(0, 10), e.actor, e.action, e.summary])));

  return out.join("\n");
}
