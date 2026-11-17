import Link from "next/link";

import { buttonVariants } from "@sebela/ui/components/button";
import { cn } from "@sebela/ui/lib/utils";

import { Footer, ProseMarkdown, routes } from "../../_shared";
import type { ServicesContent } from "../../profile";
import { Collaboration } from "../components/collaboration";
import { ServiceList } from "../components/service-list";
import { toCollaborationSteps, toServiceRows } from "../data/services";

/**
 * The services page: the person's name and the services intro, the offers as numbered editorial
 * rows with their evidence, the note on established practice and newer focus, how a collaboration
 * runs, then one action to the homepage's contact block. A part without content is left out;
 * without services the page says so.
 */
export function ServicesTemplate({ content }: { readonly content: ServicesContent }) {
  const rows = toServiceRows(content.services);
  const steps = toCollaborationSteps(content.collaborationSteps);
  return (
    <>
      <main className="layout-page flex flex-1 flex-col gap-24 py-12 sm:py-20 md:gap-32">
        <header className="flex max-w-3xl flex-col gap-6">
          <h1 className="flex flex-col gap-3">
            <span className="type-label">{content.name}</span>
            <span className="type-title">Services</span>
          </h1>
          {content.intro === null ? null : (
            <div className="type-lead [&>*+*]:mt-3">
              <ProseMarkdown>{content.intro}</ProseMarkdown>
            </div>
          )}
        </header>
        <div className="flex flex-col gap-12">
          {rows.length === 0 ? (
            <p className="text-muted-foreground">No services are published yet.</p>
          ) : (
            <ServiceList rows={rows} />
          )}
          {content.note === null ? null : (
            <aside
              aria-label="Experience and focus"
              className="max-w-prose border-l border-border pl-4 text-pretty text-muted-foreground [&>*+*]:mt-3"
            >
              <ProseMarkdown>{content.note}</ProseMarkdown>
            </aside>
          )}
        </div>
        {steps.length === 0 ? null : <Collaboration steps={steps} />}
        <section aria-labelledby="services-contact-heading" className="flex flex-col gap-6">
          <h2 id="services-contact-heading" className="type-heading">
            Have a project in mind?
          </h2>
          <div>
            <Link href={routes.contact} className={cn(buttonVariants({ size: "lg" }))}>
              Get in touch
            </Link>
          </div>
        </section>
      </main>
      <Footer name={content.name} />
    </>
  );
}
