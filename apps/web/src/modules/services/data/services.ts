import type { Person, Service, ServiceEvidence } from "@sebela/api-client";

import { anchorHref, anchorId, explorationStatusText, routes } from "../../_shared";

/** A project the service was delivered in: paid work, linked to its exact anchor. */
export interface ProjectEvidenceItem {
  readonly kind: "project";
  /** Unique within the service, for example `project:<slug>`. */
  readonly key: string;
  readonly name: string;
  /** `/experience#project-<slug>`; the experience page opens the enclosing experience. */
  readonly href: string;
}

/** An exploration: independent R&D, never paid work, with its stored status as visible text. */
export interface ExplorationEvidenceItem {
  readonly kind: "exploration";
  /** Unique within the service, for example `exploration:<slug>`. */
  readonly key: string;
  readonly name: string;
  /** `/experience#exploration-<slug>`. */
  readonly href: string;
  /** For example `Built`. */
  readonly statusLabel: string;
  /** For example `Implemented and working`. */
  readonly statusMeaning: string;
}

/** A link to one of the site's own pages, exactly as stored. */
export interface LinkEvidenceItem {
  readonly kind: "link";
  /** Unique within the service, for example `link:/experience#independent-rd`. */
  readonly key: string;
  readonly label: string;
  readonly href: string;
}

export type ServiceEvidenceItem = ProjectEvidenceItem | ExplorationEvidenceItem | LinkEvidenceItem;

/** One service as the services page shows it: a numbered editorial row. */
export interface ServiceRow {
  /** The row's place, two digits: `01`, `02`, `03`. */
  readonly number: string;
  readonly slug: string;
  /** The stable anchor of the service on the page, `service-<slug>`. */
  readonly anchor: string;
  readonly name: string;
  /** Markdown. */
  readonly summary: string;
  /** Markdown: who the service is for. */
  readonly audience: string;
  /** Markdown: what the client gets. */
  readonly deliverable: string;
  /** What shows the service was delivered or works: projects, built or tested R&D, site links. */
  readonly evidence: readonly ServiceEvidenceItem[];
  /**
   * Designed explorations: planned or architected only, so never proof of delivered capability.
   * Shown apart from the evidence, or not at all.
   */
  readonly planned: readonly ExplorationEvidenceItem[];
}

/** One step of a collaboration as the services page shows it. */
export interface CollaborationStepRow {
  /** The step's place, two digits: `01`, `02`, … */
  readonly number: string;
  /** Plain text. */
  readonly title: string;
  /** Markdown. */
  readonly description: string;
}

const twoDigits = (index: number) => String(index + 1).padStart(2, "0");

/** The paths of the site's own pages, without a fragment or query. */
const SITE_PAGES: ReadonlySet<string> = new Set(
  Object.values(routes).map((route) => pathname(route)),
);

function pathname(path: string): string {
  return path.split(/[?#]/, 1)[0] ?? path;
}

function toItem(evidence: ServiceEvidence): ServiceEvidenceItem | null {
  switch (evidence.kind) {
    case "project":
      return {
        kind: "project",
        key: `project:${evidence.project.slug}`,
        name: evidence.project.name,
        href: anchorHref({ kind: "project", slug: evidence.project.slug }),
      };
    case "exploration": {
      const status = explorationStatusText(evidence.exploration.status);
      return {
        kind: "exploration",
        key: `exploration:${evidence.exploration.slug}`,
        name: evidence.exploration.name,
        href: anchorHref({ kind: "exploration", slug: evidence.exploration.slug }),
        statusLabel: status.label,
        statusMeaning: status.meaning,
      };
    }
    case "link":
      // A link to a page the site does not have would be a dead control: it is left out.
      if (!SITE_PAGES.has(pathname(evidence.path))) return null;
      return {
        kind: "link",
        key: `link:${evidence.path}`,
        label: evidence.label,
        href: evidence.path,
      };
  }
}

/**
 * The services as the services page shows them, in the API's order, numbered and each with its
 * stable anchor. Projects and built or tested explorations are evidence; a designed exploration is
 * only planned work, never evidence. A site link to a page the site does not have is left out.
 */
export function toServiceRows(services: readonly Service[]): ServiceRow[] {
  return services.map((service, index) => {
    const evidence: ServiceEvidenceItem[] = [];
    const planned: ExplorationEvidenceItem[] = [];
    for (const stored of service.evidence) {
      const item = toItem(stored);
      if (item === null) continue;
      const designed = stored.kind === "exploration" && stored.exploration.status === "designed";
      if (designed && item.kind === "exploration") planned.push(item);
      else evidence.push(item);
    }
    return {
      number: twoDigits(index),
      slug: service.slug,
      anchor: anchorId({ kind: "service", slug: service.slug }),
      name: service.name,
      summary: service.summary,
      audience: service.audience,
      deliverable: service.deliverable,
      evidence,
      planned,
    };
  });
}

/** The collaboration steps in their stored order, numbered. */
export function toCollaborationSteps(
  steps: readonly Person["collaborationSteps"][number][],
): CollaborationStepRow[] {
  return steps.map((step, index) => ({
    number: twoDigits(index),
    title: step.title,
    description: step.description,
  }));
}
