import { CircleCheck } from "lucide-react";

import { cn } from "@sebela/ui/lib/utils";

const PILL =
  "inline-flex items-center rounded-full bg-muted/80 px-2 py-0.5 text-xs text-muted-foreground";

/** Completed of all resources as a pill, with the same count in words for screen readers. */
export function ProgressBadge({
  completed,
  total,
}: {
  readonly completed: number;
  readonly total: number;
}) {
  return (
    <>
      <span aria-hidden="true" className={cn(PILL, "gap-1 font-medium tabular-nums")}>
        {completed}/{total}
        <CircleCheck className="size-3" />
      </span>
      <span className="sr-only">
        , {completed} of {total} resources completed
      </span>
    </>
  );
}

/** Planned effort as a pill, `~2h`; it is an estimate, never time spent. */
export function EstimateBadge({ estimate }: { readonly estimate: string }) {
  return (
    <>
      <span aria-hidden="true" className={cn(PILL, "font-medium tabular-nums")}>
        ~{estimate}
      </span>
      <span className="sr-only">, estimated {estimate}</span>
    </>
  );
}

/** A resource's type as a pill. */
export function TypeBadge({ label }: { readonly label: string }) {
  return <span className={PILL}>{label}</span>;
}

/** The "Current" pill of an area being worked on. */
export function CurrentBadge() {
  return (
    <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground">
      Current
    </span>
  );
}

/**
 * An area's recommended share of the learning effort as one to three dots, with the share and its
 * band on hover (and while its row has keyboard focus) and in words for screen readers. Not
 * interactive itself: it sits inside the area's heading button.
 */
export function WeightIndicator({
  weight,
  level,
  label,
}: {
  readonly weight: number;
  readonly level: 1 | 2 | 3;
  readonly label: string;
}) {
  return (
    <span className="group/weight relative inline-flex items-center">
      <span aria-hidden="true" className="flex min-h-6 min-w-11 items-center justify-center gap-1">
        {[1, 2, 3].map((dot) => (
          <span
            key={dot}
            className={cn(
              "size-2 rounded-full",
              dot <= level ? "bg-primary" : "bg-muted-foreground/30",
            )}
          />
        ))}
      </span>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute bottom-full left-0 z-50 mb-2 rounded-md bg-foreground px-2 py-1 text-left text-xs whitespace-nowrap text-background hidden group-hover/weight:block group-focus-visible/timeline-trigger:block sm:left-1/2 sm:-translate-x-1/2"
      >
        <span className="block font-semibold">{weight}%</span>
        <span className="block text-[10px] opacity-80">{label}</span>
      </span>
      <span className="sr-only">
        , weight {weight}%, {label}
      </span>
    </span>
  );
}
