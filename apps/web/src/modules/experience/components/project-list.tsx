import type { ReactNode } from "react";

import { ProseMarkdown } from "../../_shared";
import type { TimelineProject } from "../data/timeline";
import { CaseStudyMarkdown } from "./case-study-markdown";
import { CaseStudyDisclosure } from "./disclosures";

/**
 * The projects of one experience as editorial rows, in their order. Each row names the project and
 * its period, then its context. A project without a case study shows its problem, solution and
 * result; one with a case study keeps them, with the person's own role and the long account, inside
 * the case study's disclosure. The technologies close the row. The result is the project's outcome
 * and the role the person's own contribution, never mixed. Nothing is shown in place of a missing
 * case study.
 */
export function ProjectList({ projects }: { readonly projects: readonly TimelineProject[] }) {
  return (
    <ol aria-label="Projects" className="flex flex-col gap-8">
      {projects.map((project) => (
        <li
          key={project.slug}
          id={project.anchor}
          tabIndex={-1}
          className="anchor-target flex flex-col gap-3 border-l border-border pl-4"
        >
          <div className="flex flex-col gap-1">
            <h3 className="type-item">{project.name}</h3>
            <p className="type-label text-balance">{project.period}</p>
          </div>
          <div className="text-muted-foreground [&>*+*]:mt-3">
            <ProseMarkdown>{project.summary}</ProseMarkdown>
          </div>
          {project.caseStudy === null ? (
            <Evidence project={project} />
          ) : (
            <CaseStudyDisclosure anchor={project.caseStudy.anchor} projectName={project.name}>
              <Evidence project={project} role={project.caseStudy.role}>
                <CaseStudyMarkdown>{project.caseStudy.body}</CaseStudyMarkdown>
              </Evidence>
            </CaseStudyDisclosure>
          )}
          {project.technologies.length === 0 ? null : (
            <ul
              aria-label={`${project.name} technologies`}
              className="type-label flex flex-wrap gap-x-3 gap-y-1"
            >
              {project.technologies.map((technology) => (
                <li key={technology.slug}>{technology.name}</li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}

/** Problem, the person's role (with a case study only), solution and result, each labelled. */
function Evidence({
  project,
  role,
  children,
}: {
  readonly project: TimelineProject;
  readonly role?: string;
  /** The case study's account, after the work done. */
  readonly children?: ReactNode;
}) {
  return (
    <dl className="flex flex-col gap-4">
      <Part label="Problem">
        <ProseMarkdown>{project.problem}</ProseMarkdown>
      </Part>
      {role === undefined ? null : (
        <Part label="My role">
          <p>{role}</p>
        </Part>
      )}
      <Part label="Solution">
        <ProseMarkdown>{project.workDone}</ProseMarkdown>
        {children === undefined ? null : (
          // The case study's own account belongs to the solution: one level in, behind its own rule,
          // so its section headings read as parts of the solution, not as parts beside it.
          <div data-slot="case-study-account" className="border-l border-border pl-4 [&>*+*]:mt-3">
            {children}
          </div>
        )}
      </Part>
      <Part label="Result">
        <ProseMarkdown>{project.result}</ProseMarkdown>
      </Part>
    </dl>
  );
}

function Part({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="type-label">{label}</dt>
      <dd className="[&>*+*]:mt-3">{children}</dd>
    </div>
  );
}
