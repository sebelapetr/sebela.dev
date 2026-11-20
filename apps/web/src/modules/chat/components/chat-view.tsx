"use client";

import { useEffect, useRef, useState, type Ref, type SubmitEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowDown, ArrowRight, ArrowUp, Plus, RotateCcw } from "lucide-react";

import { Button } from "@sebela/ui/components/button";
import { Input } from "@sebela/ui/components/input";
import { cn } from "@sebela/ui/lib/utils";

import { chatQuestionMaxLength } from "@sebela/contracts";

import { conversationHref, conversationIdFromParam } from "../data/address";
import type { AskEvidence } from "../data/evidence";
import { isChatTurnOpen, type ChatTurn } from "../data/conversation";
import { askSuggestions } from "../data/prepared-answers";
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
  const { tag, note, retry, showsEvidence } = describeChatTurn(turn);
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

/**
 * The chat on the Ask page: the conversation named by the address (`?c=`) or a new one, its
 * questions and streamed answers with their cards, sources and related pages, the four suggested questions of an empty chat, "New chat" and
 * the composer. It is an assistant answering about the person from the public profile and says
 * so; it never speaks as the person. Opening the address again — a rerender, back or forward —
 * never resends a question. A question the reader sends goes to just below the header and its
 * answer streams below it without moving the page; "Latest" brings back the end once it is out of
 * view (`useChatScroll`).
 */
export function ChatView({ evidence }: { readonly evidence: AskEvidence }) {
  const { name } = evidence;
  const searchParams = useSearchParams();
  const addressId = conversationIdFromParam(searchParams.get("c"));
  const { snapshot, current, open, submit, retry, newChat } = useConversation(evidence);
  const [question, setQuestion] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const conversationRef = useRef<HTMLOListElement>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const lastAnswerRef = useRef<HTMLDivElement>(null);
  // The address this page gave its own conversation; reaching it is not opening anything.
  const ownAddress = useRef<string | null>(null);
  const turnCount = snapshot.turns.length;
  const latest = snapshot.turns.at(-1);
  const [watched, setWatched] = useState<string | null>(null);
  const { request, toLatest, endHidden } = useChatScroll({
    conversationRef,
    composerRef,
    snapshot,
    current,
  });

  // A conversation opened from the address shows its end once; the hero's question goes to the
  // top like one asked here.
  useEffect(() => {
    if (addressId !== null && addressId === ownAddress.current) return;
    ownAddress.current = null;
    request(open(addressId));
  }, [addressId, open, request]);

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
    const { result, conversationId } = submit(text);
    if (result !== "sent") return;
    setQuestion("");
    request("sent");
    if (conversationId !== addressId) {
      ownAddress.current = conversationId;
      window.history.replaceState(null, "", conversationHref(conversationId));
    }
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

  function startNewChat(): void {
    newChat();
    setQuestion("");
    window.history.replaceState(null, "", conversationHref(null));
    inputRef.current?.focus();
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-5 sm:gap-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-4">
          <h1 className="flex flex-col gap-3">
            <span className="type-label">{name}</span>
            <span className="type-heading sm:type-title">Ask my AI</span>
          </h1>
          <p className="type-intro max-w-prose">
            An AI assistant that answers questions about {name}&apos;s experience, projects,
            services and learning from the public profile. It is not {name}.
          </p>
        </div>
        {turnCount === 0 ? null : (
          <Button
            type="button"
            variant="ghost"
            className="-ml-3 shrink-0 self-start px-3 text-muted-foreground hover:text-foreground sm:-mr-3 sm:ml-0"
            onClick={startNewChat}
          >
            <Plus aria-hidden="true" />
            New chat
          </Button>
        )}
      </header>

      {turnCount === 0 ? (
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
      )}

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
        <form aria-label="Ask a question" onSubmit={onSubmit} className="flex gap-2">
          <label htmlFor="ask-question" className="sr-only">
            Your question
          </label>
          <Input
            ref={inputRef}
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
