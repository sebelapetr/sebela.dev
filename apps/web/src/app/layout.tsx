import type { Metadata } from "next";
import type { ReactNode } from "react";

import { fontMono, fontSans } from "@sebela/ui/fonts";
import "@sebela/ui/globals.css";

// Page titles and descriptions come from the API on each page; this is only the fallback.
export const metadata: Metadata = {
  title: "sebela.dev",
};

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en" className={`${fontSans.variable} ${fontMono.variable}`}>
      <body className="flex min-h-dvh flex-col">{children}</body>
    </html>
  );
}
