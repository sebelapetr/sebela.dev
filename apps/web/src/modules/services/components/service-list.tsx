import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";

import { ProseMarkdown } from "../../_shared";
import type {
  ExplorationEvidenceItem,
  LinkEvidenceItem,
  ProjectEvidenceItem,
  ServiceRow,
} from "../data/services";

const linkClass =
  "inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline focus-visible:underline";

/**
 * The offers as numbered editorial rows in their stored order, each at its stable anchor: the
 * name, the summary, who it is for and what the client gets, then its evidence by kind — projects
 * (career work), independent R&D with its stored status, and pages of the site — each linking to
 * the exact item. Designed R&D is listed apart as planned work, never as evidence. A part without
 * anything to show is left out.
 */
export function ServiceList({ rows }: { readonly rows: readonly ServiceRow[] }) {
  return (
    <ol aria-label="Services" className="flex max-w-3xl flex-col gap-16">
      {rows.map((row) => {
        const projects = row.evidence.filter(
          (item): item is ProjectEvidenceItem => item.kind === "project",
        );
        const explorations = row.evidence.filter(
          (item): item is ExplorationEvidenceItem => item.kind === "exploration",
        );
        const links = row.evidence.filter((item): item is LinkEvidenceItem => item.kind === "link");
        return (
          <li
            key={row.slug}
            id={row.anchor}
            tabIndex={-1}
            className="anchor-target grid gap-4 border-t border-border pt-6 sm:grid-cols-[5rem_minmax(0,1fr)] sm:gap-8"
          >
            <span aria-hidden="true" className="type-label text-foreground">
              {row.number}
            </span>
            <div className="flex min-w-0 flex-col gap-6">
              <div className="flex flex-col gap-3">
                <h2 className="type-item">{row.name}</h2>
                <div className="max-w-prose text-pretty text-muted-foreground [&>*+*]:mt-3">
                  <ProseMarkdown>{row.summary}</ProseMarkdown>
                </div>
              </div>
              <dl className="grid max-w-prose gap-6 text-pretty">
                <Part label="For">
                  <ProseMarkdown>{row.audience}</ProseMarkdown>
                </Part>
                <Part label="You get">
                  <ProseMarkdown>{row.deliverable}</ProseMarkdown>
                </Part>
                {projects.length === 0 ? null : (
                  <Part label="Projects">
                    <ul aria-label={`${row.name}: projects`} className="flex flex-col">
                      {projects.map((item) => (
                        <li key={item.key}>
                          <EvidenceLink href={item.href}>{item.name}</EvidenceLink>
                        </li>
                      ))}
                    </ul>
                  </Part>
                )}
                {explorations.length === 0 ? null : (
                  <Part label="Independent R&D">
                    <Explorations name={`${row.name}: independent R&D`} items={explorations} />
                  </Part>
                )}
                {links.length === 0 ? null : (
                  <Part label="See also">
                    <ul aria-label={`${row.name}: see also`} className="flex flex-col">
                      {links.map((item) => (
                        <li key={item.key}>
                          <EvidenceLink href={item.href}>{item.label}</EvidenceLink>
                        </li>
                      ))}
                    </ul>
                  </Part>
                )}
                {row.planned.length === 0 ? null : (
                  <Part label="Planned, not built">
                    <Explorations name={`${row.name}: planned, not built`} items={row.planned} />
                  </Part>
                )}
              </dl>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function Part({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="type-label">{label}</dt>
      <dd className="[&>*+*]:mt-3">{children}</dd>
    </div>
  );
}

function EvidenceLink({ href, children }: { readonly href: string; readonly children: string }) {
  return (
    <Link href={href} className={linkClass}>
      {children}
      <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
    </Link>
  );
}

/** Explorations with their stored status as visible text beside the link, never stronger. */
function Explorations({
  name,
  items,
}: {
  readonly name: string;
  readonly items: readonly ExplorationEvidenceItem[];
}) {
  return (
    <ul aria-label={name} className="flex flex-col gap-2">
      {items.map((item) => (
        <li key={item.key} className="flex flex-col">
          <EvidenceLink href={item.href}>{item.name}</EvidenceLink>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="type-tag rounded-sm border border-border px-1.5">
              {item.statusLabel}
            </span>
            <span className="type-label text-balance">{item.statusMeaning}</span>
          </p>
        </li>
      ))}
    </ul>
  );
}
