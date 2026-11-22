"use client";

import { useEffect, useRef, useState, type Ref, type SubmitEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowDown, ArrowRight, ArrowUp, RotateCcw } from "lucide-react";

import { Button } from "@sebela/ui/components/button";
import { Input } from "@sebela/ui/components/input";
import { cn } from "@sebela/ui/lib/utils";

import { chatQuestionMaxLength } from "@sebela/contracts";

import { routes } from "../../_shared";
import { handOffIdFromParam } from "../data/address";
import { isChatTurnOpen, type ChatTurn } from "../data/conversation";
import { askSuggestions } from "../data/suggestions";
import { describeChatTurn } from "../data/turn-status";
import { chatTurnParts, useChatScroll } from "../hooks/use-chat-scroll";
import { useConversation } from "../hooks/use-conversation";
import { AnswerBlock, AnswerSources } from "./answer-blocks";

/**
 * The latest turn asked on this page reaches from just below the header (the question's scroll
 * margin) to the composer (76 px) with the column's gap (20 px, 40 px from `sm`) between them.
 */
const roomyTurnClass =
  "min-h-[calc(100dvh-var(--header-height)-7.25rem)] sm:min-h-[calc(100dvh-var(--header-height)-8.5rem)]";

const textLinkClass =
  "inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline focus-visible:underline";

interface AnswerProps {
  readonly turn: ChatTurn;
  /** Asks again; given only for the latest turn, shown only where a retry can help. */
  readonly onRetry?: () => void;
  readonly ref?: Ref<HTMLDivElement>;
}

function Answer({ turn, onRetry, ref }: AnswerProps) {
  const open = isChatTurnOpen(turn);
  const { tag, note, retry, showsEvidence, contact } = describeChatTurn(turn);
  return (
    // Focus lands here after a retry, so the keyboard stays at the answer it asked again.
    <div
      ref={ref}
      tabIndex={-1}
      className="flex flex-col gap-2"
      aria-busy={open}
      {...{ [chatTurnParts.answer]: "" }}
    >
      <p className="flex flex-wrap items-center gap-2">
        <span className="type-label">Assistant</span>
        {tag === null ? null : (
          <span className="type-tag rounded-sm border border-border px-1.5">{tag}</span>
        )}
      </p>
      {turn.text.length === 0 && open ? (
        <p className="text-muted-foreground">Answering…</p>
      ) : turn.text.length === 0 ? null : (
        <p className="max-w-prose text-pretty whitespace-pre-line">{turn.text}</p>
      )}
      {note === null ? null : <p className="text-sm text-muted-foreground">{note}</p>}
      {retry && onRetry !== undefined ? (
        <Button type="button" variant="outline" className="self-start" onClick={onRetry}>
          <RotateCcw aria-hidden="true" />
          Try again
        </Button>
      ) : null}
      {contact ? (
        <Link href={routes.contact} prefetch={false} className={cn(textLinkClass, "self-start")}>
          Contact
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      ) : null}
      {showsEvidence ? <AnswerEvidence turn={turn} /> : null}
    </div>
  );
}

/** The answer's cards, its sources and the related pages, in that order. */
function AnswerEvidence({ turn }: { readonly turn: ChatTurn }) {
  return (
    <>
      {turn.blocks.length === 0 ? null : (
        <ul aria-label="Cards" className="flex flex-col gap-3 pt-2">
          {turn.blocks.map((block, index) => (
            // A turn's blocks only grow while it streams, so their order is their identity.
            <li key={index}>
              <AnswerBlock block={block} />
            </li>
          ))}
        </ul>
      )}
      <AnswerSources sources={turn.sources} />
      {turn.related.length === 0 ? null : (
        <ul aria-label="Related pages" className="flex flex-wrap gap-x-6">
          {turn.related.map((link) => (
            <li key={link.href}>
              <Link href={link.href} prefetch={false} className={textLinkClass}>
                {link.label}
                <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/** How long the API keeps the conversation, said before anything is asked. */
function storageNotice(retentionDays: number): string {
  const days = retentionDays === 1 ? "1 day" : `${String(retentionDays)} days`;
  return `This conversation is stored for ${days} after its last activity, so you can come back to it in this browser.`;
}

/**
 * The chat on the Ask page: the visitor's own conversation as the API stores it (the newest page,
 * with "Show earlier messages" for the rest), its questions and streamed answers with their cards,
 * sources and related pages, the four suggested questions of an empty chat, how long the
 * conversation is kept, and the composer with the person check. It is an assistant answering
 * about the person from the public profile and says so; it never speaks as the person. The address
 * (`?c=`) only carries the hero's question here, once: it never names or opens a conversation, and
 * the page drops it after use, so a reload, back or forward never resends. A question the reader
 * sends goes to just below the header and its answer streams below it without moving the page;
 * "Latest" brings back the end once it is out of view (`useChatScroll`).
 */
export function ChatView({
  name,
  available,
  siteKey,
}: {
  readonly name: string;
  /** Whether the website has the chat; without it the page asks the API nothing. */
  readonly available: boolean;
  /** The public key of the person check; null when the website has none. */
  readonly siteKey: string | null;
}) {
  const searchParams = useSearchParams();
  const handOffId = handOffIdFromParam(searchParams.get("c"));
  const { snapshot, current, open, submit, retry, loadEarlier, challengeRef } = useConversation(
    siteKey,
    available,
  );
  const [question, setQuestion] = useState("");
  const conversationRef = useRef<HTMLOListElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const lastAnswerRef = useRef<HTMLDivElement>(null);
  // Whether the page opened the conversation; dropping the hand-off address opens nothing again.
  const opened = useRef(false);
  const turnCount = snapshot.turns.length;
  const latest = snapshot.turns.at(-1);
  const [watched, setWatched] = useState<string | null>(null);
  const { request, toLatest, endHidden } = useChatScroll({
    conversationRef,
    composerRef,
    snapshot,
    current,
  });

  // The stored conversation shows its end once; the hero's question goes to the top like one
  // asked here, or into the composer while an earlier answer is still being prepared.
  useEffect(() => {
    if (handOffId === null && opened.current) return;
    opened.current = true;
    void open(handOffId).then((result) => {
      if (result.kind === "held") setQuestion(result.question);
      request(result.kind === "sent" ? "sent" : "shown");
      if (handOffId !== null) window.history.replaceState(null, "", routes.ask);
    });
  }, [handOffId, open, request]);

  // Announces an answer this page saw start, once as it starts and once as it ends; never every
  // streamed piece, and never an answer restored as it was.
  if (latest !== undefined && isChatTurnOpen(latest) && watched !== latest.requestId) {
    setWatched(latest.requestId);
  }
  // The latest turn asked on this page keeps the room below its question for the answer to fill.
  const roomy = watched !== null && watched === latest?.requestId;
  const live =
    latest === undefined
      ? ""
      : isChatTurnOpen(latest)
        ? "Answering…"
        : watched === latest.requestId
          ? describeChatTurn(latest).announcement
          : "";

  function ask(text: string): void {
    if (submit(text) !== "sent") return;
    setQuestion("");
    request("sent");
  }

  function onSubmit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    ask(question);
  }

  function retryLatest(requestId: string): void {
    if (retry(requestId) !== "sent") return;
    request("sent");
    // The retry button goes with the failed answer; the keyboard stays at the answer, and the
    // page moves only to bring its question to the top.
    lastAnswerRef.current?.focus({ preventScroll: true });
  }

  function showLatest(): void {
    toLatest();
    // The button goes once the end is in view; the keyboard continues at the latest answer.
    lastAnswerRef.current?.focus({ preventScroll: true });
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 sm:gap-10">
      <header className="flex flex-col gap-4">
        <h1 className="flex flex-col gap-3">
          <span className="type-label">{name}</span>
          <span className="type-heading sm:type-title">Ask my AI</span>
        </h1>
        <p className="type-intro max-w-prose">
          An AI assistant that answers questions about {name}&apos;s experience, projects, services
          and learning from the public profile. It is not {name}.
        </p>
        {snapshot.retentionDays === null ? null : (
          <p className="max-w-prose text-sm text-pretty text-muted-foreground">
            {storageNotice(snapshot.retentionDays)}
          </p>
        )}
      </header>

      {snapshot.history === "unavailable" ? (
        <div className="flex flex-col gap-3">
          <p className="text-muted-foreground">The chat is not available right now.</p>
          <Link href={routes.contact} prefetch={false} className={cn(textLinkClass, "self-start")}>
            Contact
            <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
      ) : snapshot.history === "loading" && turnCount === 0 ? (
        <p aria-busy="true" className="text-muted-foreground">
          Loading your conversation…
        </p>
      ) : turnCount === 0 ? (
        <section aria-labelledby="ask-suggestions-heading" className="flex flex-col gap-4">
          <h2 id="ask-suggestions-heading" className="type-label">
            Suggested questions
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {askSuggestions(name).map((suggestion) => (
              <li key={suggestion.audience}>
                <Button
                  type="button"
                  variant="outline"
                  className="h-auto min-h-12 w-full justify-start px-4 py-3 text-left whitespace-normal"
                  onClick={() => {
                    ask(suggestion.question);
                  }}
                >
                  {suggestion.question}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <div className="flex flex-col gap-10">
          {snapshot.earlier === "none" ? null : (
            <Button
              type="button"
              variant="ghost"
              className="self-center text-muted-foreground hover:text-foreground"
              disabled={snapshot.earlier === "loading"}
              onClick={() => {
                void loadEarlier();
              }}
            >
              {snapshot.earlier === "loading"
                ? "Loading earlier messages…"
                : "Show earlier messages"}
            </Button>
          )}
          <ol ref={conversationRef} aria-label="Conversation" className="flex flex-col gap-10">
            {snapshot.turns.map((turn, index) => (
              <li
                key={turn.requestId}
                {...{ [chatTurnParts.requestId]: turn.requestId }}
                className={cn(
                  "flex flex-col gap-6",
                  // From the question below the header down to the composer, so the question can
                  // reach the top however short the conversation is.
                  roomy && index === turnCount - 1 && roomyTurnClass,
                )}
              >
                <div
                  {...{ [chatTurnParts.question]: "" }}
                  className="ml-auto max-w-[85%] scroll-mt-[calc(var(--header-height)+1.25rem)] rounded-xl bg-muted px-4 py-3"
                >
                  <p className="sr-only">You asked:</p>
                  <p className="text-pretty whitespace-pre-line">{turn.question}</p>
                </div>
                {index === turnCount - 1 ? (
                  <Answer
                    ref={lastAnswerRef}
                    turn={turn}
                    onRetry={() => {
                      retryLatest(turn.requestId);
                    }}
                  />
                ) : (
                  <Answer turn={turn} />
                )}
              </li>
            ))}
          </ol>
        </div>
      )}

      {snapshot.history === "failed" ? (
        <p className="text-sm text-muted-foreground">
          Your earlier conversation could not be loaded right now. You can still ask a question.
        </p>
      ) : null}

      <p role="status" aria-live="polite" className="sr-only">
        {live}
      </p>

      <div ref={composerRef} className="sticky bottom-0 mt-auto -mx-1 bg-background px-1 pt-3 pb-4">
        {turnCount > 0 && endHidden ? (
          <Button
            type="button"
            variant="outline"
            aria-label="Jump to latest"
            className="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 rounded-full bg-background dark:bg-background dark:hover:bg-muted"
            onClick={showLatest}
          >
            <ArrowDown aria-hidden="true" />
            Latest
          </Button>
        ) : null}
        {/* The person check shows here only when it needs the visitor. */}
        <div ref={challengeRef} className="empty:hidden [&:has(iframe)]:pb-3" />
        <form aria-label="Ask a question" onSubmit={onSubmit} className="flex gap-2">
          <label htmlFor="ask-question" className="sr-only">
            Your question
          </label>
          <Input
            id="ask-question"
            name="question"
            type="text"
            autoComplete="off"
            enterKeyHint="send"
            maxLength={chatQuestionMaxLength}
            placeholder="Ask a question"
            value={question}
            onChange={(event) => {
              setQuestion(event.target.value);
            }}
          />
          <Button
            type="submit"
            className="size-12"
            aria-label="Send"
            disabled={snapshot.busy || question.trim().length === 0}
          >
            <ArrowUp aria-hidden="true" />
          </Button>
        </form>
      </div>
    </div>
  );
}
