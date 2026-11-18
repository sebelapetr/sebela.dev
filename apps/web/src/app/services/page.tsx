import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getServices } from "../../modules/profile";
import { pageMetadata } from "../../modules/seo";
import { ServicesTemplate } from "../../modules/services";

/** Content cannot be read now; `error.tsx` shows it, never a page without its services. */
class ContentUnavailableError extends Error {
  constructor() {
    super("The services page's content could not be read from the API.");
    this.name = "ContentUnavailableError";
  }
}

async function readContent() {
  // Rendered on every request: content is read at runtime, never at build time (caching is #56).
  await connection();
  const result = await getServices();
  if (result.status === "missing") notFound();
  if (result.status === "unavailable") throw new ContentUnavailableError();
  return result.content;
}

export async function generateMetadata(): Promise<Metadata> {
  const content = await readContent();
  return pageMetadata("services", {
    name: content.name,
    headline: content.headline,
    summary: content.intro,
  });
}

export default async function ServicesPage() {
  const content = await readContent();
  return <ServicesTemplate content={content} />;
}
