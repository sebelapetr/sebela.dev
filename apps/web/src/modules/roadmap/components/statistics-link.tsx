import Link from "next/link";
import { ArrowRight, ChartColumn } from "lucide-react";

import { STATISTICS_PATH } from "../data/statistics";

/** The way from the diary and its days to the learning statistics: a 44 px text link with a
 * chart icon before it and an arrow after it. */
export function StatisticsLink() {
  return (
    <p>
      <Link
        href={STATISTICS_PATH}
        prefetch={false}
        className="inline-flex min-h-11 items-center gap-1 rounded-sm text-sm font-medium underline-offset-4 hover:underline focus-visible:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <ChartColumn aria-hidden="true" className="me-0.5 size-4" />
        View statistics
        <ArrowRight aria-hidden="true" className="size-3.5" />
      </Link>
    </p>
  );
}
