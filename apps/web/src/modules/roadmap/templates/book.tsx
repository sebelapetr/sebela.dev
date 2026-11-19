import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { buttonVariants } from "@sebela/ui/components/button";

import { bookshelfHref, ProseMarkdown } from "../../_shared";
import type { RoadmapBookContent } from "../../profile";
import { BookCover, BookStatus } from "../components/book-parts";
import { Breadcrumbs } from "../components/breadcrumbs";
import { RoadmapFrame } from "../components/roadmap-frame";
import { BOOKSHELF_NAME, toBookPage, type BookDate } from "../data/bookshelf";

const TEXT_LINK =
  "inline-flex min-h-11 items-center gap-1 rounded-sm font-medium underline-offset-4 hover:underline focus-visible:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

/**
 * A book's own page under the roadmap's sub-navigation: the way from the overview through the
 * bookshelf, its cover (or a plain placeholder), its title, status, author, Markdown description
 * and the facts it has; then its progress — when it was started and completed, and, when a resource
 * reads it, the time logged on that resource and the way to it; then its Markdown summary, rendered
 * safely, and the way back to the bookshelf. Nothing the book lacks is invented.
 */
export function RoadmapBookTemplate({ content }: { readonly content: RoadmapBookContent }) {
  const page = toBookPage(content);
  return (
    <RoadmapFrame name={content.name} section="bookshelf">
      <article className="flex max-w-3xl flex-col gap-12">
        <header className="flex flex-col gap-6">
          <Breadcrumbs crumbs={page.breadcrumbs} />
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start">
            <BookCover
              cover={page.cover}
              sizes="(min-width: 640px) 192px, 128px"
              preload
              className="h-auto w-32 shrink-0 sm:w-48"
            />
            <div className="flex min-w-0 flex-1 flex-col gap-4">
              <div className="flex flex-col gap-3">
                <p className="type-label">Book</p>
                <h1 className="type-title wrap-anywhere">{page.title}</h1>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <BookStatus status={page.status} label={page.statusLabel} />
                {page.author === null ? null : (
                  <p className="type-lead wrap-anywhere text-muted-foreground">{page.author}</p>
                )}
              </div>
              {page.description === null ? null : (
                <div className="text-base wrap-anywhere [&>*+*]:mt-3">
                  <ProseMarkdown>{page.description}</ProseMarkdown>
                </div>
              )}
              {page.facts.length === 0 ? null : (
                <ul
                  aria-label="Book facts"
                  className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground"
                >
                  {page.facts.map((fact) => (
                    <li key={fact} className="wrap-anywhere">
                      {fact}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </header>
        <section aria-labelledby="book-progress-heading" className="flex flex-col gap-6">
          <h2 id="book-progress-heading" className="type-heading">
            Progress
          </h2>
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            <Fact term="Started">
              <Day date={page.started} />
            </Fact>
            <Fact term="Completed">
              <Day date={page.completed} />
            </Fact>
            {page.timeLogged === null ? null : (
              <Fact term="Time logged">
                <span className="tabular-nums">{page.timeLogged}</span>
              </Fact>
            )}
            {page.resource === null ? null : (
              <Fact term="Read through">
                <Link href={page.resource.href} prefetch={false} className={TEXT_LINK}>
                  <span className="wrap-anywhere">{page.resource.name}</span>
                  <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
                </Link>
              </Fact>
            )}
          </dl>
        </section>
        {page.summary === null ? null : (
          <section aria-labelledby="book-summary-heading" className="flex flex-col gap-6">
            <h2 id="book-summary-heading" className="type-heading">
              Summary
            </h2>
            <div className="max-w-prose text-base wrap-anywhere [&>*+*]:mt-4">
              <ProseMarkdown>{page.summary}</ProseMarkdown>
            </div>
          </section>
        )}
        <div>
          <Link href={bookshelfHref()} prefetch={false} className={buttonVariants()}>
            Go to the {BOOKSHELF_NAME.toLowerCase()}
            <ArrowRight aria-hidden="true" />
          </Link>
        </div>
      </article>
    </RoadmapFrame>
  );
}

function Fact({ term, children }: { readonly term: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="type-label">{term}</dt>
      <dd className="text-base">{children}</dd>
    </div>
  );
}

/** A day in words, or a dash that says to assistive technology there is none yet. */
function Day({ date }: { readonly date: BookDate | null }) {
  if (date === null) {
    return (
      <>
        <span aria-hidden="true">—</span>
        <span className="sr-only">Not yet</span>
      </>
    );
  }
  return <time dateTime={date.dateTime}>{date.text}</time>;
}
