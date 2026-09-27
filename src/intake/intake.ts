/**
 * Guided intake with guardrails:
 *  - exactly one question is presented at a time
 *  - answers are structured selections or the user's own words, never generated
 *  - answers become *proposed* graph changes in the review queue; nothing is
 *    applied or confirmed automatically
 *  - free text that asks for legal/tax advice is routed to professional review
 *  - raw input is discarded once mapped; provenance is kept on each change
 */
import { proposeDecision } from "../domain/decisions.ts";
import { proposeChange, queueChange, type ChangeSet } from "../domain/changes.ts";
import type { Household } from "../domain/types.ts";
import { mapIntakeAnswer, type IntakeAnswer } from "./mapping.ts";
import { QUESTIONS, type IntakeQuestion } from "./questions.ts";

export interface IntakeState {
  answeredIds: string[];
  skippedIds: string[];
}

export const emptyIntake = (): IntakeState => ({ answeredIds: [], skippedIds: [] });

export function nextQuestion(state: IntakeState, questions: IntakeQuestion[] = QUESTIONS): IntakeQuestion | null {
  const done = new Set([...state.answeredIds, ...state.skippedIds]);
  return questions.find((q) => !done.has(q.id)) ?? null;
}

const ADVICE_SEEKING = [
  /\bshould (i|we)\b/i,
  /\bis it (legal|allowed|better)\b/i,
  /\bwhat do you (recommend|suggest)\b/i,
  /\b(tax|taxes|irs|estate tax|gift tax|capital gains)\b/i,
  /\bwho should\b/i,
];

/** True when the user's text asks for advice instead of stating a decision. */
export function seeksProfessionalAdvice(text: string): boolean {
  return ADVICE_SEEKING.some((re) => re.test(text));
}

export type AnswerOutcome =
  | { kind: "proposed"; household: Household; changes: ChangeSet[]; state: IntakeState }
  | { kind: "routed_to_professional"; household: Household; state: IntakeState; message: string }
  | { kind: "nothing_to_change"; state: IntakeState; message: string };

/** Map an answer to proposed changes and queue them for review. */
export function answerQuestion(h: Household, state: IntakeState, question: IntakeQuestion, answer: IntakeAnswer, now: Date = new Date()): AnswerOutcome {
  const nextState: IntakeState = { ...state, answeredIds: [...state.answeredIds, question.id] };
  let next = h;
  const changes: ChangeSet[] = [];
  for (const input of mapIntakeAnswer(h, question, answer, now)) {
    const cs = proposeChange(next, input, now);
    if (cs.op === "update" && cs.fields.length === 0) continue; // already recorded
    changes.push(cs);
    next = queueChange(next, cs, now);
  }
  if (changes.length === 0) return { kind: "nothing_to_change", state: nextState, message: "No changes: your answer matches what is already recorded." };
  return { kind: "proposed", household: next, changes, state: nextState };
}

/** A free-text question for the attorney/CPA, captured instead of answered. */
export function askProfessional(h: Household, state: IntakeState, question: IntakeQuestion, text: string, now: Date = new Date()): AnswerOutcome {
  const { decision, audit } = proposeDecision(
    { id: `${question.id}.q.${now.getTime()}`, topic: `${question.prompt} (question for professional)`, sensitivity: "legal_tax", answer: text.trim(), answeredBy: "user" },
    now,
  );
  return {
    kind: "routed_to_professional",
    household: { ...h, decisions: [...h.decisions, decision], audit: [...h.audit, ...audit] },
    state: { ...state, answeredIds: [...state.answeredIds, question.id] },
    message: "Added to the attorney/CPA list. FamilyVault does not answer legal or tax questions.",
  };
}

export function skipQuestion(state: IntakeState, question: IntakeQuestion): IntakeState {
  return { ...state, skippedIds: [...state.skippedIds, question.id] };
}
