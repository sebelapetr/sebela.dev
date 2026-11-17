// The mock's fixtures: the suggested questions and their prepared answers. Fictional and generic —
// they name the person from the API and point to the site's pages, never claim facts of their own,
// and speak about the person, never as the person. Phase 7 replaces the answers with the assistant
// over the public profile; the suggestions stay.
import type { ChatOutcome, ChatRelatedLink } from "@sebela/contracts";

import { anchorHref, routes } from "../../_shared";

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

const experienceLink = { label: "Experience", href: routes.experience } as const;
const servicesLink = { label: "Services", href: routes.services } as const;

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

function preparedAnswers(name: string): Readonly<Record<AskAudience, PreparedAnswer>> {
  return {
    hiring: {
      text: `Whether ${name} fits a role depends on what the role needs, so the best evidence is the record itself. The experience page lists each position with its projects and technologies, newest first, and keeps independent AI engineering research apart from delivered work. The CV holds the same record on one page.`,
      outcome: "answered",
      related: [experienceLink, { label: "CV", href: routes.cv }],
    },
    clients: {
      text: `${name} describes each service on the services page: who it is for and what you receive at the end. Automation usually starts with a short conversation about the process and the systems it touches. Describe what you would like to automate through the contact details on the homepage.`,
      outcome: "answered",
      related: [servicesLink, { label: "Contact", href: routes.contact }],
    },
    technical: {
      text: `I don't have enough evidence in ${name}'s public profile to rank engineering skills. The experience page lists the technologies used in each role and project, which is the evidence to judge by.`,
      outcome: "insufficient_evidence",
      related: [experienceLink],
    },
    general: {
      text: `The site keeps what ${name} is building apart from what is being learned. The independent R&D section of the experience page lists the current explorations with their status, and the AI Roadmap will show the learning plan.`,
      outcome: "answered",
      related: [
        { label: "Independent R&D", href: anchorHref({ kind: "independent-rd" }) },
        { label: "AI Roadmap", href: routes.aiRoadmap },
      ],
    },
  };
}

/** A question as compared: lower case, single spaces, curly apostrophes straightened, no end mark. */
function normalise(question: string): string {
  return question
    .toLowerCase()
    .replaceAll("’", "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[\s?.!]+$/, "");
}

/**
 * The prepared answer to a question: a suggested question gets its own, however it is spaced or
 * cased; any other question learns that the assistant is not connected yet and gets the main pages.
 */
export function preparedAnswer(name: string, question: string): PreparedAnswer {
  const asked = normalise(question);
  const answers = preparedAnswers(name);
  for (const suggestion of askSuggestions(name)) {
    if (normalise(suggestion.question) === asked) return answers[suggestion.audience];
  }
  return {
    text: `The assistant is not connected yet, so I can't answer that question. The main pages cover ${name}'s experience, services and CV.`,
    outcome: "unavailable",
    related: [experienceLink, servicesLink],
  };
}
