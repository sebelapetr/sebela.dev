import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { CvTemplate } from "../../modules/cv";
import { getCv } from "../../modules/profile";
import { pageMetadata } from "../../modules/seo";

/** Content cannot be read now; `error.tsx` shows it, never an empty CV. */
class ContentUnavailableError extends Error {
  constructor() {
    super("The CV page's content could not be read from the API.");
    this.name = "ContentUnavailableError";
  }
}

async function readContent() {
  // Rendered on every request from the content cache (`modules/profile`), never at build time.
  await connection();
  const result = await getCv();
  if (result.status === "missing") notFound();
  if (result.status === "unavailable") throw new ContentUnavailableError();
  return result.content;
}

export async function generateMetadata(): Promise<Metadata> {
  const content = await readContent();
  return pageMetadata("cv", {
    name: content.name,
    headline: content.headline,
    summary: content.shortBio,
  });
}

export default async function CvPage() {
  const content = await readContent();
  return <CvTemplate content={content} />;
}
