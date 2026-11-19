import { roadmapRoutes } from "../../_shared";

/** The reading guide's name, in its heading, breadcrumbs and title. */
export const READING_GUIDE_NAME = "How to Read Effectively";

/** The reading guide's own address, beside the bookshelf. */
export const READING_GUIDE_PATH = roadmapRoutes.readingGuide;

/** The talk the guide summarises; the page links to it and its structured data is based on it. */
export const READING_GUIDE_SOURCE = {
  name: "How to Remember Everything You Read",
  url: "https://www.youtube.com/watch?v=okHkUIW46ks&t=27s",
} as const;

/** The guide's opening, on the page and as its description. */
export const READING_GUIDE_OPENING =
  "Reading has two phases: consumption, when we take in a lot quickly but learn little, and " +
  "digestion, when we work through what we read so that it stays. PACER sorts what we read into " +
  "five kinds and gives each its own way to digest it.";
