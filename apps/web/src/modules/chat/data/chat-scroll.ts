// Where the Ask page's chat moves the page, decided apart from the DOM (docs/design.md, Ask page,
// Scrolling).

/**
 * Why the chat would move the page: the reader sent a question (typed, a suggestion, a retry or the
 * hero's hand-off), a conversation was opened from the address, or the reader asked for the latest.
 * An answer that streams, ends or changes its state is never a reason.
 */
export type ChatScrollCause = "sent" | "shown" | "latest";

/** Where to move: the latest question to just below the header, or the conversation's end into view. */
export interface ChatScroll {
  readonly to: "question" | "end";
  readonly behavior: "smooth" | "instant";
}

/** How the page moves for the cause, or null when it stays where it is. */
export function chatScroll(
  cause: ChatScrollCause,
  view: { readonly endHidden: boolean; readonly reducedMotion: boolean },
): ChatScroll | null {
  const motion = view.reducedMotion ? "instant" : "smooth";
  switch (cause) {
    case "sent":
      return { to: "question", behavior: motion };
    case "shown":
      return view.endHidden ? { to: "end", behavior: "instant" } : null;
    case "latest":
      return { to: "end", behavior: motion };
  }
}

/** The reason still waiting for its turn to render, once another arrives. */
export function nextChatScrollCause(
  pending: ChatScrollCause | null,
  next: ChatScrollCause,
): ChatScrollCause {
  return pending === "sent" && next === "shown" ? pending : next;
}

/** Whether the conversation ends below the top of the composer, so the reader cannot see it. */
export function isChatEndHidden(position: {
  readonly endBottom: number;
  readonly composerTop: number;
}): boolean {
  return position.endBottom - position.composerTop >= 1;
}
