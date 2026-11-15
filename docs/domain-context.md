# Domain context

The vocabulary of this project. Use these terms in code, issues, PRDs and docs. This document grows with each phase.

## Purpose of the site

A hybrid personal professional site for Petr Šebela. It serves two audiences with one identity:

| Audience | Needs | Path |
|---|---|---|
| Client | What can be ordered and whether it fits their problem | Homepage → Services → Contact |
| Recruiter / hiring manager | Seniority, stack, recent work, CV | Homepage → Experience → CV |
| Technical evaluator | Depth and how the work is done | Projects, case studies, this repository |
| AI agent | Structured, trustworthy facts | Public MCP server |

Positioning: software engineer focused on AI systems, automation and modern software, available for selected projects and career opportunities.

The site answers, in order: who he is, what he can do, what he has built, what he is doing now, where he is heading, how to work with him.

## Names

- **AI Engineering Roadmap** — the learning part of the site. Short form: **AI Roadmap**. No other name is used ("AI Engineering Path" and "Road to AI" are retired).
- **Profile** — everything about the person and their work: the `profile` schema.
- **Demo seed** — the fictional data set shipped in the repository.
- **Private seed** — the owner's real data, kept outside the repository, used once.

## Entities of the profile domain

Draft; the exact schema is defined in the phase 2 PRD.

| Entity | Meaning |
|---|---|
| Person | The site owner: name, headline, short bio, location, contacts, availability, photo. One record |
| Organization | A company or client |
| Experience | A role at an organization over a period; its kind is main job, side project or own business |
| Project | Something delivered within an experience, described as problem → what was done → result; may be selected for the homepage |
| Case study | The long-form text for a project, including the person's role in it |
| Exploration | Independent R&D outside the timeline: unreleased side work and experiments |
| Service | Something a client can order: who it is for, what they get, and the evidence — projects, explorations, links |
| Technology | A tool or language; see tiers below |
| Topic | A shared subject (for example RAG, MCP, agents) that links the profile to the AI Roadmap |
| Education | Schools, courses, certifications, milestones |
| Testimonial | A quote from a client or colleague, shown with the experience it belongs to |
| Current focus | What is being built right now |
| Media | An uploaded file — an image or a PDF such as the CV: storage key, type, dimensions, alt text |

### Experience, project, exploration

These three are deliberately separate:

- An **experience** is a period in a role. It appears on the timeline and in the CV.
- A **project** is delivered work shown inside the experience it belongs to — and only when it proves something. A strong one gets a case study.
- An **exploration** was never released. It is not a project and not part of the CV timeline. Explorations are shown together as one short block that demonstrates initiative.

### Exploration status

Every exploration carries one of:

| Status | Meaning |
|---|---|
| Built | Implemented and working |
| Tested | Tried out or evaluated hands-on |
| Designed | Planned or architected only |

The website shows built and tested work. The status exists so that neither a page nor the chatbot ever presents designed work as built.

### Technology tiers

| Tier | Presentation |
|---|---|
| Primary | Shown prominently, in two groups: **core** (four to six key technologies, with logos) and **AI engineering focus** (plain text — several are concepts, not products) |
| Secondary | Listed as plain text only, in a collapsed "other technologies and tools" list |

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
