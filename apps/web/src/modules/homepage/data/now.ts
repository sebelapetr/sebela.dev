import type { CurrentFocus, Exploration } from "@sebela/api-client";

import type { ExplorationStatusText } from "../../_shared";

/** Where an item of Working on leads: its project on the experience page, or its own web link. */
export interface WorkingOnLink {
  readonly href: string;
  /** The visible text, for example `View the project`. */
  readonly label: string;
  /** Whether it leaves the site. */
  readonly external: boolean;
}

/** One thing being built now, from the current focus. */
export interface WorkingOnItem {
  readonly slug: string;
  readonly title: string;
  /** Markdown. */
  readonly description: string;
  /** The topics' names, in their intended order. */
  readonly topics: readonly string[];
  /** Null when the focus has neither a project nor a web link. */
  readonly link: WorkingOnLink | null;
}

/** One thing being learned now: an ongoing exploration, with its status as stored. */
export interface ExploringItem {
  readonly slug: string;
  readonly name: string;
  readonly status: ExplorationStatusText;
  /** The exploration on the experience page. */
  readonly href: string;
}

/** The homepage's Now: what is being built and, apart from it, what is being learned. */
export interface NowContent {
  readonly workingOn: readonly WorkingOnItem[];
  readonly exploring: readonly ExploringItem[];
  /** The independent R&D block on the experience page; null without any exploration. */
  readonly independentRdHref: string | null;
  /** The AI Roadmap (a placeholder until phase 4). */
  readonly roadmapHref: string;
}

export function toNow(
  currentFocus: readonly CurrentFocus[],
  explorations: readonly Exploration[],
): NowContent | null {
  throw new Error(`not implemented: ${String(currentFocus.length + explorations.length)}`);
}
