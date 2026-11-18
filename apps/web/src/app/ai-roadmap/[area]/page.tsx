import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getRoadmapArea } from "../../../modules/profile";
import { RoadmapAreaTemplate, toRoadmapAreaPage } from "../../../modules/roadmap";
import { RoadmapStructuredData, roadmapPageMetadata } from "../../../modules/seo";

/** Content cannot be read now; `error.tsx` shows it, never a page without its area. */
class ContentUnavailableError extends Error {
  constructor() {
    super("The AI Roadmap area's content could not be read from the API.");
    this.name = "ContentUnavailableError";
  }
}

interface AreaPageProps {
  readonly params: Promise<{ readonly area: string }>;
}

/** The area the address names; an area that does not exist is not found. */
async function readContent(params: AreaPageProps["params"]) {
  // Rendered on every request from the content cache (`modules/profile`), never at build time.
  await connection();
  const { area } = await params;
  const result = await getRoadmapArea(area);
  if (result.status === "missing") notFound();
  if (result.status === "unavailable") throw new ContentUnavailableError();
  return result.content;
}

function facts(content: Awaited<ReturnType<typeof readContent>>) {
  const page = toRoadmapAreaPage(content.area);
  return { name: content.name, breadcrumbs: page.breadcrumbs, summary: page.description };
}

export async function generateMetadata({ params }: AreaPageProps): Promise<Metadata> {
  return roadmapPageMetadata(facts(await readContent(params)));
}

export default async function RoadmapAreaPage({ params }: AreaPageProps) {
  const content = await readContent(params);
  return (
    <>
      <RoadmapStructuredData facts={facts(content)} />
      <RoadmapAreaTemplate content={content} />
    </>
  );
}
