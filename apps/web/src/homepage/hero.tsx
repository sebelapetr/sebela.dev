import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { buttonVariants } from "@sebela/ui/components/button";

import type { HomepageProfile } from "../profile";
import { routes } from "../site";
import { InlineMarkdown } from "./markdown";
import { Portrait } from "./portrait";

/**
 * The opening of the homepage: who the person is (name, headline and short bio from the API), the
 * photo, and the two calls to action — clients to services, employers to experience.
 */
export function Hero({ profile }: { readonly profile: HomepageProfile }) {
  return (
    <section
      aria-labelledby="hero-heading"
      className="grid gap-10 md:grid-cols-[minmax(0,1fr)_auto] md:items-center md:gap-12 lg:gap-16"
    >
      <div className="md:order-last">
        <Portrait photo={profile.photo} name={profile.name} />
      </div>
      <div className="flex min-w-0 flex-col gap-6">
        <h1 id="hero-heading" className="flex flex-col gap-3">
          <span className="font-mono text-sm tracking-tight text-muted-foreground">
            {profile.name}
          </span>
          <span className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            {profile.headline}
          </span>
        </h1>
        <div className="max-w-prose text-lg leading-relaxed text-pretty text-muted-foreground [&_p+p]:mt-4">
          <InlineMarkdown>{profile.shortBio}</InlineMarkdown>
        </div>
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-6">
          <Link href={routes.services} className={buttonVariants({ size: "lg" })}>
            Work with me
          </Link>
          <Link
            href={routes.experience}
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline focus-visible:underline"
          >
            View my experience
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
      </div>
    </section>
  );
}
