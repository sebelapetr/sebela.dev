import Link from "next/link";
import { ArrowRight, ArrowUpRight } from "lucide-react";

import { ProseMarkdown } from "../../_shared";
import type { NowContent, WorkingOnItem } from "../data/now";
import { TextLink, textLinkClass } from "./text-link";

/**
 * The homepage's Now: what is being built (Working on) beside what is being learned (Exploring),
 * each column left out when empty, then the links to the independent R&D and the AI Roadmap.
 * Exploring is the AI Roadmap's areas and modules in progress, each linking to its own page and
 * marked as in progress with the API's completed count, so learning never reads as delivered work.
 */
export function Now({ now }: { readonly now: NowContent }) {
  return (
    <section aria-labelledby="now-heading" className="flex flex-col gap-10">
      <h2 id="now-heading" className="type-heading">
        Now
      </h2>
      <div className="grid gap-12 md:grid-cols-2 md:gap-8 lg:gap-16">
        {now.workingOn.length === 0 ? null : (
          <div className="flex min-w-0 flex-col gap-6">
            <h3 className="type-label text-foreground">Working on</h3>
            <ul className="flex flex-col gap-8">
              {now.workingOn.map((item) => (
                <WorkingOn key={item.slug} item={item} />
              ))}
            </ul>
          </div>
        )}
        {now.exploring.length === 0 ? null : (
          <div className="flex min-w-0 flex-col gap-6">
            <h3 className="type-label text-foreground">Exploring</h3>
            <ul className="flex flex-col">
              {now.exploring.map((item) => (
                <li
                  key={item.slug}
                  className="flex flex-col gap-1.5 border-t border-border py-4 last:border-b"
                >
                  <Link
                    href={item.href}
                    prefetch={false}
                    className="type-item inline-flex min-h-11 items-center underline-offset-4 hover:underline focus-visible:underline"
                  >
                    {item.name}
                  </Link>
                  <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="type-tag rounded-sm border border-border px-1.5">
                      In progress
                    </span>
                    <span className="type-label">{item.progress} resources completed</span>
                  </p>
                  {item.modules.length === 0 ? null : (
                    <ul aria-label={`${item.name} modules in progress`} className="flex flex-col">
                      {item.modules.map((module) => (
                        <li key={module.slug} className="flex flex-wrap items-center gap-x-3">
                          <Link
                            href={module.href}
                            prefetch={false}
                            className="inline-flex min-h-11 items-center text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:underline"
                          >
                            {module.name}
                          </Link>
                          <span className="type-label">{module.progress}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:gap-x-6">
        {now.independentRdHref === null ? null : (
          <TextLink href={now.independentRdHref}>Independent R&amp;D</TextLink>
        )}
        <TextLink href={now.roadmapHref}>AI Roadmap</TextLink>
      </div>
    </section>
  );
}

function WorkingOn({ item }: { readonly item: WorkingOnItem }) {
  return (
    <li className="flex flex-col gap-3 border-l border-border pl-4">
      <h4 className="type-item">{item.title}</h4>
      <div className="max-w-prose text-pretty text-muted-foreground [&>*+*]:mt-3">
        <ProseMarkdown>{item.description}</ProseMarkdown>
      </div>
      {item.topics.length === 0 ? null : (
        <ul
          aria-label={`${item.title} topics`}
          className="type-label flex flex-wrap gap-x-3 gap-y-1"
        >
          {item.topics.map((topic) => (
            <li key={topic}>{topic}</li>
          ))}
        </ul>
      )}
      {item.link === null ? null : item.link.external ? (
        <p>
          <a
            href={item.link.href}
            rel="noopener"
            aria-label={`${item.link.label}: ${item.title}`}
            className={textLinkClass}
          >
            {item.link.label}
            <ArrowUpRight aria-hidden="true" className="size-4" />
          </a>
        </p>
      ) : (
        <p>
          <Link
            href={item.link.href}
            prefetch={false}
            aria-label={`${item.link.label}: ${item.title}`}
            className={textLinkClass}
          >
            {item.link.label}
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </p>
      )}
    </li>
  );
}
