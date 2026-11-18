import type {
  Roadmap,
  RoadmapDerivedStatus,
  RoadmapResourceStatus,
  RoadmapResourceType,
} from "@sebela/api-client";

export interface RoadmapFacts {
  readonly areaCount: number;
  readonly moduleCount: number;
  readonly resourceCount: number;
  readonly estimatedHours: number;
  readonly lastUpdated: string | null;
}

export interface ResourceRow {
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly type: RoadmapResourceType;
  readonly typeLabel: string;
  readonly status: RoadmapResourceStatus;
  readonly estimate: string | null;
  readonly href: string | null;
}

export interface ModuleRow {
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly order: string;
  readonly estimate: string | null;
  readonly completed: number;
  readonly total: number;
  readonly status: RoadmapDerivedStatus;
  readonly resources: readonly ResourceRow[];
}

export interface AreaRow {
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly order: string;
  readonly href: string;
  readonly weight: number;
  readonly weightLevel: 1 | 2 | 3;
  readonly weightLabel: string;
  readonly completed: number;
  readonly total: number;
  readonly status: RoadmapDerivedStatus;
  readonly current: boolean;
  readonly modules: readonly ModuleRow[];
}

export interface RoadmapOverview {
  readonly facts: RoadmapFacts;
  readonly start: { readonly name: string; readonly href: string } | null;
  readonly areas: readonly AreaRow[];
}

/** The AI Roadmap's own address, and the address of one of its areas. */
export const ROADMAP_PATH = "/ai-roadmap";

/** The address of an area's page; the slug is encoded, so it never leaves the roadmap. */
export function areaHref(slug: string): string {
  return `${ROADMAP_PATH}/${encodeURIComponent(slug)}`;
}

/**
 * The overview of the whole roadmap as the page shows it: the API's totals and last update, the
 * first area to start from, and every area, module and resource in the API's order, numbered by
 * that order. Progress, status and estimates are the API's derived values, never recounted here,
 * and an estimate is only ever labelled as planned effort.
 */
export function toRoadmapOverview(roadmap: Roadmap): RoadmapOverview {
  const { summary } = roadmap;
  const first = roadmap.areas[0];
  return {
    facts: {
      areaCount: summary.areaCount,
      moduleCount: summary.moduleCount,
      resourceCount: summary.resourceCount,
      estimatedHours: summary.estimatedHours,
      lastUpdated: summary.lastUpdatedAt === null ? null : formatLastUpdated(summary.lastUpdatedAt),
    },
    start: first === undefined ? null : { name: first.name, href: areaHref(first.slug) },
    areas: roadmap.areas.map((area, index) => ({
      slug: area.slug,
      name: area.name,
      description: area.description,
      order: `${String(index + 1)}.`,
      href: areaHref(area.slug),
      weight: area.weight,
      weightLevel: weightLevel(area.weight),
      weightLabel: weightLabel(area.weight),
      completed: area.progress.completed,
      total: area.progress.total,
      status: area.progress.status,
      current: area.progress.status === "in-progress",
      modules: area.modules.map((module, moduleIndex) => ({
        slug: module.slug,
        name: module.name,
        description: module.description,
        order: `${romanNumeral(moduleIndex + 1)}.`,
        estimate:
          module.progress.estimatedMinutes > 0
            ? estimateLabel(module.progress.estimatedMinutes)
            : null,
        completed: module.progress.completed,
        total: module.progress.total,
        status: module.progress.status,
        resources: module.resources.map((resource) => ({
          slug: resource.slug,
          name: resource.name,
          description: resource.description,
          type: resource.type,
          typeLabel: resourceTypeLabel(resource.type),
          status: resource.status,
          estimate:
            resource.estimatedMinutes === null ? null : estimateLabel(resource.estimatedMinutes),
          href: safeLink(resource.link),
        })),
      })),
    })),
  };
}

/** What the roadmap holds, its planned hours and its last update, as the overview's lead. */
export function roadmapLead(facts: RoadmapFacts): string {
  throw new Error(`not implemented: ${String(facts.areaCount)}`);
}

/** Planned minutes in short words: `45m` under an hour, `2h` for whole hours, `1.5h` otherwise. */
export function estimateLabel(minutes: number): string {
  if (minutes < 60) return `${String(Math.round(minutes))}m`;
  const hours = minutes / 60;
  return Number.isInteger(hours) ? `${String(hours)}h` : `${hours.toFixed(1)}h`;
}

const NUMERALS: readonly (readonly [number, string])[] = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

/** A positive whole number as a Roman numeral, for example 14 as `XIV`. */
export function romanNumeral(value: number): string {
  let rest = value;
  let numeral = "";
  for (const [amount, letters] of NUMERALS) {
    while (rest >= amount) {
      numeral += letters;
      rest -= amount;
    }
  }
  return numeral;
}

/** How many of three dots an area's weight fills: one up to 8 %, two up to 14 %, else three. */
export function weightLevel(weight: number): 1 | 2 | 3 {
  if (weight <= 8) return 1;
  if (weight <= 14) return 2;
  return 3;
}

const WEIGHT_LABELS = {
  1: "Low weight (≤8%)",
  2: "Medium weight (9-14%)",
  3: "High weight (>14%)",
} as const;

/** The weight's band in words, as the dots' explanation. */
export function weightLabel(weight: number): string {
  return WEIGHT_LABELS[weightLevel(weight)];
}

const LAST_UPDATED = new Intl.DateTimeFormat("en-US", {
  timeZone: "Europe/Prague",
  year: "numeric",
  month: "long",
  day: "numeric",
});

/** The day of an instant in Prague, in words, for example `March 14, 2026`. */
export function formatLastUpdated(iso: string): string {
  return LAST_UPDATED.format(new Date(iso));
}

const TYPE_LABELS: Readonly<Record<RoadmapResourceType, string>> = {
  "youtube-video": "Video",
  "youtube-playlist": "Playlist",
  video: "Video",
  "google-drive": "Drive",
  link: "Link",
  text: "Text",
  project: "Repo",
  book: "Book",
};

/** A resource's type as its short badge. */
export function resourceTypeLabel(type: RoadmapResourceType): string {
  return TYPE_LABELS[type];
}

/**
 * A resource's link when it is an absolute `http:` or `https:` address, otherwise none: the page
 * never links a script, data or relative address, whatever the API holds.
 */
export function safeLink(link: string | null): string | null {
  if (link === null || !URL.canParse(link)) return null;
  const { protocol } = new URL(link);
  return protocol === "https:" || protocol === "http:" ? link : null;
}

/** An area as its own page names it: slug, name and its number in the API's order. */
export interface RoadmapAreaHeading {
  readonly slug: string;
  readonly name: string;
  readonly order: string;
}

/** The area with this slug, or null when no area has it (the page is then not found). */
export function findRoadmapArea(roadmap: Roadmap, slug: string): RoadmapAreaHeading | null {
  const index = roadmap.areas.findIndex((area) => area.slug === slug);
  const area = roadmap.areas[index];
  if (area === undefined) return null;
  return { slug: area.slug, name: area.name, order: `${String(index + 1)}.` };
}
