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
