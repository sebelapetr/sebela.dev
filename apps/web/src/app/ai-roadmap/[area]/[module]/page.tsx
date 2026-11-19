import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getRoadmapModule } from "../../../../modules/profile";
import { RoadmapModuleTemplate, roadmapPageFacts } from "../../../../modules/roadmap";
import { RoadmapStructuredData, roadmapPageMetadata } from "../../../../modules/seo";

/** Content cannot be read now; `error.tsx` shows it, never a page without its module. */
class ContentUnavailableError extends Error {
  constructor() {
    super("The AI Roadmap module's content could not be read from the API.");
    this.name = "ContentUnavailableError";
  }
}

interface ModulePageProps {
  readonly params: Promise<{ readonly area: string; readonly module: string }>;
}

/**
 * The module the address names under its area; a module that does not exist, or that lies under
 * another area, is not found.
 */
async function readContent(params: ModulePageProps["params"]) {
  // Rendered on every request from the content cache (`modules/profile`), never at build time.
  await connection();
  const { area, module: moduleSlug } = await params;
  const result = await getRoadmapModule(area, moduleSlug);
  if (result.status === "missing") notFound();
  if (result.status === "unavailable") throw new ContentUnavailableError();
  return result.content;
}

export async function generateMetadata({ params }: ModulePageProps): Promise<Metadata> {
  return roadmapPageMetadata(roadmapPageFacts(await readContent(params)));
}

export default async function RoadmapModulePage({ params }: ModulePageProps) {
  const content = await readContent(params);
  return (
    <>
      <RoadmapStructuredData facts={roadmapPageFacts(content)} />
      <RoadmapModuleTemplate content={content} />
    </>
  );
}
