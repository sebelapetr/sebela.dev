"use client";

import { UnavailableTemplate } from "../modules/content-states";

/** The error boundary of every page: content that cannot be read now shows the unavailable state. */
export default function ErrorPage({
  retry,
}: {
  readonly error: Error;
  readonly retry: () => void;
}) {
  return <UnavailableTemplate retry={retry} />;
}
