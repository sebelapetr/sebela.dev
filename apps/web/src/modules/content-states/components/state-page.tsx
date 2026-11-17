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
      <main className="layout-page flex flex-1 flex-col items-start justify-center gap-6 py-20">
        <p className="type-label">{label}</p>
        <h1 className="type-title">{heading}</h1>
        {children}
        {action}
      </main>
      <Footer name={null} />
    </>
  );
}
