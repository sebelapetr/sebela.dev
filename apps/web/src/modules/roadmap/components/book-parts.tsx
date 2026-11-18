import Link from "next/link";
import { ArrowRight, BookOpen } from "lucide-react";

import type { RoadmapBookStatus } from "@sebela/api-client";
import { cn } from "@sebela/ui/lib/utils";

import { MediaImage } from "../../_shared";
import type { ImageMedia } from "../../profile";

// Monochrome like the original: a completed book is filled with the text colour, a book being read
// sits on a grey, one still to read is only outlined.
const STATUS_PILL: Record<RoadmapBookStatus, string> = {
  completed: "border-foreground bg-foreground text-background",
  reading: "border-transparent bg-muted text-foreground",
  "to-read": "border-border text-foreground",
};

/** A book's status, as the API derived it, as a pill. */
export function BookStatus({
  status,
  label,
  className,
}: {
  readonly status: RoadmapBookStatus;
  readonly label: string;
  readonly className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        STATUS_PILL[status],
        className,
      )}
    >
      {label}
    </span>
  );
}

/**
 * A book's cover at 2:3, or a plain muted placeholder of the same size when it has none or its file
 * cannot be loaded, so a row never shifts or shows a broken image. The placeholder is decorative:
 * the book's title is beside it.
 */
export function BookCover({
  cover,
  sizes,
  className,
  preload = false,
}: {
  readonly cover: ImageMedia | null;
  readonly sizes: string;
  readonly className: string;
  readonly preload?: boolean;
}) {
  const placeholder = (
    <div
      aria-hidden="true"
      data-slot="book-cover-placeholder"
      className={cn(
        "flex aspect-2/3 items-center justify-center rounded-md bg-muted text-muted-foreground",
        className,
      )}
    >
      <BookOpen className="size-1/3 max-h-10 max-w-10" strokeWidth={1.5} />
    </div>
  );
  if (cover === null) return placeholder;
  return (
    <MediaImage
      image={cover}
      sizes={sizes}
      preload={preload}
      slot="book-cover"
      className={cn("aspect-2/3 rounded-md border border-border object-cover", className)}
      fallback={placeholder}
    />
  );
}

/** The way from a resource that reads a book to the book's page on the bookshelf, 44 px tall. */
export function BookLink({ href, resource }: { readonly href: string; readonly resource: string }) {
  return (
    <Link
      href={href}
      prefetch={false}
      className="inline-flex min-h-11 items-center gap-1 rounded-sm text-sm font-medium underline-offset-4 hover:underline focus-visible:underline focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      <span>
        On the bookshelf
        <span className="sr-only">: {resource}</span>
      </span>
      <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
    </Link>
  );
}
