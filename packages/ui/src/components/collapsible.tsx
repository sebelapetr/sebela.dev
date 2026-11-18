"use client";

// A disclosure: a trigger that shows and hides one panel. The shadcn/ui `collapsible` of the
// base-nova style, on Base UI's Collapsible; unstyled, so the caller gives it its look.
//
//   <Collapsible open={…} onOpenChange={…}>       // or defaultOpen
//     <CollapsibleTrigger>…</CollapsibleTrigger>
//     <CollapsibleContent hiddenUntilFound>…</CollapsibleContent>
//   </Collapsible>
import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";

function Collapsible({ ...props }: CollapsiblePrimitive.Root.Props) {
  return <CollapsiblePrimitive.Root data-slot="collapsible" {...props} />;
}

function CollapsibleTrigger({ ...props }: CollapsiblePrimitive.Trigger.Props) {
  return <CollapsiblePrimitive.Trigger data-slot="collapsible-trigger" {...props} />;
}

function CollapsibleContent({ ...props }: CollapsiblePrimitive.Panel.Props) {
  return <CollapsiblePrimitive.Panel data-slot="collapsible-content" {...props} />;
}

export { Collapsible, CollapsibleContent, CollapsibleTrigger };
