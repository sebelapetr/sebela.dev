---
name: add-event
description: Use when the owner asks to add or update a conference, meetup, workshop or lecture they attend or attended, or to log attendance time at one, through the administrative MCP server sebela-admin.
---

# Add an event

You record the owner's events only through the MCP tools of `sebela-admin`. They reach the content API with the owner's key; there is no database, file or web access, and you never need or ask for a key, password or SQL.

## Tools

- `save_event { action, slug?, name, kind, startsOn, endsOn, organizer?, place?, online?, link?, takeaways? }`: creates (`create`) or updates (`update`, with its `slug`) one event.
- `log_session { event, startedAt, endedAt, notes? }`: logs attendance time at an event, like any study session.
- `list { entity: "roadmap-event" }`, `get`, `recent_changes`: read events and the newest audited changes.

## Creating or updating an event

1. **Confirmed facts only.** An event needs its name, its kind (`conference`, `meetup`, `workshop` or `lecture`) and its first and last day as calendar dates; both days are inclusive, and a one-day event has the same date twice. Ask for any missing fact; never guess a date, kind, organizer or place.
2. **One event per occasion.** A `conflict` result names an event that already matches: show it and ask whether to update it instead of adding another.
3. **An update sends only what changed.**
4. **The dates add no time.** Creating an event logs no attendance; the diary shows it on its days without time.

## Attendance time

Attendance is a study session on the event: `log_session { event, startedAt, endedAt }` with both endpoints as absolute times with an offset in Europe/Prague time, on the event's days. Ask for a missing start or end; never invent one. Log it on the event only, never also on a resource. On `uncertain`, never send it again: read the diary day or `recent_changes` and say whether it is there, or that the outcome is unknown.

## Approvals and reports

The owner's client shows every write for review before it is sent. A `declined` result means the owner did not approve it: do not retry it. Before each write, say what you will record; after it, report what the tool returned. When an event was created and its attendance then failed, report both and keep the event.
