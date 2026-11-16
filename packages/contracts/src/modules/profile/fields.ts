// Field schemas shared by the profile contracts; private to the profile module.
import { z } from "zod";

/** Trimmed, non-empty text of at most `max` characters. */
export const text = (max: number) => z.string().trim().min(1).max(max);

/** An absolute `http` or `https` address with a domain host. */
export const HttpUrlSchema = z.url({ protocol: /^https?$/, hostname: z.regexes.domain }).max(2048);

/** Lower-case letters and digits in words joined by single hyphens, for example `next-js`. */
const KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** A lower-case hyphenated key, for example a slug or a static logo key. */
export const key = (description: string) =>
  z.string().min(1).max(100).regex(KEY_PATTERN, "Use lower-case words joined by hyphens.").meta({
    description,
  });

/** The stable, unique address of a record; set when it is created and never changed. */
export const SlugSchema = key("The stable, unique address of the record, for example `paldock`.");

/** Creation and last-change times of a stored record. */
export const timestamps = { createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() };

/** A calendar date, `YYYY-MM-DD`. */
export const DateSchema = z.iso.date();

const PERIOD_RULE = "The end cannot be before the start.";
const UNIQUE_TECHNOLOGIES = "List each technology once.";

/** The end is not before the start. Checked when both are set in the same body. */
export function endFollowsStart(
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

/** Every technology slug of a write appears once. */
export function technologiesAreUnique(
  value: { technologies?: string[] | undefined },
  context: z.core.$RefinementCtx,
) {
  const { technologies } = value;
  if (technologies !== undefined && new Set(technologies).size !== technologies.length) {
    context.addIssue({ code: "custom", path: ["technologies"], message: UNIQUE_TECHNOLOGIES });
  }
}

const UNIQUE_TOPICS = "List each topic once.";

/** Every topic slug of a write appears once. */
export function topicsAreUnique(
  value: { topics?: string[] | undefined },
  context: z.core.$RefinementCtx,
) {
  const { topics } = value;
  if (topics !== undefined && new Set(topics).size !== topics.length) {
    context.addIssue({ code: "custom", path: ["topics"], message: UNIQUE_TOPICS });
  }
}
