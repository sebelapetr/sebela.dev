// The bookshelf contracts, private to the roadmap module and re-exported by its entry: books as
// written and as read, with their cover, derived status, linking resource and reading time. The
// book never names its resource; a resource of type `book` points to the book.
import { z } from "zod";

import { MediaSchema } from "../media/index.js";
import { SlugParamsSchema } from "../profile/index.js";

/** A book's status, derived from its dates on read and never written. */
export const roadmapBookStatuses = ["to-read", "reading", "completed"] as const;

const PERIOD_RULE = "The end cannot be before the start.";
const NON_EMPTY = { message: "Change at least one field." };

/** Trimmed, non-empty text of at most `max` characters. */
const text = (max: number) => z.string().trim().min(1).max(max);

const SlugSchema = SlugParamsSchema.shape.slug;

const InstantSchema = z.iso.datetime();

/** A calendar date, `YYYY-MM-DD`. */
const DateSchema = z.iso.date();

/** Scalar fields of a book, the same when written and when read. */
const bookFields = {
  title: text(300),
  author: text(300).nullable().meta({ description: "`null` when unknown." }),
  description: text(5000)
    .nullable()
    .meta({ description: "A short Markdown introduction; `null` when there is none." }),
  pages: z.int().min(1).max(100_000).nullable().meta({ description: "`null` when unknown." }),
  year: z
    .int()
    .min(1)
    .max(9999)
    .nullable()
    .meta({ description: "The publication year; `null` when unknown." }),
  isbn: z
    .string()
    .trim()
    .regex(/^\d[\d -]{8,15}[\dX]$/, "Use an ISBN-10 or ISBN-13 of digits, spaces or hyphens.")
    .nullable()
    .meta({ description: "An ISBN-10 or ISBN-13 as printed; `null` when unknown." }),
  priority: z.int().min(0).max(1_000_000).meta({
    description: "Shelf order: books are listed by ascending priority, then by slug.",
  }),
  startedOn: DateSchema.nullable().meta({
    description: "The day reading started, `YYYY-MM-DD`; `null` when it has not.",
  }),
  endedOn: DateSchema.nullable().meta({
    description:
      "The day reading ended, `YYYY-MM-DD`, not before `startedOn`; `null` when it has not.",
  }),
  summary: text(50_000)
    .nullable()
    .meta({ description: "The reading summary in Markdown; `null` when there is none." }),
  coverId: z
    .uuid()
    .nullable()
    .meta({
      description:
        "The identifier of an uploaded image used as the cover; `null` when there is none. It must " +
        "exist and be an image when written.",
    }),
};

/** The end is not before the start, checked when both are set in the same body. */
function endFollowsStart(
  value: { startedOn?: string | null | undefined; endedOn?: string | null | undefined },
  context: z.core.$RefinementCtx,
) {
  const { startedOn, endedOn } = value;
  if (startedOn === undefined || startedOn === null) return;
  if (endedOn === undefined || endedOn === null) return;
  // ISO dates of the same format compare chronologically as strings.
  if (endedOn < startedOn) {
    context.addIssue({ code: "custom", path: ["endedOn"], message: PERIOD_RULE });
  }
}

/** The resource of type `book` that points to a book, with its module and area for navigation. */
export const RoadmapBookResourceSchema = z
  .object({
    slug: SlugSchema,
    name: z.string(),
    module: SlugSchema.meta({ description: "The slug of its module." }),
    area: SlugSchema.meta({ description: "The slug of its module's area." }),
  })
  .meta({ id: "RoadmapBookResource" });

/** A book on the bookshelf. */
export const RoadmapBookSchema = z
  .object({
    id: z.uuid(),
    slug: SlugSchema,
    ...bookFields,
    cover: MediaSchema.nullable().meta({ description: "The cover image; `null` when none." }),
    status: z.enum(roadmapBookStatuses).meta({
      description:
        "Derived on read: `completed` when `endedOn` is set, otherwise `reading` when `startedOn` " +
        "is set, otherwise `to-read`.",
    }),
    resource: RoadmapBookResourceSchema.nullable().meta({
      description: "The resource of type `book` that links this book; `null` when none does.",
    }),
    readingSeconds: z
      .int()
      .min(0)
      .meta({
        description:
          "The elapsed seconds of every time entry logged on the linking resource; `0` without one. " +
          "Derived on read; the book has no time of its own.",
      }),
    createdAt: InstantSchema,
    updatedAt: InstantSchema,
  })
  .meta({ id: "RoadmapBook" });

/** Every book, in shelf order. */
export const RoadmapBookListSchema = z
  .array(RoadmapBookSchema)
  .meta({ id: "RoadmapBookList", description: "Ordered by priority, then slug." });

/** Body of creating a book. Omitted optional fields mean none; an omitted priority means `0`. */
export const RoadmapBookCreateSchema = z
  .strictObject({
    slug: SlugSchema,
    ...bookFields,
    author: bookFields.author.default(null),
    description: bookFields.description.default(null),
    pages: bookFields.pages.default(null),
    year: bookFields.year.default(null),
    isbn: bookFields.isbn.default(null),
    priority: bookFields.priority.default(0),
    startedOn: bookFields.startedOn.default(null),
    endedOn: bookFields.endedOn.default(null),
    summary: bookFields.summary.default(null),
    coverId: bookFields.coverId.default(null),
  })
  .superRefine(endFollowsStart)
  .meta({ id: "RoadmapBookCreate" });

/**
 * Body of updating a book: at least one field; the slug cannot be changed and `null` clears an
 * optional field. The end may not end up before the start.
 */
export const RoadmapBookUpdateSchema = z
  .strictObject(bookFields)
  .partial()
  .refine((change) => Object.keys(change).length > 0, NON_EMPTY)
  .superRefine(endFollowsStart)
  .meta({ id: "RoadmapBookUpdate" });

export type RoadmapBookStatus = (typeof roadmapBookStatuses)[number];
export type RoadmapBookResource = z.infer<typeof RoadmapBookResourceSchema>;
export type RoadmapBook = z.infer<typeof RoadmapBookSchema>;
export type RoadmapBookList = z.infer<typeof RoadmapBookListSchema>;
export type RoadmapBookCreate = z.output<typeof RoadmapBookCreateSchema>;
export type RoadmapBookUpdate = z.output<typeof RoadmapBookUpdateSchema>;
