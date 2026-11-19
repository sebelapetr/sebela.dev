import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { ProseMarkdown } from "../../_shared";
import type { RoadmapBookshelfContent } from "../../profile";
import { BookCover, BookStatus } from "../components/book-parts";
import { RoadmapFrame } from "../components/roadmap-frame";
import { BOOKSHELF_NAME, toBookshelfPage } from "../data/bookshelf";
import { READING_GUIDE_PATH } from "../data/reading-guide";

/**
 * The bookshelf under the roadmap's sub-navigation: its name, what it is and the way to the
 * reading guide, then every book in the API's shelf order as an editorial row — its cover (or a
 * plain placeholder), its place on the shelf, its title as the link to its page, its status as the
 * API derived it, its author and a preview of its Markdown description, rendered safely. An empty
 * shelf says so.
 */
export function RoadmapBookshelfTemplate({
  content,
}: {
  readonly content: RoadmapBookshelfContent;
}) {
  const page = toBookshelfPage(content.books);
  return (
    <RoadmapFrame name={content.name} section="bookshelf">
      <div className="flex max-w-3xl flex-col gap-12">
        <header className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <p className="type-label">AI Roadmap</p>
            <h1 className="type-title">{BOOKSHELF_NAME}</h1>
          </div>
          <p className="type-lead max-w-prose text-muted-foreground">
            Books read along the roadmap, the ones being read now and those still to come.
          </p>
          <Link
            href={READING_GUIDE_PATH}
            prefetch={false}
            className="inline-flex min-h-11 items-center gap-1 self-start rounded-sm text-sm font-medium underline-offset-4 hover:underline focus-visible:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            How to read effectively
            <ArrowRight aria-hidden="true" className="size-3.5" />
          </Link>
        </header>
        {page.books.length === 0 ? (
          <p className="text-base text-muted-foreground">No books yet.</p>
        ) : (
          <ol aria-label="Books" className="flex flex-col">
            {page.books.map((book, index) => (
              <li
                key={book.slug}
                className="flex gap-4 border-t border-border py-6 first:border-t-0 first:pt-0 sm:gap-6"
              >
                <BookCover
                  cover={book.cover}
                  sizes="(min-width: 640px) 96px, 80px"
                  preload={index === 0}
                  className="h-auto w-20 shrink-0 self-start sm:w-24"
                />
                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <p className="type-label tabular-nums">{book.number}</p>
                  <h2 className="type-item wrap-anywhere">
                    <Link
                      href={book.href}
                      prefetch={false}
                      className="inline-flex min-h-11 items-center rounded-sm underline-offset-4 hover:underline focus-visible:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      {book.title}
                    </Link>
                  </h2>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <BookStatus status={book.status} label={book.statusLabel} />
                    {book.author === null ? null : (
                      <p className="text-sm wrap-anywhere text-muted-foreground">{book.author}</p>
                    )}
                  </div>
                  {book.description === null ? null : (
                    <div className="line-clamp-4 text-base wrap-anywhere text-muted-foreground [&>*+*]:mt-3">
                      <ProseMarkdown>{book.description}</ProseMarkdown>
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </RoadmapFrame>
  );
}
