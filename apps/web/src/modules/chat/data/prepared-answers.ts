// The mock's fixtures: the suggested questions and their prepared answers. Fictional and generic —
// they name the person from the API and point to the site's pages, never claim facts of their own,
// and speak about the person, never as the person. Phase 7 replaces the answers with the assistant
// over the public profile; the suggestions stay.
import type { ChatBlock, ChatOutcome, ChatRelatedLink, ChatSource } from "@sebela/contracts";

import type { AskEvidence } from "./evidence";

/** The kinds of visitor a suggested question is written for. */
export type AskAudience = "hiring" | "clients" | "technical" | "general";

/** A suggested question: the whole question it submits and a short label for the hero. */
export interface AskSuggestion {
  readonly audience: AskAudience;
  readonly label: string;
  readonly question: string;
}

/**
 * A prepared answer: its text, how it ends, its blocks, the sources it rests on (none for an
 * answer without evidence) and one or two links onward.
 */
export interface PreparedAnswer {
  readonly text: string;
  readonly outcome: ChatOutcome;
  readonly blocks: readonly ChatBlock[];
  readonly sources: readonly ChatSource[];
  readonly related: readonly ChatRelatedLink[];
}

/** The four suggested questions of an empty chat, one per kind of visitor, in this order. */
export function askSuggestions(name: string): readonly AskSuggestion[] {
  return [
    {
      audience: "hiring",
      label: "AI role fit?",
      question: `Would ${name} fit an AI engineering role?`,
    },
    {
      audience: "clients",
      label: "What to automate?",
      question: `What could ${name} automate for my company?`,
    },
    {
      audience: "technical",
      label: "Strongest skills?",
      question: `What are ${name}'s strongest engineering skills?`,
    },
    {
      audience: "general",
      label: "Working on now?",
      question: `What is ${name} working on now?`,
    },
  ];
}

/**
 * The hero's suggested questions: three of the four, leaving out the one answered with too little
 * evidence, so the first answer a visitor sees from the homepage is a full one.
 */
export function heroSuggestions(name: string): readonly AskSuggestion[] {
  return askSuggestions(name).filter((suggestion) => suggestion.audience !== "technical");
}

/**
 * The prepared answer to a question, from the evidence: a suggested question gets its own, however
 * it is spaced or cased; any other question learns that the assistant is not connected yet.
 */
export function preparedAnswer(evidence: AskEvidence, question: string): PreparedAnswer {
  throw new Error(`not implemented for ${evidence.name}: ${question}`);
}
