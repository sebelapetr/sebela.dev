import { ProseMarkdown } from "../../_shared";
import type { EducationRow } from "../data/education";

/**
 * The education section, low on the page: compact editorial rows in their order, each with the
 * title, the institution when there is one, the period and the kind as a small label, and the
 * description when there is one. The caller leaves the section out without education.
 */
export function EducationList({ rows }: { readonly rows: readonly EducationRow[] }) {
  return (
    <section aria-labelledby="education-heading" className="flex max-w-3xl flex-col gap-10">
      <h2 id="education-heading" className="type-heading">
        Education
      </h2>
      <ol aria-label="Education" className="flex flex-col gap-6">
        {rows.map((row) => (
          <li key={row.slug} className="flex flex-col gap-1.5 border-l border-border pl-4">
            <h3 className="font-semibold tracking-tight text-pretty">{row.title}</h3>
            {row.institution === null ? null : (
              <p className="text-muted-foreground">{row.institution}</p>
            )}
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
              {row.period === null ? null : (
                <span className="type-label text-balance">{row.period}</span>
              )}
              <span className="type-tag rounded-sm border border-border px-1.5">
                {row.kindLabel}
              </span>
            </p>
            {row.description === null ? null : (
              <div className="mt-1 max-w-prose text-sm text-muted-foreground [&>*+*]:mt-3">
                <ProseMarkdown>{row.description}</ProseMarkdown>
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
