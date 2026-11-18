import Link from "next/link";

import { ProseMarkdown } from "../../_shared";
import type { RoadmapDiaryContent } from "../../profile";
import { RoadmapFrame } from "../components/roadmap-frame";
import { DIARY_NAME, toDiaryList } from "../data/diary";

/**
 * The learning diary's list under the roadmap's sub-navigation: its name and what it is, then
 * every diary day, newest first, as an editorial row — the day in words as the link to its page,
 * its study time and sessions (none on a day with notes only) and a preview of its Markdown notes,
 * rendered safely. An empty diary says so.
 */
export function RoadmapDiaryTemplate({ content }: { readonly content: RoadmapDiaryContent }) {
  const list = toDiaryList(content.diary);
  return (
    <RoadmapFrame name={content.name} section="diary">
      <div className="flex max-w-3xl flex-col gap-12">
        <header className="flex flex-col gap-4">
          <div className="flex flex-col gap-3">
            <p className="type-label">AI Roadmap</p>
            <h1 className="type-title">{DIARY_NAME}</h1>
          </div>
          <p className="type-lead max-w-prose text-muted-foreground">
            A public record of my learning: what I studied each day, for how long, and what I
            noticed along the way, as I move from full-stack development to AI engineering.
          </p>
        </header>
        {list.days.length === 0 ? (
          <p className="text-base text-muted-foreground">No diary entries yet.</p>
        ) : (
          <ol aria-label="Diary days" className="flex flex-col">
            {list.days.map((day) => (
              <li
                key={day.date}
                className="flex flex-col gap-2 border-t border-border py-6 first:border-t-0 first:pt-0"
              >
                <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                  <h2 className="type-item wrap-anywhere">
                    <Link
                      href={day.href}
                      prefetch={false}
                      className="inline-flex min-h-11 items-center rounded-sm underline-offset-4 hover:underline focus-visible:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      <time dateTime={day.date}>{day.title}</time>
                    </Link>
                  </h2>
                  {day.total === null ? null : (
                    <p className="type-label shrink-0 tabular-nums">
                      {day.total} · {day.sessions}
                    </p>
                  )}
                </div>
                {day.notes === null ? null : (
                  <div className="line-clamp-6 text-base text-muted-foreground [&>*+*]:mt-3">
                    <ProseMarkdown>{day.notes}</ProseMarkdown>
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </RoadmapFrame>
  );
}
