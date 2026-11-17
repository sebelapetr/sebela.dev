// The typed parts of an answer beside its text: the block cards and the sources. Each is shown only
// when the shared chat contract accepts its whole payload, whatever reached the renderer, and all
// of its text is rendered as text, never as markup. Cards and sources lead only to the site's own
// pages; a contact card's links lead to the person's web addresses.
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import {
  ChatBlockSchema,
  ChatSourceSchema,
  type ChatBlock,
  type ChatSource,
} from "@sebela/contracts";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@sebela/ui/components/card";

import { explorationStatusText, formatPeriod, mailtoHref } from "../../_shared";

const contactLinkClass =
  "inline-flex min-h-11 items-center text-sm font-medium underline-offset-4 hover:underline focus-visible:underline";

/** A card's kind, shown above its title. */
const KIND_LABELS: Readonly<Record<ChatBlock["type"], string>> = {
  ExperienceCard: "Experience",
  ServiceCard: "Service",
  ExplorationCard: "Independent R&D",
  RoadmapCard: "AI Roadmap",
  ContactCard: "Contact",
};

/** The card's title as a link to its item on the site, 44 px tall. */
function TitleLink({ href, title }: { readonly href: string; readonly title: string }) {
  return (
    <CardTitle>
      <Link
        href={href}
        prefetch={false}
        className="inline-flex min-h-11 items-center gap-1.5 underline-offset-4 hover:underline focus-visible:underline"
      >
        <span className="min-w-0 break-words">{title}</span>
        <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
      </Link>
    </CardTitle>
  );
}

function Summary({ text }: { readonly text: string | null }) {
  return text === null ? null : <p className="text-pretty text-muted-foreground">{text}</p>;
}

function BlockCard({ block }: { readonly block: ChatBlock }) {
  const kind = <p className="type-label">{KIND_LABELS[block.type]}</p>;
  switch (block.type) {
    case "ExperienceCard":
      return (
        <Card>
          <CardHeader>
            {kind}
            <TitleLink href={block.href} title={block.title} />
            <CardDescription className="flex flex-col gap-1">
              <span>{block.organization}</span>
              <span className="type-label">{formatPeriod(block.startedOn, block.endedOn)}</span>
            </CardDescription>
          </CardHeader>
          {block.summary === null && block.technologies.length === 0 ? null : (
            <CardContent className="flex flex-col gap-2">
              <Summary text={block.summary} />
              {block.technologies.length === 0 ? null : (
                <p className="type-label">{block.technologies.join(", ")}</p>
              )}
            </CardContent>
          )}
        </Card>
      );
    case "ServiceCard":
    case "RoadmapCard":
      return (
        <Card>
          <CardHeader>
            {kind}
            <TitleLink href={block.href} title={block.title} />
          </CardHeader>
          <CardContent>
            <Summary text={block.summary} />
          </CardContent>
        </Card>
      );
    case "ExplorationCard": {
      const status = explorationStatusText(block.status);
      return (
        <Card>
          <CardHeader>
            {kind}
            <TitleLink href={block.href} title={block.title} />
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="type-tag rounded-sm border border-border px-1.5">
                {status.label}
              </span>
              <span className="type-label">{status.meaning}</span>
            </p>
          </CardHeader>
          {block.summary === null ? null : (
            <CardContent>
              <Summary text={block.summary} />
            </CardContent>
          )}
        </Card>
      );
    }
    case "ContactCard":
      return (
        <Card>
          <CardHeader>
            {kind}
            {block.email === null ? null : (
              <CardTitle>
                <a
                  href={mailtoHref(block.email)}
                  className="inline-flex min-h-11 items-center break-all underline underline-offset-4"
                >
                  {block.email}
                </a>
              </CardTitle>
            )}
          </CardHeader>
          {block.links.length === 0 ? null : (
            <CardContent>
              <ul aria-label="Links" className="flex flex-wrap gap-x-6">
                {block.links.map((link) => (
                  <li key={link.url}>
                    <a href={link.url} rel="me noopener" className={contactLinkClass}>
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </CardContent>
          )}
        </Card>
      );
  }
}

/** One typed block of an answer, shown only when its whole payload validates. */
export function AnswerBlock({ block }: { readonly block: ChatBlock }) {
  const parsed = ChatBlockSchema.safeParse(block);
  return parsed.success ? <BlockCard block={parsed.data} /> : null;
}

/** The places an answer rests on, in order, each leading to its exact item; nothing without any. */
export function AnswerSources({ sources }: { readonly sources: readonly ChatSource[] }) {
  const valid = sources.flatMap((source) => {
    const parsed = ChatSourceSchema.safeParse(source);
    return parsed.success ? [parsed.data] : [];
  });
  if (valid.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <p aria-hidden="true" className="type-label">
        Sources
      </p>
      <ol aria-label="Sources" className="list-decimal pl-6 text-sm marker:text-muted-foreground">
        {valid.map((source) => (
          <li key={source.href} className="pl-1">
            <Link
              href={source.href}
              prefetch={false}
              className="inline-flex min-h-11 items-center gap-1.5 font-medium underline-offset-4 hover:underline focus-visible:underline"
            >
              <span className="min-w-0 break-words">{source.title}</span>
              <ArrowRight aria-hidden="true" className="size-4 shrink-0" />
            </Link>
          </li>
        ))}
      </ol>
    </div>
  );
}
