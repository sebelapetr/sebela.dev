# 0020 — The learning diary groups time by Prague days and refuses overlaps in the database

Status: accepted
Date: 2026-11-18

## Decision

The learning diary stores diary days (`ai_roadmap.diary_entries`, one row per calendar date with optional Markdown notes) and time entries (`ai_roadmap.time_entries`, a resource and absolute `started_at`/`ended_at` instants, each belonging to one diary date).

- **Days are Europe/Prague calendar dates.** The services compute the date of an instant in Europe/Prague explicitly, never from the server's or the browser's timezone. Inputs must carry `Z` or a UTC offset, so a repeated local hour at the autumn change is unambiguous.
- **This corrects the original application.** It grouped entries by their UTC date, so a session started after midnight Prague time but before midnight UTC landed on the previous day. The difference is intended: compared with the old diary, entries between 00:00 and 01:00 (02:00 in summer) Prague time move to the next day.
- **A session is split at each Prague midnight** into one time entry per affected day, in one transaction, without changing its elapsed time. An edit is judged by the same rule, rewrites the entry's pieces and reports both the old and the new days.
- **Overlap is refused by the database.** The exclusion constraint `time_entries_do_not_overlap` (`EXCLUDE USING gist (tstzrange(started_at, ended_at, '[)') WITH &&)`) refuses any overlapping interval whatever its resource, also between concurrent transactions; half-open ranges allow adjacent intervals. The repository maps the constraint to `conflict`. Events will add their target to the same table, so the same constraint covers them.
- **Instants are whole seconds**, so durations are whole seconds and day totals add up exactly.
- **Durations and totals are derived** from the endpoints on every read as actual elapsed time, summed before any display rounding. Nothing caches them.

## Why

- The site's visitor and owner both live in Prague time; a diary day is what the owner experienced as a day. Making the timezone explicit keeps the result the same on any server and in any browser.
- A preflight read before the insert is racy: two concurrent writes can both see a free interval. A constraint is judged on the rows that result, so one of them always loses, and it keeps holding when more targets are added.
- Storing one piece per day makes a day's entries and total a plain query by date, while the pieces together keep the session's exact elapsed time, also across daylight-saving changes.
- A derived total cannot disagree with its entries, in line with [decision 0019](0019-roadmap-progress-derived-on-read.md).

## Rejected

- **UTC grouping as in the original application.** It shows late-evening study on the wrong day.
- **Server-local or browser-local grouping.** The day would depend on where the code runs.
- **One row per session with days computed on read.** Each day query would have to cut sessions by Prague midnight, and a session's day membership would be implicit.
- **An application-level overlap check.** It cannot hold under concurrent writes without serialising every write.
- **A stored duration or day total.** It must be kept in step with every edit, move and deletion.
- **Incremental reconciliation of seed sessions.** A session has no slug; the seed matches it by resource and instants and does not delete or move sessions removed from the seed.
