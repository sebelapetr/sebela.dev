import { describe, expect, it } from "vitest";

import { chatScroll, isChatEndHidden, nextChatScrollCause } from "./chat-scroll";

describe("where the chat moves the page", () => {
  it("brings a question the reader sent to the top, smoothly", () => {
    expect(chatScroll("sent", { endHidden: false, reducedMotion: false })).toEqual({
      to: "question",
      behavior: "smooth",
    });
    expect(chatScroll("sent", { endHidden: true, reducedMotion: false })).toEqual({
      to: "question",
      behavior: "smooth",
    });
  });

  it("brings a sent question to the top at once under reduced motion", () => {
    expect(chatScroll("sent", { endHidden: false, reducedMotion: true })).toEqual({
      to: "question",
      behavior: "instant",
    });
  });

  it("shows the end of a conversation opened from the address at once, only when it is hidden", () => {
    expect(chatScroll("shown", { endHidden: true, reducedMotion: false })).toEqual({
      to: "end",
      behavior: "instant",
    });
    expect(chatScroll("shown", { endHidden: false, reducedMotion: false })).toBeNull();
  });

  it("goes to the end when the reader asks for the latest, smoothly unless motion is reduced", () => {
    expect(chatScroll("latest", { endHidden: true, reducedMotion: false })).toEqual({
      to: "end",
      behavior: "smooth",
    });
    expect(chatScroll("latest", { endHidden: true, reducedMotion: true })).toEqual({
      to: "end",
      behavior: "instant",
    });
  });
});

describe("the pending reason to move the page", () => {
  it("keeps a sent question over a conversation shown again before it renders", () => {
    expect(nextChatScrollCause("sent", "shown")).toBe("sent");
  });

  it("takes the newer reason otherwise", () => {
    expect(nextChatScrollCause(null, "shown")).toBe("shown");
    expect(nextChatScrollCause(null, "sent")).toBe("sent");
    expect(nextChatScrollCause("shown", "sent")).toBe("sent");
  });
});

describe("whether the end of the conversation is out of view", () => {
  it("is hidden when it lies below the top of the composer", () => {
    expect(isChatEndHidden({ endBottom: 700, composerTop: 560 })).toBe(true);
  });

  it("is in view when it ends above the composer or at it", () => {
    expect(isChatEndHidden({ endBottom: 400, composerTop: 560 })).toBe(false);
    expect(isChatEndHidden({ endBottom: 560, composerTop: 560 })).toBe(false);
  });

  it("ignores less than a pixel of rounding", () => {
    expect(isChatEndHidden({ endBottom: 560.6, composerTop: 560 })).toBe(false);
  });
});
