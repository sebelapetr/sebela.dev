import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { buttonVariants } from "@sebela/ui/components/button";
import { cn } from "@sebela/ui/lib/utils";

import { cvPdfRoutes, routes } from "../../_shared";
import { StatePage } from "../components/state-page";

/**
 * Shown when the CV PDF exists but its file could not be served (missing, not a PDF, unreachable or
 * too slow). Says plainly that nothing was downloaded, sends the visitor to the live CV and offers
 * another attempt.
 */
export function CvPdfUnavailableTemplate() {
  return (
    <StatePage
      label="PDF unavailable"
      heading="The CV PDF could not be downloaded."
      action={
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
          <Link href={routes.cv} className={cn(buttonVariants({ size: "lg" }))}>
            Read the CV
          </Link>
          <a
            href={cvPdfRoutes.download}
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline focus-visible:underline"
          >
            Try the download again
            <ArrowRight aria-hidden="true" className="size-4" />
          </a>
        </div>
      }
    >
      <p className="type-intro max-w-prose">
        The file is temporarily unavailable, so nothing was downloaded. The CV page shows the same
        career, read from the site&apos;s current content.
      </p>
    </StatePage>
  );
}
