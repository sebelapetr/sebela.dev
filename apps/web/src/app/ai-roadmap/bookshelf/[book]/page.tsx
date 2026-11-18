import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getRoadmapBook } from "../../../../modules/profile";
import { bookPageFacts, RoadmapBookTemplate } from "../../../../modules/roadmap";
import { RoadmapStructuredData, roadmapPageMetadata } from "../../../../modules/seo";

/** Content cannot be read now; `error.tsx` shows it, never a page without its book. */
class ContentUnavailableError extends Error {
  constructor() {
    super("The book's content could not be read from the API.");
    this.name = "ContentUnavailableError";
  }
}

interface BookPageProps {
  readonly params: Promise<{ readonly book: string }>;
}

/** The book the address names; a book that does not exist is not found. */
async function readContent(params: BookPageProps["params"]) {
  // Rendered on every request from the content cache (`modules/profile`), never at build time.
  await connection();
  const { book } = await params;
  const result = await getRoadmapBook(book);
  if (result.status === "missing") notFound();
  if (result.status === "unavailable") throw new ContentUnavailableError();
  return result.content;
}

export async function generateMetadata({ params }: BookPageProps): Promise<Metadata> {
  return roadmapPageMetadata(bookPageFacts(await readContent(params)));
}

export default async function RoadmapBookPage({ params }: BookPageProps) {
  const content = await readContent(params);
  return (
    <>
      <RoadmapStructuredData facts={bookPageFacts(content)} />
      <RoadmapBookTemplate content={content} />
    </>
  );
}
