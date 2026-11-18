import Markdown, { type Components } from "react-markdown";

// Prose from the API (an experience's summary, a project's problem, work and result) is Markdown.
// Paragraphs, lists, emphasis, code and links render; anything else (headings, images, tables) is
// unwrapped to its text, so the prose never adds headings to the page's outline. Raw HTML is
// dropped, never rendered and never shown as text. react-markdown drops unsafe link protocols
// (`javascript:`, `data:`, `vbscript:`), keeping the link's text.
const allowedElements = ["p", "ul", "ol", "li", "strong", "em", "code", "a"];

/**
 * How prose elements look, shared by every Markdown on the site. A word longer than the line (an
 * address, an identifier) breaks where it must instead of widening the page.
 */
export const proseComponents = {
  p: ({ children: text }) => <p className="wrap-anywhere">{text}</p>,
  a: ({ href, children: text }) => (
    <a href={href} className="underline underline-offset-4 hover:text-muted-foreground">
      {text}
    </a>
  ),
  code: ({ children: text }) => (
    <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.9em] wrap-anywhere">
      {text}
    </code>
  ),
  strong: ({ children: text }) => <strong className="font-semibold text-foreground">{text}</strong>,
  ul: ({ children: items }) => <ul className="list-disc space-y-1 pl-6 wrap-anywhere">{items}</ul>,
  ol: ({ children: items }) => (
    <ol className="list-decimal space-y-1 pl-6 wrap-anywhere">{items}</ol>
  ),
} satisfies Components;

export function ProseMarkdown({ children }: { readonly children: string }) {
  return (
    <Markdown
      allowedElements={allowedElements}
      unwrapDisallowed
      skipHtml
      components={proseComponents}
    >
      {children}
    </Markdown>
  );
}
