import Link from "next/link";

import { cn } from "@sebela/ui/lib/utils";

import { ROADMAP_PATH } from "../data/overview";

/** The AI Roadmap's own pages, as its sub-navigation names them. */
export type RoadmapSection = "roadmap" | "diary" | "bookshelf" | "events";

const SECTIONS: readonly {
  readonly key: RoadmapSection;
  readonly label: string;
  readonly href: string;
}[] = [
  { key: "roadmap", label: "Roadmap", href: ROADMAP_PATH },
  { key: "diary", label: "Learning Diary", href: `${ROADMAP_PATH}/diary` },
  { key: "bookshelf", label: "Bookshelf", href: `${ROADMAP_PATH}/bookshelf` },
  { key: "events", label: "Events", href: `${ROADMAP_PATH}/events` },
];

/** The address of one of the roadmap's own pages. */
export function sectionHref(section: RoadmapSection): string {
  return SECTIONS.find((entry) => entry.key === section)?.href ?? ROADMAP_PATH;
}

/**
 * The AI Roadmap's sub-navigation under the site header, on roadmap pages only: its name on the
 * left (leading to the overview), its pages on the right. The page it is on is marked current.
 */
export function RoadmapNav({ current }: { readonly current: RoadmapSection }) {
  return (
    <nav aria-label="AI Roadmap" className="border-b print:hidden">
      <div className="layout-page flex flex-col py-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <Link
          href={ROADMAP_PATH}
          prefetch={false}
          className="inline-flex min-h-11 items-center text-sm font-semibold tracking-tight"
        >
          AI Engineering Roadmap
        </Link>
        <ul className="-mx-2 flex flex-wrap items-center">
          {SECTIONS.map((section) => (
            <li key={section.key}>
              <Link
                href={section.href}
                prefetch={false}
                aria-current={section.key === current ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center px-2 text-sm font-medium whitespace-nowrap text-muted-foreground decoration-2 underline-offset-8 hover:text-foreground aria-[current=page]:text-foreground aria-[current=page]:underline",
                )}
              >
                {section.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
