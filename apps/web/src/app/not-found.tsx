import Link from "next/link";

import { buttonVariants } from "@sebela/ui/components/button";

import { Footer } from "../footer";
import { routes } from "../site";

export default function NotFound() {
  return (
    <>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col items-start justify-center gap-6 px-5 py-20 sm:px-8">
        <p className="font-mono text-sm text-muted-foreground">404</p>
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          This page does not exist yet.
        </h1>
        <Link href={routes.home} className={buttonVariants({ variant: "outline", size: "lg" })}>
          Back to the homepage
        </Link>
      </main>
      <Footer name={null} />
    </>
  );
}
