// The learning statistics, private to the roadmap module. Every aggregate runs in PostgreSQL over
// the time entries alone, joined only to their single resource and its single module, area and
// book, so no topic or other many-to-many link can repeat an entry. Days, weeks and months follow
// the stored Europe/Prague diary day of each entry, which the schema keeps within that day.
import { sql, type SQL } from "drizzle-orm";

import type { Database } from "../../database.js";
import { areas, books, events, modules, resources, timeEntries } from "./schema.js";
import type {
  LearningStatisticsRecord,
  LearningStudyTimeRecord,
  LearningTimeAreaRecord,
  LearningTimeEventRecord,
  LearningTimeResourceRecord,
  LearningTimeSplitRecord,
  RoadmapEventKind,
  RoadmapPersistence,
  RoadmapResourceType,
} from "./types.js";

type StatisticsPersistence = Pick<RoadmapPersistence, "loadLearningStatistics">;

type Executor = Pick<Database, "execute">;

// Raw rows come from `pg` without Drizzle's parsers: sums arrive as strings, so dates are cast to
// text and every number goes through `Number`.
interface SplitRow extends Record<string, unknown> {
  total: string;
  resource: string;
  book: string;
  event: string;
}

/**
 * Every time entry once, with its diary day, its elapsed seconds, its category and the module of
 * its resource (`null` for attendance). Elapsed time is the difference of the instants, so a
 * daylight-saving day keeps its actual length.
 */
const classified = sql`(
  SELECT
    entry.diary_date AS day,
    entry.resource_id,
    entry.event_id,
    resource.module_id,
    extract(epoch FROM entry.ended_at) - extract(epoch FROM entry.started_at) AS seconds,
    CASE
      WHEN entry.event_id IS NOT NULL THEN 'event'
      WHEN resource.type = 'book' THEN 'book'
      ELSE 'resource'
    END AS category
  FROM ${timeEntries} AS entry
  LEFT JOIN ${resources} AS resource ON resource.id = entry.resource_id
)`;

const categorySeconds = (category: string) =>
  sql`coalesce(sum(classified.seconds) FILTER (WHERE classified.category = ${category}), 0)::bigint`;

/** The total and the three category sums of the grouped entries. */
const splitColumns = sql`
  coalesce(sum(classified.seconds), 0)::bigint AS total,
  ${categorySeconds("resource")} AS resource,
  ${categorySeconds("book")} AS book,
  ${categorySeconds("event")} AS event`;

function toSplit(row: SplitRow): LearningTimeSplitRecord {
  return {
    totalSeconds: Number(row.total),
    resourceSeconds: Number(row.resource),
    bookSeconds: Number(row.book),
    eventSeconds: Number(row.event),
  };
}

async function rows<Row extends Record<string, unknown>>(db: Executor, query: SQL) {
  return (await db.execute<Row>(query)).rows;
}

/**
 * The split per period, from the first to the last period with time, a gap period with zeros.
 * `period` maps the diary day to the start of its period; `step` is the period's length.
 */
async function loadPeriods(db: Executor, period: SQL, step: string) {
  return rows<SplitRow & { starts: string }>(
    db,
    sql`
      WITH grouped AS (
        SELECT ${period} AS starts, ${splitColumns}
        FROM ${classified} AS classified
        GROUP BY 1
      ),
      calendar AS (
        SELECT generate_series(min(starts)::timestamp, max(starts)::timestamp, ${step}::interval)::date
          AS starts
        FROM grouped
      )
      SELECT
        calendar.starts::text AS starts,
        coalesce(grouped.total, 0) AS total,
        coalesce(grouped.resource, 0) AS resource,
        coalesce(grouped.book, 0) AS book,
        coalesce(grouped.event, 0) AS event
      FROM calendar
      LEFT JOIN grouped ON grouped.starts = calendar.starts
      ORDER BY calendar.starts
    `,
  );
}

interface StudyRow extends Record<string, unknown> {
  slug: string;
  name: string;
  resource: string;
  book: string;
}

function toStudy(row: StudyRow): LearningStudyTimeRecord {
  const resourceSeconds = Number(row.resource);
  const bookSeconds = Number(row.book);
  return {
    slug: row.slug,
    name: row.name,
    totalSeconds: resourceSeconds + bookSeconds,
    resourceSeconds,
    bookSeconds,
  };
}

/** Study time by area with its modules, through each resource's current module. */
async function loadAreas(db: Executor): Promise<LearningTimeAreaRecord[]> {
  const study = sql`
    ${categorySeconds("resource")} AS resource,
    ${categorySeconds("book")} AS book
    FROM ${classified} AS classified
    INNER JOIN ${modules} AS module ON module.id = classified.module_id
    INNER JOIN ${areas} AS area ON area.id = module.area_id`;
  const byTotalThenSlug = sql`ORDER BY sum(classified.seconds) DESC, 1`;
  const areaRows = await rows<StudyRow>(
    db,
    sql`SELECT area.slug, area.name, ${study} GROUP BY area.id ${byTotalThenSlug}`,
  );
  const moduleRows = await rows<StudyRow & { area: string }>(
    db,
    sql`SELECT module.slug, module.name, area.slug AS area, ${study}
      GROUP BY module.id, area.slug ${byTotalThenSlug}`,
  );
  return areaRows.map((area) => ({
    ...toStudy(area),
    modules: moduleRows.filter((module) => module.area === area.slug).map(toStudy),
  }));
}

async function loadResources(db: Executor): Promise<LearningTimeResourceRecord[]> {
  const resourceRows = await rows<{
    slug: string;
    name: string;
    type: RoadmapResourceType;
    module_slug: string;
    module_name: string;
    area_slug: string;
    area_name: string;
    book_slug: string | null;
    book_title: string | null;
    total: string;
  }>(
    db,
    sql`
      SELECT
        resource.slug, resource.name, resource.type::text AS type,
        module.slug AS module_slug, module.name AS module_name,
        area.slug AS area_slug, area.name AS area_name,
        book.slug AS book_slug, book.title AS book_title,
        sum(classified.seconds)::bigint AS total
      FROM ${classified} AS classified
      INNER JOIN ${resources} AS resource ON resource.id = classified.resource_id
      INNER JOIN ${modules} AS module ON module.id = resource.module_id
      INNER JOIN ${areas} AS area ON area.id = module.area_id
      LEFT JOIN ${books} AS book ON book.id = resource.book_id
      GROUP BY resource.id, module.id, area.id, book.id
      ORDER BY total DESC, resource.slug
    `,
  );
  return resourceRows.map((row) => ({
    slug: row.slug,
    name: row.name,
    type: row.type,
    module: { slug: row.module_slug, name: row.module_name },
    area: { slug: row.area_slug, name: row.area_name },
    book:
      row.book_slug === null || row.book_title === null
        ? null
        : { slug: row.book_slug, title: row.book_title },
    totalSeconds: Number(row.total),
  }));
}

async function loadEvents(db: Executor): Promise<LearningTimeEventRecord[]> {
  const eventRows = await rows<{
    slug: string;
    name: string;
    kind: RoadmapEventKind;
    starts_on: string;
    ends_on: string;
    total: string;
  }>(
    db,
    sql`
      SELECT
        event.slug, event.name, event.kind::text AS kind,
        event.starts_on::text AS starts_on, event.ends_on::text AS ends_on,
        sum(classified.seconds)::bigint AS total
      FROM ${classified} AS classified
      INNER JOIN ${events} AS event ON event.id = classified.event_id
      GROUP BY event.id
      ORDER BY total DESC, event.slug
    `,
  );
  return eventRows.map((row) => ({
    slug: row.slug,
    name: row.name,
    kind: row.kind,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    totalSeconds: Number(row.total),
  }));
}

async function loadStatistics(db: Executor): Promise<LearningStatisticsRecord> {
  const [totals] = await rows<SplitRow & { active_days: string }>(
    db,
    sql`SELECT ${splitColumns}, count(DISTINCT classified.day) AS active_days
      FROM ${classified} AS classified`,
  );
  const days = await rows<SplitRow & { day: string }>(
    db,
    sql`SELECT classified.day::text AS day, ${splitColumns}
      FROM ${classified} AS classified
      GROUP BY classified.day
      ORDER BY classified.day`,
  );
  const weeks = await loadPeriods(db, sql`date_trunc('week', classified.day)::date`, "1 week");
  const months = await loadPeriods(db, sql`date_trunc('month', classified.day)::date`, "1 month");
  return {
    totals: {
      ...toSplit(totals ?? { total: "0", resource: "0", book: "0", event: "0" }),
      activeDays: Number(totals?.active_days ?? 0),
    },
    days: days.map((row) => ({ date: row.day, ...toSplit(row) })),
    weeks: weeks.map((row) => ({ startsOn: row.starts, ...toSplit(row) })),
    months: months.map((row) => ({ month: row.starts.slice(0, 7), ...toSplit(row) })),
    areas: await loadAreas(db),
    resources: await loadResources(db),
    events: await loadEvents(db),
  };
}

/** The statistics read over one connection or transaction. */
export function createStatisticsPersistence(db: Database): StatisticsPersistence {
  return {
    loadLearningStatistics() {
      return db.transaction((tx) => loadStatistics(tx), {
        isolationLevel: "repeatable read",
        accessMode: "read only",
      });
    },
  };
}
