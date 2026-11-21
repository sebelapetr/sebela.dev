// Deterministic checks of a supplemental document's chunks against the structured portfolio facts:
// a year, a role title or a technology a chunk claims for an organization that the API's
// experiences contradict. The checks are deliberately narrow and never claim complete detection:
// only a chunk that names exactly one organization of the experiences is checked, and only against
// the experiences at that organization.
import type { SourceChunk } from "../ingest/index.js";
import type { PortfolioSnapshot } from "../ports/index.js";

/** What a conflicting claim is about. */
export type DocumentConflictKind = "date" | "role_title" | "technology";

/**
 * A claim of one chunk that contradicts a structured fact: the chunk's ordinal, the portfolio
 * source of the fact, the claim as it appears in the chunk and the fact it contradicts.
 */
export interface DocumentConflict {
  readonly kind: DocumentConflictKind;
  readonly chunkOrdinal: number;
  readonly sourceId: string;
  readonly claim: string;
  readonly fact: string;
}

/**
 * The conflicts of the chunks with the snapshot's experiences, in chunk order. A chunk's first line
 * is its heading path: the organization may be named anywhere, but claims are read from the body
 * only, so a document's title (an edition year, say) is never a claim.
 *
 * - `date`: a year in the body outside every experience at the organization, from its start year
 *   to its end year (`today`'s year while it continues; the current year when `today` is absent).
 * - `role_title`: another experience's title in the body, once the organization's own titles are
 *   taken out of it.
 * - `technology`: a technology of the portfolio, by its exact name as a whole word, that neither
 *   the organization's experiences nor their projects list.
 */
export function findConflicts(
  chunks: readonly SourceChunk[],
  snapshot: PortfolioSnapshot,
  today: Date = new Date(),
): DocumentConflict[] {
  const organizations = organizationsOf(snapshot, today.getUTCFullYear());
  const titles = unique(snapshot.experiences.map((experience) => experience.title));
  const technologies = unique([
    ...snapshot.experiences.flatMap((experience) => experience.technologies.map(nameOf)),
    ...snapshot.projects.flatMap((project) => project.technologies.map(nameOf)),
  ]);
  const found: DocumentConflict[] = [];
  for (const chunk of chunks) {
    const named = organizations.filter((organization) =>
      wholeName(organization.name, "iu").test(chunk.text),
    );
    const [organization] = named;
    if (organization === undefined || named.length > 1) continue;
    const newline = chunk.text.indexOf("\n");
    const body = newline === -1 ? chunk.text : chunk.text.slice(newline + 1);
    const conflict = (kind: DocumentConflictKind, claim: string, fact: string) => {
      found.push({
        kind,
        chunkOrdinal: chunk.ordinal,
        sourceId: organization.sourceId,
        claim,
        fact,
      });
    };

    const years = new Set(body.match(/(?<!\d)(?:19|20)\d{2}(?!\d)/g) ?? []);
    for (const year of years) {
      const value = Number(year);
      if (!organization.spans.some(([from, to]) => from <= value && value <= to)) {
        conflict("date", year, organization.dates);
      }
    }

    let rest = body;
    for (const own of organization.titles) rest = rest.replace(wholeName(own, "giu"), " ");
    for (const title of titles) {
      if (organization.titles.some((own) => own.toLowerCase() === title.toLowerCase())) continue;
      const claimed = wholeName(title, "iu").exec(rest);
      if (claimed !== null) conflict("role_title", claimed[0], organization.titles.join(", "));
    }

    for (const technology of technologies) {
      if (organization.technologies.includes(technology)) continue;
      if (wholeName(technology, "u").test(body)) {
        conflict("technology", technology, organization.technologies.join(", "));
      }
    }
  }
  return found;
}

/** What the experiences at one organization establish. */
interface OrganizationFacts {
  readonly name: string;
  /** The portfolio source of its first experience: the fact a conflict points to. */
  readonly sourceId: string;
  readonly titles: readonly string[];
  /** Inclusive year spans of its experiences. */
  readonly spans: readonly (readonly [number, number])[];
  readonly dates: string;
  readonly technologies: readonly string[];
}

function organizationsOf(snapshot: PortfolioSnapshot, currentYear: number): OrganizationFacts[] {
  const byName = new Map<string, PortfolioSnapshot["experiences"][number][]>();
  for (const experience of snapshot.experiences) {
    const key = experience.organization.name.trim().toLowerCase();
    if (key === "") continue;
    byName.set(key, [...(byName.get(key) ?? []), experience]);
  }
  return [...byName.values()].flatMap((experiences) => {
    const [first] = experiences;
    if (first === undefined) return [];
    const slugs = new Set(experiences.map((experience) => experience.slug));
    return [
      {
        name: first.organization.name.trim(),
        sourceId: `portfolio:experience:${first.slug}`,
        titles: unique(experiences.map((experience) => experience.title)),
        spans: experiences.map((experience): readonly [number, number] => [
          yearOf(experience.startedOn),
          experience.endedOn === null ? currentYear : yearOf(experience.endedOn),
        ]),
        dates: experiences
          .map(
            (experience) =>
              `${experience.startedOn} ${experience.endedOn === null ? "onwards" : `to ${experience.endedOn}`}`,
          )
          .join("; "),
        technologies: unique([
          ...experiences.flatMap((experience) => experience.technologies.map(nameOf)),
          ...snapshot.projects
            .filter((project) => slugs.has(project.experience))
            .flatMap((project) => project.technologies.map(nameOf)),
        ]),
      },
    ];
  });
}

const yearOf = (date: string) => Number(date.slice(0, 4));

const nameOf = (named: { readonly name: string }) => named.name;

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value !== ""))];
}

/** A name as a whole word: not preceded or followed by a letter or digit. */
function wholeName(name: string, flags: string): RegExp {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, flags);
}
