# Domain context

The domain model and product rules for this project. Use [`GLOSSARY.md`](../GLOSSARY.md) for canonical term names and rejected synonyms; this document grows with each phase and records their relationships and detailed meaning.

## Purpose of the site

A hybrid personal professional site for Petr Šebela. It serves two audiences with one identity:

| Audience                   | Needs                                                 | Path                                    |
| -------------------------- | ----------------------------------------------------- | --------------------------------------- |
| Client                     | What can be ordered and whether it fits their problem | Homepage → Services → Contact           |
| Recruiter / hiring manager | Seniority, stack, recent work, CV                     | Homepage → Experience → CV              |
| Technical evaluator        | Depth and how the work is done                        | Projects, case studies, this repository |
| AI agent                   | Structured, trustworthy facts                         | Public MCP server                       |

Positioning: software engineer focused on AI systems, automation and modern software, available for selected projects and career opportunities.

The site answers, in order: who he is, what he can do, what he has built, what he is doing now, where he is heading, how to work with him.

## Entities of the profile domain

Delivered in phase 2: the schema and migrations are in `packages/db`, the transport contracts in `packages/contracts` and the routes, with their access and errors, in `apps/api/AGENTS.md`.

| Entity        | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Person        | The site owner: name, headline, short bio, location, contacts, availability, a photo and the current CV PDF, both media, and the Services page's own prose (an introduction, ordered collaboration steps and the note before the closing action). One record                                                                                                                                                                                                                                                                                                                  |
| Organization  | A company or client: name, website, description and an optional logo (an image media). Experiences refer to it, so an organization cannot be deleted while one still does                                                                                                                                                                                                                                                                                                                                                                                                     |
| Experience    | A role at an organization over a period (no end for a current role); its kind is main job, side project or own business. It links technologies in a chosen order; a linked technology cannot be deleted                                                                                                                                                                                                                                                                                                                                                                       |
| Project       | Something delivered within exactly one experience, described as problem → what was done → result, with a period, outside links, an optional cover (an image media) and technologies in a chosen order; may be selected for the homepage. It can move to another experience but never be without one; an experience that owns a project cannot be deleted, and neither can a technology a project links or a project a service names as evidence. Its dates are not checked against the experience's period. A project a current-focus entry is about cannot be deleted either |
| Case study    | The long-form Markdown text for a project, including the person's role in it. A project has at most one, addressed through the project; a project with a case study cannot be deleted until the case study is                                                                                                                                                                                                                                                                                                                                                                 |
| Exploration   | Independent R&D outside the timeline: unreleased side work and experiments, with a name, summary, status (built, tested or designed, see below), an ordered list of concepts, a period and a chosen position. It links technologies and topics in a chosen order, never an experience or a project; a linked technology or topic cannot be deleted, and neither can an exploration a service names as evidence                                                                                                                                                                |
| Service       | Something a client can order, with a name, summary, who it is for (audience), what they get (deliverable) and a chosen position. Its evidence is an ordered list of existing projects and explorations, each at most once, and links to paths within the site (never another host or scheme); deleting a service removes only its evidence                                                                                                                                                                                                                                    |
| Technology    | A tool or language; see tiers below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Topic         | A shared subject (for example RAG, MCP, agents) that links the profile to the AI Roadmap; a topic a current-focus entry or a roadmap resource links cannot be deleted                                                                                                                                                                                                                                                                                                                                                                                                         |
| Education     | A school, course, certification or other learning milestone, with a kind (`school`, `course`, `certification` or `milestone`), a title, an optional institution and description, a period and a chosen position; listed by position, then slug. The period need not look like a school year: at least one date is set, a start alone means the learning is ongoing, an end alone means it was completed on that day, and the end is never before the start. The same rule applies to every kind. Nothing refers to an education record                                        |
| Testimonial   | A quote from a client or colleague, with the author's name and role and an optional author photo (an image media), belonging to exactly one experience and shown with it beside its projects, by a chosen position, then slug. It can move to another experience but never be without one; an experience with a testimonial cannot be deleted. Nothing refers to a testimonial                                                                                                                                                                                                |
| Current focus | Work or learning the person is focused on now, with a title, a Markdown description, an optional outside link and a chosen position (ordered by position, then slug). It may be about one existing project and links existing topics in a chosen order; neither is required. A project or topic a focus entry links cannot be deleted. Nothing refers to a focus entry                                                                                                                                                                                                        |
| Media         | An uploaded file — a PNG, JPEG or WebP image or a PDF — with its storage key, the type its content proved, byte size, image dimensions and alt text. The person's photo, an organization's logo, a project's cover, a testimonial's author photo and a bookshelf book's cover refer to an image; the person's current CV PDF refers to a PDF. Media that a record refers to cannot be deleted. The current CV PDF is uploaded as prepared, never generated                                                                                                                    |

### Experience, project, exploration

These three are deliberately separate:

- An **experience** is a period in a role. It appears on the timeline and in the CV.
  Experiences have no manual position. They are ordered current roles first (no end date), then by latest start, latest end and slug.
- A **project** is delivered work shown inside the experience it belongs to — and only when it proves something. A strong one gets a case study.
- An **exploration** was never released. It is not a delivered project or a career experience. Explorations are shown together as one short block that demonstrates initiative on the Experience page, and concisely in a separate section on the print-friendly CV page, with their actual status preserved. They are not inserted into the career timeline. The downloadable PDF is maintained manually and is not generated from this data.

### CV data, CV page, Experience page and CV PDF

- **CV data** is what the public `GET /v1/cv` returns: the person, the experiences selected for the CV, the technology tiers and groups, education, the explorations with their actual status in a section of their own, and the current CV PDF's metadata. It is assembled from the stored profile on every read, so a profile change shows in the next response; nothing is copied into another table.
- The **CV page** is the future print-friendly page of the website (phase 3) that renders the CV data. It may show fewer exploration statuses than the data carries, according to its PRD.
- The **Experience page** is another consumer of the same profile: the full timeline with projects and the exploration block. It reads the profile through its own routes, not through the CV data.
- The **CV PDF** is prepared by hand and uploaded as media; the person names the current one. Neither the API nor the pages generate or update it.

### Exploration status

Every exploration carries one of:

| Status   | Meaning                         |
| -------- | ------------------------------- |
| Built    | Implemented and working         |
| Tested   | Tried out or evaluated hands-on |
| Designed | Planned or architected only     |

The Experience page and print-friendly CV may show all three statuses in their separate R&D sections. Every entry retains a visible text status, including in print and chat blocks. Designed work is explicitly an unimplemented design, never evidence of delivered work or hands-on experience. Neither a page nor the chatbot may present a status more strongly than stored. Explorations never become career experiences or delivered client projects through presentation.

### Technology tiers

| Tier      | Presentation                                                                                                                                                         |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary   | Shown prominently, in two groups: **core** (four to six key technologies, with logos) and **AI engineering focus** (plain text — several are concepts, not products) |
| Secondary | Listed as plain text only, in a collapsed "other technologies and tools" list                                                                                        |

The point is that a task tracker never looks as important as the database or the main language.

### Describing work on a shared product

When a project is a product built by a team, describe the public product and the person's role over time. Do not present team achievements as personal ones. Client and employer work is described through public product information, roles and technologies; internal use cases and implementation details are excluded.

## Entities of the AI roadmap

Delivered in phase 4 (issue #109): schema `ai_roadmap` in `packages/db`, contracts in `packages/contracts`, the routes in `apps/api/AGENTS.md`. Areas, modules and resources are public content, read as one tree by `GET /v1/roadmap` and written only through private routes. Issue #110 adds the reads of one area or module at its nested address and the current learning (the areas and modules whose derived status is `in-progress`, which the homepage's Exploring shows); both are cut from the same tree with the same progress rules. A module read under an area it does not belong to does not exist. Issue #111 adds the learning diary below, #112 the bookshelf and #113 the attended events.

| Entity   | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Area     | A top-level part of the roadmap: name, Markdown description, a weight from 1 to 100 (the recommended share of learning effort) and a chosen position. Its slug is its address under `/ai-roadmap/`, so the slugs of the roadmap's own pages (`diary`, `bookshelf`, `events`, `how-to-read-effectively`) are refused. An area with modules cannot be deleted.                                                                                                                                                          |
| Module   | An ordered group of resources in exactly one area: name, Markdown description and a chosen position. It can move to another area. A module with resources cannot be deleted.                                                                                                                                                                                                                                                                                                                                          |
| Resource | One thing to learn from in exactly one module: name, Markdown description, type (`youtube-video`, `youtube-playlist`, `google-drive`, `video`, `link`, `text`, `project`, `book`), status (`planned`, `in-progress`, `completed`, `paused`, `skipped`), an optional estimate in minutes, optional start and finish (the finish never before the start), an optional `http`/`https` link, a chosen position and existing topics in a chosen order. It can move to another module; deleting it removes its topic links. |

Every level is ordered by position, then slug; slugs are unique per kind of record. Parents are real foreign keys: deleting a parent that still has children, or a topic a resource links, is refused instead of losing history.

### Roadmap progress

Progress is derived from the resource statuses on every read and never stored ([decision 0019](decisions/0019-roadmap-progress-derived-on-read.md)). For a module, an area (all resources of its modules) and the whole roadmap:

- **Count.** `completed` is the number of completed resources and `total` the number of all resources. A skipped resource only enlarges the denominator; a paused one counts like a planned one.
- **Status of a module or area.** `planned` when it has no resources; `completed` when every resource is completed or skipped (so an all-skipped container is completed with `0/n`); `in-progress` when any resource is in progress; otherwise `planned`. A container is never `paused`.
- **Completion date.** A module's is the latest finish among its completed resources, only when it is completed and non-empty. An area's additionally needs at least one module and every module non-empty, so an area with an empty module can be completed without a date. Skipping never invents a date.
- **Last update.** The latest update time of the resources in it; `null` when empty.
- **Estimates.** The sum of the known estimates in minutes (a missing one counts as nothing); the roadmap's totals round them to whole hours.

Estimates and area weight are planned effort. They never stand in for logged time or completed work.

### Learning diary

The learning diary records what was studied when ([decision 0020](decisions/0020-learning-diary-prague-days.md)). It is public content like the rest of the roadmap, read through `GET /v1/roadmap/diary` and one day at a time, and written only through private routes (`apps/api/AGENTS.md`).

| Entity     | Meaning                                                                                                                                                                                                                                                                   |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Diary day  | One Europe/Prague calendar date with optional Markdown notes; at most one per date. A day exists in the diary when it has notes or time entries, or when an event's dates cover it. Deleting the notes keeps its time entries.                                            |
| Time entry | One logged interval on exactly one target, a roadmap resource (study time) or an event (attendance), with absolute start and end instants in whole seconds, the end after the start, lying within one diary day. A resource or event with time entries cannot be deleted. |

- **Prague days.** A time entry belongs to the Prague calendar date of its start, whatever the server's or browser's timezone. Inputs carry `Z` or an offset, so a repeated local hour in autumn is unambiguous. The original application grouped by the UTC date of the start; this is an intended correction (`docs/decisions/0020-learning-diary-prague-days.md`): a session starting between 00:00 and 01:00 Prague time (02:00 in summer) now lands on the next day, its Prague date, instead of the previous one. Evening sessions keep their day.
- **Splitting.** A session across Prague midnight is split into one time entry per affected day without changing its elapsed time, and is written whole or not at all; 23:30–00:30 without an offset change gives 30 minutes to each day. An edit follows the same rule and changes both the old and the new days; notes stay.
- **No overlap.** No two time entries overlap, whatever their targets, resources and events alike; adjacent intervals are allowed. The database refuses an overlap at the write itself, so of two concurrent overlapping writes one loses. Attendance on an event is a time entry in the same table under the same constraint, not a separate check.
- **Durations.** A duration is the actual elapsed time between the endpoints, so a day with a daylight-saving change counts the real hours. Durations and a day's total are derived on every read, summed before any display rounding, and never stored.
- **Seed identity.** A diary day is identified by its date, a seed session by its target (resource or event) and absolute endpoints; a rerun adds nothing (`packages/db/seed/README.md`).
- Statistics over logged time are described under Learning statistics; the diary-entry skill belongs to a later issue.

### Bookshelf

Issue #112 adds the bookshelf: the books read for the roadmap, public content read through `GET /v1/roadmap/books` and one book at a time, and written only through private routes (`apps/api/AGENTS.md`).

| Entity | Meaning                                                                                                                                                                                                                                                                                                                                                                                |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Book   | A book on the shelf: slug, title, optional author, Markdown description, pages, year, ISBN, Markdown summary, an optional cover image from the media library, a non-negative priority (shelf order, ascending, then slug) and optional start and end calendar dates, the end never before the start. A book a resource links cannot be deleted; deleting a book keeps its cover media. |

- **Status.** Derived on every read and never stored: `completed` when the end date is set, otherwise `reading` when the start date is set, otherwise `to-read`.
- **The resource points to the book.** A resource of type `book` may link one book; each book is linked by at most one resource, and only a resource of type `book` can link one. The book stores nothing about its resource, so there are no circular links.
- **Reading time.** A book has no time ledger of its own. Its reading time is the sum of the time entries logged on the resource that links it, counted once whatever the resource's topics, so it equals the diary's totals for that resource; a book without a linking resource has none.
- **Covers.** A cover is an uploaded image in the media library; media in use as a cover cannot be deleted. Covers are never loaded from a publisher at render time; a seed supplies them as local files (`packages/db/seed/README.md`).

### Events

Issue #113 adds the attended events: conferences, meetups, workshops and lectures, public content read through `GET /v1/roadmap/events` and one event at a time, and written only through private routes (`apps/api/AGENTS.md`).

| Entity | Meaning                                                                                                                                                                                                                                                                                                                                                             |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Event  | An attended event: slug, name, kind (`conference`, `meetup`, `workshop`, `lecture`), optional organizer, inclusive start and end Europe/Prague calendar dates (equal for a single day, the end never before the start), an optional place, whether it was online, an optional `http`/`https` link, Markdown takeaways and existing shared topics in a chosen order. |

- **Not a resource.** An event belongs to no module and never appears in the roadmap tree, its progress, the current learning or the homepage's Exploring. Shared topics connect it with other content; the topic links never duplicate its time.
- **Dates add no time.** An event shows on every Prague calendar day of its range in the diary, also on days without notes or time entries. Those days are derived from the dates on every read and never stored, so moving or deleting an event changes its old and new days with no artificial notes or entries left behind.
- **Attendance.** Time spent at an event is a time entry whose target is the event, logged through the same operation as study time with the same midnight splitting, elapsed-time and overlap rules. Every piece must fall on a day of the event. An event's attendance time is the sum of those entries alone.
- **Date edits and deletion keep history.** New dates that would leave logged attendance outside the event are refused, naming those days, and nothing changes; the edit is judged while the event is locked, so a concurrent attendance write cannot slip past it. An event with attendance cannot be deleted; move or delete that time first.
- Event attendance appears in the learning statistics as its own category, never inside an area or module.

### Learning statistics

Issue #114 adds the learning statistics: a public, read-only view over the diary's time entries, read through `GET /v1/roadmap/statistics` (`apps/api/AGENTS.md`). Nothing is stored for them; PostgreSQL aggregates every view on each read in one consistent snapshot.

- **Three categories, exactly once.** Every time entry is classified once: a resource of type `book` (book time), any other resource (resource time) or an event (attendance). A book adds no second duration, and topics or other links are never joined into the sums, so they cannot multiply an entry. In every period the three categories sum to the total.
- **Prague periods.** Days are the diary's Europe/Prague days, weeks start on Monday and months are Prague calendar months. Because a session is already split at each Prague midnight, an interval crossing a period boundary contributes only its time within each period, and a daylight-saving day keeps its actual duration. Days list only those with time; weeks and months are listed without gaps from the first to the last with time, quiet ones as zero. A day's total equals the diary's total for it.
- **Areas and modules.** Area and module totals hold resource and book time through each resource's current module, so moving a resource moves all its logged time from the old module to the new one without losing or repeating any. Event attendance is never part of an area or module; it is shown separately.
- **Whole seconds.** Every value is summed in whole seconds before any display rounding; rounding is the reader's job. An empty diary gives zero totals and empty lists.

### Supporting content

Issue #115 adds the roadmap's supporting content: project ideas, followed sources ("stay current") and glossary terms ("additional terms"). Each is public content read as one ordered list (`GET /v1/roadmap/project-ideas`, `/followed-sources`, `/glossary-terms`) or one record by slug, and written only through private routes (`apps/api/AGENTS.md`).

| Entity          | Meaning                                                                                                                                                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Project idea    | A suggested practice project: slug, title, Markdown "why it matters", optional Markdown "how to start", existing shared topics in a chosen order and a position. |
| Followed source | A source followed to stay current: slug, title, optional Markdown description, optional `http`/`https` link, free-text kind and a position.                      |
| Glossary term   | An additional term: slug, term, Markdown description and a position.                                                                                             |

- **Beside the roadmap, not in it.** None belongs to an area or module, adds time or changes progress. Lists are ordered by position, then slug; an empty list is valid.
- **Slugs.** The PRD lists no slug for these entities; each has a stable, unique slug for seed identity, the website's anchors and later references (the phase-6 knowledge index and phase-7 chat citations can name a record by its kind and slug). The slug cannot change.
- **Nothing references them.** A delete is refused only when the record is missing; a project idea's topic links are deleted with it and its topics are kept. A topic linked to a project idea cannot be deleted.
- The FAQ and the guide on reading effectively are static website text, not records.

### Launch import and later phases

- **Launch import.** The owner's existing roadmap data is imported once through the seed format and command; the interface and the acceptance checklist (counts, relationships, elapsed totals, midnight splits, Prague regrouping, reruns) are in `packages/db/seed/README.md`. The mapper, the owner's data and the import itself stay outside the repository; there is no synchronization or reconciliation.
- **Phase 5 (admin MCP and the diary-entry replacement).** Every roadmap write the admin MCP server needs already exists as a private, API-key-protected route with an OpenAPI operation and a generated client method: areas, modules, resources, books, events, diary notes, time entries and the supporting content. Recording a diary entry is `PATCH /v1/roadmap/diary/{date}` (its notes) plus `POST /v1/roadmap/time-entries` per session; the API splits a session at Prague midnight itself.
- **Phases 6 and 7 (knowledge and chat).** The public reads are the source targets: the roadmap tree, each area, module and resource, the diary and each day, the statistics, the bookshelf and each book, the events and each event, and the three supporting lists, every record addressed by its slug (a diary day by its date). The website's sitemap, `llms.txt`, structured data and Open Graph output are built from these same reads; the API has no separate discovery route.

## Access

Profile and AI Roadmap records are public content shown on the site, without per-record visibility flags. This does not make authentication, audit, visitor conversations or ingest staging public. Extra documents may enrich public answers after approval without becoming website pages or public downloads.

- The API has **public** routes (read, no authentication) and **private** routes (protected by an API key). Every write is a private route.
- A per-record private flag is added only when a real use case appears and only where it is needed; the learning diary's notes are public, like every roadmap record.
- Do not put confidential information in public profile/roadmap records. Knowledge staging and source metadata are separate private operational data; only approved passage projections enter public search. Source originals stay in private Bunny/local storage.
- API facts take precedence over extra documents. Extra material supplements explanations and context; identified contradictions are held for owner resolution.
- Extra knowledge is limited to owner-supplied Markdown, TXT and text-layer PDF in the first version. Local sensitivity checks and owner approval of an exact version precede public indexing; no external websites are crawled.
- Knowledge about Petr is separate from visitor conversation history. There is one conversation per anonymous browser identity, restored on `/ask`, without a session picker or cross-device identity.
- Admin MCP and private content-write routes are reachable only internally or through an authenticated SSH tunnel, with API authentication still required. The scoped visitor-conversation exception remains public.

## Services

Three services:

1. **Process automation & integrations** — connect what the client already has.
2. **Custom software & internal tools** — build what is missing.
3. **AI integration & internal AI tools** — add AI where it actually makes sense.

Consulting and training is not a service of its own; advice is part of each of the three. The site states openly what is long-standing practice (software engineering) and what is a newer focus (the AI offering). It does not list what is not offered, and it states no guarantees or SLAs.

## Language

The site is in English only. The schema must not make a second language a rewrite later.
