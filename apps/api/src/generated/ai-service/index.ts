// The AI service's internal generation interface as the API calls it. Written by hand for now, in
// the shape the AI service's OpenAPI document will give; once that document exists this file is
// generated from it and never edited by hand.

/** A source an earlier answered exchange cited, as context for the next answer. */
export interface GenerationHistorySource {
  readonly kind: string;
  readonly recordId: string;
  readonly title: string;
}

/** One completed answered exchange of the conversation, oldest first. */
export interface GenerationHistoryExchange {
  readonly question: string;
  readonly answer: string;
  readonly language: "en" | "cs" | null;
  readonly sources: readonly GenerationHistorySource[];
}

/**
 * The body of `POST /internal/v1/generations`: one admitted question with its one-use grant. The AI
 * service claims the grant at the API before it spends anything and reports one result back.
 */
export interface GenerationRequest {
  readonly operationId: string;
  readonly grant: string;
  readonly question: string;
  readonly history: readonly GenerationHistoryExchange[];
  /** The question's date in the site's time zone, `YYYY-MM-DD`. */
  readonly today: string;
  readonly deadlineAt: string;
  readonly contextRevision: number;
  readonly model: string;
  readonly pricingVersion: string;
  readonly allowanceUsd: number;
}

/** The path of the generation route, relative to the AI service's base address. */
export const generationsPath = "internal/v1/generations";

/** The only status that means the AI service accepted the generation. */
export const generationAcceptedStatus = 202;
