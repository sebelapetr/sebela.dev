// A one-line text input. The shadcn/ui `input` of the base-nova style, on Base UI's Input. Changed
// from the registry source: 48 px tall (one input line of docs/design.md, above the 44 px touch
// target) with 16 px text at every width, so phones do not zoom into it; the file-input styles
// nothing uses are left out. Give it a visible or `sr-only` label.
import type * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";

import { cn } from "#lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-12 w-full min-w-0 rounded-lg border border-input bg-transparent px-4 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
