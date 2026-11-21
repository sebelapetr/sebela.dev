// Turns the public portfolio into indexable sources: one source per record with its canonical site
// path, split into sections by field and into bounded chunks, each with its text hash, and a
// version hash over the whole source. Nothing private (the contact email) is indexed.
import { createHash } from "node:crypto";

import {
  portfolioSourceId,
  portfolioSourcePath,
  type PortfolioContentKind,
  type PortfolioSourceAddress,
} from "@sebela/contracts";

import type { PortfolioSnapshot } from "../ports/index.js";

/** A chunk of a section, before it is embedded. */
export interface SourceChunk {
  readonly sectionOrdinal: number;
  readonly ordinal: number;
  readonly text: string;
  readonly textHash: string;
}

/** A section of a source: where it sits in the record and its span in the source text. */
export interface SourceSection {
  readonly ordinal: number;
  readonly headingPath: readonly string[];
  readonly start: number;
  readonly end: number;
}

/** One portfolio record as an indexable source. */
export interface PortfolioSource {
  readonly sourceId: string;
  readonly contentKind: PortfolioContentKind;
  readonly title: string;
  readonly path: string;
  readonly version: string;
  readonly sections: readonly SourceSection[];
  readonly chunks: readonly SourceChunk[];
}

/** The most characters in one chunk. */
export const chunkMaxLength = 1200;

/** A section as a record describes it: a heading below the title, `null` for the opening one. */
interface Part {
  readonly heading: string | null;
  readonly lines: readonly (string | null | undefined)[];
}

interface PortfolioRecord {
  readonly address: PortfolioSourceAddress;
  readonly title: string;
  readonly parts: readonly Part[];
}

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

const names = (items: readonly { readonly name: string }[]) =>
  items.length === 0 ? null : items.map((item) => item.name).join(", ");

const labelled = (label: string, value: string | null | undefined) =>
  value === null || value === undefined || value.trim() === "" ? null : `${label}: ${value}`;

/** Every indexable source of the portfolio, in a stable order. */
export function portfolioSources(snapshot: PortfolioSnapshot): PortfolioSource[] {
  return portfolioRecords(snapshot).map(toSource);
}

function portfolioRecords(snapshot: PortfolioSnapshot): PortfolioRecord[] {
  const records: PortfolioRecord[] = [];
  const { person } = snapshot;
  if (person !== null) {
    records.push({
      address: { kind: "profile", key: "person" },
      title: person.name,
      parts: [
        {
          heading: null,
          lines: [
            person.headline,
            person.shortBio,
            labelled("Location", person.location),
            labelled("Availability", person.availability),
          ],
        },
        { heading: "About", lines: [person.longBio] },
        {
          heading: "Working together",
          lines: [
            person.servicesIntro,
            ...person.collaborationSteps.map((step) => `${step.title}: ${step.description}`),
            person.servicesNote,
          ],
        },
      ],
    });
  }
  for (const experience of snapshot.experiences) {
    const testimonials = snapshot.testimonials.filter(
      (testimonial) => testimonial.experience === experience.slug,
    );
    records.push({
      address: { kind: "experience", key: experience.slug },
      title: `${experience.title} at ${experience.organization.name}`,
      parts: [
        {
          heading: null,
          lines: [experience.summary, labelled("Technologies", names(experience.technologies))],
        },
        { heading: "Responsibilities", lines: experience.responsibilities },
        {
          heading: "Testimonials",
          lines: testimonials.map(
            (testimonial) =>
              `"${testimonial.quote}" (${testimonial.authorName}, ${testimonial.authorRole})`,
          ),
        },
      ],
    });
  }
  for (const project of snapshot.projects) {
    records.push({
      address: { kind: "project", key: project.slug },
      title: project.name,
      parts: [
        {
          heading: null,
          lines: [project.summary, labelled("Technologies", names(project.technologies))],
        },
        { heading: "Problem", lines: [project.problem] },
        { heading: "Work done", lines: [project.workDone] },
        { heading: "Result", lines: [project.result] },
      ],
    });
  }
  for (const caseStudy of snapshot.caseStudies) {
    const project = snapshot.projects.find((each) => each.slug === caseStudy.project);
    records.push({
      address: { kind: "case_study", key: caseStudy.project },
      title: `Case study: ${project?.name ?? caseStudy.project}`,
      parts: [
        { heading: null, lines: [labelled("Role", caseStudy.role)] },
        { heading: "Story", lines: [caseStudy.body] },
      ],
    });
  }
  for (const exploration of snapshot.explorations) {
    records.push({
      address: { kind: "exploration", key: exploration.slug },
      title: exploration.name,
      parts: [
        {
          heading: null,
          lines: [
            exploration.summary,
            labelled("Concepts", exploration.concepts.join(", ")),
            labelled("Technologies", names(exploration.technologies)),
          ],
        },
      ],
    });
  }
  for (const service of snapshot.services) {
    records.push({
      address: { kind: "service", key: service.slug },
      title: service.name,
      parts: [
        {
          heading: null,
          lines: [
            service.summary,
            labelled("For", service.audience),
            labelled("Deliverable", service.deliverable),
          ],
        },
      ],
    });
  }
  for (const education of snapshot.education) {
    records.push({
      address: { kind: "education", key: education.slug },
      title: education.title,
      parts: [
        {
          heading: null,
          lines: [labelled("Institution", education.institution), education.description],
        },
      ],
    });
  }
  for (const area of snapshot.roadmap.areas) {
    records.push({
      address: { kind: "roadmap_area", key: area.slug },
      title: area.name,
      parts: [
        {
          heading: null,
          lines: [area.description, labelled("Modules", names(area.modules))],
        },
      ],
    });
    for (const module of area.modules) {
      records.push({
        address: { kind: "roadmap_module", key: module.slug, area: area.slug },
        title: module.name,
        parts: [
          {
            heading: null,
            lines: [
              module.description,
              labelled("Area", area.name),
              labelled("Resources", names(module.resources)),
            ],
          },
        ],
      });
      for (const resource of module.resources) {
        records.push({
          address: {
            kind: "roadmap_resource",
            key: resource.slug,
            area: area.slug,
            module: module.slug,
          },
          title: resource.name,
          parts: [
            {
              heading: null,
              lines: [resource.description, labelled("Module", module.name)],
            },
          ],
        });
      }
    }
  }
  for (const day of snapshot.diary.days) {
    if (day.notes === null || day.notes.trim() === "") continue;
    records.push({
      address: { kind: "diary_day", key: day.date },
      title: `Learning diary, ${day.date}`,
      parts: [{ heading: null, lines: [day.notes] }],
    });
  }
  for (const book of snapshot.books) {
    records.push({
      address: { kind: "book", key: book.slug },
      title: book.title,
      parts: [
        { heading: null, lines: [labelled("Author", book.author), book.description] },
        { heading: "Summary", lines: [book.summary] },
      ],
    });
  }
  for (const event of snapshot.events) {
    records.push({
      address: { kind: "event", key: event.slug },
      title: event.name,
      parts: [
        {
          heading: null,
          lines: [labelled("Organizer", event.organizer), labelled("Place", event.place)],
        },
        { heading: "Takeaways", lines: [event.takeaways] },
      ],
    });
  }
  for (const term of snapshot.glossary) {
    records.push({
      address: { kind: "glossary_term", key: term.slug },
      title: term.term,
      parts: [{ heading: null, lines: [term.description] }],
    });
  }
  return records;
}

/** The separator between sections in a source's text. */
const SECTION_BREAK = "\n\n";

function toSource({ address, title, parts }: PortfolioRecord): PortfolioSource {
  const path = portfolioSourcePath(address);
  const sections: SourceSection[] = [];
  const chunks: SourceChunk[] = [];
  const texts: string[] = [];
  let offset = 0;
  for (const part of parts) {
    const body = part.lines
      .filter((line): line is string => typeof line === "string" && line.trim() !== "")
      .map((line) => line.trim())
      .join("\n");
    // The opening section always exists and names the record, so every source has a chunk.
    if (body === "" && part.heading !== null) continue;
    const headingPath = part.heading === null ? [title] : [title, part.heading];
    const text = part.heading === null ? [title, body].filter(Boolean).join("\n") : body;
    const ordinal = sections.length;
    if (texts.length > 0) offset += SECTION_BREAK.length;
    sections.push({ ordinal, headingPath, start: offset, end: offset + text.length });
    texts.push(text);
    offset += text.length;
    const context = part.heading === null ? "" : `${headingPath.join(" / ")}\n`;
    for (const piece of split(text, chunkMaxLength - context.length)) {
      const chunkText = `${context}${piece}`;
      chunks.push({
        sectionOrdinal: ordinal,
        ordinal: chunks.length,
        text: chunkText,
        textHash: sha256(chunkText),
      });
    }
  }
  const version = sha256(
    JSON.stringify({
      title,
      path,
      sections: sections.map((section, index) => [section.headingPath, texts[index]]),
    }),
  );
  return {
    sourceId: portfolioSourceId(address.kind, address.key),
    contentKind: address.kind,
    title,
    path,
    version,
    sections,
    chunks,
  };
}

/** Splits text into pieces of at most `max` characters, at line breaks and then at spaces. */
function split(text: string, max: number): string[] {
  const pieces: string[] = [];
  let current = "";
  const flush = () => {
    if (current.trim() !== "") pieces.push(current.trim());
    current = "";
  };
  for (const word of text.split(/(?<=\s)/u)) {
    if (current.length + word.length > max) flush();
    let rest = word;
    while (rest.length > max) {
      pieces.push(rest.slice(0, max));
      rest = rest.slice(max);
    }
    current += rest;
  }
  flush();
  return pieces;
}
