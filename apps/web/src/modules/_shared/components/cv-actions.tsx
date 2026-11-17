import Link from "next/link";
import { ArrowDown, ArrowRight } from "lucide-react";

import { formatDate } from "../period";
import { cvPdfRoutes, routes } from "../site";

const linkClass =
  "inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline focus-visible:underline";

/**
 * The CV's actions as text links, hidden in print. With a PDF: "Download CV" serves the current,
 * manually uploaded file through `/cv/pdf`, and the day that file was uploaded is shown beside it,
 * so a PDF older than the site is visible. Without a PDF there is nothing to download: the live CV
 * takes its place, and no date is shown. `withCvLink` adds the link to the live CV as well (left
 * out on `/cv` itself).
 *
 * The download is a plain link, not `download`: when the file cannot be served the route answers
 * with the failure page, which must open as a page, never be saved as a file.
 */
export function CvActions({
  pdf,
  withCvLink = true,
}: {
  readonly pdf: { readonly updatedOn: string } | null;
  readonly withCvLink?: boolean;
}) {
  if (pdf === null && !withCvLink) return null;
  return (
    <div className="flex flex-col gap-1 print:hidden">
      <ul className="flex flex-col sm:flex-row sm:flex-wrap sm:gap-x-6">
        {pdf === null ? null : (
          <li>
            <a href={cvPdfRoutes.download} className={linkClass}>
              Download CV
              <ArrowDown aria-hidden="true" className="size-4" />
            </a>
          </li>
        )}
        {withCvLink ? (
          <li>
            <Link href={routes.cv} prefetch={false} className={linkClass}>
              Read the CV
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </li>
        ) : null}
      </ul>
      {pdf === null ? null : (
        <p className="type-label">
          PDF updated <time dateTime={pdf.updatedOn}>{formatDate(pdf.updatedOn)}</time>
        </p>
      )}
    </div>
  );
}
