import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { buttonVariants } from "@sebela/ui/components/button";
import { cn } from "@sebela/ui/lib/utils";

import { routes } from "../../_shared";
import { StatePage } from "../components/state-page";

/**
 * The AI Roadmap's address until phase 4 publishes the roadmap: says plainly that it is not here
 * yet and leads back to the site. It promises no date and lists no roadmap content.
 */
export function RoadmapPlaceholderTemplate() {
  return (
    <StatePage
      label="AI Roadmap"
      heading="The AI Roadmap is not published yet."
      action={
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-6">
          <Link
            href={routes.home}
            className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
          >
            Back to the homepage
          </Link>
          <Link
            href={routes.experience}
            prefetch={false}
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline focus-visible:underline"
          >
            View my experience
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
      }
    >
      <p className="type-intro max-w-prose">
        It will map what I am learning in AI engineering, step by step. Until then, the independent
        R&amp;D on the experience page shows what I am exploring now.
      </p>
    </StatePage>
  );
}
