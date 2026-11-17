import { RotateCw } from "lucide-react";

import { Button } from "@sebela/ui/components/button";

import { StatePage } from "../components/state-page";

/**
 * Shown when a page's content cannot be read (the API failed, was unreachable or too slow). Says
 * so plainly and offers another attempt; never pretends the content is empty. Rendered from the
 * client error boundary (`error.tsx`), which supplies `retry`.
 */
export function UnavailableTemplate({ retry }: { readonly retry: () => void }) {
  return (
    <>
      {/* The page's own metadata failed with its content; React hoists this into the head. */}
      <title>Content unavailable</title>
      <StatePage
        label="Content unavailable"
        heading="This page could not be loaded right now."
        action={
          <Button size="lg" onClick={retry}>
            <RotateCw aria-hidden="true" data-icon="inline-start" />
            Try again
          </Button>
        }
      >
        <p className="max-w-prose text-lg text-muted-foreground">
          Its content is temporarily unavailable. Please try again in a moment.
        </p>
      </StatePage>
    </>
  );
}
