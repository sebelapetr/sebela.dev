import type { Person } from "@sebela/api-client";

import { mailtoHref } from "../../_shared";

import { isWebUrl } from "./image";

/** The person's contacts, ready for links. */
export interface Contact {
  readonly email: { readonly address: string; readonly href: string } | null;
  /** The person's web links, in their order; any other address is left out. */
  readonly links: readonly { readonly label: string; readonly url: string }[];
}

/** The person's email as a mailto link and their web links. */
export function toContact(person: Person): Contact {
  return {
    email: person.email === null ? null : { address: person.email, href: mailtoHref(person.email) },
    links: person.links.filter((link) => isWebUrl(link.url)),
  };
}
