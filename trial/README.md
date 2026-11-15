# trial

Practice functions for the phase 0 trial of the agent harness (`.plan/00-trial/prd.md`). Plain Node, no dependencies. Run the tests with `node --test trial/`.

| Function | Description | File |
|---|---|---|
| `slugify(text)` | Turns text into a URL slug: lower case, no diacritics, runs of other characters become one dash. | `trial/slugify.mjs` |
| `uniqueSlug(text, taken)` | Returns the slug of `text` that is not in `taken` (an array or a `Set`), adding `-2`, `-3`, ... when needed. Uses `slugify`. | `trial/unique-slug.mjs` |
| `formatDuration(minutes)` | Formats a number of minutes for people: `45 min`, `1 h 30 min`, `2 h`. Throws a `RangeError` unless `minutes` is a non-negative integer. | `trial/format-duration.mjs` |
