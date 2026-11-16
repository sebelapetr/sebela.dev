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

Draft; the exact schema is defined in the phase 2 PRD.

| Entity        | Meaning                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Person        | The site owner: name, headline, short bio, location, contacts, availability, photo. One record                                                                                                                                                                                                                                                                                                                                                                         |
| Organization  | A company or client: name, website, description. Experiences refer to it, so an organization cannot be deleted while one still does                                                                                                                                                                                                                                                                                                                                    |
| Experience    | A role at an organization over a period (no end for a current role); its kind is main job, side project or own business. It links technologies in a chosen order; a linked technology cannot be deleted                                                                                                                                                                                                                                                                |
| Project       | Something delivered within exactly one experience, described as problem → what was done → result, with a period, outside links and technologies in a chosen order; may be selected for the homepage. It can move to another experience but never be without one; an experience that owns a project cannot be deleted, and neither can a technology a project links or a project a service names as evidence. Its dates are not checked against the experience's period |
| Case study    | The long-form Markdown text for a project, including the person's role in it. A project has at most one, addressed through the project; a project with a case study cannot be deleted until the case study is                                                                                                                                                                                                                                                          |
| Exploration   | Independent R&D outside the timeline: unreleased side work and experiments, with a name, summary, status (built, tested or designed, see below), an ordered list of concepts, a period and a chosen position. It links technologies and topics in a chosen order, never an experience or a project; a linked technology or topic cannot be deleted, and neither can an exploration a service names as evidence                                                         |
| Service       | Something a client can order, with a name, summary, who it is for (audience), what they get (deliverable) and a chosen position. Its evidence is an ordered list of existing projects and explorations, each at most once, and links to paths within the site (never another host or scheme); deleting a service removes only its evidence                                                                                                                             |
| Technology    | A tool or language; see tiers below                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Topic         | A shared subject (for example RAG, MCP, agents) that links the profile to the AI Roadmap                                                                                                                                                                                                                                                                                                                                                                               |
| Education     | Schools, courses, certifications, milestones                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Testimonial   | A quote from a client or colleague, shown with the experience it belongs to                                                                                                                                                                                                                                                                                                                                                                                            |
| Current focus | What is being built right now                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Media         | An uploaded file — an image or a PDF such as the CV: storage key, type, dimensions, alt text                                                                                                                                                                                                                                                                                                                                                                           |

### Experience, project, exploration

These three are deliberately separate:

- An **experience** is a period in a role. It appears on the timeline and in the CV.
  Experiences have no manual position. They are ordered current roles first (no end date), then by latest start, latest end and slug.
- A **project** is delivered work shown inside the experience it belongs to — and only when it proves something. A strong one gets a case study.
- An **exploration** was never released. It is not a delivered project or a career experience. Explorations are shown together as one short block that demonstrates initiative on the Experience page, and concisely in a separate section on the print-friendly CV page, with their actual status preserved. They are not inserted into the career timeline. The downloadable PDF is maintained manually and is not generated from this data.

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
