/** Where llms.txt is served (`src/app/llms.txt/route.ts`). */
const LLMS_TXT_PATH = "/llms.txt";

/**
 * The `<head>` link that points language models at llms.txt, the site's plain-text summary for
 * them, as the page's plain-text alternate. The root layout renders it, so every page has it; it
 * is not page metadata, since a page's own `alternates` would replace it.
 */
export function LlmsTxtLink() {
  return <link rel="alternate" type="text/plain" href={LLMS_TXT_PATH} title="llms.txt" />;
}
