import type { ReactNode } from "react";

import type { RoadmapDerivedStatus } from "@sebela/api-client";

import { ProseMarkdown } from "../../_shared";
import type { RoadmapCrumb } from "../data/detail";
import { CurrentBadge, EstimateBadge, ProgressBadge } from "./badges";
import { Breadcrumbs } from "./breadcrumbs";
import { StatusLabel } from "./status-label";

/**
 * The heading block of an area's or a module's own page: the breadcrumbs, the kind as a label above
 * the name, the name alone as the page's `h1`, "Current" while it is in progress, its status,
 * planned estimate and progress, anything the page adds to them (an area's weight), its Markdown
 * description, then when it last changed.
 */
export function DetailHeader({
  kind,
  name,
  breadcrumbs,
  status,
  current,
  estimate,
  completed,
  total,
  extra,
  description,
  updated,
}: {
  readonly kind: string;
  readonly name: string;
  readonly breadcrumbs: readonly RoadmapCrumb[];
  readonly status: RoadmapDerivedStatus;
  readonly current: boolean;
  readonly estimate: string | null;
  readonly completed: number;
  readonly total: number;
  readonly extra?: ReactNode;
  readonly description: string | null;
  /** When the page's content last changed (`March 14, 2026`), or null. */
  readonly updated: string | null;
}) {
  return (
    <header className="flex flex-col gap-6">
      <Breadcrumbs crumbs={breadcrumbs} />
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-3">
          <p className="type-label">{kind}</p>
          <h1 className="type-title wrap-anywhere">{name}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {current ? <CurrentBadge /> : null}
          <StatusLabel status={status} />
          {estimate === null ? null : <EstimateBadge estimate={estimate} />}
          <ProgressBadge completed={completed} total={total} />
          {extra}
        </div>
      </div>
      {description === null ? null : (
        <div className="type-lead wrap-anywhere [&>*+*]:mt-3">
          <ProseMarkdown>{description}</ProseMarkdown>
        </div>
      )}
      {updated === null ? null : <p className="text-sm text-muted-foreground">Updated {updated}</p>}
    </header>
  );
}
