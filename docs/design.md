# Design

The visual language of the site. The direction, tokens, type and spacing scales, focus, motion and the hero below are decided; the remaining components and page layouts are defined during phase 3.

## Direction

Premium technical, editorial, engineering-lab. Strong typography, generous whitespace, content before decoration. The site should read like a well-set document written by an engineer, not like a product landing page.

## What to avoid

- Gradients, glows, decorative colour
- Walls of rounded cards
- A greeting with a waving hand
- A generic SaaS landing page look
- A hacker-terminal look
- A huge flat list of technologies

## Colour

Black, white and neutral greys only. Colour is reserved for status. There is no brand accent colour.

| Token              | Light     | Dark      |
| ------------------ | --------- | --------- |
| background         | `#ffffff` | `#000000` |
| foreground         | `#0a0a0a` | `#ededed` |
| card               | `#f5f5f5` | `#0a0a0a` |
| primary            | `#0a0a0a` | `#ffffff` |
| primary-foreground | `#ffffff` | `#000000` |
| secondary / muted  | `#e5e5e5` | `#1a1a1a` |
| muted-foreground   | `#525252` | `#a3a3a3` |
| border / input     | `#d4d4d4` | `#262626` |
| success            | `#10b981` | `#10b981` |
| warning            | `#f59e0b` | `#f59e0b` |
| destructive        | `#ef4444` | `#ef4444` |

Only these two sets exist. Tokens are defined once in the shared UI package (`packages/ui/src/styles/globals.css`, exported as `@sebela/ui/globals.css`) and consumed through Tailwind; components never use raw colour values.

## Themes

Light and dark, following the system preference by default, with a toggle in the header.

- **Choice.** The toggle is a button named "Dark theme", pressed while dark shows (`aria-pressed`); its icon is a moon in light and a sun in dark. Pressing it stores the visitor's explicit choice in `localStorage` (`sebela-theme`); from then on the choice wins over the system on every page and after a reload. Without a choice the site follows the system, also when it changes while the page is open.
- **No flash.** An inline script at the top of `<head>` reads the stored choice and sets `data-theme` on `<html>` before anything is painted. The dark tokens apply under `prefers-color-scheme: dark` unless `data-theme="light"`, and always under `data-theme="dark"`; Tailwind's `dark:` variant follows the same rule. The server renders no theme, so nothing mismatches on hydration.
- **No storage.** When the browser refuses storage, the toggle still switches the page and the choice lasts until the next page load.
- **Print** is always light.

## Typography

- Geist for text and headings, Geist Mono for code and small labels.
- Hierarchy comes from size and weight, not from colour. Secondary text uses `muted-foreground`; that is the only colour step.
- The scale is recorded with #43. Each step is one utility in `@sebela/ui/globals.css`; pages use the utility, not a hand-picked size. Sizes are mobile → from `sm` (640 px).

| Step    | Utility        | Size (line height)               | Weight, tracking         | Use                                                                                                           |
| ------- | -------------- | -------------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Display | `type-display` | 36 px (40) → 48 px (48)          | semibold, tight, balance | The hero headline; one per page at most.                                                                      |
| Title   | `type-title`   | 30 px (36) → 36 px (40)          | semibold, tight, balance | The heading of a page without a hero (content states, inner pages).                                           |
| Heading | `type-heading` | 24 px (32) → 30 px (36)          | semibold, tight          | Section headings (h2).                                                                                        |
| Item    | `type-item`    | 18 px (28) → 20 px (28)          | semibold, tight, pretty  | The title of one item in a list, such as a role on the timeline (h2).                                         |
| Lead    | `type-lead`    | 18 px, relaxed (1.625), max 65ch | regular, muted           | Introductory prose under a display or title line.                                                             |
| Intro   | `type-intro`   | 18 px (28)                       | regular, muted           | One short sentence that opens a block: contact, content states.                                               |
| Body    | (default)      | 16 px (24)                       | regular                  | Running text.                                                                                                 |
| Small   | `text-sm`      | 14 px (20)                       | medium for links         | Text links in action rows and lists, the footer, a quote's caption.                                           |
| Label   | `type-label`   | 14 px (20), Geist Mono           | regular, tight, muted    | A short label above a heading, such as the name in the hero; a timeline period; a plain list of technologies. |
| Tag     | `type-tag`     | 12 px (16)                       | medium                   | A small bordered tag beside a label, such as an experience's kind.                                            |

- Readable line length: prose is kept to at most 65 characters (`type-lead` or `max-w-prose`); headings wrap balanced.

## Spacing

The 4 px scale of Tailwind (`--spacing`), used in these steps only: 2, 4, 6, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96 and 128 px. 2 px is only the vertical padding of inline code; 20 px is only the mobile page gutter and the side padding of a large button.

- **Page frame:** `layout-page` in `@sebela/ui/globals.css` — centred, at most 1024 px wide (`max-w-5xl`), side gutter 20 px on mobile and 32 px from `sm`. Every page, the footer and the content states use it, so their edges line up.
- **Page padding:** 48 px above and below on mobile, 80 px from `sm`.
- **Between page sections:** 96 px on mobile, 128 px from `md`. Sections are separated by space, never by rules (Rhythm).
- **Inside a block:** 24 px between its parts (heading, text, actions); 12 px between a label and the heading it belongs to; 12 px between stacked actions on mobile, 24 px beside each other.
- **Content states** (not found, content unavailable) are the one exception: a single centred block with 80 px above and below at every width, and 24 px between the label and the heading, like every other part of that block.
- **AI Roadmap placeholder.** Until phase 4 publishes the roadmap, `/ai-roadmap` uses the content states' frame (not indexed): "AI Roadmap" in `type-label`, "The AI Roadmap is not published yet.", one sentence that points to the independent R&D, then "Back to the homepage" (outline) and "View my experience →". No roadmap content, date or promise.
- **Hero columns:** 40 px between photo and text on mobile, 48 px from `md`, 64 px from `lg`.

## Components

- Tailwind CSS v4 and shadcn/ui in the `base-nova` style, built on Base UI.
- Icons from Lucide, 16 px beside text, hidden from assistive technology when the text says the same.
- Corner radius base `0.625rem`.
- Technologies: four to six core ones are shown prominently with logos (no large cards); the AI engineering focus and all secondary ones are plain text.
- **Actions are asymmetric.** One primary action per block, a solid `Button` (`buttonVariants`, size `lg`, 48 px). Every other action is a text link: `text-sm`, medium weight, underlined on hover and focus, with a trailing arrow when it leads to another page. Two solid buttons never stand side by side. The `outline` variant is used only for the single action of a content state that leads away rather than fixing anything (not found: "Back to the homepage"), where a solid button would overstate it.
- **Links in running text** are underlined at all times, in the text's own colour. The one exception is a contact address inside muted text, set in `foreground` so it stands out (the email in the contact block).
- **Touch targets:** every link and button outside running text is at least 44 px tall (`min-h-11`); text links get the height from padding, not from a larger font.
- **Photo:** the person's photo at its own aspect ratio with radius `xl` on a `muted` background; without a photo a placeholder of the same 4:5 shape with the initials in Geist Mono. Widths 160, 192, 224 and 320 px (mobile, `sm`, `md`, `lg`).
- **Cards** are not the default container. Content sits on the page background; `card` is for the rare block that must stand apart (Rhythm).

## Navigation

- **Header.** Every page starts with a sticky header (`--header-height`, 64 px, a bottom border, the page background): the name in semibold that leads home ("Home" on pages that read no profile: placeholders and not found), the navigation (Experience, Services, AI Roadmap, Contact) in `text-sm` muted, "Ask AI" as the one solid button (`/ask`), and the theme toggle. The current page's entry is `foreground` and underlined, with `aria-current="page"`; Contact leads to the homepage's contact block and is never current. The header is not printed.
- **Mobile menu.** Below `md` (768 px) the header shows the name, "Ask AI" and a "Menu" button. The menu opens full screen as a modal dialog: the same top row with "Close menu", then the items stacked in `type-heading`, lined up with the name, and the toggle with its label. Escape and "Close menu" close it and return focus to "Menu"; Tab stays inside it; the page behind does not scroll; following a link or reaching the desktop width closes it.
- **Skip link.** "Skip to content" is the first focusable element of every page; it shows at the top left when focused and moves focus to `<main id="main-content">`.

## Focus

- Every focusable element shows focus when reached by keyboard (`:focus-visible`), never on mouse click.
- Default treatment, set once in `@sebela/ui/globals.css`: a solid 2 px outline in the `ring` colour (the foreground colour of the theme), offset by 2 px. Text links also underline.
- Buttons and inputs from `@sebela/ui` draw their own 3 px ring in `ring` at 50 % instead, with the border in `ring`, and turn the outline off.
- Focus is never removed without a replacement; the order of focus follows the reading order. One known gap: in forced-colours mode a button's own ring is not drawn and its outline is off, so focus on buttons is not visible there. It is tracked as the `Follow-up:` comment on issue #43.

## Motion

- Motion is functional and short: colour, opacity and the 1 px press of a button, at most 150 ms. No entrance animations, parallax, scroll-triggered effects or looping motion.
- With `prefers-reduced-motion: reduce`, `@sebela/ui/globals.css` ends every transition and animation at once and keeps scrolling instant. Nothing on the site may depend on motion to be understood.

## Hero

The owner kept the hero's direction (#43): simple and sharp. Typography, photo treatment, actions and spacing stay as built; later pages repeat these choices instead of inventing new ones. The owner's visual approval is recorded on #43.

- **Order (mobile):** photo, name label, headline (`type-display`), short bio (`type-lead`), the chat entry, then the actions. **From `md`:** the text column on the left, the photo on the right, vertically centred.
- **Actions:** "Work with me" as the primary button, "View my experience →" as a text link beside it (stacked below it on mobile).
- **Chat entry:** between the short bio and the actions — one input line with its submit and one row of suggested questions below it (`.plan/03-web/prd.md`, Chat flow), 104 px tall at every width: a 48 px input line, 12 px of space and a 44 px row of suggestions, with the hero's 24 px above and below. The input (`@sebela/ui` `Input`, 16 px text so phones do not zoom) has an `sr-only` label, "Ask anything about my work, experience or skills", and a shorter placeholder that fits a phone. Its submit is an outline 48 px icon button ("Ask"), so "Work with me" stays the one primary button. The suggestions are ghost buttons on `muted` at 60 %, short labels of at most 20 characters (the full question is sent): two below `sm`, three from it, never wrapping to a second row. Submitting goes to the conversation on the Ask page; nothing else happens in the hero.

## Rhythm

Sections of a page are not equally tall and are not separated by hard horizontal lines. A wireframe shows structure, not proportions — do not reproduce its even boxes.

On the homepage: the hero gets a lot of space, Selected work is the most prominent block, Experience is compact, Now is an editorial split layout, Services are plain. Lists of work are numbered editorial rows, not cards.

The homepage's sections, in this order, 96/128 px apart: the hero, What I do, Selected work, Experience, Now, Services, Contact (`#contact`), then the footer. Each section is an `h2` (`type-heading`); a section without content is left out entirely, never shown empty or with filler.

**What I do** is three short columns from `sm` (stacked on mobile): Software systems, Integrations & automation, AI engineering, each a `type-item` name and one muted sentence. The sentences are the site's own copy and describe kinds of work only — no results, numbers or clients — and AI engineering reads as the current focus, never as a delivered track record.

**Selected work** sits between What I do and the experience snapshot and lists the projects selected for the homepage, in the API's order. Each row is separated by a 1 px top rule: the two-digit number in `type-label` (in a column of its own from `sm`), the name (`type-item`), the period, the problem, my role (only when the project has a case study), the result and the technologies, then a text link with an arrow to the exact item on `/experience`: "Read the case study" to the case study, else "View the project" to the project. "View full experience →" follows the list. Without a selected project the block is left out; no filler rows.

**Experience** is a compact snapshot within 768 px: one `type-intro` paragraph with the years of professional software development (from `careerStartedOn`, left out without it) and the roles held now (title in `foreground`, organization, kind), then the primary technologies as two plain lines of text — "Core" and "AI engineering focus", each label in `type-label` beside its line from `sm` — then "Full experience →" and the CV actions (CV page) in one row of text links. A part without content is left out; the heading and links stay.

**Now** is an editorial split from `md`, stacked on mobile: **Working on** (each current focus as a block with a 1 px left rule: its title in `type-item`, its Markdown description muted, its topics in `type-label`, and "View the project →" to the project on `/experience`, else "Read more ↗" to its own web link) beside **Exploring** (each ongoing exploration as a row between 1 px rules: its name linking to it on `/experience`, its stored status as a tag with its meaning, as on the experience page). Below them "Independent R&D →" (when any exploration exists) and "AI Roadmap →". What is being learned is never presented as delivered expertise. Each column is left out when empty; the section is left out when both are.

**Services** are plain numbered rows like Selected work but shorter: the number, the name linking to the service on `/services` and its one-sentence summary, then "All services →". Audience, deliverable and evidence stay on the services page. Without services the block is left out.

## Responsive

Mobile-first from the first component. Every UI change is checked at **360, 768 and 1280 px** in both themes. No horizontal scrolling at any width; touch targets at least 44 px.

## Timeline

One shared timeline (`@sebela/ui/components/timeline`) tells the career on `/experience` and will carry the AI Engineering Roadmap. It is monochrome and editorial: no cards, shadows or accent colour.

- **Page.** `/experience` uses the page frame and page padding (Spacing). Its heading block (name in `type-label`, "Experience" in `type-title`, the headline and length of career in `type-lead`, then the CV actions, see CV page), the timeline, then Independent R&D, Technologies and Education (Experience sections) are its sections, 96/128 px apart. The page has no primary button: the CV is a destination, not the block's action. Heading block and timeline stay within 768 px (`max-w-3xl`), left-aligned in the frame, so long entries keep a readable measure.
- **Rail and markers.** A dashed vertical rail on the left connects one round 32 px marker per item; the item's text starts 48 px from the timeline's left edge, 32 px right of the rail. The marker is a chevron that points right while the item is closed and down while it is open, switching at once (Motion: only colour moves); an open or hovered item draws its marker border and chevron in the foreground colour. A hovered heading row also gets a fill of `muted` at 60 % with radius `lg` and 8 px of side padding, reaching 8 px past the text on each side so the text does not move.
- **Item heading.** The whole heading row is one button that opens and closes the item. The period and the kind label sit above the title (`type-item`, the organization after it in regular weight, muted), never in a separate column. Like a button, the trigger draws its own 3 px focus ring instead of the outline (Focus).
- **Logo.** When the organization has a usable logo (an image from the API's media with a web address and dimensions), it sits on its own line at the top of the heading row, above the period, so closed rows can be scanned by it too. It keeps its own aspect ratio: 24 px tall on mobile and 32 px from `sm`, at most 128 / 160 px wide, aligned to the start of the line, with 8 px below it (the heading row's 4 px gap plus 4 px of its own). Its alt text is the media's alternative text. Without a logo, or when it cannot be shown or read, nothing takes its place (no placeholder, no broken image) and the text starts at the same position as in every other row. Images are served unoptimised until the media slice (#55), like the homepage photo.
- **Spacing.** 4 px between the period row and the title, 8 px between items, 12 px above an open item's content and 24 px below it, 24 px between its parts; the same steps as Spacing.
- **Period.** `type-label`: `October 1st, 2023 – July 10th, 2024` with correct ordinals and an en dash, `October 1st, 2023 – present` while ongoing, and a single date when an experience started and ended on the same day. Dates are calendar dates, never shifted by a time zone.
- **Kind label.** A small bordered label (`type-tag`) beside the period: `Full-time job`, `Own business`, `Side project` (the displayed labels of the kinds `main_job`, `own_business` and `side_project`). It exists so that concurrent experiences do not read as several full-time jobs. Client and side work keeps its own row and is never nested under an employer.
- **Expand policy.** Only current items (no end date) are open when the page loads; older ones are compact rows that open on click, Enter or Space. Closed content stays in the page (`hidden="until-found"`), so the browser's page search finds and opens it, and a closed item takes no extra space.
- **Content.** Summary (muted body text; its links follow Links in running text), responsibilities, technologies as plain text in `type-label`, the organization's website as a text link without an arrow (it leaves the site), and a testimonial as a quote with a left rule and a `text-sm` caption, only beside its own experience. Long content stays within `max-w-prose`.
- **Author photo.** When a testimonial's author has a usable photo (an image from the API's media with a web address and dimensions), it sits beside the quote, after it on the same line and aligned to its top, 16 px away: a circle of 40 px on mobile and 48 px from `sm`, cropped to fill it, on a `muted` background. Its alt text is the media's alternative text. Without a photo, or when it cannot be shown or read, nothing takes its place (no placeholder avatar, no broken image), so the quote starts at the same position with or without one. Served unoptimised until #55, like the logos.
- **Narrow screens.** The rail and markers stay; on narrow screens the kind label wraps below the period and the period balances its lines rather than breaking a date apart.
- **Projects and case studies.** An experience's projects follow its technologies, before its website link, as an ordered list of editorial rows (a 1 px left rule, 16 px in; no cards), in the API's order: the name (an `h3`, `type-item`), the period in `type-label`, the summary as muted body text, then the technologies in `type-label`. A project without a case study shows its evidence directly: Problem, Solution, Result as a list of labelled parts (`type-label` labels). A project with a case study puts its evidence behind a "View technical case study ↓" disclosure (a text link whose chevron points down while closed and up while open, 44 px tall, inside an `h4`; its accessible name adds the project, "View technical case study: <project>"), in the order context (the summary above it), problem, my role, solution, result, technologies. The case study's own account belongs to the solution: after what was done, one level in behind its own 1 px left rule (16 px in), its section headings in `type-label` in the foreground colour, so they read as parts of the solution and not as parts beside it. Its closed content stays findable by page search (`hidden="until-found"`). A project without a case study never gets an empty disclosure or an invented role; an experience without projects shows no list. The role is the person's own contribution; the result is the team's outcome and stays a separate part.
- **Anchors.** Every experience, project, case study and exploration, each technology group and the independent R&D block has a stable id built by one helper (`experience-<slug>`, `project-<slug>`, `case-study-<project slug>`, `exploration-<slug>`, `technology-group-<core | ai-engineering-focus | secondary>`, `independent-rd`; the same helper builds the services page's `service-<slug>`, see Services page). A link to one, on load, on a hash change or on back and forward, opens every disclosure around it, then puts it at once (no smooth scroll) at the top of the viewport with 32 px of room above it below any sticky header (`anchor-target`, `--header-height`), and moves focus to it, so the next Tab continues from there. An anchor the page does not have (an unknown or removed item) opens nothing and leaves the page as it is.

## Experience sections

Below the timeline on `/experience`, in this order: Independent R&D, Technologies, Education. Each is an `h2` section (`type-heading`) within `max-w-3xl`, 40 px between its heading and its content, and is left out entirely when it has nothing to show: no empty heading, no placeholder claim, no extra gap.

- **Independent R&D.** Unreleased research and experiments, kept apart from the career timeline. A one-sentence muted intro that says no more than that, then the explorations in their stored order as editorial rows (a 1 px left rule, 16 px in, 32 px apart): the name (`h3`, `type-item`); the status as a bordered `type-tag` label with its meaning beside it in `type-label` — `Built` "Implemented and working", `Tested` "Tried hands-on", `Designed` "Unimplemented design, planned or architected only"; the sentence as muted body text; the concepts in their stored order in `type-label`. A page never shows a status stronger than the stored one, and designed work never reads as working, tried or delivered. No period.
- **Technologies.** Three groups, each with a `type-label` heading (`h3`) and its own anchor. **Core**: the names in `type-item` in a wrapping row, 32 px apart, each with its static logo before it (28 px, 32 px from `sm`, monochrome in the text colour, decorative beside the name); a core technology without a logo of the website's set shows its name alone. No cards or tiles. **AI engineering focus**: plain text, with a muted note that it is a current specialisation; no logos, since several are concepts. **Secondary**: a "+ N other technologies & tools" disclosure (the text-link disclosure of the case study, 44 px tall), collapsed at first, its plain muted list findable by page search (`hidden="until-found"`); a link to `#technology-group-secondary` opens it. Nothing is inferred: a group shows exactly the stored technologies.
- **Static logos.** The website holds a fixed set of single-colour SVG paths (from Simple Icons, CC0; the marks belong to their owners) keyed by `logoKey`: `docker`, `javascript`, `laravel`, `nextjs`, `nodejs`, `php`, `postgresql`, `python`, `react`, `symfony`, `typescript`. A key outside the set shows no logo. Adding a logo means adding its path to `apps/web/src/modules/experience/data/technology-logos.ts`.
- **Education.** Low on the page, compact rows in their stored order (a 1 px left rule, 16 px in, 24 px apart): the title (`h3`, `type-item`), the institution muted when there is one, then the period in `type-label` and the kind (`School`, `Course`, `Certification`, `Milestone`) as a bordered `type-tag`, then the description as small muted text when there is one. A record with only an end date shows that date; with only a start, `– present`.

## Services page

`/services` is for clients: what I offer, the evidence behind it and how a collaboration runs. It uses the page frame and page padding (Spacing); its parts are 96/128 px apart and stay within 768 px (`max-w-3xl`), left-aligned. No cards, price list, contact form, guarantee or SLA.

- **Header.** The name in `type-label`, "Services" in `type-title`, then the services intro from the API as Markdown in `type-lead`. Without an intro the header is the heading alone.
- **Offers.** The services in the API's order as numbered editorial rows, 64 px apart, each with a 1 px top rule and its anchor `service-<slug>` (the browser scrolls to it on load with the 32 px of room of `anchor-target`; the page has no disclosures to open): the two-digit number in `type-label` (in a 5 rem column of its own from `sm`), the name (`h2`, `type-item`), the summary as muted body text, then labelled parts (`type-label` labels): **For**, **You get**, and only when they have something to show **Projects** (career work), **Independent R&D** (built or tested explorations, each with its stored status as a bordered `type-tag` and its meaning in `type-label`, the same wording as on `/experience`), **See also** (pages of the site) and **Planned, not built** (designed explorations with their status). Each piece of evidence is a text link with an arrow, 44 px tall, to its exact item (`project-<slug>`, `exploration-<slug>` on `/experience`, or the stored site path). R&D never appears under Projects, and a designed exploration is never shown as evidence. A site link to a page the site does not have is left out, never a dead link. Without services the page says "No services are published yet."
- **Note on practice and focus.** The services note from the API, after the offers: muted text behind a 1 px left rule (16 px in), an `aside` named "Experience and focus". Left out without a note.
- **How I work.** An `h2` section (`type-heading`) with a one-sentence muted intro saying the steps adapt, then the collaboration steps from the API in their order: one column on mobile, two from `sm`, each with a 1 px left rule (16 px in), its number in `type-label`, its title (`h3`, `type-item`) and its description as muted Markdown. Left out without steps.
- **Closing.** "Have a project in mind?" (`h2`, `type-heading`) and one primary button, "Get in touch", to the homepage's contact block (`/#contact`), which holds the email address and web links when the person has them. The page writes no contact value itself.

## CV page

`/cv` is for recruiters: the assembled CV from the API as one readable document. It uses the page frame and page padding (Spacing) in one column within 768 px (`max-w-3xl`), left-aligned; sections are 64 px apart. No cards, no timeline disclosures: everything is written out.

- **Header.** The name in `type-title`, the headline in `type-lead`, then the contacts in a row from `sm` (one per line on mobile, each 44 px tall): the location as muted text, the email address and the web links as text links without arrows.
- **Sections.** `h2` sections (`type-heading`), 24 px between heading and content, each left out when empty: **Summary** (the short bio as Markdown), **Experience** (the experiences the API selected, in its order, as rows with a 1 px left rule, 16 px in, 40 px apart: the period in `type-label` and the kind as a bordered `type-tag`, the title and the organization as on the timeline, the summary as muted body text, the responsibilities as a muted bulleted list, the technologies in `type-label`), **Independent R&D** (separate and concise, one line each that wraps only where the width ends, rows 12 px apart with a 1 px left rule, 16 px in: the name (`h3`, semibold, inline), the status as a bordered `type-tag`, its meaning and the period in `type-label`, then the summary as muted text; the same status wording as on `/experience`, designed reading as an unimplemented design), **Skills** (each group's label in `type-label` in a 192 px column from `sm`, its technologies as one plain line) and **Education** (compact rows: the title and the institution, the period and the kind; no description). The website never selects or reorders what the API assembled, and explorations never appear as experiences.
- **CV actions.** One shared block in the homepage's experience snapshot, in the Experience header and under the CV's header: with a PDF, "Download CV" with a down arrow (to the downloaded file) and, below it in `type-label`, "PDF updated <date>" — the day the current PDF was uploaded, never the day the profile changed; "Read the CV →" beside it except on `/cv` itself. Without a PDF the block is only "Read the CV →" (left out on `/cv`), with no date. Text links, 44 px tall, in a row from `sm`. The PDF is a separately maintained file, never generated from the page.
- **PDF unavailable.** When the PDF exists but cannot be delivered, the visitor lands on a state page (as Not found): "PDF unavailable" in `type-label`, "The CV PDF could not be downloaded." and the plain fact that nothing was downloaded, then "Read the CV" as the primary button and "Try the download again →" as a text link.
- **Print.** Printing `/cv` gives the same document, dark on white whatever the theme (the light colour tokens in print, `packages/ui` `globals.css`), full width without page padding, sections 32 px apart and rows kept whole across pages where they fit. The footer and the CV actions are hidden in print on every page; each web link's address is printed after its label. Print is checked separately from the responsive screenshots, by Playwright with print media in both schemes.

## Ask page

`/ask` is the chat: an assistant answering questions about the person from the public profile. It uses the page frame and page padding (Spacing) in one column within 672 px (`max-w-2xl`), centred, and fills the screen's height so the composer sits at the bottom. No model selector, settings or debug controls.

- **Header.** The name in `type-label`, "Ask AI" in `type-title`, then one `type-intro` sentence saying it is an AI assistant over the public profile and is not the person. It never speaks as the person. With a conversation, "New chat" (a ghost button with a plus) sits beside the heading from `sm` and below the introduction on mobile, discreet and never primary.
- **Empty chat.** "Suggested questions" in `type-label`, then four outline buttons with the full questions, one per kind of visitor (hiring, clients, technical, general): one column on mobile, two from `sm`.
- **Conversation.** Turns 40 px apart. The question on the right in a `muted` bubble (radius `xl`, at most 85 % wide); the answer below it full width: "Assistant" in `type-label`, the text within `max-w-prose`, then the related pages as text links with an arrow, 44 px tall. Block cards and sources come later in phase 3 (#52). A new question scrolls into view; a finished answer scrolls up so its links clear the composer.
- **Composer.** Sticky at the bottom on the page background: one input line ("Ask a question", `sr-only` label "Your question") and a solid 48 px send button, disabled while an answer is open or the input is empty, then one muted note that answers come from the public profile and may be incomplete. The on-screen keyboard resizes the page (`interactive-widget=resizes-content`), so the composer stays above it.
- **Announcements.** One polite live region: "Answering…" when an answer starts, then the answer (or that it failed or was interrupted) once when it ends; never each streamed piece. The open answer is `aria-busy`.

## Process

Implementation → browser screenshot → visual review → iteration. Screenshots are attached to the pull request.

## To be defined in phase 3

The chat's block cards and sources (#52), and its retry and interruption states (#53).
