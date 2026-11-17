import { Mail } from "lucide-react";

import { buttonVariants } from "@sebela/ui/components/button";

import type { HomepageProfile } from "../profile";

/**
 * The closing contact block, the target of `/#contact`: the email address and web links from the
 * API, and one button that opens an email. Without an email address only the links remain.
 */
export function Contact({ contact }: { readonly contact: HomepageProfile["contact"] }) {
  return (
    <section
      id="contact"
      aria-labelledby="contact-heading"
      className="flex scroll-mt-8 flex-col gap-6 border-t pt-12"
    >
      <h2 id="contact-heading" className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Have a project or a role in mind?
      </h2>
      {contact.email === null ? null : (
        <p className="text-lg text-muted-foreground">
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
          <a href={contact.email.href} className={buttonVariants({ size: "lg" })}>
            <Mail aria-hidden="true" data-icon="inline-start" />
            Send an email
          </a>
        </div>
      )}
    </section>
  );
}
