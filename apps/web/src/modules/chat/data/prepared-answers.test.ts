import { describe, expect, it } from "vitest";

import { ChatRelatedLinkSchema } from "@sebela/contracts";

import { askSuggestions, heroSuggestions, preparedAnswer } from "./prepared-answers";

const NAME = "Casey Morrow";

describe("askSuggestions", () => {
  it("offers four questions, one per kind of visitor, about the person by name", () => {
    expect(askSuggestions(NAME).map(({ audience, question }) => [audience, question])).toEqual([
      ["hiring", "Would Casey Morrow fit an AI engineering role?"],
      ["clients", "What could Casey Morrow automate for my company?"],
      ["technical", "What are Casey Morrow's strongest engineering skills?"],
      ["general", "What is Casey Morrow working on now?"],
    ]);
  });

  it("gives every suggestion a short label for the hero", () => {
    for (const suggestion of askSuggestions(NAME)) {
      expect(suggestion.label.length).toBeGreaterThan(0);
      expect(suggestion.label.length).toBeLessThanOrEqual(32);
    }
  });
});

describe("heroSuggestions", () => {
  it("offers at most three of the Ask suggestions, never the one without evidence", () => {
    const hero = heroSuggestions(NAME);
    expect(hero.length).toBeGreaterThanOrEqual(2);
    expect(hero.length).toBeLessThanOrEqual(3);
    for (const suggestion of hero) expect(askSuggestions(NAME)).toContainEqual(suggestion);
    expect(hero.map((suggestion) => suggestion.audience)).not.toContain("technical");
  });
});

describe("preparedAnswer", () => {
  it("answers every suggested question from its prepared answer", () => {
    const outcomes = askSuggestions(NAME).map(
      (suggestion) => preparedAnswer(NAME, suggestion.question).outcome,
    );
    expect(outcomes).toEqual(["answered", "answered", "insufficient_evidence", "answered"]);
  });

  it("recognises a suggested question however it is spaced, cased or punctuated", () => {
    expect(preparedAnswer(NAME, "  what is casey   morrow working on NOW  ")).toEqual(
      preparedAnswer(NAME, "What is Casey Morrow working on now?"),
    );
  });

  it("says it lacks evidence instead of ranking skills the profile does not support", () => {
    const answer = preparedAnswer(NAME, "What are Casey Morrow's strongest engineering skills?");
    expect(answer.text).toContain("I don't have enough evidence in Casey Morrow's public profile");
  });

  it("tells any other question that the assistant is not connected yet, with the main pages", () => {
    const answer = preparedAnswer(NAME, "What is the capital of a fictional country?");
    expect(answer.outcome).toBe("unavailable");
    expect(answer.text).toContain("not connected yet");
    expect(answer.related.map((link) => link.href)).toEqual(["/experience", "/services"]);
  });

  it("speaks about the person, never as the person", () => {
    const questions = [
      ...askSuggestions(NAME).map((suggestion) => suggestion.question),
      "Something unknown?",
    ];
    for (const question of questions) {
      const { text } = preparedAnswer(NAME, question);
      expect(text).toContain(NAME);
      expect(text).not.toMatch(/\b(I am|I'm|I've|I have worked|my experience|my work)\b/i);
    }
  });

  it("gives every answer one or two valid related links onward", () => {
    const questions = [
      ...askSuggestions(NAME).map((suggestion) => suggestion.question),
      "Something unknown?",
    ];
    for (const question of questions) {
      const { related } = preparedAnswer(NAME, question);
      expect(related.length).toBeGreaterThanOrEqual(1);
      expect(related.length).toBeLessThanOrEqual(2);
      for (const link of related) expect(ChatRelatedLinkSchema.safeParse(link).success).toBe(true);
    }
  });
});
