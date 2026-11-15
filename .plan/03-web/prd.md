# Phase 3 — Website

| | |
|---|---|
| Status | Draft, awaiting approval |
| Date | 2026-11-15 |
| Parent | `.plan/00-overview/prd.md` |
| Depends on | Phase 2 |
| Result | The public website: all presentation pages, the CV, and a chat that works end to end on mock answers |

## Problem Statement

The backend holds Petr's profile, but nobody can see it. A client still cannot find out what he offers, a recruiter cannot judge his seniority, and a technical evaluator cannot see how he works. The current site answers none of these and presents him as something he no longer is.

## Solution

A website that turns the profile into a short, convincing story for two audiences at once:

- a homepage that says within half a minute who he is and offers two paths — work with me, view my experience;
- an Experience page that tells the career as a story with evidence;
- a Services page with three concrete offers;
- a CV page and a downloadable PDF;
- a chat that answers questions about him and shows its sources — in this phase on prepared answers, with the full flow in place.

Everything is rendered from the API, so a content change appears without a deploy.

## User Stories

### Client

1. As a client, I want to understand from the hero who Petr is and what he does, so that I can decide in seconds whether to read on.
2. As a client, I want a primary "Work with me" action, so that my path is obvious.
3. As a client, I want three clearly described services, each saying who it is for and what I get, so that I know what I can order.
4. As a client, I want each service linked to real work that proves it, so that I can trust the claim.
5. As a client, I want to know how working with him runs, so that I know what to expect before I write.
6. As a client, I want an honest statement of what is long practice and what is newer, so that I can judge the risk.
7. As a client, I want to reach contact details from any page in one click, so that writing to him is effortless.

### Recruiter and hiring manager

8. As a recruiter, I want a "View my experience" link in the hero, so that I reach the career view in one click.
9. As a recruiter, I want a timeline with organizations, roles, dates and kinds of engagement, so that I understand the career and what ran in parallel.
10. As a recruiter, I want to download the CV as a PDF from the homepage and the Experience page, so that I can forward it.
11. As a recruiter, I want to see when the PDF was last updated, so that I know whether the site is newer.
12. As a recruiter, I want core technologies to stand out and the rest to stay out of the way, so that I see strengths rather than a list.
13. As a hiring manager, I want to see what he is working on and what he is exploring, kept apart, so that I do not mistake study for sold expertise.

### Technical evaluator

14. As a technical evaluator, I want to expand a case study inside an experience, so that I can read the problem, his role and the solution without leaving the page.
15. As a technical evaluator, I want independent R&D listed with honest statuses, so that I can tell what was built from what was only tried.
16. As a technical evaluator, I want a link to the repository from every page, so that I can see how the site is built.

### Chat

17. As a visitor, I want to type a question in the hero and land in a conversation where it is already being answered, so that I never type it twice.
18. As a visitor, I want suggested questions that fit why I came, so that I can start without thinking.
19. As a visitor, I want every answer to show its sources as links into the site, so that I can verify it.
20. As a visitor, I want the assistant to say when the profile does not support a claim, so that I am not misled.
21. As a visitor, I want it to be clear that this is an assistant over Petr's data and not Petr, so that I know what I am talking to.
22. As a visitor, I want to start a new conversation easily.

### Everyone

23. As a visitor on a phone, I want every page to work at a narrow width with no sideways scrolling, so that I can read it anywhere.
24. As a visitor, I want light and dark mode following my system, with a switch, so that the site is comfortable to read.
25. As a visitor using a keyboard or a screen reader, I want to reach and understand everything, so that the site is usable for me.
26. As a visitor, I want pages to load fast, so that I do not leave before they appear.
27. As someone who received a link to a specific experience, I want it to open at that item.

### Search engines and AI agents

28. As a search engine, I want correct titles, descriptions, a sitemap and structured data, so that I can index the site properly.
29. As an AI agent, I want an `llms.txt` generated from the profile, so that I can read the site's content in a form made for me.
30. As someone sharing a link, I want a proper preview image and text.

### Owner

31. As the owner, I want a content change made through the API to appear on the site within seconds, so that I never deploy to fix a text.
32. As the owner, I want privacy-friendly analytics without a consent banner, so that I see how the site is used without bothering visitors.
33. As the owner, I want the chat UI built against the interface the real backend will implement, so that phase 7 replaces the mock without redoing the UI.

## Implementation Decisions
### Pages

| Address | Page | In navigation |
|---|---|---|
| `/` | Homepage with the chat line in the hero | Name / logo |
| `/experience` | Career timeline with projects and inline case studies, independent R&D, technologies, education, CV download | Yes |
| `/services` | What a client can order | Yes |
| `/ai-roadmap` | From phase 4 | Yes |
| `/ask` | The chat | Button |
| `/cv` | Print-friendly CV and PDF download | No — reached from Experience and the homepage |

- There is **no separate projects listing**. Projects are shown inside the experiences they belong to. The data model is unchanged: a project stays an entity linked to an experience.
- There is **no contact page**. "Contact" in the navigation leads to the contact block `/#contact` on the homepage, from every page.
- Technologies have no page of their own.

### Navigation

```
Petr Šebela        Experience   Services   AI Roadmap   Contact      [Ask AI]  [theme]
```

- "Ask AI" is a button on the right and leads to `/ask`.
- Light / dark toggle in the header.
- Mobile: name, Ask AI and a menu that opens full screen.
- Footer on every page: © line, "Built in public with an agentic engineering workflow →" linking to the repository, link to the CV.

### Chat flow

- The hero contains one input line with at most two or three suggested questions below it. Clicking a suggestion submits it.
- Submitting creates a conversation and redirects to `/ask?c=<id>`, where the chat continues as a normal conversation.
- The identifier in the address is random and unguessable. It identifies the conversation; it does not authorise anything.
- Authorisation is an anonymous visitor cookie (HttpOnly, Secure, SameSite). The server checks on every request that the conversation belongs to the visitor holding the cookie.
- Someone else opening the link does not see the history; they get a new, empty chat.
- **Split between phases:** in this phase the whole flow works on mock answers and the conversation lives in the browser only. Server-side storage, the cookie, the ownership check and a retention period for visitors' questions are delivered in phase 7.
- The chat component talks to an interface that the real backend implements later, so phase 7 replaces the mock without touching the UI.

### Homepage

Order of sections and their content:

1. **Hero**
   - Headline: "Software engineer building AI systems, automation and modern software."
   - Sub-headline: "8 years building production software. Currently focused on AI engineering."
   - Years of experience refer to software development overall, not to a specific technology or to AI engineering.
   - Photo on the right (above the headline on mobile).
   - Asymmetric calls to action: **Work with me** as the primary button → `/services`; **View my experience →** as a text link → `/experience`.
   - The chat line with its label ("Ask anything about my work, experience or skills") and two or three suggested questions. The chat is part of the hero, not a section of its own.
2. **What I do** — three columns: Software systems · Integrations & automation · AI engineering. One sentence each.
3. **Selected work** — the projects marked as selected in the data; three to start (from Paldock, PumpYourSound and GearForce), a fourth only if it is genuinely strong. Numbered editorial rows, not cards. Each is a case-study teaser: problem → role → result, with period and technologies. Each links to its item on `/experience`. Link below: "View full experience →".
4. **Experience** — a compact snapshot: one short paragraph, primary technologies as two lines of text (core, AI engineering focus). Links: "Full experience →" and "Download CV ↓".
5. **Now** — an editorial split: **Working on** (what is being built) and **Exploring** (what is being learned, from the AI Roadmap). Links to the independent R&D block and to the AI Roadmap. The split matters: what is being studied is not presented as sold expertise.
6. **Services** — the three services, one sentence each, link "All services →". Placed after the evidence on purpose.
7. **Contact** (`#contact`) — a closing prompt, email, LinkedIn, GitHub, one button.
8. **Footer.**

Layout rule: the sections are not equally tall and are not separated by hard horizontal lines. The hero gets a lot of space, Selected work is the most prominent block, Experience is compact, Now is a split, Services are plain. Recorded in `docs/design.md`.

### Independent R&D

Not a page and not a large section. A short block at the end of `/experience`, below the timeline; the homepage links to it from the Now section.

### Experience page

The page answers one question: what did Petr actually do in his career, and which parts of it prove his abilities. It is a career story with evidence, not a CV on a web page.

Order: **header → career timeline → independent R&D → technologies → education**. Independent R&D comes before technologies because, for AI engineering roles, things built and tested are stronger evidence than a list of tools.

- **Header:** title; summary "8 years building production software — from backend development and team leadership to a growing focus on AI engineering."; "Download CV ↓". The wording must not suggest eight years of AI engineering.
- **Career timeline:** years on the left, content on the right.
  - Current experiences are written out: organization, title, kind as a small label (main job, own business, side project), the product and the role's progression, selected technical work, technologies.
  - The kind labels exist so that concurrent experiences do not read as three full-time jobs at once.
  - A project is shown inside an experience **only when it proves something** — a concrete problem, the role, technical depth. Not everything that was touched is listed.
  - A case study opens **inline**: "View technical case study ↓" expands the detail inside the experience. No separate page in this phase; a strong case can get its own address later.
  - A client testimonial sits with the experience it belongs to — quote, name, role, organization. There is no testimonials section.
  - Older experiences are one line each and can be expanded.
  - Small client and side work is **its own row** in the timeline, not nested under an employer: "2020–2022 · Selected client & side work · SousedOnline · Currys · MopedAuto · View 3 projects ↓".
- **Independent R&D:** a few rows, each with name, status, one sentence and the concepts involved. Statuses are shown as they are — built, tested, designed — because the difference between reading about something and having built it is the point. No detail pages.
- **Technologies:**
  - **Core:** four to six key technologies, visually prominent, with logos. No large cards.
  - **AI engineering focus:** plain text (for example LLMs, MCP, RAG, agents, evals). No logos — several of these are not products, and logos would be inconsistent. The name says it is a current specialisation, not eight years of core expertise.
  - "+ N other technologies & tools ↓" expands a plain-text list.
- **Education:** low on the page, compact editorial rows, no cards.
- **Anchors:** every experience has an anchor, so the homepage's Selected work links straight to an item on this page.
- Mobile: the year moves above the organization, the kind label below it.

Much of the wording for experiences comes from the current sebelapetr.cz, where it was already written with care; it is revised, not rewritten from scratch.

### Services page

Three services and how the work runs. The page should not read like a young agency that listed everything it could think of. Its message, in three lines:

> I can connect what you already have. I can build what you're missing. I can add AI where it actually makes sense.

- **Header:** title and one sentence: "I help companies connect their systems, automate processes and add AI to the software they already have."
- **Services** as numbered editorial rows, each with the same three parts — who it is for, what you get, evidence (links to items on `/experience`):

| # | Service | For | You get | Evidence |
|---|---|---|---|---|
| 01 | Process automation & integrations | Companies where much is done by hand or systems are poorly connected | Systems connected through APIs; a concrete workflow automated; data and document processing; reporting | PumpYourSound, GearForce |
| 02 | Custom software & internal tools | Companies that need software they cannot buy | Backend, database, internal tool or e-commerce, including deployment and operation | Paldock |
| 03 | AI integration & internal AI tools | Companies that want useful AI capabilities in an existing product or internal workflow | AI features integrated into existing software; assistants over company data and documents; retrieval / RAG and structured LLM workflows; prototypes that validate whether an AI use case actually works | Booky (R&D), AI Roadmap |

- Booky is labelled explicitly as R&D: it is not a paid client reference.
- **There is no fourth service.** Consulting and training is not offered as a service of its own — advising on what is and is not worth building is part of each of the three. "AI engineering advisory & workshops" may be added later, once there is evidence for it.
- **How I work** — four steps, worded so they do not read as a rigid process:
  1. **Understand the problem** — a short call to understand the process, the systems and the expected outcome.
  2. **Define the solution** — written scope, proposed approach, assumptions and estimate.
  3. **Build in small steps** — deliver incrementally, validate early and adjust when needed.
  4. **Handover & support** — documentation, deployment or hand-over, and an agreed support arrangement.
- No guarantees, warranty periods or SLAs are stated until the commercial model is defined.
- **Honesty line**, placed before the closing call to action, not hidden: software engineering is long-standing practice; the AI offering is newer and builds on eight years of production software.
- No price list, no form. The closing button leads to `/#contact`.

### CV

- **`/cv` page:** a single-column document assembled from the same data as the site (the CV endpoint of the API). Header with name, title and contacts; summary; experience; independent R&D in one line each; skills (core, AI engineering focus, other); education. Which experiences appear is controlled by the "appears in the CV" flag in the data, so the site can show more than the CV does.
- The page has a print stylesheet: site header and footer are hidden, and it always prints dark on white regardless of the theme.
- **The PDF is not generated.** It is a file the owner prepares by hand and uploads to object storage; "Download CV ↓" everywhere on the site serves that file. A CV needs manual control over page breaks and fit, which automatic rendering does not give.
- When the data changes, the owner updates the PDF himself. The page shows when the PDF was last updated, so a stale file is visible.
- Consequence for the data model (phase 2): uploads accept PDF as well as images, and the person record references the current CV file.
- A later convenience, not part of this phase: an agent skill that prints `/cv` to a draft PDF for the owner to adjust and upload.

### Ask page

The chat is the whole page. No sidebar, no dashboard.

- **Header:** "Ask my AI" and one sentence: it answers questions based on Petr's public experience, projects, services and learning activity.
- **It is an assistant over Petr's data, not a simulation of Petr.** It never speaks as him and is never called a digital twin.
- **Suggested questions** when the conversation is empty — four, one per kind of visitor; they disappear after the first message:
  - Hiring: "Would Petr fit an AI engineering role?"
  - Clients: "What could Petr automate for my company?"
  - Technical: "What are Petr's strongest engineering skills?"
  - General: "What is Petr working on now?"
- **Arriving from the homepage:** the question typed in the hero is already in the conversation and being answered. The visitor never types it twice.
- **Rich blocks.** Besides text, an answer can carry typed blocks that the website renders with its own components: `ContactCard`, `ExperienceCard`, `ServiceCard`, `ExplorationCard`, `RoadmapCard` (from phase 4) and `Sources`. A question about RAG gets the answer and, below it, the relevant work as a card; a question the profile cannot answer gets a short "I don't have that information" and the `ContactCard`. The components are built in this phase and fed by the mock, so phase 7 only has to send real blocks.
- **An answer has up to three parts:**
  - the answer itself, streamed;
  - **Sources** — links to the exact places on the site the answer rests on (an experience, a project, a technology group, an AI Roadmap item). Every answer has them where possible; this is what makes the chat trustworthy;
  - **Related** — at most one or two links onward (for example "View Petr's experience").
- **It says when it does not know.** If the public profile does not support a claim, the answer says so ("I don't have enough evidence in Petr's public profile to claim …") instead of guessing. This is a feature to show, not a failure to hide.
- **"New chat"** is a discreet control at the top. There is no list of past conversations in this version.
- **Under the input:** "Answers are generated from Petr's public profile and may be incomplete."
- **Not shown:** model selector, temperature, retrieval debug information, "powered by" labels, token counts, agent-thinking animations. How it works is documented in the repository.
- The address is `/ask`, matching the "Ask AI" wording.
- Mobile: the same layout full width, the input above the keyboard.

### Mock chat in this phase

- Prepared answers for the suggested questions, with sources, related links and at least one of each block type, kept as fixtures in the website. They include at least one "I don't know" answer, so that state is designed and tested too.
- Any other question gets a general reply that the assistant is not connected yet, with links to the main pages.
- Answers are streamed even in the mock, so the UI is built against real behaviour.
- The mock sits behind the interface the real backend implements in phase 7.
- The site launches only after all phases, so visitors never see the mock.

### Contact block

Not a page. A closing block on the homepage (`#contact`): a one-line prompt for both audiences ("Have a project or a role in mind?"), email, LinkedIn, GitHub, and one button that opens an email. "Contact" in the navigation leads here from every page.

### Rendering and data

- Pages render on the server at request time and are cached. The build needs no running API.
- **Cache invalidation:** after a successful write, the API calls a private address of the website that invalidates the affected pages. A content change is visible within seconds without a deploy. The attachment point in the API exists from phase 2.
- The website reads data only through the generated API client and only from public routes. It never holds an API key.
- Texts that are content (headline, bio, experience descriptions, services) come from the API. Section headings and button labels live in the website.

### Inline case study

A fixed structure: context → problem → my role → solution → result → technologies. The text is markdown from the database. It expands inside its experience and has an anchor.

### Cross-linking

| From | To |
|---|---|
| Homepage, Selected work | The item's anchor on `/experience` |
| A service's evidence | The item's anchor on `/experience` |
| Homepage, Now | The independent R&D block; the AI Roadmap |
| Sources in a chat answer | Anchors on `/experience`, `/services`, later the AI Roadmap |
| Homepage and Experience | The CV page and the PDF |
| Footer, every page | The repository; the CV |
| "Contact" in the navigation, closing buttons | `/#contact` |

Until phase 4 the AI Roadmap item in the navigation and its links are present but lead to a short placeholder; the Exploring column on the homepage is filled from profile data.

### Images

- Originals live in object storage. The website's framework produces the sizes and formats it needs.
- A CDN-side optimiser is reconsidered in phase 8 only if this is not enough.
- Logos of core technologies are static assets of the website.

### SEO and AI agents

- Titles and descriptions from data; an Open Graph image; sitemap; robots file; structured data for the person and the website, carried over from Road to AI and adapted.
- `llms.txt` generated from the profile.

### Analytics

- Umami Cloud: cookieless and GDPR-friendly, so no consent banner. The limits of its free plan are checked when it is set up in phase 8.
- The Smartlook and Google Analytics scripts of the current site are not carried over.

### Accessibility

Keyboard operation, sufficient contrast in both themes, alt text from the media records, respect for reduced-motion settings. Checked by an automated test on every page.

### Design system

- `docs/design.md` is binding and is completed in this phase: spacing and type scale, the components, the print layout of the CV, motion.
- Shared components and tokens live in the shared UI package; the website has no colours or fonts of its own.

### Environments

- The website gets a Dockerfile and a Compose service.
- `apps/web` and the shared UI package each get an `AGENTS.md`.
- Each worktree runs the website on its own port against its own API.

## Testing Decisions

- **Layout, typography and responsive polish** are accepted on the acceptance criteria of each issue, Playwright checks and screenshots at 360, 768 and 1280 px in light and dark mode, reviewed by the reviewer agent and then by the owner. A test before the markup is not required.
- **Test-first** applies to the logic in the website: mapping API data to what a page shows (which experiences are written out and which collapsed, what goes into the CV), the chat state (creating a conversation, carrying the first question over, streaming, the "I don't know" state), date and period formatting.
- **End-to-end tests** cover the paths that matter: hero → Services; hero → Experience → CV download; hero question → `/ask` with the question already answered; "Contact" from an inner page; a deep link to an experience anchor; the theme switch.
- **Every page** has an automated accessibility check and a check that there is no horizontal scroll at 360 px.
- **Cache invalidation** is tested end to end: a write through the API changes what the page shows.
- **The mock chat** is tested through the same interface the real backend will implement.
- Tests run against the demo seed's shape using small fixtures, not the demo seed itself.
- **Prior art:** `road-to-matrix` for the component style, SEO and structured data; phase 2 tests for the API side.

## Out of Scope

- Real LLM calls, server-side conversations, the visitor cookie and the ownership check, retention of visitors' questions (phase 7).
- AI Roadmap pages (phase 4).
- A projects listing page, a contact page, a contact form, separate case-study pages, a blog.
- Generating the CV PDF.
- A history of conversations.
- A second language.
- Production analytics set-up and deployment (phase 8).

## Further Notes

- **HITL issues in this phase:** the visual direction of the hero and of the Experience timeline is reviewed by the owner before the remaining pages are built on it, so that a wrong direction is caught once and not on every page.
- **Wording still to be settled with the owner:** the Paldock role title. Paldock content is limited to public product information, roles and technologies; internal use cases and implementation details are excluded.
- **Content:** much of the wording for experiences comes from the current sebelapetr.cz and is revised, not rewritten. Raw material is in `.context/profile-notes.md`.
