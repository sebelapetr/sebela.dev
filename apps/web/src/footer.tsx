import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { repositoryUrl, routes } from "./site";

const linkClass =
  "inline-flex min-h-11 items-center gap-1.5 underline-offset-4 hover:text-foreground hover:underline focus-visible:underline";

/** The site footer: the copyright line, the public repository and the CV. */
export function Footer({ name }: { readonly name: string | null }) {
  const year = String(new Date().getFullYear());
  return (
    <footer className="border-t">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-5 py-8 text-sm text-muted-foreground sm:px-8 md:flex-row md:items-center md:justify-between">
        <p>{name === null ? `© ${year}` : `© ${year} ${name}`}</p>
        <ul className="flex flex-col md:flex-row md:gap-6">
          <li>
            <a href={repositoryUrl} className={`${linkClass} py-3`}>
              <span>
                Built in public with an agentic engineering workflow
                <ArrowRight aria-hidden="true" className="ml-1.5 inline size-4 align-[-0.2em]" />
              </span>
            </a>
          </li>
          <li>
            <Link href={routes.cv} className={linkClass}>
              CV
            </Link>
          </li>
        </ul>
      </div>
    </footer>
  );
}
