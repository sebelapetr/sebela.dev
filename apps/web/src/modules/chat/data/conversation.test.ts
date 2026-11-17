import { describe, expect, it } from "vitest";

import { endChatStream, receiveChatEvent, startChatTurn, type ChatTurn } from "./conversation";

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
