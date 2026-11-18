import { Mail } from "lucide-react";

import { buttonVariants } from "@sebela/ui/components/button";
import { cn } from "@sebela/ui/lib/utils";

import type { HomepageProfile } from "../../profile";

/**
 * The closing contact block, the target of `/#contact`: the email address and web links from the
 * API and one button that opens an email. Without an email address only the links remain; without
 * either the block says so, so the header's Contact link never lands on a bare heading. The CV's
 * actions live in the experience snapshot.
 */
export function Contact({ contact }: { readonly contact: HomepageProfile["contact"] }) {
  return (
    <section
      id="contact"
      aria-labelledby="contact-heading"
      className="anchor-target flex flex-col gap-6"
    >
      <h2 id="contact-heading" className="type-heading">
        Have a project or a role in mind?
      </h2>
      {contact.email === null && contact.links.length === 0 ? (
        <p className="text-muted-foreground">No contact details are published yet.</p>
      ) : null}
      {contact.email === null ? null : (
        <p className="type-intro">
          Write to{" "}
          <a
            href={contact.email.href}
            className="wrap-anywhere text-foreground underline underline-offset-4"
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
    </section>
  );
}
