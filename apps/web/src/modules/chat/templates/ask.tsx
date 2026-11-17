import { Suspense } from "react";

import { Footer, mainContentId, SiteHeader } from "../../_shared";
import { ChatView } from "../components/chat-view";

/**
 * The Ask page: the site header, the chat about the named person (the conversation the address
 * names, or a new one) and the footer. The chat lives in the browser; the server renders it empty.
 */
export function AskTemplate({ name }: { readonly name: string }) {
  return (
    <>
      <SiteHeader name={name} />
      <main id={mainContentId} className="layout-page flex flex-1 flex-col pt-12 sm:pt-20">
        <Suspense>
          <ChatView name={name} />
        </Suspense>
      </main>
      <Footer name={name} />
    </>
  );
}
