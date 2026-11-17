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

Only these two sets exist. Tokens are defined once in the shared UI package (`packages/ui/src/styles/globals.css`, exported as `@sebela/ui/globals.css`) and consumed through Tailwind; components never use raw colour values. Until the toggle exists, dark follows `prefers-color-scheme`.

## Themes

Light and dark, following the system preference by default, with a toggle in the header.

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
- **Chat entry:** between the short bio and the actions — one input line with its submit and one row of two or three suggested questions below it (`.plan/03-web/prd.md`, Chat flow). Its place is reserved in the layout (`ChatSlot` in the homepage module): 104 px tall at every width, that is a 48 px input line, 12 px of space and a 44 px row of suggestions, with the hero's 24 px above and below. The chat entry (#51) fills that place without moving anything else. Until then the place is empty space; no inert or fake control is shown.

## Rhythm

Sections of a page are not equally tall and are not separated by hard horizontal lines. A wireframe shows structure, not proportions — do not reproduce its even boxes.

On the homepage: the hero gets a lot of space, Selected work is the most prominent block, Experience is compact, Now is an editorial split layout, Services are plain. Lists of work are numbered editorial rows, not cards.

**Selected work** sits between the hero and the contact block and lists the projects selected for the homepage, in the API's order. Each row is separated by a 1 px top rule: the two-digit number in `type-label` (in a column of its own from `sm`), the name (`type-item`), the period, the problem, my role (only when the project has a case study), the result and the technologies, then a text link with an arrow to the exact item on `/experience`: "Read the case study" to the case study, else "View the project" to the project. "View full experience →" follows the list. Without a selected project the block is left out; no filler rows.

## Responsive

Mobile-first from the first component. Every UI change is checked at **360, 768 and 1280 px** in both themes. No horizontal scrolling at any width; touch targets at least 44 px.

## Timeline

One shared timeline (`@sebela/ui/components/timeline`) tells the career on `/experience` and will carry the AI Engineering Roadmap. It is monochrome and editorial: no cards, shadows or accent colour.

- **Page.** `/experience` uses the page frame and page padding (Spacing). Its heading block (name in `type-label`, "Experience" in `type-title`, the headline and length of career in `type-lead`, then the CV as a text link with an arrow) and the timeline are its two sections, 96/128 px apart. The page has no primary button: the CV is a destination, not the block's action. Heading block and timeline stay within 768 px (`max-w-3xl`), left-aligned in the frame, so long entries keep a readable measure.
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
- **Anchors.** Every experience, project and case study has a stable id built by one helper from its slug (`experience-<slug>`, `project-<slug>`, `case-study-<project slug>`). A link to one, on load, on a hash change or on back and forward, opens every disclosure around it, then puts it at once (no smooth scroll) at the top of the viewport with 32 px of room above it below any sticky header (`anchor-target`, `--header-height`), and moves focus to it, so the next Tab continues from there. An anchor the page does not have (an unknown or removed item) opens nothing and leaves the page as it is.

## Process

Implementation → browser screenshot → visual review → iteration. Screenshots are attached to the pull request.

## To be defined in phase 3

Page layouts, navigation, the chat component, the CV print layout.
