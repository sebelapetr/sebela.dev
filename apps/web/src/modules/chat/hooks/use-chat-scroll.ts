"use client";

// How the Ask page's chat moves the page (docs/design.md, Ask page, Scrolling): a question the
// reader sends goes to just below the sticky header and its answer streams into the room below it
// without moving the page; a conversation opened from the address shows its end at once; nothing
// else scrolls, so a reader who scrolled away stays where they are. It also says when the end of
// the conversation is out of view, for the "Latest" button.
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import type { ConversationSnapshot } from "../stores/conversation-store";
import {
  chatScroll,
  isChatEndHidden,
  nextChatScrollCause,
  type ChatScroll,
  type ChatScrollCause,
} from "../data/chat-scroll";

/** Room between the conversation's end and the composer once the page shows the end. */
const END_ROOM_PX = 20;

/** How long a smooth scroll may take before the "Latest" button is measured again anyway. */
const SMOOTH_SCROLL_LIMIT_MS = 1000;

/** Marks the parts of a turn this hook measures and moves. */
export const chatTurnParts = {
  requestId: "data-request-id",
  question: "data-chat-question",
  answer: "data-chat-answer",
} as const;

interface LatestTurn {
  readonly question: HTMLElement;
  readonly answer: HTMLElement;
}

interface ChatScrollOptions {
  /** The conversation list; its last item is the latest turn, marked with `chatTurnParts`. */
  readonly conversationRef: RefObject<HTMLOListElement | null>;
  /** The sticky composer. */
  readonly composerRef: RefObject<HTMLDivElement | null>;
  /** The snapshot this render shows, and the store's state now. */
  readonly snapshot: ConversationSnapshot;
  readonly current: () => ConversationSnapshot;
}

/**
 * Moves the page for the chat. `request` queues a move ("sent" or "shown") that is made once the
 * page renders the store's latest turn; `toLatest` scrolls to the conversation's end; `endHidden`
 * says whether that end is below the composer.
 */
export function useChatScroll({
  conversationRef,
  composerRef,
  snapshot,
  current,
}: ChatScrollOptions) {
  const pending = useRef<ChatScrollCause | null>(null);
  const moving = useRef(false);
  const [endHidden, setEndHidden] = useState(false);

  /** The latest turn as rendered, when it is the store's latest; null while it is still to render. */
  const latestTurn = useCallback((): LatestTurn | null => {
    const latest = current().turns.at(-1);
    const turn = conversationRef.current?.lastElementChild;
    if (latest === undefined || !(turn instanceof HTMLElement)) return null;
    if (turn.getAttribute(chatTurnParts.requestId) !== latest.requestId) return null;
    const question = turn.querySelector(`[${chatTurnParts.question}]`);
    const answer = turn.querySelector(`[${chatTurnParts.answer}]`);
    if (!(question instanceof HTMLElement) || !(answer instanceof HTMLElement)) return null;
    return { question, answer };
  }, [conversationRef, current]);

  const measure = useCallback(() => {
    if (moving.current) return;
    const turn = latestTurn();
    const composer = composerRef.current;
    setEndHidden(
      turn !== null &&
        composer !== null &&
        isChatEndHidden({
          endBottom: turn.answer.getBoundingClientRect().bottom,
          composerTop: composer.getBoundingClientRect().top,
        }),
    );
  }, [composerRef, latestTurn]);

  const move = useCallback(
    (turn: LatestTurn, scroll: ChatScroll) => {
      if (scroll.behavior === "smooth") {
        // A smooth scroll passes the end on its way; the button waits until it has arrived.
        moving.current = true;
        const arrived = () => {
          window.removeEventListener("scrollend", arrived);
          window.clearTimeout(limit);
          moving.current = false;
          measure();
        };
        const limit = window.setTimeout(arrived, SMOOTH_SCROLL_LIMIT_MS);
        window.addEventListener("scrollend", arrived);
      }
      if (scroll.to === "question") {
        // The question's scroll margin keeps it below the sticky header.
        turn.question.scrollIntoView({ block: "start", behavior: scroll.behavior });
        return;
      }
      const composerHeight = composerRef.current?.offsetHeight ?? 0;
      const top =
        turn.answer.getBoundingClientRect().bottom -
        (window.innerHeight - composerHeight - END_ROOM_PX);
      window.scrollBy({ top, behavior: scroll.behavior });
    },
    [composerRef, measure],
  );

  /** Makes the move for the cause with the page as it is laid out now. */
  const scrollFor = useCallback(
    (cause: ChatScrollCause, turn: LatestTurn) => {
      const composer = composerRef.current;
      if (composer === null) return;
      const scroll = chatScroll(cause, {
        endHidden: isChatEndHidden({
          endBottom: turn.answer.getBoundingClientRect().bottom,
          composerTop: composer.getBoundingClientRect().top,
        }),
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      });
      if (scroll !== null) move(turn, scroll);
    },
    [composerRef, move],
  );

  /** Makes the queued move once the store's latest turn is on the page; drops it for no turns. */
  const flush = useCallback(() => {
    const cause = pending.current;
    if (cause === null) return;
    if (current().turns.length === 0) {
      pending.current = null;
      return;
    }
    const turn = latestTurn();
    if (turn === null) return;
    pending.current = null;
    scrollFor(cause, turn);
  }, [current, latestTurn, scrollFor]);

  const request = useCallback(
    (cause: ChatScrollCause) => {
      pending.current = nextChatScrollCause(pending.current, cause);
      flush();
    },
    [flush],
  );

  const toLatest = useCallback(() => {
    const turn = latestTurn();
    if (turn !== null) scrollFor("latest", turn);
  }, [latestTurn, scrollFor]);

  // Every rendered change may be the turn a queued move waits for.
  useEffect(flush, [snapshot, flush]);

  // Measures the end again whenever the page scrolls or resizes, or the latest answer grows.
  const latestRequestId = snapshot.turns.at(-1)?.requestId;
  useEffect(() => {
    const frame = window.requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    const list = conversationRef.current;
    if (list !== null) observer.observe(list);
    const answer = list?.lastElementChild?.querySelector(`[${chatTurnParts.answer}]`);
    if (answer instanceof HTMLElement) observer.observe(answer);
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
    };
  }, [conversationRef, latestRequestId, measure]);

  return { request, toLatest, endHidden };
}
