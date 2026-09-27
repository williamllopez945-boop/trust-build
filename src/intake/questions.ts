import type { Sensitivity } from "../domain/decisions.ts";

export interface IntakeQuestion {
  id: string;
  section: "household" | "fiduciaries" | "beneficiaries" | "assets" | "incapacity" | "legal_tax";
  prompt: string;
  sensitivity: Sensitivity;
  help?: string;
}

/** Asked strictly one at a time, in this order. */
export const QUESTIONS: IntakeQuestion[] = [
  { id: "q.marital", section: "household", sensitivity: "factual", prompt: "What is the household's current marital status?" },
  { id: "q.dependents", section: "household", sensitivity: "factual", prompt: "How many children or other dependents are there, and are any minors?" },
  { id: "q.homestead", section: "assets", sensitivity: "important_fact", prompt: "Which property, if any, is your residence homestead?" },
  { id: "q.property_character", section: "assets", sensitivity: "important_fact", prompt: "Which assets do you believe are separate property rather than community property?", help: "Your belief is recorded as-is and flagged for attorney review." },
  { id: "q.successor_trustee", section: "fiduciaries", sensitivity: "fiduciary", prompt: "Who do you want as successor trustee, and who is the alternate?" },
  { id: "q.guardian", section: "fiduciaries", sensitivity: "fiduciary", prompt: "Who do you want as guardian for minor children, and who is the alternate?" },
  { id: "q.beneficiaries", section: "beneficiaries", sensitivity: "dispositive", prompt: "Who should receive trust assets, and in what shares?" },
  { id: "q.distribution_terms", section: "beneficiaries", sensitivity: "dispositive", prompt: "Should any beneficiary's share be held in trust until a certain age or event?" },
  { id: "q.incapacity", section: "incapacity", sensitivity: "important_fact", prompt: "How should incapacity be determined (for example, by one or two physicians)?" },
  { id: "q.trust_type", section: "legal_tax", sensitivity: "legal_tax", prompt: "Do you have a preference between a joint revocable trust and separate trusts?", help: "Recorded as your preference only; the attorney decides the structure with you." },
];
