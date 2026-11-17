"use client";

import { useEffect, useRef, useState, type SubmitEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowRight, ArrowUp, Plus } from "lucide-react";

import { Button } from "@sebela/ui/components/button";
import { Input } from "@sebela/ui/components/input";

import { chatQuestionMaxLength } from "@sebela/contracts";

import { conversationHref, conversationIdFromParam } from "../data/address";
import { isChatTurnOpen, type ChatTurn } from "../data/conversation";
import { askSuggestions } from "../data/prepared-answers";
import { useConversation } from "../hooks/use-conversation";

const textLinkClass =
  "inline-flex min-h-11 items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline focus-visible:underline";

/** What the live region says when an answer ends. */
function announcement(turn: ChatTurn): string {
  switch (turn.status) {
    case "pending":
    case "streaming":
      return "Answering…";
    case "complete":
      return turn.text;
    case "failed":
      return "The answer could not be completed.";
    case "interrupted":
      return "The answer was interrupted.";
  }
}

function Answer({ turn }: { readonly turn: ChatTurn }) {
  const open = isChatTurnOpen(turn);
  return (
    <div className="flex flex-col gap-2" aria-busy={open}>
      <p className="type-label">Assistant</p>
      {turn.text.length === 0 && open ? (
        <p className="text-muted-foreground">Answering…</p>
      ) : (
        <p className="max-w-prose text-pretty whitespace-pre-line">{turn.text}</p>
      )}
      {turn.status === "failed" ? (
        <p className="text-sm text-muted-foreground">The answer could not be completed.</p>
      ) : null}
      {turn.status === "interrupted" ? (
        <p className="text-sm text-muted-foreground">The answer was interrupted.</p>
      ) : null}
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
    </div>
  );
}

/**
 * The chat on the Ask page: the conversation named by the address (`?c=`) or a new one, its
 * questions and streamed answers, the four suggested questions of an empty chat, "New chat" and
 * the composer. It is an assistant answering about the person from the public profile and says
 * so; it never speaks as the person. Opening the address again — a rerender, back or forward —
 * never resends a question.
 */
export function ChatView({ name }: { readonly name: string }) {
  const searchParams = useSearchParams();
  const addressId = conversationIdFromParam(searchParams.get("c"));
  const { snapshot, open, submit, newChat } = useConversation(name);
  const [question, setQuestion] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const lastTurnRef = useRef<HTMLLIElement>(null);
  const turnCount = snapshot.turns.length;
  const latest = snapshot.turns.at(-1);
  const [watched, setWatched] = useState<string | null>(null);

  useEffect(() => {
    open(addressId);
  }, [addressId, open]);

  // Brings the latest question into view as it is asked, and its whole answer with the related
  // pages above the composer as it ends.
  const latestStatus = latest?.status;
  useEffect(() => {
    if (turnCount > 0) lastTurnRef.current?.scrollIntoView({ block: "nearest" });
  }, [turnCount, latestStatus]);

  // Announces an answer this page saw start, once as it starts and once as it ends; never every
  // streamed piece, and never an answer restored as it was.
  if (latest !== undefined && isChatTurnOpen(latest) && watched !== latest.requestId) {
    setWatched(latest.requestId);
  }
  const live =
    latest === undefined
      ? ""
      : isChatTurnOpen(latest)
        ? "Answering…"
        : watched === latest.requestId
          ? announcement(latest)
          : "";

  function ask(text: string): void {
    const { result, conversationId } = submit(text);
    if (result !== "sent") return;
    setQuestion("");
    if (conversationId !== addressId) {
      window.history.replaceState(null, "", conversationHref(conversationId));
    }
  }

  function onSubmit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    ask(question);
  }

  function startNewChat(): void {
    newChat();
    setQuestion("");
    window.history.replaceState(null, "", conversationHref(null));
    inputRef.current?.focus();
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-4">
          <h1 className="flex flex-col gap-3">
            <span className="type-label">{name}</span>
            <span className="type-title">Ask my AI</span>
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
        <ol aria-label="Conversation" className="flex flex-col gap-10">
          {snapshot.turns.map((turn, index) => (
            <li
              key={turn.requestId}
              ref={index === turnCount - 1 ? lastTurnRef : undefined}
              className="flex scroll-mb-40 flex-col gap-6"
            >
              <div className="ml-auto max-w-[85%] rounded-xl bg-muted px-4 py-3">
                <p className="sr-only">You asked:</p>
                <p className="text-pretty whitespace-pre-line">{turn.question}</p>
              </div>
              <Answer turn={turn} />
            </li>
          ))}
        </ol>
      )}

      <p role="status" aria-live="polite" className="sr-only">
        {live}
      </p>

      <div className="sticky bottom-0 mt-auto -mx-1 flex flex-col gap-2 bg-background px-1 pt-3 pb-4">
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
        <p className="text-sm text-muted-foreground">
          Answers are generated from {name}&apos;s public profile and may be incomplete.
        </p>
      </div>
    </div>
  );
}
