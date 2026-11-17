// A mailto link for an address, the same on the contact page and in the chat's contact card.

/** A mailto link with the address's local part encoded; `@` and the domain stay readable. */
export function mailtoHref(address: string): string {
  const at = address.lastIndexOf("@");
  return `mailto:${encodeURIComponent(address.slice(0, at))}@${address.slice(at + 1)}`;
}
