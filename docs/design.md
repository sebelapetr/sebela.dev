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

| Token | Light | Dark |
|---|---|---|
| background | `#ffffff` | `#000000` |
| foreground | `#0a0a0a` | `#ededed` |
| card | `#f5f5f5` | `#0a0a0a` |
| primary | `#0a0a0a` | `#ffffff` |
| primary-foreground | `#ffffff` | `#000000` |
| secondary / muted | `#e5e5e5` | `#1a1a1a` |
| muted-foreground | `#525252` | `#a3a3a3` |
| border / input | `#d4d4d4` | `#262626` |
| success | `#10b981` | `#10b981` |
| warning | `#f59e0b` | `#f59e0b` |
| destructive | `#ef4444` | `#ef4444` |

Only these two sets exist. Tokens are defined once in the shared UI package and consumed through Tailwind; components never use raw colour values.

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

## Process

Implementation → browser screenshot → visual review → iteration. Screenshots are attached to the pull request.

## To be defined in phase 3

Spacing and type scale, page layouts, navigation, the chat component, the CV print layout, motion.
