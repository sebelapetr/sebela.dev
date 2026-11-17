"use client";

import { useRef, useState, type SubmitEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp } from "lucide-react";

import { Button } from "@sebela/ui/components/button";
import { Input } from "@sebela/ui/components/input";
import { cn } from "@sebela/ui/lib/utils";

import { chatQuestionMaxLength } from "@sebela/contracts";

import { conversationHref } from "../data/address";
import { heroSuggestions } from "../data/prepared-answers";
import { handOff } from "../hooks/use-conversation";

/**
 * The hero's way into the chat: one input line with its submit and a row of suggested questions
 * below it (two on mobile, three from `sm`). A question, typed or suggested, starts a conversation
 * with a random address and goes to it on the Ask page, carried there in this tab — never in the
 * address. Sends once however often it is pressed.
 */
export function HeroChatEntry({ name }: { readonly name: string }) {
  const router = useRouter();
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const sent = useRef(false);

  function ask(text: string): void {
    if (sent.current) return;
    const id = handOff(text);
    if (id === null) return;
    sent.current = true;
    setSending(true);
    router.push(conversationHref(id));
  }

  function onSubmit(event: SubmitEvent<HTMLFormElement>): void {
    event.preventDefault();
    ask(question);
  }

  return (
    <div data-testid="hero-chat-entry" className="flex flex-col gap-3">
      <form aria-label="Ask my AI" onSubmit={onSubmit} className="flex gap-2">
        <label htmlFor="hero-chat-question" className="sr-only">
          Ask anything about my work, experience or skills
        </label>
        <Input
          id="hero-chat-question"
          name="question"
          type="text"
          autoComplete="off"
          enterKeyHint="send"
          maxLength={chatQuestionMaxLength}
          placeholder="Ask about my work or skills"
          value={question}
          onChange={(event) => {
            setQuestion(event.target.value);
          }}
        />
        <Button
          type="submit"
          variant="outline"
          className="size-12"
          aria-label="Ask"
          disabled={sending || question.trim().length === 0}
        >
          <ArrowUp aria-hidden="true" />
        </Button>
      </form>
      <ul aria-label="Suggested questions" className="flex min-w-0 gap-2">
        {heroSuggestions(name).map((suggestion, index) => (
          <li key={suggestion.audience} className={cn("min-w-0", index > 1 && "hidden sm:block")}>
            <Button
              type="button"
              variant="ghost"
              className="max-w-full bg-muted/60 px-3 text-muted-foreground hover:text-foreground dark:bg-muted/60"
              disabled={sending}
              onClick={() => {
                ask(suggestion.question);
              }}
            >
              <span className="truncate">{suggestion.label}</span>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
