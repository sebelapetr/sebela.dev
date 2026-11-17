import type { Metadata } from "next";
import type { ReactNode } from "react";

import { fontMono, fontSans } from "@sebela/ui/fonts";
import "@sebela/ui/globals.css";

import { themeScript } from "../modules/_shared";

// Page titles and descriptions come from the API on each page; this is only the fallback.
export const metadata: Metadata = {
  title: "sebela.dev",
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    // The theme script marks <html> with a stored choice before the first paint, so React must not
    // treat that attribute as a mismatch (docs/design.md, Themes).
    <html
      lang="en"
      className={`${fontSans.variable} ${fontMono.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-dvh flex-col">{children}</body>
    </html>
  );
}
