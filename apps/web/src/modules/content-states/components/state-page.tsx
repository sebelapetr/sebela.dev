import type { ReactNode } from "react";

import { Footer } from "../../_shared";

/**
 * The frame of a page that has no content to show: a short label, a heading, optional text, one
 * action, and the footer without a name (the profile could not be read).
 */
export function StatePage({
  label,
  heading,
  children,
  action,
}: {
  readonly label: string;
  readonly heading: string;
  readonly children?: ReactNode;
  readonly action: ReactNode;
}) {
  return (
    <>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-start justify-center gap-6 px-5 py-20 sm:px-8">
        <p className="font-mono text-sm text-muted-foreground">{label}</p>
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {heading}
        </h1>
        {children}
        {action}
      </main>
      <Footer name={null} />
    </>
  );
}
