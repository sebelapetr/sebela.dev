import type { CvDocument } from "../data/cv-document";

const contactLinkClass =
  "inline-flex min-h-11 items-center text-sm font-medium break-all underline-offset-4 hover:underline focus-visible:underline print:min-h-0";

/**
 * The CV's header: the name as the page's heading, the headline, then the location, the email
 * address and the web links. In print a link's own address follows its label, since paper cannot
 * be clicked.
 */
export function CvHeader({ header }: { readonly header: CvDocument["header"] }) {
  const hasContacts = header.location !== null || header.email !== null || header.links.length > 0;
  return (
    <header className="flex flex-col gap-6 print:gap-3">
      <div className="flex flex-col gap-3 print:gap-1">
        <h1 className="type-title">{header.name}</h1>
        <p className="type-lead">{header.headline}</p>
      </div>
      {hasContacts ? (
        <ul
          aria-label="Contacts"
          className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6 print:flex-row print:flex-wrap print:gap-x-6"
        >
          {header.location === null ? null : (
            <li className="flex min-h-11 items-center text-sm text-muted-foreground print:min-h-0">
              {header.location}
            </li>
          )}
          {header.email === null ? null : (
            <li>
              <a href={header.email.href} className={contactLinkClass}>
                {header.email.address}
              </a>
            </li>
          )}
          {header.links.map((link) => (
            <li key={link.url}>
              <a href={link.url} rel="me noopener" className={contactLinkClass}>
                {link.label}
                <span className="hidden font-normal text-muted-foreground print:inline">
                  &nbsp;{link.url}
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </header>
  );
}
