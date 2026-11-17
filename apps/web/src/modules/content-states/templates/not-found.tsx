import Link from "next/link";

import { buttonVariants } from "@sebela/ui/components/button";
import { cn } from "@sebela/ui/lib/utils";

import { routes } from "../../_shared";
import { StatePage } from "../components/state-page";

/** Shown for an address without a page, and when no profile is published yet. */
export function NotFoundTemplate() {
  return (
    <StatePage
      label="404"
      heading="This page does not exist yet."
      action={
        <Link href={routes.home} className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
          Back to the homepage
        </Link>
      }
    />
  );
}
