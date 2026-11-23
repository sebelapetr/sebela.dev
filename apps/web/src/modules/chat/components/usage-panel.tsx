"use client";

import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@sebela/ui/components/collapsible";
import { cn } from "@sebela/ui/lib/utils";

import type { ChatUsageLevel } from "@sebela/contracts";

import { routes } from "../../_shared";
import type { ChatRestrictionView, ChatUsageView } from "../data/usage";

/** The bar's fill by level; the words beside it always say the same. */
const barClass: Readonly<Record<ChatUsageLevel, string>> = {
  neutral: "bg-primary",
  warning: "bg-warning",
  critical: "bg-destructive",
};

/** A thin bar for a percentage; decorative, since the row says the numbers in words. */
function Bar({ percent, level }: { readonly percent: number; readonly level: ChatUsageLevel }) {
  return (
    <span aria-hidden="true" className="block h-1.5 w-full overflow-hidden rounded-full bg-muted">
      <span
        className={cn("block h-full rounded-full", barClass[level])}
        style={{ width: `${String(percent)}%` }}
      />
    </span>
  );
}

/** A small marker before a state said in words, coloured by its level. */
function Marker({ level }: { readonly level: ChatUsageLevel }) {
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-2 shrink-0 rounded-full", barClass[level])}
    />
  );
}

/**
 * Why a question would be refused now, with when it can be asked again, and "Contact" where
 * waiting is long or the limit is not the visitor's own.
 */
export function UsageRestriction({
  restriction,
}: {
  readonly restriction: ChatRestrictionView | null;
}) {
  return (
    <div role="status" className="flex flex-col gap-1 pb-3 empty:hidden">
      {restriction === null ? null : (
        <>
          <p className="text-sm text-pretty">{restriction.text}</p>
          {restriction.contact ? (
            <Link
              href={routes.contact}
              prefetch={false}
              className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-medium underline-offset-4 hover:underline focus-visible:underline"
            >
              Contact
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          ) : null}
        </>
      )}
    </div>
  );
}

const rowClass = "flex flex-col gap-1.5";
const termClass = "type-label";
const valueClass = "flex flex-wrap items-baseline gap-x-2 text-sm tabular-nums";
const mutedClass = "text-sm text-pretty text-muted-foreground tabular-nums";

/**
 * The composer's usage panel: one compact line with both counts and the most pressing state in
 * words, which shows and hides the details: the visitor's two meters with counts, percentages and
 * when capacity comes back, the last answer's context against the input cap, the next question's
 * estimate, the model and effort the site uses, and whether the numbers are out of date. Read-only:
 * nothing here changes the model or the limits.
 */
export function UsagePanel({
  view,
  open,
  onOpenChange,
}: {
  readonly view: ChatUsageView;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const { summary } = view;
  return (
    <Collapsible
      open={open}
      onOpenChange={onOpenChange}
      className="flex flex-col"
      render={<section aria-label="Your usage" />}
    >
      <CollapsibleTrigger className="group/usage -mx-1 inline-flex min-h-11 max-w-full items-center gap-2 self-start rounded-md px-1 text-sm text-muted-foreground tabular-nums hover:text-foreground focus-visible:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none">
        {/* The compact counts for the eye; in words for a screen reader. */}
        <span aria-hidden="true" className="truncate">
          {summary.text}
        </span>
        <span className="sr-only">{spokenSummary(view)}</span>
        {summary.note === null ? null : (
          <span className="inline-flex shrink-0 items-center gap-1.5 font-medium text-foreground">
            <Marker level={summary.level} />
            {summary.note}
          </span>
        )}
        {view.stale === null ? null : (
          <span className="shrink-0 font-medium text-foreground">Not up to date</span>
        )}
        <ChevronDown
          aria-hidden="true"
          className="size-4 shrink-0 group-data-[panel-open]/usage:rotate-180"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        {/* Scrolls on a short screen; focusable, so the keyboard can scroll it too. */}
        <div
          role="group"
          aria-label="Usage details"
          tabIndex={0}
          className="max-h-[40dvh] overflow-y-auto overscroll-contain rounded-xl pt-1 pb-3 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <UsageDetails view={view} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** The collapsed line as a screen reader says it: "Usage: Last 2 hours, 6 of 10 questions; …". */
function spokenSummary(view: ChatUsageView): string {
  if (view.meters.length === 0) return "Usage";
  return `Usage: ${view.meters.map((meter) => `${meter.label}, ${meter.value}`).join("; ")}`;
}

function UsageDetails({ view }: { readonly view: ChatUsageView }) {
  if (view.status !== "ready") {
    return (
      <p className={mutedClass}>
        {view.status === "loading"
          ? "Your usage is being read."
          : "Your usage could not be read right now. It is not shown as zero; the assistant still checks every question."}
      </p>
    );
  }
  const { context } = view;
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-border p-4">
      {view.stale === null ? null : <p className="text-sm font-medium">{view.stale}</p>}
      {view.active === null ? null : <p className="text-sm">{view.active}</p>}
      <dl className="flex flex-col gap-4">
        {view.meters.map((meter) => (
          <div key={meter.id} className={rowClass}>
            <dt className={termClass}>{meter.label}</dt>
            <dd className="flex flex-col gap-1.5">
              <span className={valueClass}>
                <span>{meter.value}</span>
                <span className="text-muted-foreground">{meter.percentText}</span>
                {meter.state === null ? null : (
                  <span className="inline-flex items-center gap-1.5 font-medium">
                    <Marker level={meter.level} />
                    {meter.state}
                  </span>
                )}
              </span>
              <Bar percent={meter.percent} level={meter.level} />
              {meter.timing === null ? null : <span className={mutedClass}>{meter.timing}</span>}
            </dd>
          </div>
        ))}
        <div className={rowClass}>
          <dt className={termClass}>Context of the last answer</dt>
          <dd className="flex flex-col gap-1.5">
            <span className={valueClass}>
              <span>{context.value}</span>
              {context.percentText === null ? null : (
                <span className="text-muted-foreground">{context.percentText}</span>
              )}
              {context.kind === null ? null : (
                <span className="text-muted-foreground">{context.kind}</span>
              )}
            </span>
            {context.percent === null || context.level === null ? null : (
              <Bar percent={context.percent} level={context.level} />
            )}
            <span className={mutedClass}>
              {context.status === "measured"
                ? "What the last main model call was given: instructions, tool definitions, history, your question and evidence, against the input cap."
                : "Nothing was measured yet. It counts what the last main model call was given: instructions, tool definitions, history, your question and evidence."}
            </span>
            {context.details.length === 0 ? null : (
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm tabular-nums">
                {context.details.map((detail) => (
                  <div key={detail.label} className="contents">
                    <dt className="text-muted-foreground">{detail.label}</dt>
                    <dd>{detail.value}</dd>
                  </div>
                ))}
              </dl>
            )}
          </dd>
        </div>
        <div className={rowClass}>
          <dt className={termClass}>Next question after compacting (estimate)</dt>
          <dd className="flex flex-col gap-1">
            <span className={valueClass}>
              <span>{view.nextRequest.value}</span>
              {view.nextRequest.measured === null ? null : (
                <span className="text-muted-foreground">{view.nextRequest.measured}</span>
              )}
            </span>
            <span className={mutedClass}>{view.nextRequest.note}</span>
          </dd>
        </div>
        {view.model === null ? null : (
          <div className={rowClass}>
            <dt className={termClass}>Model</dt>
            <dd className="flex flex-col gap-1">
              <span className="text-sm">{view.model}</span>
              <span className={mutedClass}>Set by the site; it cannot be changed here.</span>
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
