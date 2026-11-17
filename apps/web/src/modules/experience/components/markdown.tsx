import Markdown from "react-markdown";

// Experience summaries are Markdown from the API. Paragraphs, lists, emphasis, code and links
// render; anything else (headings, images, tables, raw HTML) is unwrapped to its text, so a summary
// never adds headings to the page's outline. react-markdown never renders raw HTML and drops unsafe
// link protocols.
const allowedElements = ["p", "ul", "ol", "li", "strong", "em", "code", "a"];

export function SummaryMarkdown({ children }: { readonly children: string }) {
  return (
    <Markdown
      allowedElements={allowedElements}
      unwrapDisallowed
      components={{
        a: ({ href, children: text }) => (
          <a href={href} className="underline underline-offset-4 hover:text-muted-foreground">
            {text}
          </a>
        ),
        code: ({ children: text }) => (
          <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-[0.9em]">{text}</code>
        ),
        strong: ({ children: text }) => (
          <strong className="font-semibold text-foreground">{text}</strong>
        ),
        ul: ({ children: items }) => <ul className="list-disc space-y-1 pl-5">{items}</ul>,
        ol: ({ children: items }) => <ol className="list-decimal space-y-1 pl-5">{items}</ol>,
      }}
    >
      {children}
    </Markdown>
  );
}
