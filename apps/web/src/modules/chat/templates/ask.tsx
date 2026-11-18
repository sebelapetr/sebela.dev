import { Suspense } from "react";

import { Footer, mainContentId, SiteHeader } from "../../_shared";
import type { AskContent } from "../../profile";
import { ChatView } from "../components/chat-view";
import { toAskEvidence } from "../data/evidence";

/**
 * The Ask page: the site header, the chat about the person (the conversation the address names,
 * or a new one) and the footer. The server reduces the public profile to the evidence the answers
 * rest on; the chat lives in the browser, and the server renders it empty.
 */
export function AskTemplate({ content }: { readonly content: AskContent }) {
  const { name } = content;
  return (
    <>
      <SiteHeader name={name} />
      <main id={mainContentId} className="layout-page flex flex-1 flex-col pt-12 sm:pt-20">
        <Suspense>
          <ChatView evidence={toAskEvidence(content)} />
        </Suspense>
      </main>
      <Footer name={name} />
    </>
  );
}
