import Link from "next/link";

import { ProseMarkdown } from "../../_shared";
import type { RoadmapDiaryDayContent } from "../../profile";
import { TypeBadge } from "../components/badges";
import { Breadcrumbs } from "../components/breadcrumbs";
import { RoadmapFrame } from "../components/roadmap-frame";
import { DIARY_NAME, toDiaryDayPage, type DiarySession } from "../data/diary";

const HEADING_LINK =
  "inline-flex min-h-11 items-center rounded-sm underline-offset-4 hover:underline focus-visible:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none";

/**
 * A diary day's own page under the roadmap's sub-navigation: the way from the overview through the
 * diary, the day in words, its study time and sessions, its Markdown notes (rendered safely), then
 * what was studied when — grouped by area, then module, in the roadmap's order, each session with
 * its Prague start and end, its duration and its resource. A day with notes only shows its notes.
 */
export function RoadmapDiaryDayTemplate({ content }: { readonly content: RoadmapDiaryDayContent }) {
  const page = toDiaryDayPage(content.day, content.areas);
  return (
    <RoadmapFrame name={content.name} section="diary">
      <article className="flex max-w-3xl flex-col gap-12">
        <header className="flex flex-col gap-6">
          <Breadcrumbs crumbs={page.breadcrumbs} />
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3">
              <p className="type-label">{DIARY_NAME}</p>
              <h1 className="type-title wrap-anywhere">
                <time dateTime={page.date}>{page.title}</time>
              </h1>
            </div>
            {page.total === null ? null : (
              <p className="type-label tabular-nums">
                {page.total} · {page.sessions}
              </p>
            )}
          </div>
        </header>
        {page.notes === null ? null : (
          <div className="max-w-prose text-base [&>*+*]:mt-4">
            <ProseMarkdown>{page.notes}</ProseMarkdown>
          </div>
        )}
        {page.areas.length === 0 ? null : (
          <section aria-labelledby="diary-sessions-heading" className="flex flex-col gap-8">
            <h2 id="diary-sessions-heading" className="type-heading">
              What I worked on
            </h2>
            {page.areas.map((area) => (
              <div key={area.slug} className="flex flex-col gap-4">
                <h3 className="text-xl font-semibold wrap-anywhere">
                  <MaybeLink href={area.href}>{area.name}</MaybeLink>
                </h3>
                <div className="flex flex-col gap-6 border-l border-border pl-4">
                  {area.modules.map((group) => (
                    <div key={group.slug} className="flex flex-col gap-3">
                      <h4 className="text-lg font-medium wrap-anywhere">
                        <MaybeLink href={group.href}>{group.name}</MaybeLink>
                      </h4>
                      <ul aria-label={`Sessions in ${group.name}`} className="flex flex-col gap-4">
                        {group.entries.map((session) => (
                          <Session key={session.id} session={session} />
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </section>
        )}
      </article>
    </RoadmapFrame>
  );
}

function MaybeLink({
  href,
  children,
}: {
  readonly href: string | null;
  readonly children: string;
}) {
  if (href === null) return <span>{children}</span>;
  return (
    <Link href={href} prefetch={false} className={HEADING_LINK}>
      {children}
    </Link>
  );
}

/** One study session: its Prague start and end, its duration, then its resource and type. */
function Session({ session }: { readonly session: DiarySession }) {
  const { resource } = session;
  return (
    <li className="flex flex-col gap-1">
      <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm text-muted-foreground">
        <span className="font-mono tabular-nums">
          <time dateTime={session.startedAt}>{session.start}</time> –{" "}
          <time dateTime={session.endedAt}>{session.end}</time>
        </span>
        <span>({session.duration})</span>
      </p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-base font-medium wrap-anywhere">
          {resource.href === null ? (
            <span>{resource.name}</span>
          ) : (
            <a
              href={resource.href}
              target="_blank"
              rel="noopener noreferrer"
              className={HEADING_LINK}
            >
              <span>
                {resource.name}
                <span className="sr-only"> (opens in a new tab)</span>
              </span>
            </a>
          )}
        </p>
        <TypeBadge label={resource.typeLabel} />
      </div>
    </li>
  );
}
