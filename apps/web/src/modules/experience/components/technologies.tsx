import type { TechnologyGroup } from "../data/technologies";
import { SecondaryTechnologiesDisclosure } from "./disclosures";
import { TechnologyLogo } from "./technology-logo";

/**
 * The technologies section: the core technologies prominently, each with its static logo when the
 * website has one (no cards); the AI engineering focus as plain text that says it is a current
 * specialisation; the secondary technologies as a collapsed plain-text list. Each group has its
 * own anchor. The caller leaves the section out without technologies; a group without
 * technologies is not among `groups`.
 */
export function Technologies({ groups }: { readonly groups: readonly TechnologyGroup[] }) {
  return (
    <section aria-labelledby="technologies-heading" className="flex max-w-3xl flex-col gap-10">
      <h2 id="technologies-heading" className="type-heading">
        Technologies
      </h2>
      <div className="flex flex-col gap-10">
        {groups.map((group) => (
          <Group key={group.key} group={group} />
        ))}
      </div>
    </section>
  );
}

function Group({ group }: { readonly group: TechnologyGroup }) {
  switch (group.key) {
    case "core":
      return (
        <div id={group.anchor} tabIndex={-1} className="anchor-target flex flex-col gap-4">
          <h3 className="type-label">{group.label}</h3>
          <ul aria-label={`${group.label} technologies`} className="flex flex-wrap gap-x-8 gap-y-4">
            {group.technologies.map((technology) => (
              <li
                key={technology.slug}
                className="flex min-h-8 items-center gap-3 text-lg font-semibold tracking-tight"
              >
                {technology.logoKey === null ? null : (
                  <TechnologyLogo logoKey={technology.logoKey} />
                )}
                {technology.name}
              </li>
            ))}
          </ul>
        </div>
      );
    case "ai-engineering-focus":
      return (
        <div id={group.anchor} tabIndex={-1} className="anchor-target flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <h3 className="type-label">{group.label}</h3>
            <p className="text-sm text-muted-foreground">
              A current specialisation, not years of core expertise.
            </p>
          </div>
          <ul aria-label={`${group.label} technologies`} className="flex flex-wrap gap-x-4 gap-y-1">
            {group.technologies.map((technology) => (
              <li key={technology.slug} className="font-medium">
                {technology.name}
              </li>
            ))}
          </ul>
        </div>
      );
    case "secondary":
      return (
        <SecondaryTechnologiesDisclosure
          anchor={group.anchor}
          label={otherCount(group.technologies.length)}
        >
          <ul
            aria-label={group.label}
            className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground"
          >
            {group.technologies.map((technology) => (
              <li key={technology.slug}>{technology.name}</li>
            ))}
          </ul>
        </SecondaryTechnologiesDisclosure>
      );
  }
}

function otherCount(count: number): string {
  return count === 1
    ? "+ 1 other technology or tool"
    : `+ ${String(count)} other technologies & tools`;
}
