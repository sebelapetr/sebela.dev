"use client";

import { RotateCw } from "lucide-react";

import { Button } from "@sebela/ui/components/button";

import { Footer } from "../modules/_shared";

/**
 * Shown when a page's content cannot be read (the API failed, was unreachable or too slow). Says
 * so plainly and offers another attempt; never pretends the content is empty.
 */
export default function ErrorPage({
  retry,
}: {
  readonly error: Error;
  readonly retry: () => void;
}) {
  return (
    <>
      {/* The page's own metadata failed with its content; React hoists this into the head. */}
      <title>Content unavailable</title>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-start justify-center gap-6 px-5 py-20 sm:px-8">
        <p className="font-mono text-sm text-muted-foreground">Content unavailable</p>
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          This page could not be loaded right now.
        </h1>
        <p className="max-w-prose text-lg text-muted-foreground">
          Its content is temporarily unavailable. Please try again in a moment.
        </p>
        <Button size="lg" onClick={retry}>
          <RotateCw aria-hidden="true" data-icon="inline-start" />
          Try again
        </Button>
      </main>
      <Footer name={null} />
    </>
  );
}
