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

| Step    | Utility        | Size (line height)               | Weight, tracking         | Use                                                                 |
| ------- | -------------- | -------------------------------- | ------------------------ | ------------------------------------------------------------------- |
| Display | `type-display` | 36 px (40) → 48 px (48)          | semibold, tight, balance | The hero headline; one per page at most.                            |
| Title   | `type-title`   | 30 px (36) → 36 px (40)          | semibold, tight, balance | The heading of a page without a hero (content states, inner pages). |
| Heading | `type-heading` | 24 px (32) → 30 px (36)          | semibold, tight          | Section headings (h2).                                              |
| Lead    | `type-lead`    | 18 px, relaxed (1.625), max 65ch | regular, muted           | Introductory prose under a display or title line.                   |
| Body    | (default)      | 16 px (24)                       | regular                  | Running text.                                                       |
| Small   | `text-sm`      | 14 px (20)                       | medium for links         | Text links in action rows and lists, the footer.                    |
| Label   | `type-label`   | 14 px (20), Geist Mono           | regular, tight, muted    | A short label above a heading, such as the name in the hero.        |

- Readable line length: prose is kept to at most 65 characters (`type-lead` or `max-w-prose`); headings wrap balanced.

## Spacing

The 4 px scale of Tailwind (`--spacing`), used in these steps only: 4, 6, 8, 12, 16, 24, 32, 40, 48, 64, 80, 96 and 128 px.

- **Page frame:** `layout-page` in `@sebela/ui/globals.css` — centred, at most 1024 px wide (`max-w-5xl`), side gutter 20 px on mobile and 32 px from `sm`. Every page, the footer and the content states use it, so their edges line up.
- **Page padding:** 48 px above and below on mobile, 80 px from `sm`.
- **Between page sections:** 96 px on mobile, 128 px from `md`. Sections are separated by space, never by rules (Rhythm).
- **Inside a block:** 24 px between its parts (heading, text, actions); 12 px between a label and the heading it belongs to; 12 px between stacked actions on mobile, 24 px beside each other.
- **Hero columns:** 40 px between photo and text on mobile, 48 px from `md`, 64 px from `lg`.

## Components

- Tailwind CSS v4 and shadcn/ui in the `base-nova` style, built on Base UI.
- Icons from Lucide, 16 px beside text, hidden from assistive technology when the text says the same.
- Corner radius base `0.625rem`.
- Technologies: four to six core ones are shown prominently with logos (no large cards); the AI engineering focus and all secondary ones are plain text.
- **Actions are asymmetric.** One primary action per block, a solid `Button` (`buttonVariants`, size `lg`, 48 px). Every other action is a text link: `text-sm`, medium weight, underlined on hover and focus, with a trailing arrow when it leads to another page. Two solid buttons never stand side by side.
- **Links in running text** are underlined at all times, in the text's own colour.
- **Touch targets:** every link and button outside running text is at least 44 px tall (`min-h-11`); text links get the height from padding, not from a larger font.
- **Photo:** the person's photo at its own aspect ratio with radius `xl` on a `muted` background; without a photo a placeholder of the same 4:5 shape with the initials in Geist Mono. Widths 160, 192, 224 and 320 px (mobile, `sm`, `md`, `lg`).
- **Cards** are not the default container. Content sits on the page background; `card` is for the rare block that must stand apart (Rhythm).

## Focus

- Every focusable element shows focus when reached by keyboard (`:focus-visible`), never on mouse click.
- Default treatment, set once in `@sebela/ui/globals.css`: a solid 2 px outline in the `ring` colour (the foreground colour of the theme), offset by 2 px. Text links also underline.
- Buttons and inputs from `@sebela/ui` draw their own 3 px ring in `ring` at 50 % instead, with the border in `ring`, and turn the outline off.
- Focus is never removed without a replacement; the order of focus follows the reading order.

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

## Responsive

Mobile-first from the first component. Every UI change is checked at **360, 768 and 1280 px** in both themes. No horizontal scrolling at any width; touch targets at least 44 px.

## Process

Implementation → browser screenshot → visual review → iteration. Screenshots are attached to the pull request.

## To be defined in phase 3

Page layouts, navigation, the chat component, the CV print layout.
