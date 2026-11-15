# trial

Practice functions for the phase 0 trial of the agent harness (`.plan/00-trial/prd.md`). Plain Node, no dependencies. Run the tests with `node --test trial/`.

| Function | Description | File |
|---|---|---|
| `toSlug(text)` | Turns text into a URL slug: lower case, no diacritics, runs of other characters become one dash. | `trial/to-slug.mjs` |
| `uniqueSlug(text, taken)` | Returns the slug of `text` that is not in `taken` (an array or a `Set`), adding `-2`, `-3`, ... when needed. Uses `toSlug`. | `trial/unique-slug.mjs` |
| `formatDuration(minutes)` | Formats a number of minutes for people: `45 min`, `1 h 30 min`, `2 h`. Durations of a day or more stay in hours (`1500` gives `25 h`). Throws a `RangeError` unless `minutes` is a non-negative integer no larger than `Number.MAX_SAFE_INTEGER`. | `trial/format-duration.mjs` |
| `greet(name)` | Returns `"<greeting>, <name>!"`. The greeting is `TRIAL_GREETING` (documented in `.env.example`), or `Hello` when it is not set or empty. To use the value from the worktree's `.env.local`, start Node with `--env-file-if-exists=.env.local`. | `trial/greet.mjs` |
