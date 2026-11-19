import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@sebela/ui/components/collapsible";

import { ProseMarkdown } from "../../_shared";
import { ROADMAP_FAQ } from "../data/faq";
import type {
  FollowedSourceRow,
  GlossaryTermRow,
  ProjectIdeaRow,
  SupportingSections as Sections,
} from "../data/supporting";
import { TypeBadge } from "./badges";

const LINK =
  "inline-flex min-h-11 items-center rounded-sm underline-offset-4 hover:underline focus-visible:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

const TRIGGER =
  "group/disclosure flex min-h-11 w-full items-center gap-3 rounded-sm py-2 text-left underline-offset-4 hover:underline focus-visible:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

const CHEVRON =
  "ml-auto size-4 shrink-0 text-muted-foreground group-data-[panel-open]/disclosure:rotate-180 motion-safe:transition-transform";

const PROSE = "text-base leading-7 wrap-anywhere text-muted-foreground [&>*+*]:mt-3";

/**
 * The overview's supporting sections below the learning approach, in the original's order: the
 * project ideas, the followed sources, the frequently asked questions and the additional terms.
 * Data-driven sections without content are left out; the FAQ is the site's own text and always
 * shows. Closed panels stay in the page (`hidden="until-found"`), so page search finds them.
 */
export function SupportingSections({ sections }: { readonly sections: Sections }) {
  return (
    <>
      {sections.projectIdeas.length === 0 ? null : <ProjectIdeas ideas={sections.projectIdeas} />}
      {sections.followedSources.length === 0 ? null : (
        <FollowedSources sources={sections.followedSources} />
      )}
      <Faq />
      {sections.glossaryTerms.length === 0 ? null : (
        <GlossaryTerms terms={sections.glossaryTerms} />
      )}
    </>
  );
}

function Section({
  id,
  title,
  lead,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly lead: string;
  readonly children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h2 id={`${id}-heading`} className="type-heading">
          {title}
        </h2>
        <p className="text-base leading-7 text-muted-foreground">{lead}</p>
      </div>
      {children}
    </section>
  );
}

function Disclosure({
  heading,
  defaultOpen = false,
  children,
}: {
  readonly heading: ReactNode;
  readonly defaultOpen?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <Collapsible defaultOpen={defaultOpen} className="flex flex-col">
      <h3 className="type-item">
        <CollapsibleTrigger className={TRIGGER}>
          {heading}
          <ChevronDown aria-hidden="true" className={CHEVRON} />
        </CollapsibleTrigger>
      </h3>
      <CollapsibleContent hiddenUntilFound>
        <div className="flex flex-col gap-4 pt-2 pb-2">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ProjectIdeas({ ideas }: { readonly ideas: readonly ProjectIdeaRow[] }) {
  return (
    <Section
      id="project-ideas"
      title="Portfolio Project Ideas"
      lead="Additional project ideas to strengthen a portfolio beyond the core roadmap."
    >
      <ol className="flex flex-col">
        {ideas.map((idea) => (
          <li key={idea.slug} className="border-t border-border py-2 last:border-b">
            <Disclosure
              heading={
                <span className="flex min-w-0 items-baseline gap-3">
                  <span className="type-label tabular-nums">{idea.order}</span>
                  <span className="min-w-0 wrap-anywhere">{idea.title}</span>
                </span>
              }
            >
              <div className="flex flex-col gap-1">
                <p className="type-label">Why it matters</p>
                <div className={PROSE}>
                  <ProseMarkdown>{idea.whyItMatters}</ProseMarkdown>
                </div>
              </div>
              {idea.topics.length === 0 ? null : (
                <div className="flex flex-col gap-1">
                  <p className="type-label">Key topics</p>
                  <ul className="list-disc pl-5 text-base leading-7 text-muted-foreground">
                    {idea.topics.map((topic) => (
                      <li key={topic} className="wrap-anywhere">
                        {topic}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {idea.howToStart === null ? null : (
                <div className="flex flex-col gap-1">
                  <p className="type-label">How to start</p>
                  <div className={PROSE}>
                    <ProseMarkdown>{idea.howToStart}</ProseMarkdown>
                  </div>
                </div>
              )}
            </Disclosure>
          </li>
        ))}
      </ol>
    </Section>
  );
}

function FollowedSources({ sources }: { readonly sources: readonly FollowedSourceRow[] }) {
  return (
    <Section
      id="stay-current"
      title="Stay Current"
      lead="Sources to keep up with the fast-moving AI landscape without getting overwhelmed."
    >
      <ul className="flex flex-col">
        {sources.map((source) => (
          <li
            key={source.slug}
            className="flex flex-col gap-2 border-t border-border py-4 last:border-b"
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h3 className="type-item wrap-anywhere">
                {source.href === null ? (
                  source.title
                ) : (
                  <a href={source.href} target="_blank" rel="noopener noreferrer" className={LINK}>
                    {source.title}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                )}
              </h3>
              {source.kind === null ? null : <TypeBadge label={source.kind} />}
            </div>
            {source.description === null ? null : (
              <div className={PROSE}>
                <ProseMarkdown>{source.description}</ProseMarkdown>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function Faq() {
  return (
    <Section
      id="faq"
      title="Frequently Asked Questions"
      lead="Common questions about the roadmap, its scope and who it's for."
    >
      <div className="flex flex-col">
        {ROADMAP_FAQ.map((entry, index) => (
          <div key={entry.question} className="border-t border-border py-2 last:border-b">
            <Disclosure heading={entry.question} defaultOpen={index === 0}>
              <p className="text-base leading-7 text-muted-foreground">{entry.answer}</p>
            </Disclosure>
          </div>
        ))}
      </div>
    </Section>
  );
}

function GlossaryTerms({ terms }: { readonly terms: readonly GlossaryTermRow[] }) {
  return (
    <Section
      id="additional-terms"
      title="Additional Terms to Explore"
      lead="Terms from the AI world worth knowing about, but not directly part of this roadmap."
    >
      <div className="border-y border-border py-2">
        <Disclosure heading="Browse terms">
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {terms.map((term) => (
              <div key={term.slug} className="flex flex-col gap-1">
                <dt className="text-base font-medium wrap-anywhere">{term.term}</dt>
                <dd className="text-sm leading-6 wrap-anywhere text-muted-foreground">
                  {term.description}
                </dd>
              </div>
            ))}
          </dl>
        </Disclosure>
      </div>
    </Section>
  );
}
