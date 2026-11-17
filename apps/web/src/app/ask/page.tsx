import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { AskTemplate } from "../../modules/chat";
import { getAsk } from "../../modules/profile";

/** Content cannot be read now; `error.tsx` shows it, never a chat without the person's name. */
class ContentUnavailableError extends Error {
  constructor() {
    super("The Ask page's content could not be read from the API.");
    this.name = "ContentUnavailableError";
  }
}

// A conversation is the visitor's own, so the page is kept out of search results.
export const metadata: Metadata = {
  title: "Ask AI",
  robots: { index: false },
};

// The on-screen keyboard shrinks the page instead of covering the composer.
export const viewport: Viewport = {
  interactiveWidget: "resizes-content",
};

export default async function AskPage() {
  // Rendered on every request: content is read at runtime, never at build time (caching is #56).
  await connection();
  const result = await getAsk();
  if (result.status === "missing") notFound();
  if (result.status === "unavailable") throw new ContentUnavailableError();
  return <AskTemplate content={result.content} />;
}
