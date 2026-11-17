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
| Person        | The site owner: name, headline, short bio, location, contacts, availability, a photo and the current CV PDF, both media. One record                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Organization  | A company or client: name, website, description and an optional logo (an image media). Experiences refer to it, so an organization cannot be deleted while one still does                                                                                                                                                                                                                                                                                                                                                                                                     |
| Experience    | A role at an organization over a period (no end for a current role); its kind is main job, side project or own business. It links technologies in a chosen order; a linked technology cannot be deleted                                                                                                                                                                                                                                                                                                                                                                       |
| Project       | Something delivered within exactly one experience, described as problem → what was done → result, with a period, outside links, an optional cover (an image media) and technologies in a chosen order; may be selected for the homepage. It can move to another experience but never be without one; an experience that owns a project cannot be deleted, and neither can a technology a project links or a project a service names as evidence. Its dates are not checked against the experience's period. A project a current-focus entry is about cannot be deleted either |
| Case study    | The long-form Markdown text for a project, including the person's role in it. A project has at most one, addressed through the project; a project with a case study cannot be deleted until the case study is                                                                                                                                                                                                                                                                                                                                                                 |
| Exploration   | Independent R&D outside the timeline: unreleased side work and experiments, with a name, summary, status (built, tested or designed, see below), an ordered list of concepts, a period and a chosen position. It links technologies and topics in a chosen order, never an experience or a project; a linked technology or topic cannot be deleted, and neither can an exploration a service names as evidence                                                                                                                                                                |
| Service       | Something a client can order, with a name, summary, who it is for (audience), what they get (deliverable) and a chosen position. Its evidence is an ordered list of existing projects and explorations, each at most once, and links to paths within the site (never another host or scheme); deleting a service removes only its evidence                                                                                                                                                                                                                                    |
| Technology    | A tool or language; see tiers below                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Topic         | A shared subject (for example RAG, MCP, agents) that links the profile to the AI Roadmap; a topic a current-focus entry links cannot be deleted                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Education     | A school, course, certification or other learning milestone, with a kind (`school`, `course`, `certification` or `milestone`), a title, an optional institution and description, a period and a chosen position; listed by position, then slug. The period need not look like a school year: at least one date is set, a start alone means the learning is ongoing, an end alone means it was completed on that day, and the end is never before the start. The same rule applies to every kind. Nothing refers to an education record                                        |
| Testimonial   | A quote from a client or colleague, with the author's name and role, belonging to exactly one experience and shown with it beside its projects, by a chosen position, then slug. It can move to another experience but never be without one; an experience with a testimonial cannot be deleted. Nothing refers to a testimonial                                                                                                                                                                                                                                              |
| Current focus | Work or learning the person is focused on now, with a title, a Markdown description, an optional outside link and a chosen position (ordered by position, then slug). It may be about one existing project and links existing topics in a chosen order; neither is required. A project or topic a focus entry links cannot be deleted. Nothing refers to a focus entry                                                                                                                                                                                                        |
| Media         | An uploaded file — a PNG, JPEG or WebP image or a PDF — with its storage key, the type its content proved, byte size, image dimensions and alt text. The person's photo, an organization's logo and a project's cover refer to an image; the person's current CV PDF refers to a PDF. Media that a record refers to cannot be deleted. The current CV PDF is uploaded as prepared, never generated                                                                                                                                                                            |

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

## Access

There is no visibility model. Everything stored in the database is public content and is shown on the site; nothing is marked private.

- The API has **public** routes (read, no authentication) and **private** routes (protected by an API key). Every write is a private route.
- A per-record private flag is added only when a real use case appears — for example personal notes in the learning diary — and only where it is needed.
- Until then, do not store anything in the database that must not be public.

## Services

Three services:

1. **Process automation & integrations** — connect what the client already has.
2. **Custom software & internal tools** — build what is missing.
3. **AI integration & internal AI tools** — add AI where it actually makes sense.

Consulting and training is not a service of its own; advice is part of each of the three. The site states openly what is long-standing practice (software engineering) and what is a newer focus (the AI offering). It does not list what is not offered, and it states no guarantees or SLAs.

## Language

The site is in English only. The schema must not make a second language a rewrite later.
