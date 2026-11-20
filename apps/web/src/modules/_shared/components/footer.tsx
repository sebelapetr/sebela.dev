import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";

import { copyrightLine } from "../copyright";
import { repositoryUrl, routes } from "../site";
import { GitHubMark } from "./github-mark";

// A full-width row on phones (the trailing arrow marks it as a link without hover), an inline link
// from md up.
const linkClass =
  "flex min-h-11 w-full items-center justify-between gap-3 py-2.5 underline-offset-4 hover:text-foreground hover:underline focus-visible:underline md:inline-flex md:w-auto md:justify-start md:gap-1.5 md:py-0";

/**
 * The site footer: its links (the public repository with the GitHub mark, the CV) and the copyright
 * line with the current year. Phones show the links as rows first, then a divider and the
 * copyright line; from md up everything sits in one row. Not printed.
 */
export function Footer({ name }: { readonly name: string | null }) {
  return (
    <footer className="print:hidden">
      <div className="layout-page flex flex-col py-8 text-sm text-muted-foreground md:flex-row md:items-center md:justify-between md:gap-6">
        <ul className="flex flex-col md:flex-row md:gap-6">
          <li>
            <a href={repositoryUrl} className={linkClass}>
              <span className="flex items-center gap-2">
                <GitHubMark className="size-4 shrink-0" />
                <span>Built in public with an agentic engineering workflow</span>
              </span>
              <ArrowUpRight aria-hidden="true" className="size-4 shrink-0" />
            </a>
          </li>
          <li>
            <Link href={routes.cv} prefetch={false} className={linkClass}>
              CV
              <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
            </Link>
          </li>
        </ul>
        <p className="mt-4 border-t border-border pt-6 md:order-first md:mt-0 md:border-t-0 md:pt-0">
          {copyrightLine(name, new Date())}
        </p>
      </div>
    </footer>
  );
}
