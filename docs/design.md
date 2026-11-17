# Design

The visual language of the site. The direction and tokens below are decided; components and page layouts are defined in phase 3.

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

- Geist for text and headings, Geist Mono for code.
- Hierarchy comes from size and weight, not from colour.

## Components

- Tailwind CSS v4 and shadcn/ui in the `base-nova` style, built on Base UI.
- Icons from Lucide.
- Corner radius base `0.625rem`.
- Technologies: four to six core ones are shown prominently with logos (no large cards); the AI engineering focus and all secondary ones are plain text.

## Rhythm

Sections of a page are not equally tall and are not separated by hard horizontal lines. A wireframe shows structure, not proportions — do not reproduce its even boxes.

On the homepage: the hero gets a lot of space, Selected work is the most prominent block, Experience is compact, Now is an editorial split layout, Services are plain. Lists of work are numbered editorial rows, not cards.

## Responsive

Mobile-first from the first component. Every UI change is checked at **360, 768 and 1280 px** in both themes. No horizontal scrolling at any width; touch targets at least 44 px.

## Timeline

One shared timeline (`@sebela/ui/components/timeline`) tells the career on `/experience` and will carry the AI Engineering Roadmap. It is monochrome and editorial: no cards, shadows or accent colour.

- **Rail and markers.** A dashed vertical rail on the left connects one round marker per item. The marker is a chevron that points right while the item is closed and down while it is open; an open or hovered item draws its marker in the foreground colour.
- **Item heading.** The whole heading row is one button that opens and closes the item. The period and the kind label sit above the content's title, never in a separate column.
- **Period.** Geist Mono, muted: `October 1st, 2023 – July 10th, 2024` with correct ordinals and an en dash, `October 1st, 2023 – present` while ongoing, and a single date when an experience started and ended on the same day. Dates are calendar dates, never shifted by a time zone.
- **Kind label.** A small bordered label beside the period: `Main job`, `Own business`, `Side project`. It exists so that concurrent experiences do not read as several full-time jobs. Client and side work keeps its own row and is never nested under an employer.
- **Expand policy.** Only current items (no end date) are open when the page loads; older ones are compact rows that open on click, Enter or Space. Closed content stays in the page (`hidden="until-found"`), so the browser's page search finds and opens it, and a closed item takes no extra space.
- **Content.** Summary, responsibilities, technologies as plain mono text, and a testimonial as a quote with a left rule, only beside its own experience. Long content stays within a readable measure.
- **Narrow screens.** The rail and markers stay; on narrow screens the kind label wraps below the period and the period balances its lines rather than breaking a date apart.
- **Anchors.** Each item has a stable id (`experience-<slug>`) and scrolls into view with room above it.

## Process

Implementation → browser screenshot → visual review → iteration. Screenshots are attached to the pull request.

## To be defined in phase 3

Spacing and type scale, page layouts, navigation, the chat component, the CV print layout, motion.
