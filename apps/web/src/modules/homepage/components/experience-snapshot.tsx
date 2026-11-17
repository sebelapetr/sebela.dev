import { CvActions, routes } from "../../_shared";
import type { HomepageProfile } from "../../profile";
import type { ExperienceSnapshot as Snapshot } from "../data/experience-snapshot";
import { TextLink } from "./text-link";

/**
 * The compact Experience block: the career's length and the roles held now in one short
 * paragraph, the primary technologies as two plain lines (core, AI engineering focus), then the
 * links to the full experience and the CV's actions. A part without content is left out.
 */
export function ExperienceSnapshot({
  snapshot,
  cvPdf,
}: {
  readonly snapshot: Snapshot;
  readonly cvPdf: HomepageProfile["cvPdf"];
}) {
  const lines = [
    { label: "Core", names: snapshot.core },
    { label: "AI engineering focus", names: snapshot.aiFocus },
  ].filter((line) => line.names.length > 0);
  return (
    <section
      aria-labelledby="experience-snapshot-heading"
      className="flex max-w-3xl flex-col gap-6"
    >
      <h2 id="experience-snapshot-heading" className="type-heading">
        Experience
      </h2>
      {snapshot.years === null && snapshot.current.length === 0 ? null : (
        <p className="type-intro max-w-prose text-pretty">
          {snapshot.years === null
            ? null
            : `${String(snapshot.years)} years of professional software development. `}
          {snapshot.current.length === 0 ? null : (
            <>
              Currently:{" "}
              {snapshot.current.map((role, index) => (
                <span key={role.slug}>
                  {index === 0 ? null : "; "}
                  <span className="text-foreground">{role.title}</span>, {role.organization} (
                  {role.kind.toLowerCase()})
                </span>
              ))}
              .
            </>
          )}
        </p>
      )}
      {lines.length === 0 ? null : (
        <dl className="flex flex-col gap-3">
          {lines.map((line) => (
            <div key={line.label} className="flex flex-col gap-1 sm:flex-row sm:gap-6">
              <dt className="type-label shrink-0 sm:w-48">{line.label}</dt>
              <dd>
                {/* A name never breaks from its separator, so no line starts with a dot. */}
                {line.names.map((name, index) => (
                  <span key={name}>
                    {index === 0 ? null : " "}
                    <span className="whitespace-nowrap">
                      {name}
                      {index === line.names.length - 1 ? null : " ·"}
                    </span>
                  </span>
                ))}
              </dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-start sm:gap-x-6">
        <TextLink href={routes.experience}>Full experience</TextLink>
        <CvActions pdf={cvPdf} />
      </div>
    </section>
  );
}
