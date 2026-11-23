import { describe, expect, it } from "vitest";

import { chatCommands, commandSuggestions, readComposerInput } from "./commands";

describe("readComposerInput", () => {
  it("reads text that does not start with a slash as a question, even with a slash inside", () => {
    expect(readComposerInput("What is /compact for?")).toEqual({ kind: "question" });
    expect(readComposerInput("Projects in and/or after 2020")).toEqual({ kind: "question" });
    expect(readComposerInput(" /compact")).toEqual({ kind: "question" });
  });

  it("reads /compact on its own as the command, in any case and with surrounding spaces", () => {
    expect(readComposerInput("/compact")).toEqual({ kind: "command", name: "compact" });
    expect(readComposerInput("/Compact  ")).toEqual({ kind: "command", name: "compact" });
  });

  it("explains locally that /compact takes no text, and sends nothing", () => {
    expect(readComposerInput("/compact please")).toEqual({
      kind: "invalid",
      message: "/compact takes no text after it. Nothing was sent.",
    });
  });

  it("explains an unknown command locally, and sends nothing", () => {
    expect(readComposerInput("/reset now")).toEqual({
      kind: "invalid",
      message:
        "/reset is not a command. The only command is /compact. Nothing was sent; to ask this as a question, do not start it with a slash.",
    });
  });

  it("explains a lone slash locally", () => {
    expect(readComposerInput("/")).toEqual({
      kind: "invalid",
      message:
        "/ is not a command. The only command is /compact. Nothing was sent; to ask this as a question, do not start it with a slash.",
    });
  });
});

describe("commandSuggestions", () => {
  it("offers only /compact, with help that says what it summarizes and what stays", () => {
    expect(chatCommands).toEqual([
      {
        name: "/compact",
        description:
          "Summarize the assistant's current working context. History it already leaves out is not summarized again, and your visible conversation stays as it is.",
      },
    ]);
  });

  it("filters the commands by what was typed after a leading slash", () => {
    expect(commandSuggestions("/")).toEqual(chatCommands);
    expect(commandSuggestions("/co")).toEqual(chatCommands);
    expect(commandSuggestions("/COMP")).toEqual(chatCommands);
    expect(commandSuggestions("/compact")).toEqual(chatCommands);
  });

  it("offers nothing for text that is no command being typed", () => {
    expect(commandSuggestions("")).toEqual([]);
    expect(commandSuggestions("/r")).toEqual([]);
    expect(commandSuggestions("/compact ")).toEqual([]);
    expect(commandSuggestions("what /co")).toEqual([]);
    expect(commandSuggestions(" /co")).toEqual([]);
  });
});
