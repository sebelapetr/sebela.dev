import type { ReactNode } from "react";

import { ProseMarkdown, type EducationRow } from "../../_shared";
import type { CvExperience, CvExplorationLine, CvSkillGroup } from "../data/cv-document";

const tagClass = "type-tag rounded-sm border border-border px-1.5";

/** One section of the CV: an `h2` and its content, 24 px apart. */
export function CvSection({
  id,
  heading,
  children,
}: {
  readonly id: string;
  readonly heading: string;
  readonly children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-6 print:gap-3">
      <h2 id={`${id}-heading`} className="type-heading">
        {heading}
      </h2>
      {children}
    </section>
  );
}

/** The summary: the short bio as prose. */
export function CvSummary({ summary }: { readonly summary: string }) {
  return (
    <div className="max-w-prose text-pretty [&>*+*]:mt-3">
      <ProseMarkdown>{summary}</ProseMarkdown>
    </div>
  );
}

/**
 * The experiences the API selected for the CV, in its order, all written out: the period and the
 * kind, the role and the organization, the summary, the responsibilities and the technologies.
 */
export function CvExperiences({ experiences }: { readonly experiences: readonly CvExperience[] }) {
  return (
    <ol aria-label="Experience" className="flex flex-col gap-10 print:gap-5">
      {experiences.map((experience) => (
        <li
          key={experience.slug}
          className="flex break-inside-avoid flex-col gap-3 border-l border-border pl-4"
        >
          <div className="flex flex-col gap-1">
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
              <span className="type-label text-balance">{experience.period}</span>
              <span className={tagClass}>{experience.kindLabel}</span>
            </p>
            <h3 className="type-item">
              {experience.title}
              <span className="font-normal text-muted-foreground">
                {" "}
                · {experience.organization}
              </span>
            </h3>
          </div>
          <div className="max-w-prose text-pretty text-muted-foreground [&>*+*]:mt-3">
            <ProseMarkdown>{experience.summary}</ProseMarkdown>
          </div>
          {experience.responsibilities.length === 0 ? null : (
            <ul
              aria-label={`${experience.title} responsibilities`}
              className="max-w-prose list-disc space-y-1 pl-6 text-muted-foreground"
            >
              {experience.responsibilities.map((responsibility) => (
                <li key={responsibility}>{responsibility}</li>
              ))}
            </ul>
          )}
          {experience.technologies.length === 0 ? null : (
            <ul
              aria-label={`${experience.title} technologies`}
              className="type-label flex flex-wrap gap-x-3 gap-y-1"
            >
              {experience.technologies.map((technology) => (
                <li key={technology}>{technology}</li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * The independent R&D, apart from the experiences: one line each, wrapping only where the width
 * ends — the name, the stored status as visible text with what it means (a designed one reads as an
 * unimplemented design, on screen and in print), the period and the one-sentence summary.
 */
export function CvIndependentRd({
  explorations,
}: {
  readonly explorations: readonly CvExplorationLine[];
}) {
  return (
    <ol aria-label="Explorations" className="flex flex-col gap-3 print:gap-2">
      {explorations.map((exploration) => (
        <li
          key={exploration.slug}
          className="max-w-prose break-inside-avoid border-l border-border pl-4 text-pretty"
        >
          <h3 className="inline font-semibold">{exploration.name}</h3>{" "}
          <span className={`${tagClass} ml-1 whitespace-nowrap`}>{exploration.statusLabel}</span>{" "}
          <span className="type-label">
            {exploration.statusMeaning} · {exploration.period}.
          </span>{" "}
          <div className="inline text-muted-foreground [&_p]:inline">
            <ProseMarkdown>{exploration.summary}</ProseMarkdown>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** The skills: each group's label, then its technologies as one plain line. */
export function CvSkills({ groups }: { readonly groups: readonly CvSkillGroup[] }) {
  return (
    <dl className="flex flex-col gap-4 print:gap-2">
      {groups.map((group) => (
        <div
          key={group.key}
          className="flex break-inside-avoid flex-col gap-1 sm:flex-row sm:gap-6 print:flex-row print:gap-6"
        >
          <dt className="type-label shrink-0 sm:w-48 print:w-48">{group.label}</dt>
          <dd className="text-pretty">{group.technologies.join(", ")}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The education, compact rows in their order: the title, the institution, the period, the kind. */
export function CvEducation({ rows }: { readonly rows: readonly EducationRow[] }) {
  return (
    <ol aria-label="Education" className="flex flex-col gap-4 print:gap-2">
      {rows.map((row) => (
        <li
          key={row.slug}
          className="flex break-inside-avoid flex-col gap-1 border-l border-border pl-4"
        >
          <h3 className="font-semibold text-pretty">
            {row.title}
            {row.institution === null ? null : (
              <span className="font-normal text-muted-foreground"> · {row.institution}</span>
            )}
          </h3>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
            {row.period === null ? null : (
              <span className="type-label text-balance">{row.period}</span>
            )}
            <span className={tagClass}>{row.kindLabel}</span>
          </p>
        </li>
      ))}
    </ol>
  );
}
