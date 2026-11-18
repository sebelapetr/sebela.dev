import Markdown from "react-markdown";

// Short profile texts are Markdown from the API. Only inline emphasis, code and links render;
// anything else (headings, images, raw HTML) is unwrapped to its text. react-markdown never
// renders raw HTML and drops unsafe link protocols.
const allowedElements = ["p", "strong", "em", "code", "a"];

export function InlineMarkdown({ children }: { readonly children: string }) {
  return (
    <Markdown
      allowedElements={allowedElements}
      unwrapDisallowed
      components={{
        // A word longer than the line (an address, an identifier) breaks instead of widening it.
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
        strong: ({ children: text }) => (
          <strong className="font-semibold text-foreground">{text}</strong>
        ),
      }}
    >
      {children}
    </Markdown>
  );
}
