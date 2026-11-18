import type { CurrentFocus, Exploration, RoadmapCurrentArea } from "@sebela/api-client";

import { anchorHref, routes } from "../../_shared";

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

/** A roadmap module being learned now, under its area. */
export interface ExploringModule {
  readonly slug: string;
  readonly name: string;
  /** The module's own page. */
  readonly href: string;
  /** The API's completed of all resources, for example `1/3`. */
  readonly progress: string;
}

/** A roadmap area being learned now, with its modules in progress. */
export interface ExploringItem {
  readonly slug: string;
  readonly name: string;
  /** The area's own page. */
  readonly href: string;
  /** The API's completed of all resources, for example `2/7`. */
  readonly progress: string;
  readonly modules: readonly ExploringModule[];
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
  currentLearning: readonly RoadmapCurrentArea[],
): NowContent | null {
  const workingOn = currentFocus.map(toWorkingOn);
  const exploring: ExploringItem[] = currentLearning.flatMap(() => []);
  if (workingOn.length === 0 && exploring.length === 0) return null;
  return {
    workingOn,
    exploring,
    independentRdHref: explorations.length === 0 ? null : anchorHref({ kind: "independent-rd" }),
    roadmapHref: routes.aiRoadmap,
  };
}

function toWorkingOn(focus: CurrentFocus): WorkingOnItem {
  return {
    slug: focus.slug,
    title: focus.title,
    description: focus.description,
    topics: focus.topics.map((topic) => topic.name),
    link: focusLink(focus),
  };
}

/** The focus's project on the site first; else its own link, only when it is a web address. */
function focusLink(focus: CurrentFocus): WorkingOnLink | null {
  if (focus.project !== null) {
    return {
      href: anchorHref({ kind: "project", slug: focus.project.slug }),
      label: "View the project",
      external: false,
    };
  }
  if (focus.link !== null && isWebAddress(focus.link)) {
    return { href: focus.link, label: "Read more", external: true };
  }
  return null;
}

function isWebAddress(value: string): boolean {
  try {
    const { protocol } = new URL(value);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}
