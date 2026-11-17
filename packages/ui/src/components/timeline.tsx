"use client";

// A vertical timeline of items that expand and collapse, shared by the experience page and the
// AI Engineering Roadmap. Not a shadcn registry component: built here on Base UI's Collapsible,
// with the look of docs/design.md (Timeline). It knows nothing about what its items contain.
//
//   <Timeline>
//     <TimelineItem id="…" defaultOpen>            // or open + onOpenChange to control it
//       <h3><TimelineTrigger>…</TimelineTrigger></h3>
//       <TimelineContent>… <Timeline>…</Timeline> …</TimelineContent>   // nests by composition
//     </TimelineItem>
//   </Timeline>
import { Collapsible } from "@base-ui/react/collapsible";
import { ChevronRight } from "lucide-react";
import { createContext, use, useId, type ComponentProps, type ReactNode } from "react";

import { cn } from "#lib/utils";

const TriggerIdContext = createContext<string | undefined>(undefined);

/** The list of items, with the dashed rail that connects their markers. */
function Timeline({ className, ...props }: ComponentProps<"ol">) {
  return (
    <ol
      data-slot="timeline"
      className={cn(
        "relative flex flex-col gap-2 before:absolute before:inset-y-4 before:left-4 before:-translate-x-1/2 before:border-l-[1.5px] before:border-dashed before:border-border",
        className,
      )}
      {...props}
    />
  );
}

interface TimelineItemProps {
  /** The item's anchor on the page. */
  readonly id?: string;
  readonly className?: string;
  /** Whether the item is open, to control it from outside (with `onOpenChange`). */
  readonly open?: boolean;
  /** Whether the item is open at first, when nothing controls it. */
  readonly defaultOpen?: boolean;
  /** Called when the visitor opens or closes the item, or the browser's page search opens it. */
  readonly onOpenChange?: (open: boolean) => void;
  readonly children: ReactNode;
}

/** One item: a list element that holds its trigger and its content. Give it an `id` to link to. */
function TimelineItem({
  open,
  defaultOpen,
  onOpenChange,
  id,
  className,
  children,
}: TimelineItemProps) {
  const triggerId = useId();
  return (
    <Collapsible.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={
        onOpenChange === undefined
          ? undefined
          : (next) => {
              onOpenChange(next);
            }
      }
      render={<li id={id} />}
      data-slot="timeline-item"
      className={cn("relative pl-11 sm:pl-12", className)}
    >
      <TriggerIdContext value={triggerId}>{children}</TriggerIdContext>
    </Collapsible.Root>
  );
}

/**
 * The item's heading row and its disclosure control: a button that opens and closes the content,
 * with the item's marker on the rail. Put it in a heading of the right level; its children are
 * phrasing content (text, spans).
 */
function TimelineTrigger({ className, children, ...props }: Collapsible.Trigger.Props) {
  const id = use(TriggerIdContext);
  return (
    <Collapsible.Trigger
      id={id}
      data-slot="timeline-trigger"
      className={cn(
        "group/timeline-trigger -mx-2 flex min-h-11 w-[calc(100%+1rem)] flex-col items-start gap-1 rounded-lg px-2 py-1.5 text-left transition-colors outline-none hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        data-slot="timeline-marker"
        className="absolute top-1.5 left-0 z-10 flex size-8 items-center justify-center rounded-full border border-border bg-background text-muted-foreground transition-[transform,color,border-color] group-hover/timeline-trigger:scale-110 group-hover/timeline-trigger:border-foreground group-hover/timeline-trigger:text-foreground group-data-[panel-open]/timeline-trigger:border-foreground group-data-[panel-open]/timeline-trigger:text-foreground motion-reduce:transition-none"
      >
        <ChevronRight className="size-4 transition-transform group-data-[panel-open]/timeline-trigger:rotate-90 motion-reduce:transition-none" />
      </span>
      {children}
    </Collapsible.Trigger>
  );
}

/**
 * The item's content: a region named by its trigger, hidden while the item is closed. Hidden
 * content stays in the page (`hidden="until-found"`), so the browser's page search finds it and
 * opens the item.
 */
function TimelineContent({ className, children, ...props }: Collapsible.Panel.Props) {
  const triggerId = use(TriggerIdContext);
  return (
    <Collapsible.Panel
      hiddenUntilFound
      role="region"
      aria-labelledby={triggerId}
      data-slot="timeline-content"
      className={className}
      {...props}
    >
      {/* The spacing sits inside, so a closed item takes no space at all. */}
      <div className="pt-3 pb-6">{children}</div>
    </Collapsible.Panel>
  );
}

export { Timeline, TimelineContent, TimelineItem, TimelineTrigger };
export type { TimelineItemProps };
