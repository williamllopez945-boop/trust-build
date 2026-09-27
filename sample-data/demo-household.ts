/**
 * FICTIONAL demo household. Every name, value, and detail here is invented.
 * Do not replace with real family data. Real data belongs in the encrypted
 * local vault, never in Git.
 */
import type { Household } from "../src/domain/types.ts";
import type { Decision } from "../src/domain/decisions.ts";
import { buildReadBack } from "../src/domain/decisions.ts";
import { CURRENT_SCHEMA_VERSION } from "../src/domain/schema.ts";

const at = (d: string) => `${d}T15:00:00.000Z`;

function confirmed(id: string, topic: string, sensitivity: Decision["sensitivity"], answer: string, date: string): Decision {
  return {
    id, topic, sensitivity, answer, answeredBy: "user", state: "confirmed",
    readBack: sensitivity === "dispositive" || sensitivity === "fiduciary" ? buildReadBack(topic, answer) : undefined,
    createdAt: at(date), updatedAt: at(date),
  };
}

export const demoHousehold: Household = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  id: "demo-household",
  label: "The Example Family (fictional demo)",
  isFictional: true,
  maritalStatus: { value: "married", status: "confirmed" },
  people: [
    { id: "p-alex", kind: "person", displayName: "Alex Example", isGrantor: true },
    { id: "p-jordan", kind: "person", displayName: "Jordan Example", isGrantor: true },
    { id: "p-casey", kind: "person", displayName: "Casey Example", isMinor: false, hasSpecialNeeds: { value: false, status: "confirmed" } },
    { id: "p-riley", kind: "person", displayName: "Riley Example", isMinor: true, hasSpecialNeeds: { value: null, status: "unknown" } },
    { id: "p-sam", kind: "person", displayName: "Sam Placeholder" },
    { id: "p-morgan", kind: "person", displayName: "Morgan Sample" },
    { id: "c-charity", kind: "charity", displayName: "Sample Food Bank (fictional)" },
  ],
  relationships: [
    { id: "r1", from: "p-alex", to: "p-jordan", type: "spouse", status: "confirmed" },
    { id: "r2", from: "p-alex", to: "p-casey", type: "child", status: "confirmed" },
    { id: "r3", from: "p-jordan", to: "p-casey", type: "child", status: "confirmed" },
    { id: "r4", from: "p-alex", to: "p-riley", type: "child", status: "confirmed" },
    { id: "r5", from: "p-jordan", to: "p-riley", type: "child", status: "confirmed" },
    { id: "r6", from: "p-jordan", to: "p-sam", type: "sibling", status: "known" },
    { id: "r7", from: "p-alex", to: "p-morgan", type: "friend", status: "known" },
  ],
  fiduciaries: [
    { id: "f1", personId: "p-alex", role: "trustee", order: 1, status: "confirmed", decisionId: "d-trustees" },
    { id: "f2", personId: "p-jordan", role: "trustee", order: 1, status: "confirmed", decisionId: "d-trustees" },
    { id: "f3", personId: "p-sam", role: "successor_trustee", order: 1, status: "confirmed", decisionId: "d-successor" },
    { id: "f4", personId: "p-morgan", role: "successor_trustee", order: 2, status: "needs_review" },
    { id: "f5", personId: "p-sam", role: "guardian_of_person", order: 1, forPersonIds: ["p-riley"], status: "confirmed", decisionId: "d-guardian" },
    { id: "f6", personId: "p-alex", role: "financial_agent", order: 1, forPersonIds: ["p-jordan"], status: "known" },
    { id: "f7", personId: "p-jordan", role: "healthcare_agent", order: 1, forPersonIds: ["p-alex"], status: "known" },
    { id: "f8", personId: "p-casey", role: "healthcare_agent", order: 2, forPersonIds: ["p-alex"], status: "known" },
  ],
  assets: [
    {
      id: "a-home", label: "Home (sample residence)", category: "real_estate",
      approximateValue: { value: 400000, status: "known" },
      titledTo: { value: ["p-alex", "p-jordan"], status: "confirmed" },
      character: { value: "community", status: "known" },
      isHomestead: { value: true, status: "confirmed" },
      hasMortgage: { value: true, status: "confirmed" },
      funding: { method: "deed", state: "funded", deedRecorded: { value: null, status: "unknown" } },
    },
    {
      id: "a-checking", label: "Checking", category: "bank", refLast4: "0000",
      approximateValue: { value: 15000, status: "known" },
      titledTo: { value: ["p-alex", "p-jordan"], status: "confirmed" },
      character: { value: "community", status: "known" },
      funding: { method: "retitle", state: "funded" },
    },
    {
      id: "a-brokerage", label: "Brokerage", category: "brokerage", refLast4: "1111",
      approximateValue: { value: 120000, status: "known" },
      titledTo: { value: ["p-jordan"], status: "confirmed" },
      character: { value: "mixed", status: "needs_review", note: "Sample: opened before marriage, later contributions" },
      funding: { method: "retitle", state: "review" },
    },
    {
      id: "a-vehicle", label: "Vehicle", category: "vehicle",
      approximateValue: { value: 20000, status: "known" },
      titledTo: { value: ["p-alex"], status: "confirmed" },
      character: { value: "community", status: "known" },
      funding: { method: "leave_outside", state: "left_outside" },
    },
    {
      id: "a-ira", label: "IRA", category: "ira", refLast4: "2222",
      approximateValue: { value: 90000, status: "known" },
      titledTo: { value: ["p-alex"], status: "confirmed" },
      character: { value: "community", status: "needs_review" },
      funding: { method: "beneficiary_designation", state: "designation_current" },
      designations: { value: [
        { personId: "p-jordan", tier: "primary", sharePercent: 100 },
        { personId: "trust", tier: "contingent", sharePercent: 100 },
      ], status: "confirmed" },
    },
    {
      id: "a-401k", label: "401(k)", category: "401k", refLast4: "3333",
      approximateValue: { value: 150000, status: "known" },
      titledTo: { value: ["p-jordan"], status: "confirmed" },
      character: { value: "community", status: "needs_review" },
      funding: { method: "beneficiary_designation", state: "designation_needs_update" },
      designations: { value: [
        { personId: "p-alex", tier: "primary", sharePercent: 100 },
        { personId: "p-casey", tier: "contingent", sharePercent: 50 },
        { personId: "p-riley", tier: "contingent", sharePercent: 40 },
      ], status: "known" },
    },
    {
      id: "a-life", label: "Term life insurance", category: "life_insurance",
      approximateValue: { value: 500000, status: "known" },
      titledTo: { value: ["p-alex"], status: "confirmed" },
      character: { value: "community", status: "known" },
      funding: { method: "beneficiary_designation", state: "designation_current" },
      designations: { value: [
        { personId: "p-jordan", tier: "primary", sharePercent: 100 },
        { personId: "trust", tier: "contingent", sharePercent: 100 },
      ], status: "confirmed" },
    },
    {
      id: "a-personal", label: "Household personal property", category: "personal_property",
      titledTo: { value: ["p-alex", "p-jordan"], status: "known" },
      character: { value: "community", status: "known" },
      funding: { method: "assignment", state: "funded" },
    },
    {
      id: "a-digital", label: "Digital assets (email, photos, online accounts)", category: "digital",
      titledTo: { value: ["p-alex", "p-jordan"], status: "known" },
      character: { value: null, status: "unknown" },
      funding: { method: "instructions", state: "instructions_missing" },
    },
  ],
  plan: {
    name: "Example Family Living Trust (sample)",
    jurisdiction: "texas",
    type: { value: "revocable_joint", status: "needs_review" },
    distributions: [
      { id: "dist-1", beneficiaryId: "p-casey", tier: "primary", sharePercent: { value: 50, status: "confirmed" }, terms: { value: "outright", status: "confirmed" }, decisionId: "d-shares" },
      { id: "dist-2", beneficiaryId: "p-riley", tier: "primary", sharePercent: { value: 50, status: "confirmed" }, terms: { value: "held in trust until age 25 (sample)", status: "needs_review" }, decisionId: "d-shares" },
      { id: "dist-3", beneficiaryId: "c-charity", tier: "contingent", sharePercent: { value: 100, status: "known" }, terms: { value: null, status: "unknown" } },
    ],
    documents: [
      { id: "doc-trust", kind: "trust_agreement", stage: "drafting" },
      { id: "doc-will-a", kind: "pour_over_will", forPersonId: "p-alex", stage: "attorney_reviewed" },
      { id: "doc-will-j", kind: "pour_over_will", forPersonId: "p-jordan", stage: "not_started" },
      { id: "doc-poa-a", kind: "durable_poa", forPersonId: "p-alex", stage: "executed", storageReference: "Home safe, folder A (sample)" },
      { id: "doc-mpoa-a", kind: "medical_poa", forPersonId: "p-alex", stage: "executed" },
    ],
    digitalAssetInstructions: { value: null, status: "unknown" },
    incapacityPlan: { definitionOfIncapacity: { value: "Written determination by two licensed physicians (sample)", status: "known" } },
  },
  decisions: [
    confirmed("d-trustees", "Initial trustees", "fiduciary", "Alex Example and Jordan Example as co-trustees", "2026-01-10"),
    confirmed("d-successor", "Primary successor trustee", "fiduciary", "Sam Placeholder", "2026-01-10"),
    confirmed("d-guardian", "Guardian for Riley Example", "fiduciary", "Sam Placeholder", "2026-01-12"),
    confirmed("d-shares", "Primary trust beneficiaries and shares", "dispositive", "Casey Example 50%, Riley Example 50%", "2026-01-12"),
    {
      id: "d-alt-successor", topic: "Alternate successor trustee", sensitivity: "fiduciary",
      answer: "Morgan Sample", answeredBy: "user", state: "proposed",
      readBack: buildReadBack("Alternate successor trustee", "Morgan Sample"),
      createdAt: at("2026-02-01"), updatedAt: at("2026-02-01"),
    },
    {
      id: "d-trust-type", topic: "Joint revocable trust vs. separate trusts", sensitivity: "legal_tax",
      answer: "Preference: one joint revocable trust", answeredBy: "user", state: "awaiting_professional_review", reviewer: "attorney",
      createdAt: at("2026-02-01"), updatedAt: at("2026-02-01"),
    },
  ],
  pendingChanges: [],
  archived: [],
  audit: [
    { id: "au1", at: at("2026-01-10"), actor: "user", action: "decision.confirmed", subjectId: "d-trustees", summary: "Initial trustees" },
    { id: "au2", at: at("2026-01-10"), actor: "user", action: "decision.confirmed", subjectId: "d-successor", summary: "Primary successor trustee" },
    { id: "au3", at: at("2026-01-12"), actor: "user", action: "decision.confirmed", subjectId: "d-guardian", summary: "Guardian for Riley Example" },
    { id: "au4", at: at("2026-01-12"), actor: "user", action: "decision.confirmed", subjectId: "d-shares", summary: "Primary trust beneficiaries and shares" },
    { id: "au5", at: at("2026-02-01"), actor: "user", action: "decision.proposed", subjectId: "d-alt-successor", summary: "fiduciary: Alternate successor trustee" },
    { id: "au6", at: at("2026-02-01"), actor: "system", action: "decision.sent_for_review", subjectId: "d-trust-type", summary: "Joint revocable trust vs. separate trusts → attorney/CPA review" },
    { id: "au7", at: at("2026-03-05"), actor: "user", action: "asset.funding_updated", subjectId: "a-home", summary: "Home deeded to trustees (sample)" },
  ],
};
