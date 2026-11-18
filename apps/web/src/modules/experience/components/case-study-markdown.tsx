import Markdown, { type Components } from "react-markdown";

import { proseComponents } from "../../_shared";

// The body of a case study is Markdown with its own sections (for example `## Context`,
// `## Approach`, `## Outcome`). It renders inside a project whose name is an `h3` and whose case
// study is an `h4`, so every heading of the body becomes an `h5`. Prose renders as elsewhere;
// images and tables are unwrapped to their text, raw HTML is dropped and unsafe link protocols are
// removed, as in `ProseMarkdown`.
const allowedElements = [
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "p",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "code",
  "a",
];

function SectionHeading({ children }: { readonly children?: React.ReactNode }) {
  return <h5 className="type-label pt-2 text-foreground">{children}</h5>;
}

const components = {
  ...proseComponents,
  h1: SectionHeading,
  h2: SectionHeading,
  h3: SectionHeading,
  h4: SectionHeading,
  h5: SectionHeading,
  h6: SectionHeading,
} satisfies Components;

export function CaseStudyMarkdown({ children }: { readonly children: string }) {
  return (
    <Markdown allowedElements={allowedElements} unwrapDisallowed skipHtml components={components}>
      {children}
    </Markdown>
  );
}
