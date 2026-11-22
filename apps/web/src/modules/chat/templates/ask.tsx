import { Suspense } from "react";

import { Footer, mainContentId, SiteHeader } from "../../_shared";
import type { AskContent } from "../../profile";
import { ChatView } from "../components/chat-view";

/**
 * The Ask page: the site header, the chat about the person (the visitor's own conversation, which
 * the API resolves from its cookie), a note below it that the answers come from the public profile,
 * and the footer. The chat lives in the browser and the server renders it empty; `siteKey` is the
 * public key of the person check a new question needs, null when the website has none.
 */
export function AskTemplate({
  content,
  siteKey,
}: {
  readonly content: AskContent;
  readonly siteKey: string | null;
}) {
  const { name } = content;
  return (
    <>
      <SiteHeader name={name} />
      <main id={mainContentId} className="layout-page flex flex-1 flex-col pt-5 sm:pt-20">
        <Suspense>
          <ChatView name={name} siteKey={siteKey} />
        </Suspense>
        {/* In the page's flow below the sticky composer, so it shows once the chat is scrolled to its end. */}
        <p className="mx-auto w-full max-w-2xl text-sm text-pretty text-muted-foreground">
          Answers are generated from {name}&apos;s public profile and may be incomplete.
        </p>
      </main>
      <Footer name={name} />
    </>
  );
}
