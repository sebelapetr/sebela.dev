import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

import { ROADMAP_PATH } from "../data/overview";

/**
 * The body of a roadmap page that is not published yet: a label, the heading, one sentence that
 * says so, and the way back to the overview. It promises no date.
 */
export function Placeholder({
  label,
  heading,
  children,
}: {
  readonly label: string;
  readonly heading: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex max-w-3xl flex-col items-start gap-6">
      <h1 className="flex flex-col gap-3">
        <span className="type-label">{label}</span>
        <span className="type-title">{heading}</span>
      </h1>
      <p className="type-intro max-w-prose">{children}</p>
      <Link
        href={ROADMAP_PATH}
        prefetch={false}
        className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline focus-visible:underline"
      >
        Back to the roadmap
        <ArrowRight aria-hidden="true" className="size-4" />
      </Link>
    </div>
  );
}
