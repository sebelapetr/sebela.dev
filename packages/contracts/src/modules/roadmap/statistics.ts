// The learning statistics contract, private to the roadmap module and re-exported by its entry: the
// time logged in the learning diary, totalled per category, per Europe/Prague day, week and month,
// and broken down by area, module, resource and event. Every value is whole seconds, aggregated
// before any display rounding.
import { z } from "zod";

import { SlugParamsSchema } from "../profile/index.js";
import { roadmapResourceTypes } from "./catalogs.js";
import { roadmapEventKinds } from "./events.js";

const SlugSchema = SlugParamsSchema.shape.slug;

const DateSchema = z.iso.date();

const seconds = (description: string) => z.int().min(0).meta({ description });

/** The overall time and its three categories, which always sum to it. */
const categorySplit = {
  totalSeconds: seconds("All logged time: the sum of the three categories."),
  resourceSeconds: seconds("Time logged on resources whose type is not `book`."),
  bookSeconds: seconds("Time logged on resources of type `book`, counted once."),
  eventSeconds: seconds("Attendance logged on events."),
};

/** Study time, which areas and modules have; event attendance belongs to no area. */
const studySplit = {
  totalSeconds: seconds("Study time: resource and book time together, never event attendance."),
  resourceSeconds: categorySplit.resourceSeconds,
  bookSeconds: categorySplit.bookSeconds,
};

const NamedSchema = z.object({ slug: SlugSchema, name: z.string() });

export const LearningTimeTotalsSchema = z
  .object({
    ...categorySplit,
    activeDays: z.int().min(0).meta({ description: "The number of diary days with logged time." }),
  })
  .meta({ id: "LearningTimeTotals" });

export const LearningTimeDaySchema = z
  .object({
    date: DateSchema.meta({ description: "The diary day, `YYYY-MM-DD` in Europe/Prague." }),
    ...categorySplit,
  })
  .meta({
    id: "LearningTimeDay",
    description: "One diary day with logged time; its total equals the diary day's total.",
  });

export const LearningTimeWeekSchema = z
  .object({
    startsOn: DateSchema.meta({
      description: "The Monday that starts the week, `YYYY-MM-DD` in Europe/Prague.",
    }),
    ...categorySplit,
  })
  .meta({ id: "LearningTimeWeek" });

export const LearningTimeMonthSchema = z
  .object({
    month: z
      .string()
      .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
      .meta({ description: "The calendar month, `YYYY-MM` in Europe/Prague." }),
    ...categorySplit,
  })
  .meta({ id: "LearningTimeMonth" });

export const LearningTimeModuleSchema = z
  .strictObject({ slug: SlugSchema, name: z.string(), ...studySplit })
  .meta({ id: "LearningTimeModule" });

export const LearningTimeAreaSchema = z
  .strictObject({
    slug: SlugSchema,
    name: z.string(),
    ...studySplit,
    modules: z.array(LearningTimeModuleSchema).meta({
      description:
        "The area's modules with study time, by total (largest first), then slug. Their totals " +
        "sum to the area's.",
    }),
  })
  .meta({ id: "LearningTimeArea" });

export const LearningTimeResourceSchema = z
  .object({
    slug: SlugSchema,
    name: z.string(),
    type: z.enum(roadmapResourceTypes),
    category: z
      .enum(["resource", "book"])
      .meta({ description: "`book` for a resource of type `book`, otherwise `resource`." }),
    module: NamedSchema.meta({ description: "The module the resource is in now." }),
    area: NamedSchema.meta({ description: "The area of that module." }),
    book: z
      .object({ slug: SlugSchema, title: z.string() })
      .nullable()
      .meta({ description: "The book the resource reads; `null` when it links none." }),
    totalSeconds: seconds("Time logged on the resource."),
  })
  .meta({ id: "LearningTimeResource" });

export const LearningTimeEventSchema = z
  .object({
    slug: SlugSchema,
    name: z.string(),
    kind: z.enum(roadmapEventKinds),
    startsOn: DateSchema,
    endsOn: DateSchema,
    totalSeconds: seconds("Attendance logged on the event."),
  })
  .meta({ id: "LearningTimeEvent" });

/** The learning statistics: every time entry counted exactly once in each view. */
export const RoadmapStatisticsSchema = z
  .object({
    totals: LearningTimeTotalsSchema,
    days: z
      .array(LearningTimeDaySchema)
      .meta({ description: "Every diary day with logged time, oldest first." }),
    weeks: z.array(LearningTimeWeekSchema).meta({
      description:
        "Every Monday-start week from the first to the last with logged time, oldest first; a " +
        "week between them without time is present with zero seconds.",
    }),
    months: z.array(LearningTimeMonthSchema).meta({
      description:
        "Every calendar month from the first to the last with logged time, oldest first; a " +
        "month between them without time is present with zero seconds.",
    }),
    areas: z.array(LearningTimeAreaSchema).meta({
      description:
        "The areas with study time, by total (largest first), then slug. Resource and book time " +
        "counts in the current module and area of its resource; event attendance is never part " +
        "of an area.",
    }),
    resources: z.array(LearningTimeResourceSchema).meta({
      description: "The resources with logged time, by total (largest first), then slug.",
    }),
    events: z
      .array(LearningTimeEventSchema)
      .meta({ description: "The events with attendance, by total (largest first), then slug." }),
  })
  .meta({ id: "RoadmapStatistics" });

export type LearningTimeTotals = z.infer<typeof LearningTimeTotalsSchema>;
export type LearningTimeDay = z.infer<typeof LearningTimeDaySchema>;
export type LearningTimeWeek = z.infer<typeof LearningTimeWeekSchema>;
export type LearningTimeMonth = z.infer<typeof LearningTimeMonthSchema>;
export type LearningTimeArea = z.infer<typeof LearningTimeAreaSchema>;
export type LearningTimeModule = z.infer<typeof LearningTimeModuleSchema>;
export type LearningTimeResource = z.infer<typeof LearningTimeResourceSchema>;
export type LearningTimeEvent = z.infer<typeof LearningTimeEventSchema>;
export type RoadmapStatistics = z.infer<typeof RoadmapStatisticsSchema>;
