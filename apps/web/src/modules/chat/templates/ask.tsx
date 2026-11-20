import { Suspense } from "react";

import { Footer, mainContentId, SiteHeader } from "../../_shared";
import type { AskContent } from "../../profile";
import { ChatView } from "../components/chat-view";
import { toAskEvidence } from "../data/evidence";

/**
 * The Ask page: the site header, the chat about the person (the conversation the address names,
 * or a new one), a note below it that the answers come from the public profile, and the footer. The server reduces the public profile to the evidence the answers
 * rest on; the chat lives in the browser, and the server renders it empty.
 */
export function AskTemplate({ content }: { readonly content: AskContent }) {
  const { name } = content;
  return (
    <>
      <SiteHeader name={name} />
      <main id={mainContentId} className="layout-page flex flex-1 flex-col pt-5 sm:pt-20">
        <Suspense>
          <ChatView evidence={toAskEvidence(content)} />
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
