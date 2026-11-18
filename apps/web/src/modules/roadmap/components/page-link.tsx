import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * The way from an opened area or module on the overview to its own page: a 44 px text link with an
 * arrow, its accessible name naming the item.
 */
export function PageLink({
  href,
  kind,
  name,
}: {
  readonly href: string;
  readonly kind: "area" | "module";
  readonly name: string;
}) {
  return (
    <p className="ml-2 sm:ml-3">
      <Link
        href={href}
        prefetch={false}
        className="inline-flex min-h-11 items-center gap-1 rounded-sm text-sm font-medium underline-offset-4 hover:underline focus-visible:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        Open the {kind} page<span className="sr-only">: {name}</span>
        <ArrowRight aria-hidden="true" className="size-3.5" />
      </Link>
    </p>
  );
}
