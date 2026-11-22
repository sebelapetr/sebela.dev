// The chat's suggested questions: generic texts that name the person from the API, one per kind of
// visitor, on the Ask page's empty chat and (three of them) in the hero.

/** The kinds of visitor a suggested question is written for. */
export type AskAudience = "hiring" | "clients" | "technical" | "general";

/** A suggested question: the whole question it submits and a short label for the hero. */
export interface AskSuggestion {
  readonly audience: AskAudience;
  readonly label: string;
  readonly question: string;
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
 * The hero's suggested questions: three of the four, leaving out the narrow technical one, so the
 * first question a visitor asks from the homepage is a broad one.
 */
export function heroSuggestions(name: string): readonly AskSuggestion[] {
  return askSuggestions(name).filter((suggestion) => suggestion.audience !== "technical");
}
