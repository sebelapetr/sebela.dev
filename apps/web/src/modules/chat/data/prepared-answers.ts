// The mock's fixtures: the suggested questions and their prepared answers. Generic texts that name
// the person from the API, with blocks and sources built only from the public profile's records —
// never a fact of their own — speaking about the person, never as the person. Phase 7 replaces the answers with the assistant
// over the public profile; the suggestions stay.
import {
  ChatBlockSchema,
  ChatSourceSchema,
  type ChatBlock,
  type ChatOutcome,
  type ChatRelatedLink,
  type ChatSource,
} from "@sebela/contracts";

import { anchorHref, routes, technologyGroupLabel } from "../../_shared";
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

const experienceLink = { label: "Experience", href: routes.experience } as const;
const servicesLink = { label: "Services", href: routes.services } as const;
const contactLink = { label: "Contact", href: routes.contact } as const;

/** The experiences and the case studies an answer about a role rests on, at most two of each. */
const SOURCED_EXPERIENCES = 2;
const SOURCED_CASE_STUDIES = 2;
/** The services shown as cards, and the services an answer about them rests on. */
const SERVICE_CARDS = 2;
const SOURCED_SERVICES = 3;
/** The explorations shown as cards. */
const EXPLORATION_CARDS = 3;
/** The most web links a contact card holds (the contract's limit). */
const CONTACT_LINKS = 6;

/** The block when the shared contract accepts it whole; otherwise none, never a partial one. */
function validBlock(block: ChatBlock): ChatBlock | null {
  const parsed = ChatBlockSchema.safeParse(block);
  return parsed.success ? parsed.data : null;
}

/** The source when the shared contract accepts it; otherwise none. */
function validSource(source: ChatSource): ChatSource | null {
  const parsed = ChatSourceSchema.safeParse(source);
  return parsed.success ? parsed.data : null;
}

function present<T>(value: T | null): value is T {
  return value !== null;
}

/**
 * The contact card from the person's contact: the email and each web link the contract accepts;
 * none when nothing is left to contact.
 */
function contactCard(contact: AskEvidence["contact"]): ChatBlock[] {
  const card = (email: string | null, links: AskEvidence["contact"]["links"]) =>
    validBlock({
      type: "ContactCard",
      email,
      links: links.map(({ label, url }) => ({ label, url })),
    });
  const email = contact.email !== null && card(contact.email, []) !== null ? contact.email : null;
  const links = contact.links.filter((link) => card(null, [link]) !== null).slice(0, CONTACT_LINKS);
  if (email === null && links.length === 0) return [];
  const block = card(email, links);
  return block === null ? [] : [block];
}

/** An answer that cannot rest on the profile: it says so, cites nothing and offers the contact. */
function insufficientEvidence(
  evidence: AskEvidence,
  text: string,
  related: readonly ChatRelatedLink[],
): PreparedAnswer {
  return {
    text,
    outcome: "insufficient_evidence",
    blocks: contactCard(evidence.contact),
    sources: [],
    related,
  };
}

function hiringAnswer(evidence: AskEvidence): PreparedAnswer {
  const { name, experiences } = evidence;
  const latest = experiences[0];
  const card =
    latest === undefined
      ? null
      : validBlock({
          type: "ExperienceCard",
          title: latest.title,
          organization: latest.organization,
          startedOn: latest.startedOn,
          endedOn: latest.endedOn,
          summary: latest.summary,
          technologies: [...latest.technologies],
          href: anchorHref({ kind: "experience", slug: latest.slug }),
        });
  const experienceSources = experiences.slice(0, SOURCED_EXPERIENCES).map((experience) =>
    validSource({
      record: { kind: "experience", id: experience.slug },
      title: `${experience.title}, ${experience.organization}`,
      href: anchorHref({ kind: "experience", slug: experience.slug }),
    }),
  );
  const caseStudySources = experiences
    .flatMap((experience) => experience.projects.filter((project) => project.caseStudy))
    .map((project) =>
      validSource({
        record: { kind: "project", id: project.slug },
        title: `${project.name}: technical case study`,
        href: anchorHref({ kind: "case-study", project: project.slug }),
      }),
    )
    .filter(present)
    .slice(0, SOURCED_CASE_STUDIES);
  const focusSources = evidence.technologyGroups.includes("ai-engineering-focus")
    ? [
        validSource({
          record: { kind: "technology_group", id: "ai-engineering-focus" },
          title: technologyGroupLabel("ai-engineering-focus"),
          href: anchorHref({ kind: "technology-group", group: "ai-engineering-focus" }),
        }),
      ]
    : [];
  const sources = [
    ...experienceSources.filter(present),
    ...caseStudySources,
    ...focusSources,
  ].filter(present);
  if (sources.length === 0) {
    return insufficientEvidence(
      evidence,
      `I don't have enough evidence in ${name}'s public profile to say whether ${name} fits a role. Please ask ${name} directly.`,
      [contactLink],
    );
  }
  return {
    text: `Whether ${name} fits a role depends on what the role needs, so the best evidence is the record itself. The experience page lists each position with its projects and technologies, newest first, and keeps independent AI engineering research apart from delivered work. The CV holds the same record on one page.`,
    outcome: "answered",
    blocks: card === null ? [] : [card],
    sources,
    related: [experienceLink, { label: "CV", href: routes.cv }],
  };
}

function clientsAnswer(evidence: AskEvidence): PreparedAnswer {
  const { name } = evidence;
  const offered = evidence.services.flatMap((service) => {
    const href = anchorHref({ kind: "service", slug: service.slug });
    const card = validBlock({
      type: "ServiceCard",
      title: service.name,
      summary: service.summary,
      href,
    });
    const source = validSource({
      record: { kind: "service", id: service.slug },
      title: service.name,
      href,
    });
    return card === null || source === null ? [] : [{ card, source }];
  });
  if (offered.length === 0) {
    return insufficientEvidence(
      evidence,
      `I don't have enough evidence in ${name}'s public profile to say what ${name} could automate for you. Describe the process you have in mind and ask ${name} directly.`,
      [contactLink],
    );
  }
  return {
    text: `${name} describes each service on the services page: who it is for and what you receive at the end. Automation usually starts with a short conversation about the process and the systems it touches. Describe what you would like to automate through the contact details on the homepage.`,
    outcome: "answered",
    blocks: offered.slice(0, SERVICE_CARDS).map(({ card }) => card),
    sources: offered.slice(0, SOURCED_SERVICES).map(({ source }) => source),
    related: [servicesLink, contactLink],
  };
}

function technicalAnswer(evidence: AskEvidence): PreparedAnswer {
  const { name } = evidence;
  return insufficientEvidence(
    evidence,
    `I don't have enough evidence in ${name}'s public profile to rank engineering skills. The experience page lists the technologies used in each role and project, which is the evidence to judge by; for a ranking, ask ${name} directly.`,
    [experienceLink],
  );
}

function generalAnswer(evidence: AskEvidence): PreparedAnswer {
  const { name } = evidence;
  const shown = evidence.explorations.slice(0, EXPLORATION_CARDS).flatMap((exploration) => {
    const card = validBlock({
      type: "ExplorationCard",
      title: exploration.name,
      summary: exploration.summary,
      status: exploration.status,
      href: anchorHref({ kind: "exploration", slug: exploration.slug }),
    });
    return card === null ? [] : [{ exploration, card }];
  });
  // A designed exploration is unimplemented, so it is never evidence of work done.
  const sources = shown
    .filter(({ exploration }) => exploration.status !== "designed")
    .map(({ exploration }) =>
      validSource({
        record: { kind: "exploration", id: exploration.slug },
        title: exploration.name,
        href: anchorHref({ kind: "exploration", slug: exploration.slug }),
      }),
    )
    .filter(present);
  if (evidence.explorations.length === 0) {
    return insufficientEvidence(
      evidence,
      `I don't have enough evidence in ${name}'s public profile to say what ${name} is working on now. The site lists no current explorations; to hear about current work, ask ${name} directly.`,
      [contactLink],
    );
  }
  if (sources.length === 0) {
    return insufficientEvidence(
      evidence,
      `I don't have enough evidence in ${name}'s public profile to say what ${name} is working on now. The current explorations on the experience page are designed only and not yet implemented, so they show plans rather than work done; to hear more, ask ${name} directly.`,
      [{ label: "Independent R&D", href: anchorHref({ kind: "independent-rd" }) }],
    );
  }
  return {
    text: `The site keeps what ${name} is building apart from what is being learned. The independent R&D section of the experience page lists the current explorations with their status: built ones work, tested ones were tried hands-on, and designed ones are planned only and not yet implemented. The AI Roadmap will show the learning plan.`,
    outcome: "answered",
    blocks: shown.map(({ card }) => card),
    sources,
    related: [
      { label: "Independent R&D", href: anchorHref({ kind: "independent-rd" }) },
      { label: "AI Roadmap", href: routes.aiRoadmap },
    ],
  };
}

const ANSWERS: Readonly<Record<AskAudience, (evidence: AskEvidence) => PreparedAnswer>> = {
  hiring: hiringAnswer,
  clients: clientsAnswer,
  technical: technicalAnswer,
  general: generalAnswer,
};

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
 * The prepared answer to a question, from the evidence: a suggested question gets its own, however
 * it is spaced or cased; any other question learns that the assistant is not connected yet. Every
 * block and source is one the shared contract accepts, a source points at its record with the
 * builder its page uses, and an answer the profile cannot support says so with the contact
 * instead of citing anything.
 */
export function preparedAnswer(evidence: AskEvidence, question: string): PreparedAnswer {
  const asked = normalise(question);
  for (const suggestion of askSuggestions(evidence.name)) {
    if (normalise(suggestion.question) === asked) return ANSWERS[suggestion.audience](evidence);
  }
  return {
    text: `The assistant is not connected yet, so I can't answer that question. The main pages cover ${evidence.name}'s experience, services and CV.`,
    outcome: "unavailable",
    blocks: [],
    sources: [],
    related: [experienceLink, servicesLink],
  };
}

/**
 * The reply to a question the assistant declines: one outside the public profile. Only the mock's
 * refusal scenario streams it in phase 3; phase 7's assistant decides refusals itself.
 */
export function declinedAnswer(evidence: AskEvidence): PreparedAnswer {
  return {
    text: `The assistant only answers questions about ${evidence.name}'s public profile, so it won't answer that one.`,
    outcome: "refused",
    blocks: [],
    sources: [],
    related: [experienceLink, servicesLink],
  };
}
