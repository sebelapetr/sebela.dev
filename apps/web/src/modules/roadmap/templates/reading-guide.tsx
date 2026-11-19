import type { ReactNode } from "react";

import { Breadcrumbs } from "../components/breadcrumbs";
import { RoadmapFrame } from "../components/roadmap-frame";
import { readingGuidePageFacts } from "../data/page-facts";
import {
  READING_GUIDE_NAME,
  READING_GUIDE_OPENING,
  READING_GUIDE_SOURCE,
} from "../data/reading-guide";

const LINK =
  "inline-flex min-h-11 items-center rounded-sm font-medium underline-offset-4 hover:underline focus-visible:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

function Section({
  id,
  title,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <h2 id={id} className="type-heading text-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function Category({
  letter,
  name,
  children,
}: {
  readonly letter: string;
  readonly name: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-6">
      <h3 className="type-item text-foreground">
        <span className="font-mono">{letter}</span> — {name}
      </h3>
      {children}
    </div>
  );
}

/** A short instruction, set apart from the explanation around it. */
function Action({ children }: { readonly children: ReactNode }) {
  return (
    <p>
      <strong className="font-medium text-foreground">Action: </strong>
      {children}
    </p>
  );
}

/** A caution, set apart from the explanation around it. */
function Important({ children }: { readonly children: ReactNode }) {
  return (
    <p>
      <strong className="font-medium text-foreground">Important: </strong>
      {children}
    </p>
  );
}

/**
 * How to read effectively, under the roadmap's sub-navigation beside the bookshelf: the way from the
 * overview through the bookshelf, the talk it summarises (opening in a new tab), the consumption and
 * digestion periods, the five PACER categories with how to digest each, and the balance between
 * the two periods. Static website text carried over from the original roadmap site.
 */
export function RoadmapReadingGuideTemplate({
  content,
}: {
  readonly content: { readonly name: string };
}) {
  const { breadcrumbs } = readingGuidePageFacts(content);
  return (
    <RoadmapFrame name={content.name} section="bookshelf">
      <article className="flex max-w-3xl flex-col gap-12">
        <header className="flex flex-col gap-6">
          <Breadcrumbs crumbs={breadcrumbs} />
          <div className="flex flex-col gap-3">
            <p className="type-label">Bookshelf</p>
            <h1 className="type-title">{READING_GUIDE_NAME}</h1>
          </div>
          <p className="type-lead max-w-prose text-muted-foreground">{READING_GUIDE_OPENING}</p>
          <p className="text-sm text-muted-foreground">
            Based on{" "}
            <a
              href={READING_GUIDE_SOURCE.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`${LINK} text-foreground`}
            >
              {READING_GUIDE_SOURCE.name}
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          </p>
        </header>

        <div className="flex flex-col gap-12 text-base leading-7 text-muted-foreground">
          <Section id="consumption" title="1. Consumption period">
            <p>We read faster and take in more information, but we don&apos;t learn.</p>
          </Section>

          <Section id="digestion" title="2. Digestion period">
            <blockquote className="border-l-2 border-border pl-4 text-foreground italic">
              “What goes into your brain is less important than what stays in your brain.”
            </blockquote>
            <p>This is the digestion period.</p>
          </Section>

          <Section id="pacer" title="PACER">
            <div className="flex flex-col gap-3">
              <p>
                Information falls into five categories —{" "}
                <strong className="text-foreground">PACER</strong>. When we consume information, we
                want to identify which category it belongs to.
              </p>
              <p>
                The two stages, consumption and digestion, are important for every category of
                information.
              </p>
            </div>
            <div className="flex flex-col gap-8 pt-2">
              <Category letter="P" name="Procedural">
                <p>How something can be executed. For example: how to call the OpenAI SDK.</p>
                <p>
                  For remembering: <strong className="font-medium text-foreground">practice</strong>
                  . Apply it in real life as soon as possible.
                </p>
                <p>
                  If we can&apos;t practise now, move on to something else, or stop reading and wait
                  until we can practise. Don&apos;t waste time trying to memorise it.
                </p>
                <Important>
                  Stopping when we can&apos;t practise, or moving somewhere else, is actually
                  crucial.
                </Important>
              </Category>

              <Category letter="A" name="Analogous">
                <p>One of the best types of information to work with, remember and apply.</p>
                <p>
                  It relates to something we already know, so we can connect it with prior
                  knowledge. For example: electric current compared to water flowing in a pipe.
                </p>
                <Action>Ask critical questions.</Action>
                <ul className="list-disc pl-5">
                  <li>How is it similar?</li>
                  <li>How is it different?</li>
                  <li>Where does the analogy stop working?</li>
                </ul>
                <p>This way, new information connects to existing knowledge.</p>
              </Category>

              <Category letter="C" name="Conceptual">
                <p>
                  What and why — concepts and relationships. They answer what something is, why it
                  works and how things are related. For example: the principle of evolution, the
                  mechanism of inflation or the relationship between hormones.
                </p>
                <Action>
                  Mapping. On paper or a computer, draw a graph or mind map: the main concept in the
                  centre, branches with related ideas, arrows that show how they connect. It is a
                  living document that grows as you learn more.
                </Action>
              </Category>

              <Category letter="E" name="Evidence">
                <p>
                  Proof and specific examples that support a concept: studies, experiments,
                  statistics or historical cases that back a claim (figures, dates, study results,
                  detailed cases).
                </p>
                <Action>
                  Store and rehearse — save it now, practise it later. Storing means noting it down,
                  in your conceptual map or in your notes. Rehearsing means thinking about how you
                  will use and apply it, and which concept it is an example of.
                </Action>
              </Category>

              <Category letter="R" name="Reference">
                <p>
                  Very specific facts we need later — IDs, constants, names, dates. Low-level facts
                  that won&apos;t change the understanding of the big picture but that we might need
                  to know.
                </p>
                <Action>
                  Extract them from the main notes into flashcards, then drill them for a few
                  minutes at a time. It is storing and rehearsing like Evidence, in a different way.
                </Action>
                <Important>
                  Memorising Reference information is not an efficient use of time compared to the
                  first three categories (P, A, C).
                </Important>
              </Category>
            </div>
          </Section>

          <Section id="balance" title="Keep the two periods in balance">
            <p>
              Consumption and digestion must always be in balance: everything we consume must be
              digested. Otherwise we consume more and more, nothing comes of it, and we forget.
            </p>
            <p>
              If we forget 90% of what we read, it makes sense to spend less time reading and more
              time digesting and processing.
            </p>
            <Important>
              Don&apos;t take notes or try to memorise while reading. Do that afterwards, in the
              digestion period.
            </Important>
          </Section>
        </div>
      </article>
    </RoadmapFrame>
  );
}
