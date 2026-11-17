// The mock's fixtures: the suggested questions and their prepared answers. Fictional and generic —
// they name the person from the API and point to the site's pages, never claim facts of their own.
import type { ChatOutcome, ChatRelatedLink } from "@sebela/contracts";

/** The kinds of visitor a suggested question is written for. */
export type AskAudience = "hiring" | "clients" | "technical" | "general";

/** A suggested question: the whole question it submits and a short label for the hero. */
export interface AskSuggestion {
  readonly audience: AskAudience;
  readonly label: string;
  readonly question: string;
}

/** A prepared answer: its text, how it ends and one or two links onward. */
export interface PreparedAnswer {
  readonly text: string;
  readonly outcome: ChatOutcome;
  readonly related: readonly ChatRelatedLink[];
}

export const askSuggestions: (name: string) => readonly AskSuggestion[] = () => {
  throw new Error("not implemented");
};

export const heroSuggestions: (name: string) => readonly AskSuggestion[] = () => {
  throw new Error("not implemented");
};

export const preparedAnswer: (name: string, question: string) => PreparedAnswer = () => {
  throw new Error("not implemented");
};
