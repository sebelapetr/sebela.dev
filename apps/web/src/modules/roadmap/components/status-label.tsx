import type { RoadmapDerivedStatus } from "@sebela/api-client";
import { cn } from "@sebela/ui/lib/utils";

import { derivedStatusWords, statusDot } from "./status";

/** An area's or a module's derived status: a dot in its marker colour and the status in words. */
export function StatusLabel({ status }: { readonly status: RoadmapDerivedStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span aria-hidden="true" className={cn("size-2 rounded-full", statusDot(status))} />
      {derivedStatusWords(status)}
    </span>
  );
}
