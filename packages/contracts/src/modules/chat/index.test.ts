import { describe, expect, it } from "vitest";

import {
  ChatBlockSchema,
  ChatRelatedLinkSchema,
  ChatSourceSchema,
  ChatSourcesSchema,
  ChatStreamEventSchema,
  ChatSubmissionSchema,
  advanceChatAttempt,
  chatBlockTypes,
  chatErrorCodes,
  chatOutcomes,
  chatQuestionMaxLength,
  startChatAttempt,
  validateChatStream,
  type ChatStreamEvent,
} from "./index.js";

// Fictional identifiers and content only.
const conversationId = "0b9c3c1e-6f0a-4d5e-9a51-3a0c1f2b7d10";
const requestId = "5f1d2a33-1c4b-4b8e-8d3f-2b9e6a7c4d21";
const otherRequestId = "9a7b6c5d-4e3f-4a1b-8c2d-1e0f9a8b7c65";
const messageId = "c2e4f6a8-0b1d-4c3e-9f5a-7b9d1f3e5a70";
const otherMessageId = "d3f5a7b9-1c2e-4d4f-8a6b-8c0e2a4f6b81";

const ids = { requestId, messageId };

const start = { ...ids, eventId: 1, type: "start" } as const;
const delta = (eventId: number, text: string) =>
  ({ ...ids, eventId, type: "text_delta", text }) as const;
const complete = (eventId: number, outcome: (typeof chatOutcomes)[number] = "answered") =>
  ({ ...ids, eventId, type: "complete", outcome }) as const;

const experienceSource = {
  record: { kind: "experience", id: "harbor-logistics" },
  title: "Platform engineer at Harbor Logistics",
  href: "/experience#experience-harbor-logistics",
} as const;

const blocks = {
  ContactCard: {
    type: "ContactCard",
    email: "casey@morrow.example.test",
    links: [{ label: "GitHub", url: "https://github.example.test/casey-morrow" }],
  },
  ExperienceCard: {
    type: "ExperienceCard",
    title: "Platform engineer",
    organization: "Harbor Logistics",
    startedOn: "2021-04-01",
    endedOn: null,
    summary: "Fictional work on calm routing software.",
    technologies: ["TypeScript", "PostgreSQL"],
    href: "/experience#experience-harbor-logistics",
  },
  ServiceCard: {
    type: "ServiceCard",
    title: "Workflow automation",
    summary: "Turns fictional manual steps into software.",
    href: "/services#service-workflow-automation",
  },
  ExplorationCard: {
    type: "ExplorationCard",
    title: "Agent lab",
    summary: "A fictional experiment with tool-using agents.",
    status: "designed",
    href: "/experience#exploration-agent-lab",
  },
  RoadmapCard: {
    type: "RoadmapCard",
    title: "Retrieval evaluation",
    summary: null,
    href: "/ai-roadmap",
  },
} as const;

describe("ChatSubmissionSchema", () => {
  it("accepts a conversation, a request and a trimmed question", () => {
    expect(
      ChatSubmissionSchema.parse({ conversationId, requestId, question: "  What is new?  " }),
    ).toEqual({ conversationId, requestId, question: "What is new?" });
  });

  it.each([
    ["an empty question", { conversationId, requestId, question: "   " }],
    [
      "a question that is too long",
      { conversationId, requestId, question: "a".repeat(chatQuestionMaxLength + 1) },
    ],
    ["a conversation that is not a UUID", { conversationId: "abc", requestId, question: "Hi?" }],
    ["a missing request", { conversationId, question: "Hi?" }],
    ["a question that is not text", { conversationId, requestId, question: 42 }],
  ])("rejects %s", (_, submission) => {
    expect(ChatSubmissionSchema.safeParse(submission).success).toBe(false);
  });
});

describe("ChatStreamEventSchema", () => {
  it("accepts every event type with its correlation identifiers", () => {
    const events: unknown[] = [
      start,
      delta(2, "Hello"),
      { ...ids, eventId: 3, type: "block", block: blocks.ServiceCard },
      { ...ids, eventId: 4, type: "sources", sources: [experienceSource] },
      {
        ...ids,
        eventId: 5,
        type: "related",
        links: [{ label: "Experience", href: "/experience" }],
      },
      complete(6),
      { ...ids, eventId: 7, type: "error", code: "timeout", retryable: true },
    ];
    for (const event of events) expect(ChatStreamEventSchema.parse(event)).toEqual(event);
  });

  it("names the outcomes of a completed answer", () => {
    expect(chatOutcomes).toEqual(["answered", "insufficient_evidence", "refused", "unavailable"]);
  });

  it.each(chatOutcomes)("accepts the outcome %s", (outcome) => {
    expect(ChatStreamEventSchema.parse(complete(2, outcome))).toMatchObject({ outcome });
  });

  it.each(chatErrorCodes)("accepts the stable error code %s with its retry flag", (code) => {
    const event = { ...ids, eventId: 2, type: "error", code, retryable: false };
    expect(ChatStreamEventSchema.parse(event)).toEqual(event);
  });

  it.each([
    ["an unknown type", { ...start, type: "thinking" }],
    ["a missing request", { messageId, eventId: 1, type: "start" }],
    ["a missing message", { requestId, eventId: 1, type: "start" }],
    ["a negative event identifier", { ...start, eventId: -1 }],
    ["a fractional event identifier", { ...start, eventId: 1.5 }],
    ["an empty text delta", delta(2, "")],
    ["an unknown outcome", { ...complete(2), outcome: "maybe" }],
    ["an unknown error code", { ...ids, eventId: 2, type: "error", code: "oops", retryable: true }],
    ["an error without its retry flag", { ...ids, eventId: 2, type: "error", code: "timeout" }],
    ["related links beyond two", { ...ids, eventId: 2, type: "related", links: threeLinks() }],
    ["no related links", { ...ids, eventId: 2, type: "related", links: [] }],
    ["no sources", { ...ids, eventId: 2, type: "sources", sources: [] }],
    ["an invalid block", { ...ids, eventId: 2, type: "block", block: { type: "Chart" } }],
  ])("rejects %s", (_, event) => {
    expect(ChatStreamEventSchema.safeParse(event).success).toBe(false);
  });
});

function threeLinks() {
  return ["/experience", "/services", "/cv"].map((href) => ({ label: href, href }));
}

describe("ChatBlockSchema", () => {
  it("defines a payload for every named block, the reserved roadmap card included", () => {
    expect(chatBlockTypes).toEqual([
      "ContactCard",
      "ExperienceCard",
      "ServiceCard",
      "ExplorationCard",
      "RoadmapCard",
    ]);
  });

  it.each(Object.values(blocks))("accepts a complete $type", (block) => {
    expect(ChatBlockSchema.parse(block)).toEqual(block);
  });

  it.each(["built", "tested", "designed"])("keeps an exploration's status %s", (status) => {
    expect(ChatBlockSchema.parse({ ...blocks.ExplorationCard, status })).toMatchObject({ status });
  });

  it.each([
    ["an exploration without its status", { ...blocks.ExplorationCard, status: undefined }],
    ["an exploration with an unknown status", { ...blocks.ExplorationCard, status: "shipped" }],
    ["an experience without its title", { ...blocks.ExperienceCard, title: "" }],
    [
      "an experience with a date that is not a date",
      { ...blocks.ExperienceCard, startedOn: "May" },
    ],
    ["a service leading off the site", { ...blocks.ServiceCard, href: "https://x.example.test" }],
    ["a roadmap card without a title", { ...blocks.RoadmapCard, title: undefined }],
    [
      "a contact link with a script scheme",
      { ...blocks.ContactCard, links: [{ label: "X", url: "javascript:alert(1)" }] },
    ],
    ["a contact with an invalid email", { ...blocks.ContactCard, email: "casey" }],
  ])("rejects %s", (_, block) => {
    expect(ChatBlockSchema.safeParse(block).success).toBe(false);
  });
});

describe("ChatSourceSchema and ChatSourcesSchema", () => {
  it("keeps the record and its exact site path with the anchor", () => {
    expect(ChatSourceSchema.parse(experienceSource)).toEqual(experienceSource);
  });

  it.each([
    ["an address on another site", { ...experienceSource, href: "https://x.example.test/a" }],
    ["a protocol-relative address", { ...experienceSource, href: "//x.example.test/a" }],
    ["a relative address", { ...experienceSource, href: "experience" }],
    ["a control character in the path", { ...experienceSource, href: "/experience\u0007" }],
    ["a script address", { ...experienceSource, href: "javascript:alert(1)" }],
    ["an unknown record kind", { ...experienceSource, record: { kind: "blog", id: "a" } }],
  ])("rejects %s", (_, source) => {
    expect(ChatSourceSchema.safeParse(source).success).toBe(false);
  });

  it("points a roadmap source at its area, its module or a resource on its module page", () => {
    for (const href of [
      "/ai-roadmap/foundations",
      "/ai-roadmap/foundations/prompting-basics",
      "/ai-roadmap/foundations/prompting-basics#resource-prompting-notes",
    ]) {
      const source = {
        record: { kind: "roadmap_item", id: "prompting-notes" },
        title: "Notes",
        href,
      };
      expect(ChatSourceSchema.parse(source)).toEqual(source);
      expect(ChatBlockSchema.parse({ ...blocks.RoadmapCard, href })).toMatchObject({ href });
    }
  });

  it("holds at least one source", () => {
    expect(ChatSourcesSchema.safeParse([]).success).toBe(false);
    expect(ChatSourcesSchema.parse([experienceSource])).toEqual([experienceSource]);
  });
});

describe("ChatRelatedLinkSchema", () => {
  it.each(["/experience", "/experience#independent-rd", "https://github.example.test/casey"])(
    "accepts the safe address %s",
    (href) => {
      expect(ChatRelatedLinkSchema.parse({ label: "Read more", href })).toEqual({
        label: "Read more",
        href,
      });
    },
  );

  it.each([
    "javascript:alert(1)",
    "data:text/html,hi",
    "mailto:casey@morrow.example.test",
    "//x.example.test",
    "/\\x.example.test",
    "/experience\u0000",
    "/experience\u007f#a",
    "/exp\u0085erience",
    "",
  ])("rejects the unsafe address %j", (href) => {
    expect(ChatRelatedLinkSchema.safeParse({ label: "Read more", href }).success).toBe(false);
  });
});

describe("advanceChatAttempt", () => {
  const advance = (events: readonly ChatStreamEvent[]) => {
    let attempt = startChatAttempt(requestId);
    const steps = [];
    for (const event of events) {
      const step = advanceChatAttempt(attempt, event);
      steps.push(step);
      if (step.status === "accepted") attempt = step.attempt;
    }
    return { attempt, steps };
  };

  it("accepts a start, deltas and a completion, ending the attempt with its outcome", () => {
    const { attempt, steps } = advance([start, delta(2, "Hi"), complete(3)]);
    expect(steps.map((step) => step.status)).toEqual(["accepted", "accepted", "accepted"]);
    expect(attempt).toMatchObject({
      messageId,
      lastEventId: 3,
      terminal: { type: "complete", outcome: "answered" },
    });
  });

  it("accepts an error before any start: a failure before the first event", () => {
    const error = { ...ids, eventId: 1, type: "error", code: "unavailable", retryable: true };
    const { attempt, steps } = advance([error as ChatStreamEvent]);
    expect(steps[0]?.status).toBe("accepted");
    expect(attempt.terminal).toEqual({ type: "error", code: "unavailable", retryable: true });
  });

  it("ignores an event whose identifier was already passed", () => {
    const { steps } = advance([start, delta(2, "Hi"), delta(2, "Hi"), delta(1, "x")]);
    expect(steps.map((step) => step.status)).toEqual([
      "accepted",
      "accepted",
      "duplicate",
      "duplicate",
    ]);
  });

  it.each<[string, readonly ChatStreamEvent[], string]>([
    ["a delta before the start", [delta(1, "Hi")], "missing_start"],
    ["a completion before the start", [complete(1)], "missing_start"],
    ["a second start", [start, { ...start, eventId: 2 }], "repeated_start"],
    ["an event of another request", [{ ...start, requestId: otherRequestId }], "foreign_request"],
    [
      "an event of another message",
      [start, { ...delta(2, "x"), messageId: otherMessageId }],
      "foreign_message",
    ],
    ["an event after the completion", [start, complete(2), delta(3, "late")], "after_terminal"],
    ["a second completion", [start, complete(2), complete(3)], "after_terminal"],
    [
      "a second set of sources",
      [
        start,
        { ...ids, eventId: 2, type: "sources", sources: [experienceSource] },
        { ...ids, eventId: 3, type: "sources", sources: [experienceSource] },
      ],
      "repeated_sources",
    ],
    [
      "a second set of related links",
      [
        start,
        { ...ids, eventId: 2, type: "related", links: [{ label: "CV", href: "/cv" }] },
        { ...ids, eventId: 3, type: "related", links: [{ label: "CV", href: "/cv" }] },
      ],
      "repeated_related",
    ],
  ])("rejects %s", (_, events, reason) => {
    const { steps } = advance(events);
    expect(steps.at(-1)).toEqual({ status: "invalid", reason });
  });
});

describe("validateChatStream", () => {
  it("accepts a minimal start, delta and completion stream", () => {
    const result = validateChatStream(requestId, [start, delta(2, "Hello"), complete(3)]);
    expect(result).toEqual({
      status: "complete",
      events: [start, delta(2, "Hello"), complete(3)],
      terminal: { type: "complete", outcome: "answered" },
    });
  });

  it("drops duplicate events and keeps the order", () => {
    const result = validateChatStream(requestId, [
      start,
      delta(2, "A"),
      delta(2, "A"),
      complete(3),
    ]);
    expect(result).toMatchObject({
      status: "complete",
      events: [start, delta(2, "A"), complete(3)],
    });
  });

  it("reports a stream that ends before its terminal event as interrupted", () => {
    expect(validateChatStream(requestId, [start, delta(2, "Hel")])).toEqual({
      status: "interrupted",
      events: [start, delta(2, "Hel")],
    });
  });

  it("reports a malformed event as invalid with its position", () => {
    expect(validateChatStream(requestId, [start, { ...delta(2, "x"), text: 7 }])).toEqual({
      status: "invalid",
      index: 1,
      reason: "malformed_event",
    });
  });

  it("reports an event out of order as invalid with its position", () => {
    expect(validateChatStream(requestId, [delta(1, "x")])).toEqual({
      status: "invalid",
      index: 0,
      reason: "missing_start",
    });
  });
});
