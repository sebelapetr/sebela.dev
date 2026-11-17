"use client";

// The experience page's disclosures, bound to the page's one open state (stores/disclosures.tsx),
// so a link can open them. Their content is rendered on the server and passed in as children.
import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@sebela/ui/components/collapsible";
import { TimelineItem } from "@sebela/ui/components/timeline";

import { useDisclosure } from "../stores/disclosures";

/** One experience on the timeline, open while the page's state says so. */
export function ExperienceItem({
  anchor,
  children,
}: {
  readonly anchor: string;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useDisclosure(anchor);
  return (
    <TimelineItem
      id={anchor}
      tabIndex={-1}
      open={open}
      onOpenChange={setOpen}
      className="anchor-target"
    >
      {children}
    </TimelineItem>
  );
}

/**
 * A project's case study: a heading whose button ("View technical case study ↓") shows and hides
 * the account; its chevron points down while closed and up while open. Closed content stays in the
 * page (`hidden="until-found"`), so the browser's page search finds and opens it.
 */
export function CaseStudyDisclosure({
  anchor,
  projectName,
  children,
}: {
  readonly anchor: string;
  readonly projectName: string;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useDisclosure(anchor);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      render={<div id={anchor} tabIndex={-1} />}
      className="anchor-target flex flex-col"
    >
      <h4>
        <CollapsibleTrigger
          aria-label={`View technical case study: ${projectName}`}
          className="group/case-study inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline focus-visible:underline"
        >
          View technical case study
          <ChevronDown
            aria-hidden="true"
            className="size-4 group-data-[panel-open]/case-study:rotate-180"
          />
        </CollapsibleTrigger>
      </h4>
      <CollapsibleContent hiddenUntilFound>
        <div className="pt-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * The secondary technologies: a heading whose button ("+ N other technologies & tools ↓") shows and
 * hides their plain-text list, collapsed at first. Its chevron points down while closed and up
 * while open; the closed list stays findable by page search (`hidden="until-found"`).
 */
export function SecondaryTechnologiesDisclosure({
  anchor,
  label,
  children,
}: {
  readonly anchor: string;
  /** The button's text, for example `+ 5 other technologies & tools`. */
  readonly label: string;
  readonly children: ReactNode;
}) {
  const [open, setOpen] = useDisclosure(anchor);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      render={<div id={anchor} tabIndex={-1} />}
      className="anchor-target flex flex-col"
    >
      <h3>
        <CollapsibleTrigger className="group/secondary inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline focus-visible:underline">
          {label}
          <ChevronDown
            aria-hidden="true"
            className="size-4 group-data-[panel-open]/secondary:rotate-180"
          />
        </CollapsibleTrigger>
      </h3>
      <CollapsibleContent hiddenUntilFound>
        <div className="pt-2">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}
