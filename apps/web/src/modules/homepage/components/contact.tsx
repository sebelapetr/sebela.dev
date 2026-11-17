import { Mail } from "lucide-react";

import { buttonVariants } from "@sebela/ui/components/button";
import { cn } from "@sebela/ui/lib/utils";

import { CvActions } from "../../_shared";
import type { HomepageProfile } from "../../profile";

/**
 * The closing contact block, the target of `/#contact`: the email address and web links from the
 * API, one button that opens an email, then the CV's actions (the PDF's download and date when
 * there is one, and the live CV). Without an email address only the links and the CV remain.
 */
export function Contact({
  contact,
  cvPdf,
}: {
  readonly contact: HomepageProfile["contact"];
  readonly cvPdf: HomepageProfile["cvPdf"];
}) {
  return (
    <section
      id="contact"
      aria-labelledby="contact-heading"
      className="flex scroll-mt-8 flex-col gap-6"
    >
      <h2 id="contact-heading" className="type-heading">
        Have a project or a role in mind?
      </h2>
      {contact.email === null ? null : (
        <p className="type-intro">
          Write to{" "}
          <a
            href={contact.email.href}
            className="break-all text-foreground underline underline-offset-4"
          >
            {contact.email.address}
          </a>
        </p>
      )}
      {contact.links.length === 0 ? null : (
        <ul aria-label="Links" className="flex flex-wrap gap-x-6">
          {contact.links.map((link) => (
            <li key={link.url}>
              <a
                href={link.url}
                rel="me noopener"
                className="inline-flex min-h-11 items-center text-sm font-medium underline-offset-4 hover:underline focus-visible:underline"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>
      )}
      {contact.email === null ? null : (
        <div>
          <a href={contact.email.href} className={cn(buttonVariants({ size: "lg" }))}>
            <Mail aria-hidden="true" data-icon="inline-start" />
            Send an email
          </a>
        </div>
      )}
      <CvActions pdf={cvPdf} />
    </section>
  );
}
