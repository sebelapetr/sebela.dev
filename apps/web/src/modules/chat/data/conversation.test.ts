import { describe, expect, it } from "vitest";

import {
  canRetryChatTurn,
  endChatStream,
  receiveChatEvent,
  rejectChatTurn,
  restartChatTurn,
  startChatTurn,
  timeOutChatTurn,
  type ChatTurn,
} from "./conversation";

const REQUEST = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const MESSAGE = "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f";

function event(eventId: number, fields: Record<string, unknown>) {
  return { requestId: REQUEST, messageId: MESSAGE, eventId, ...fields };
}

function receiveAll(turn: ChatTurn, events: unknown[]): ChatTurn {
  return events.reduce<ChatTurn>((current, raw) => receiveChatEvent(current, raw), turn);
}

describe("startChatTurn", () => {
  it("holds the question as pending, before any answer", () => {
    expect(startChatTurn(REQUEST, "What is Casey Morrow working on now?")).toMatchObject({
      requestId: REQUEST,
      question: "What is Casey Morrow working on now?",
      status: "pending",
      text: "",
      blocks: [],
      sources: [],
      related: [],
      outcome: null,
      error: null,
    });
  });
});

describe("receiveChatEvent", () => {
  it("builds a minimal start, delta, completion stream into an answered turn", () => {
    const turn = receiveAll(startChatTurn(REQUEST, "Q?"), [
      event(0, { type: "start" }),
      event(1, { type: "text_delta", text: "Casey Morrow " }),
      event(2, { type: "text_delta", text: "builds fictional systems." }),
      event(3, { type: "complete", outcome: "answered" }),
    ]);

    expect(turn).toMatchObject({
      status: "complete",
      text: "Casey Morrow builds fictional systems.",
      outcome: "answered",
      error: null,
    });
  });

  it("is streaming once the answer has started", () => {
    const turn = receiveAll(startChatTurn(REQUEST, "Q?"), [
      event(0, { type: "start" }),
      event(1, { type: "text_delta", text: "Partial" }),
    ]);

    expect(turn).toMatchObject({ status: "streaming", text: "Partial" });
  });

  it("keeps the related links, sources and complete blocks of the answer", () => {
    const related = [{ label: "Experience", href: "/experience" }];
    const sources = [
      {
        record: { kind: "experience", id: "harbor-logistics" },
        title: "Harbor Logistics",
        href: "/experience#experience-harbor-logistics",
      },
    ];
    const block = {
      type: "ServiceCard",
      title: "Fictional automation",
      summary: "Made up.",
      href: "/services#service-automation",
    };
    const turn = receiveAll(startChatTurn(REQUEST, "Q?"), [
      event(0, { type: "start" }),
      event(1, { type: "block", block }),
      event(2, { type: "sources", sources }),
      event(3, { type: "related", links: related }),
      event(4, { type: "complete", outcome: "answered" }),
    ]);

    expect(turn).toMatchObject({ status: "complete", blocks: [block], sources, related });
  });

  it("records how an insufficient-evidence answer ended", () => {
    const turn = receiveAll(startChatTurn(REQUEST, "Q?"), [
      event(0, { type: "start" }),
      event(1, { type: "text_delta", text: "I don't have enough evidence." }),
      event(2, { type: "complete", outcome: "insufficient_evidence" }),
    ]);

    expect(turn).toMatchObject({ status: "complete", outcome: "insufficient_evidence" });
  });

  it("fails with the stream's error code and whether a retry may help", () => {
    const turn = receiveAll(startChatTurn(REQUEST, "Q?"), [
      event(0, { type: "error", code: "rate_limited", retryable: true }),
    ]);

    expect(turn).toMatchObject({
      status: "failed",
      error: { code: "rate_limited", retryable: true },
    });
  });

  it("ignores a duplicate event", () => {
    const turn = receiveAll(startChatTurn(REQUEST, "Q?"), [
      event(0, { type: "start" }),
      event(1, { type: "text_delta", text: "Once" }),
      event(1, { type: "text_delta", text: "Once" }),
    ]);

    expect(turn.text).toBe("Once");
  });

  it("fails a malformed event as an invalid stream, keeping the partial answer", () => {
    const turn = receiveAll(startChatTurn(REQUEST, "Q?"), [
      event(0, { type: "start" }),
      event(1, { type: "text_delta", text: "Partial" }),
      event(2, { type: "text_delta" }),
    ]);

    expect(turn).toMatchObject({
      status: "failed",
      text: "Partial",
      error: { code: "invalid_stream", retryable: true },
    });
  });

  it("fails an event out of order as an invalid stream", () => {
    const turn = receiveAll(startChatTurn(REQUEST, "Q?"), [
      event(0, { type: "text_delta", text: "No start" }),
    ]);

    expect(turn).toMatchObject({ status: "failed", text: "", error: { code: "invalid_stream" } });
  });

  it("ignores events for another request", () => {
    const start = receiveChatEvent(startChatTurn(REQUEST, "Q?"), event(0, { type: "start" }));
    const foreign = {
      ...event(1, { type: "text_delta", text: "Late" }),
      requestId: "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e",
    };

    expect(receiveChatEvent(start, foreign)).toBe(start);
  });

  it("changes nothing once the turn has ended", () => {
    const complete = receiveAll(startChatTurn(REQUEST, "Q?"), [
      event(0, { type: "start" }),
      event(1, { type: "complete", outcome: "answered" }),
    ]);

    expect(receiveChatEvent(complete, event(2, { type: "text_delta", text: "Late" }))).toBe(
      complete,
    );
  });
});

describe("receiveChatEvent with progress", () => {
  const progress = (fields: Record<string, unknown> = {}) => ({
    type: "progress",
    requestId: REQUEST,
    stage: "answering",
    elapsedMs: 4000,
    ...fields,
  });

  it("accepts a sign of life of the same request without changing the turn", () => {
    const started = receiveChatEvent(startChatTurn(REQUEST, "Q?"), event(0, { type: "start" }));

    expect(receiveChatEvent(started, progress())).toBe(started);
  });

  it("accepts it before the answer starts, keeping the turn pending", () => {
    const pending = startChatTurn(REQUEST, "Q?");

    expect(receiveChatEvent(pending, progress({ stage: "queued", elapsedMs: 0 }))).toBe(pending);
  });

  it("still takes the next answer event after it", () => {
    const turn = receiveAll(startChatTurn(REQUEST, "Q?"), [
      event(0, { type: "start" }),
      progress(),
      event(1, { type: "text_delta", text: "After progress" }),
    ]);

    expect(turn).toMatchObject({ status: "streaming", text: "After progress" });
  });

  it("fails a progress frame carrying text as an invalid stream", () => {
    const started = receiveChatEvent(startChatTurn(REQUEST, "Q?"), event(0, { type: "start" }));

    expect(receiveChatEvent(started, progress({ text: "draft" }))).toMatchObject({
      status: "failed",
      error: { code: "invalid_stream" },
    });
  });
});

describe("rejectChatTurn", () => {
  it.each([
    ["challenge_failed", true],
    ["busy", true],
    ["quota_exceeded", true],
    ["rate_limited", true],
    ["unavailable", true],
    ["budget_exhausted", false],
    ["conflict", false],
    ["invalid_request", false],
  ] as const)("fails an open turn not admitted for %s (retryable: %s)", (code, retryable) => {
    expect(rejectChatTurn(startChatTurn(REQUEST, "Q?"), code)).toMatchObject({
      status: "failed",
      question: "Q?",
      text: "",
      error: { code, retryable },
    });
  });

  it("keeps when the API said to try again", () => {
    expect(rejectChatTurn(startChatTurn(REQUEST, "Q?"), "quota_exceeded", 120).error).toEqual({
      code: "quota_exceeded",
      retryable: true,
      retryAfterSeconds: 120,
    });
  });

  it("leaves an ended turn as it is", () => {
    const interrupted = endChatStream(startChatTurn(REQUEST, "Q?"));

    expect(rejectChatTurn(interrupted, "busy")).toBe(interrupted);
  });

  it("can be retried where the reason allows it", () => {
    expect(canRetryChatTurn(rejectChatTurn(startChatTurn(REQUEST, "Q?"), "challenge_failed"))).toBe(
      true,
    );
    expect(canRetryChatTurn(rejectChatTurn(startChatTurn(REQUEST, "Q?"), "budget_exhausted"))).toBe(
      false,
    );
  });
});

describe("endChatStream", () => {
  it("marks a turn whose stream ended without a terminal event as interrupted", () => {
    const streaming = receiveAll(startChatTurn(REQUEST, "Q?"), [
      event(0, { type: "start" }),
      event(1, { type: "text_delta", text: "Partial" }),
    ]);

    expect(endChatStream(streaming)).toMatchObject({ status: "interrupted", text: "Partial" });
  });

  it("marks a turn that never received an event as interrupted", () => {
    expect(endChatStream(startChatTurn(REQUEST, "Q?")).status).toBe("interrupted");
  });

  it("leaves an ended turn as it is", () => {
    const complete = receiveAll(startChatTurn(REQUEST, "Q?"), [
      event(0, { type: "start" }),
      event(1, { type: "complete", outcome: "answered" }),
    ]);

    expect(endChatStream(complete)).toBe(complete);
  });
});

describe("receiveChatEvent with unsafe payloads", () => {
  const experienceCard = {
    type: "ExperienceCard",
    title: "Lead engineer",
    organization: "Fictional Freight",
    startedOn: "2022-03-01",
    endedOn: null,
    summary: "Leads a fictional team.",
    technologies: [],
    href: "/experience#experience-lead-engineer",
  };
  const source = {
    record: { kind: "experience", id: "lead-engineer" },
    title: "Lead engineer",
    href: "/experience#experience-lead-engineer",
  };
  const unsafeHrefs = [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "//evil.example.test/experience",
    "/\\evil.example.test",
    "https://evil.example.test/experience",
    "/experience#a b",
  ];

  function afterStart(fields: Record<string, unknown>): ChatTurn {
    return receiveAll(startChatTurn(REQUEST, "Q?"), [
      event(0, { type: "start" }),
      event(1, { type: "text_delta", text: "Kept." }),
      event(2, fields),
    ]);
  }

  function expectRejected(turn: ChatTurn): void {
    expect(turn).toMatchObject({
      status: "failed",
      text: "Kept.",
      blocks: [],
      sources: [],
      related: [],
      error: { code: "invalid_stream" },
    });
  }

  it.each(unsafeHrefs)("rejects a block that leads to %s", (href) => {
    expectRejected(afterStart({ type: "block", block: { ...experienceCard, href } }));
  });

  it.each(unsafeHrefs)("rejects a source that leads to %s", (href) => {
    expectRejected(afterStart({ type: "sources", sources: [{ ...source, href }] }));
  });

  it.each(["javascript:alert(1)", "data:text/html,x", "//evil.example.test"])(
    "rejects a related link to %s",
    (href) => {
      expectRejected(afterStart({ type: "related", links: [{ label: "Go", href }] }));
    },
  );

  it.each(["javascript:alert(1)", "mailto:casey@morrow.example.test", "/relative"])(
    "rejects a contact link to %s",
    (url) => {
      expectRejected(
        afterStart({
          type: "block",
          block: { type: "ContactCard", email: null, links: [{ label: "Odd", url }] },
        }),
      );
    },
  );

  it.each([
    ["an unknown block type", { ...experienceCard, type: "HtmlCard" }],
    ["a block without its title", { ...experienceCard, title: undefined }],
    [
      "an exploration with a status stronger than stored",
      {
        type: "ExplorationCard",
        title: "Tool scopes",
        summary: null,
        status: "delivered",
        href: "/experience#exploration-tool-scopes",
      },
    ],
    ["a block of raw HTML", { type: "ExperienceCard", html: "<img src=x onerror=alert(1)>" }],
  ])("rejects %s, rendering none of it", (_label, block) => {
    expectRejected(afterStart({ type: "block", block }));
  });

  it("rejects more than two related links", () => {
    const links = ["/experience", "/services", "/cv"].map((href) => ({ label: "Go", href }));
    expectRejected(afterStart({ type: "related", links }));
  });

  it("rejects an empty list of sources rather than showing an empty Sources block", () => {
    expectRejected(afterStart({ type: "sources", sources: [] }));
  });

  it("keeps markup in a block's text as plain text for the renderer to escape", () => {
    const title = "<script>alert(1)</script>";
    const turn = afterStart({ type: "block", block: { ...experienceCard, title } });
    expect(turn.blocks).toEqual([{ ...experienceCard, title }]);
  });
});

describe("timeOutChatTurn", () => {
  it("fails an open turn as timed out, keeping its partial answer, with a retry allowed", () => {
    const streaming = receiveAll(startChatTurn(REQUEST, "Q?"), [
      event(0, { type: "start" }),
      event(1, { type: "text_delta", text: "Partial" }),
    ]);

    expect(timeOutChatTurn(streaming)).toMatchObject({
      status: "failed",
      text: "Partial",
      error: { code: "timeout", retryable: true },
    });
  });

  it("times out a turn that never received an event", () => {
    expect(timeOutChatTurn(startChatTurn(REQUEST, "Q?"))).toMatchObject({
      status: "failed",
      error: { code: "timeout" },
    });
  });

  it("leaves an ended turn as it is", () => {
    const complete = receiveAll(startChatTurn(REQUEST, "Q?"), [
      event(0, { type: "start" }),
      event(1, { type: "complete", outcome: "answered" }),
    ]);

    expect(timeOutChatTurn(complete)).toBe(complete);
  });
});

describe("canRetryChatTurn", () => {
  const started = [event(0, { type: "start" }), event(1, { type: "text_delta", text: "Part" })];

  it("allows a retry of an interrupted answer: the failure is ambiguous, the visitor decides", () => {
    expect(canRetryChatTurn(endChatStream(receiveAll(startChatTurn(REQUEST, "Q?"), started)))).toBe(
      true,
    );
  });

  it("allows a retry when the error says a retry may help", () => {
    const failed = receiveAll(startChatTurn(REQUEST, "Q?"), [
      event(0, { type: "error", code: "unavailable", retryable: true }),
    ]);
    expect(canRetryChatTurn(failed)).toBe(true);
  });

  it("refuses a retry when the error says it cannot help", () => {
    const failed = receiveAll(startChatTurn(REQUEST, "Q?"), [
      event(0, { type: "error", code: "invalid_request", retryable: false }),
    ]);
    expect(canRetryChatTurn(failed)).toBe(false);
  });

  it.each([
    ["pending", startChatTurn(REQUEST, "Q?")],
    ["streaming", receiveAll(startChatTurn(REQUEST, "Q?"), started)],
    [
      "refused",
      receiveAll(startChatTurn(REQUEST, "Q?"), [
        event(0, { type: "start" }),
        event(1, { type: "complete", outcome: "refused" }),
      ]),
    ],
    [
      "unavailable",
      receiveAll(startChatTurn(REQUEST, "Q?"), [
        event(0, { type: "start" }),
        event(1, { type: "complete", outcome: "unavailable" }),
      ]),
    ],
  ])("offers no retry for a %s answer", (_label, turn) => {
    expect(canRetryChatTurn(turn)).toBe(false);
  });
});

describe("restartChatTurn", () => {
  it("replaces the failed attempt: same request and question, the partial answer gone", () => {
    const failed = receiveAll(startChatTurn(REQUEST, "Q?"), [
      event(0, { type: "start" }),
      event(1, { type: "text_delta", text: "Partial" }),
      event(2, { type: "error", code: "internal", retryable: true }),
    ]);

    expect(restartChatTurn(failed)).toEqual(startChatTurn(REQUEST, "Q?"));
  });

  it("accepts the new attempt's events from the beginning, under its own message", () => {
    const failed = receiveAll(startChatTurn(REQUEST, "Q?"), [
      event(0, { type: "start" }),
      event(1, { type: "text_delta", text: "Partial" }),
      event(2, { type: "error", code: "internal", retryable: true }),
    ]);
    const other = "3c4d5e6f-7a8b-4c9d-8e0f-2a3b4c5d6e7f";
    const retried = receiveAll(restartChatTurn(failed), [
      { requestId: REQUEST, messageId: other, eventId: 0, type: "start" },
      { requestId: REQUEST, messageId: other, eventId: 1, type: "text_delta", text: "Whole." },
      { requestId: REQUEST, messageId: other, eventId: 2, type: "complete", outcome: "answered" },
    ]);

    expect(retried).toMatchObject({ status: "complete", text: "Whole.", error: null });
  });
});

describe("receiveChatEvent with a stream delivered twice", () => {
  it("shows every piece once and completes", () => {
    const events = [
      event(0, { type: "start" }),
      event(1, { type: "text_delta", text: "Once " }),
      event(2, { type: "text_delta", text: "only." }),
      event(3, { type: "complete", outcome: "answered" }),
    ];
    const turn = receiveAll(
      startChatTurn(REQUEST, "Q?"),
      events.flatMap((raw) => [raw, raw]),
    );

    expect(turn).toMatchObject({ status: "complete", text: "Once only." });
  });

  it("fails an event of another message of the same request as an invalid stream", () => {
    const turn = receiveAll(startChatTurn(REQUEST, "Q?"), [
      event(0, { type: "start" }),
      { ...event(1, { type: "text_delta", text: "Foreign" }), messageId: REQUEST },
    ]);

    expect(turn).toMatchObject({ status: "failed", text: "", error: { code: "invalid_stream" } });
  });
});
