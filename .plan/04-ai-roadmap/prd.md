# Phase 4 — AI Roadmap

| | |
|---|---|
| Status | Draft, awaiting approval |
| Date | 2026-11-15 |
| Parent | `.plan/00-overview/prd.md` |
| Depends on | Phases 2 and 3 |
| Result | The AI Engineering Roadmap inside the site: everything the current Road to AI application shows, carried over as it is, plus a record of attended events |

## Problem Statement

Petr's learning roadmap — what he studies, how much time he gives it, what he has read — lives in a separate application on another domain. A recruiter looking at his portfolio does not see it, and nothing connects it to his projects and experience. The application's backend also grew through several rewrites and carries machinery (an event bus, a queue, a slug registry) that a site of this size does not need.

Separately, since November 2026 he attends many lectures, conferences and workshops, and there is nowhere to record them.

## Solution

Bring the roadmap into the site as the **AI Engineering Roadmap** ("AI Roadmap"), under `/ai-roadmap`, with its own sub-navigation.

- **What the visitor sees stays the same.** The pages, their look and their behaviour are carried over one to one from the current application. Petr likes it as it is.
- **What is underneath is rebuilt** on the stack of this repository: a newly designed `ai_roadmap` schema, the API, the shared UI package.
- **One thing is added:** Events.
- The existing data is converted and imported.

## User Stories

### Visitor

1. As a visitor, I want to see the roadmap as areas with their modules and progress, so that I see what Petr studies and how far he is.
2. As a visitor, I want to open an area and see its modules, and open a module and see its resources with their status, so that I can go as deep as I like.
3. As a visitor, I want to see which areas are current, so that I know what he is working on now.
4. As a visitor, I want totals — areas, modules, resources, hours — and the date of the last update, so that I can judge the scale and freshness.
5. As a visitor, I want to read the learning diary day by day with the time spent, so that I see consistent effort.
6. As a visitor, I want to open a single day and see its notes and what was studied when.
7. As a visitor, I want statistics of time spent, so that I see the effort over weeks and by area.
8. As a visitor, I want a bookshelf showing what is being read, what was finished and what is planned, and to open a book for its summary.
9. As a visitor, I want a list of events Petr attended — conferences, meetups, workshops, lectures — with what he took away, so that I see he learns from the community and not only from the screen.
10. As a visitor, I want the FAQ, the glossary of additional terms, the sources he follows to stay current, the project ideas and the guide on reading effectively, as they are today.
11. As a visitor, I want a sub-navigation inside the AI Roadmap, so that I can move between roadmap, diary, bookshelf and events.
12. As a visitor who wonders who is behind it, I want a link to the rest of the site instead of a separate About page.
13. As a visitor on a phone, I want all of it to work at a narrow width, as the rest of the site does.

### Recruiter and hiring manager

14. As a hiring manager, I want the Exploring column on the homepage to show what is actually in progress in the roadmap, so that the homepage reflects real, current activity.
15. As a recruiter, I want the chat's sources to be able to point at roadmap items, so that claims about what he is learning can be verified.

### Owner

16. As the owner, I want all my existing areas, modules, resources, diary entries, time entries and books imported, so that no history is lost.
17. As the owner, I want to keep logging in the old application until the new site launches and import again at the end, so that I do not have to keep two systems in step by hand.
18. As the owner, I want to record time spent at an event the same way as time spent on a resource, so that my statistics are complete.
19. As the owner, I want progress, completion dates and time totals worked out for me, so that I only record what I did.
20. As the owner, I want to add diary entries, resources, books and events through the API, so that my agents can do it for me.

### Search engines and AI agents

21. As a search engine, I want the roadmap pages to keep their structured data and good titles, so that they stay findable.
22. As an AI agent, I want `llms.txt` to cover the roadmap as well.

### Development agents

23. As a development agent, I want the demo seed to include a fictional roadmap, diary, books and events, so that I can build and check these pages without real data.
24. As a reviewer, I want each carried-over page compared against the original, so that "one to one" is verified and not assumed.

## Implementation Decisions

### Addresses

| Today (Road to AI) | New |
|---|---|
| `/` | `/ai-roadmap` |
| `/[area]` | `/ai-roadmap/[area]` |
| `/[area]/[module]` | `/ai-roadmap/[area]/[module]` |
| `/diary`, `/diary/[date]`, `/diary/stats` | `/ai-roadmap/diary`, `/ai-roadmap/diary/[date]`, `/ai-roadmap/diary/stats` |
| `/bookshelf`, `/bookshelf/[book]` | `/ai-roadmap/bookshelf`, `/ai-roadmap/bookshelf/[book]` |
| `/how-to-read-effectively` | `/ai-roadmap/how-to-read-effectively` |
| — | `/ai-roadmap/events` |
| `/about` | Removed; "Who's building this" links to the homepage |

- `diary`, `bookshelf`, `events` and `how-to-read-effectively` are reserved words: an area cannot use them as its slug. The API rejects such a slug.
- Routing is explicit by position in the address. The slug registry of the old application is not carried over.

### Sub-navigation

Shown under the main header on AI Roadmap pages only:

```
AI Engineering Roadmap        Roadmap   Learning Diary   Bookshelf   Events
```

### What is carried over as it is

The roadmap overview with expandable areas, progress indicators, "current" markers and totals; area and module pages; resources with type, status and estimate; the diary list, the day page and the statistics page; the bookshelf and the book page with its summary; the FAQ; additional terms; stay current; project ideas; the reading guide; structured data and Open Graph images.

- Components are moved into the website and the shared UI package and adjusted only where the design tokens differ (the violet accent is gone).
- The FAQ and the reading guide stay static texts in the website, as today. Their wording is updated where it says "Road to AI" or speaks about a separate site.

### Events

- A new page listing attended events, newest first, grouped by year, in the same editorial style as the rest of the site — rows, not cards.
- An event has: name, kind (conference, meetup, workshop, lecture), organizer, date, place or online, link, what was taken away, topics.
- **In the diary:** the day of an event shows it among that day's records; time spent at an event is recorded like time spent on a resource.
- **In the statistics:** event time is included in the totals and can be seen separately from resources and books.
- Events are **not** shown on the roadmap overview and **not** on the site's homepage.
- Events are not put into modules as resources: the roadmap is a plan of what to learn, an event is something that happened on a day.

### The `ai_roadmap` schema

Newly designed, not a copy of the old tables. Columns in `snake_case`, real foreign keys instead of references by slug.

| Entity | Holds | Relations |
|---|---|---|
| Area | Name, slug, description, weight, position | — |
| Module | Name, slug, description, position | Area |
| Resource | Name, slug, description, type, status, estimated minutes, started, finished, link | Module; book (optional); topics |
| Book | Title, slug, author, description, pages, year, ISBN, priority, started, ended, summary | Cover (media) |
| Diary entry | Date (one per day), notes | — |
| Time entry | From, to | Diary entry; **either** a resource **or** an event |
| Event | Name, slug, kind, organizer, date, place, link, takeaways | Topics |
| Project idea | Title, why it matters, topics, how to start, position | — |
| Followed source ("stay current") | Title, description, link, kind, position | — |
| Glossary term ("additional terms") | Term, description, position | — |

- Resource types and statuses keep today's values.
- A book and its resource are linked from one side only (the resource points to the book); today each points to the other.
- A book's status (to read, reading, completed) is derived from its dates, as today.
- **Derived values are computed, not stored and synchronised:** an area's and module's progress, completion date, last update and total estimate; a day's total time; a time entry's duration. The event bus and the queue of the old application exist only to keep such fields in step and are not carried over.
- Topics are the shared table of the profile domain, so a resource or an event can be linked to the same topic as a project or an exploration.
- Book covers are imported into object storage instead of being loaded from publishers' addresses.
- The final table names are the developer's call within these conventions.

### API

- Public read routes for everything the pages show, including the roadmap tree in one call, a day of the diary with its entries, and the statistics.
- Private write routes for every entity, as in phase 2.
- The statistics are aggregated by the database, not in application code.
- The OpenAPI document and the generated client are extended.

### Import of existing data

- The conversion from the old database to the new shape is a **one-off mapper kept outside the repository**. It turns a dump of the old database into a seed folder in the repository's seed format.
- The repository's seed command is extended to the roadmap domain and loads that folder. So the repository contains the format and the loader, not the owner's data and not the mapper.
- The owner keeps using the old application until launch. The mapper and the load are therefore **repeatable**: running them again on a newer dump updates what exists and adds what is new. The final import is part of the launch in phase 8.
- The demo seed gets a fictional roadmap of realistic size, a few weeks of diary, a few books and events.

### Homepage

The Exploring column of the Now section switches from profile data to the roadmap: the areas and modules currently in progress. The navigation item stops leading to a placeholder.

### Recording a diary entry

The owner's existing `diary-entry` skill writes straight into the old application's database. Its replacement — writing through this API — is part of phase 5 together with the admin MCP server.

## Testing Decisions

- **Test-first, mandatory:**
  - derived values — progress, completion date, total estimates and day totals for the combinations of resource statuses that matter (nothing started, partly done, all done, skipped and paused resources);
  - statistics — totals by period, by area and by kind (resource, book, event);
  - time entries — belonging to exactly one of resource or event, the end after the start, the duration;
  - reserved slugs are rejected;
  - the seed for this domain loads and can be run again without duplicates.
- **API contracts and authentication** as in phase 2; the test that walks every route covers the new routes automatically.
- **One-to-one carry-over is verified visually:** each page is compared with the same page of the running old application at 360, 768 and 1280 px in both themes, using the same data. Differences are either intended (tokens, sub-navigation, address) or fixed.
- **Events page and its place in the diary and statistics:** acceptance criteria, Playwright checks and screenshots.
- **End-to-end paths:** roadmap → area → module; diary → a day → statistics; bookshelf → a book; events; the sub-navigation on every page.
- **Prior art:** the current `road-to-matrix` application is the reference for behaviour and look.

## Out of Scope

- Redirects from roadtoai.dev and anything else about that domain.
- The mapper itself (kept outside the repository) and the final import (phase 8).
- A private flag on diary entries or notes; everything imported is public, as it is today.
- New features beyond Events: no redesign of the roadmap, diary or bookshelf.
- Events on the roadmap overview or on the homepage.
- The replacement of the `diary-entry` skill (phase 5).
- The event bus, the queue, Redis and the slug registry of the old application.

## Further Notes

- **HITL:** the side-by-side comparison with the old application is reviewed by the owner for the roadmap overview before the remaining pages are carried over.
- The old application has uncommitted changes in its working tree and its latest dump is from 2026-10-05. Before the mapper is written, a fresh dump is taken, and the working tree — not the last commit — is the reference for how pages look.
- The current data: 10 areas, 53 modules, 137 resources.
