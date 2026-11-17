import type { Metadata } from "next";

import { AskPlaceholderTemplate } from "../../modules/content-states";

// A placeholder until the shared mock-chat slice delivers the chat; kept out of search results.
export const metadata: Metadata = {
  title: "Ask AI",
  robots: { index: false },
};

export default function AskPage() {
  return <AskPlaceholderTemplate />;
}
