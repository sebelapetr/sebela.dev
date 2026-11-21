import { ArrowUpRight } from "lucide-react";

import { buttonVariants } from "@sebela/ui/components/button";
import { cn } from "@sebela/ui/lib/utils";

import { repositoryUrl } from "../site";
import { GitHubMark } from "./github-mark";

/**
 * The link to the website's public repository in the site chrome, named "Source code on GitHub" so
 * it reads as the site's code, not a personal profile. An icon button by default (the desktop
 * header); `withLabel` shows "Source code" and an external arrow beside the mark (the mobile menu).
 */
export function SourceCodeLink({
  withLabel = false,
  className,
  onNavigate,
}: {
  readonly withLabel?: boolean;
  readonly className?: string;
  readonly onNavigate?: () => void;
}) {
  return (
    <a
      href={repositoryUrl}
      aria-label="Source code on GitHub"
      onClick={() => onNavigate?.()}
      className={cn(
        buttonVariants({ variant: "ghost", size: withLabel ? "default" : "icon" }),
        withLabel && "justify-start px-3",
        className,
      )}
    >
      <GitHubMark />
      {withLabel ? (
        <>
          Source code
          <ArrowUpRight aria-hidden="true" />
        </>
      ) : null}
    </a>
  );
}
