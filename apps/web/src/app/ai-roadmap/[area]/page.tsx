import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getRoadmap } from "../../../modules/profile";
import { findRoadmapArea, RoadmapAreaPlaceholderTemplate } from "../../../modules/roadmap";

/** Content cannot be read now; `error.tsx` shows it, never a page without its area. */
class ContentUnavailableError extends Error {
  constructor() {
    super("The AI Roadmap's content could not be read from the API.");
    this.name = "ContentUnavailableError";
  }
}

interface AreaPageProps {
  readonly params: Promise<{ readonly area: string }>;
}

/** The roadmap and the area the address names; an area that does not exist is not found. */
async function readContent(params: AreaPageProps["params"]) {
  await connection();
  const { area: slug } = await params;
  const result = await getRoadmap();
  if (result.status === "missing") notFound();
  if (result.status === "unavailable") throw new ContentUnavailableError();
  const area = findRoadmapArea(result.content.roadmap, slug);
  if (area === null) notFound();
  return { content: result.content, area };
}

// A placeholder until the area's own page is published; kept out of search results until then.
export async function generateMetadata({ params }: AreaPageProps): Promise<Metadata> {
  const { content, area } = await readContent(params);
  return {
    title: `${area.name} — AI Engineering Roadmap — ${content.name}`,
    robots: { index: false },
  };
}

export default async function RoadmapAreaPage({ params }: AreaPageProps) {
  const { content, area } = await readContent(params);
  return <RoadmapAreaPlaceholderTemplate content={content} area={area} />;
}
