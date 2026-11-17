import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

/** The look of every text link outside running text: small, medium, 44 px tall. */
export const textLinkClass =
  "inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline focus-visible:underline";

/**
 * A text link with a trailing arrow to a page of the site. The pages are rendered on request, so
 * the link is not prefetched: a homepage full of links would otherwise read every page at once.
 */
export function TextLink({
  href,
  label,
  children,
}: {
  readonly href: string;
  /** The accessible name when the visible text alone is not unique on the page. */
  readonly label?: string;
  readonly children: ReactNode;
}) {
  return (
    <Link href={href} prefetch={false} aria-label={label} className={textLinkClass}>
      {children}
      <ArrowRight aria-hidden="true" className="size-4" />
    </Link>
  );
}
