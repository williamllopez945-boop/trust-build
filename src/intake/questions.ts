import type { Sensitivity } from "../domain/decisions.ts";

/** The kind of structured input a question collects. */
export type AnswerInput =
  | { kind: "choice"; options: { value: string; label: string }[] }
  | { kind: "new_people"; relationship: "child" | "stepchild" | "grandchild" }
  | { kind: "pick_asset"; categories: string[]; allowNone: boolean }
  | { kind: "asset_character" }
  | { kind: "ordered_people"; min: number }
  | { kind: "shares" }
  | { kind: "distribution_terms" }
  | { kind: "text" };

export interface IntakeQuestion {
  id: string;
  section: "household" | "fiduciaries" | "beneficiaries" | "assets" | "incapacity" | "legal_tax";
  prompt: string;
  sensitivity: Sensitivity;
  input: AnswerInput;
  help?: string;
}

/** Asked strictly one at a time, in this order. */
export const QUESTIONS: IntakeQuestion[] = [
  {
    id: "q.marital", section: "household", sensitivity: "important_fact",
    prompt: "What is the household's current marital status?",
    input: { kind: "choice", options: ["married", "single", "widowed", "divorced"].map((v) => ({ value: v, label: v })) },
  },
  {
    id: "q.dependents", section: "household", sensitivity: "important_fact",
    prompt: "Add each child of the grantor(s). Mark any who are minors.",
    help: "Use fictional names in the demo. Leave empty if there are none.",
    input: { kind: "new_people", relationship: "child" },
  },
  {
    id: "q.homestead", section: "assets", sensitivity: "important_fact",
    prompt: "Which property, if any, is your residence homestead?",
    input: { kind: "pick_asset", categories: ["real_estate"], allowNone: true },
  },
  {
    id: "q.property_character", section: "assets", sensitivity: "important_fact",
    prompt: "For each asset, do you believe it is community or separate property?",
    help: "Your belief is recorded as-is and flagged for attorney review. Choose \"not sure\" when unsure.",
    input: { kind: "asset_character" },
  },
  {
    id: "q.successor_trustee", section: "fiduciaries", sensitivity: "fiduciary",
    prompt: "Who do you want as successor trustee? List the primary first, then alternates.",
    input: { kind: "ordered_people", min: 1 },
  },
  {
    id: "q.guardian", section: "fiduciaries", sensitivity: "fiduciary",
    prompt: "Who do you want as guardian for minor children? List the primary first, then alternates.",
    input: { kind: "ordered_people", min: 1 },
  },
  {
    id: "q.beneficiaries", section: "beneficiaries", sensitivity: "dispositive",
    prompt: "Who should receive trust assets, and in what shares?",
    input: { kind: "shares" },
  },
  {
    id: "q.distribution_terms", section: "beneficiaries", sensitivity: "dispositive",
    prompt: "For each primary beneficiary, how should their share be distributed?",
    help: "For example: outright, or held in trust until a certain age. The attorney will draft the actual terms.",
    input: { kind: "distribution_terms" },
  },
  {
    id: "q.incapacity", section: "incapacity", sensitivity: "important_fact",
    prompt: "How should incapacity be determined (for example, by one or two physicians)?",
    input: { kind: "text" },
  },
  {
    id: "q.trust_type", section: "legal_tax", sensitivity: "legal_tax",
    prompt: "Do you have a preference between one joint revocable trust and separate trusts?",
    help: "Recorded as your preference only; the attorney decides the structure with you.",
    input: {
      kind: "choice",
      options: [
        { value: "revocable_joint", label: "One joint revocable trust" },
        { value: "revocable_individual", label: "Separate revocable trusts" },
        { value: "irrevocable", label: "Irrevocable trust" },
        { value: "undecided", label: "No preference / undecided" },
      ],
    },
  },
];
