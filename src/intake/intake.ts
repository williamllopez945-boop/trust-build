/**
 * Guided intake with guardrails:
 *  - exactly one question is presented at a time
 *  - answers are only ever the user's own words (never generated)
 *  - sensitive answers produce a read-back that must be confirmed
 *  - questions asking for legal/tax advice are routed to professional review
 *  - only structured decisions are retained; raw input is discarded
 */
import { proposeDecision, type Decision } from "../domain/decisions.ts";
import type { AuditEntry } from "../domain/audit.ts";
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
  | { kind: "decision"; decision: Decision; audit: AuditEntry[]; state: IntakeState; needsReadBack: boolean }
  | { kind: "routed_to_professional"; decision: Decision; audit: AuditEntry[]; state: IntakeState; message: string }
  | { kind: "empty"; message: string };

export function answerQuestion(state: IntakeState, question: IntakeQuestion, rawText: string, now: Date = new Date()): AnswerOutcome {
  const text = rawText.trim();
  if (!text) return { kind: "empty", message: "No answer given. You can skip this question and come back later." };
  const nextState: IntakeState = { ...state, answeredIds: [...state.answeredIds, question.id] };
  const id = `${question.id}.${now.getTime()}`;

  if (question.sensitivity !== "legal_tax" && seeksProfessionalAdvice(text)) {
    const { decision, audit } = proposeDecision(
      { id, topic: `${question.prompt} (question for professional)`, sensitivity: "legal_tax", answer: text, answeredBy: "user" },
      now,
    );
    return {
      kind: "routed_to_professional",
      decision,
      audit,
      state: nextState,
      message: "This sounds like a request for legal or tax advice. It has been added to the attorney/CPA review list instead of being answered.",
    };
  }

  const { decision, audit } = proposeDecision({ id, topic: question.prompt, sensitivity: question.sensitivity, answer: text, answeredBy: "user" }, now);
  return { kind: "decision", decision, audit, state: nextState, needsReadBack: Boolean(decision.readBack) };
}

export function skipQuestion(state: IntakeState, question: IntakeQuestion): IntakeState {
  return { ...state, skippedIds: [...state.skippedIds, question.id] };
}
