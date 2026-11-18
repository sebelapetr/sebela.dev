import { TECHNOLOGY_LOGOS } from "../data/technology-logos";

/**
 * A core technology's static logo, monochrome in the text colour. Decorative: the technology's
 * name always stands beside it. Renders nothing for a key the website has no logo for.
 */
export function TechnologyLogo({ logoKey }: { readonly logoKey: string }) {
  const path = TECHNOLOGY_LOGOS[logoKey];
  if (path === undefined) return null;
  return (
    <svg
      aria-hidden="true"
      data-logo={logoKey}
      viewBox="0 0 24 24"
      fill="currentColor"
      className="size-7 shrink-0 sm:size-8"
    >
      <path d={path} />
    </svg>
  );
}
