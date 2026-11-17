import type { CurrentFocus, Exploration } from "@sebela/api-client";

import {
  anchorHref,
  explorationStatusText,
  routes,
  type ExplorationStatusText,
} from "../../_shared";

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

/**
 * The homepage's Now from the current focus and the explorations, in the API's order. Working on is
 * every current focus; Exploring is only the ongoing explorations, each with its stored status, so
 * learning never reads as delivered work. Null when nothing is being built or learned now, and the
 * section is left out.
 */
export function toNow(
  currentFocus: readonly CurrentFocus[],
  explorations: readonly Exploration[],
): NowContent | null {
  const workingOn = currentFocus.map(toWorkingOn);
  const exploring = explorations
    .filter((exploration) => exploration.endedOn === null)
    .map((exploration) => ({
      slug: exploration.slug,
      name: exploration.name,
      status: explorationStatusText(exploration.status),
      href: anchorHref({ kind: "exploration", slug: exploration.slug }),
    }));
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
