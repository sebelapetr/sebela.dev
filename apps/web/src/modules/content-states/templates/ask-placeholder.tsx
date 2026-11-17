import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { buttonVariants } from "@sebela/ui/components/button";
import { cn } from "@sebela/ui/lib/utils";

import { routes } from "../../_shared";
import { StatePage } from "../components/state-page";

/**
 * The chat's address until the shared mock-chat slice delivers the chat: says plainly that it is
 * not here yet and leads to the contact block and back to the site. It answers nothing.
 */
export function AskPlaceholderTemplate() {
  return (
    <StatePage
      label="Ask AI"
      heading="The chat is not available yet."
      action={
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-6">
          <Link
            href={routes.home}
            className={cn(buttonVariants({ variant: "outline", size: "lg" }))}
          >
            Back to the homepage
          </Link>
          <Link
            href={routes.contact}
            className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline focus-visible:underline"
          >
            Get in touch
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
      }
    >
      <p className="type-intro max-w-prose">
        It will answer questions about my experience and services. Until then, the contact block on
        the homepage is the quickest way to ask.
      </p>
    </StatePage>
  );
}
