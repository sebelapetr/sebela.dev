import { describe, expect, it } from "vitest";

import { askSuggestions, heroSuggestions } from "./suggestions";

const NAME = "Casey Morrow";

const HIRING = `Would ${NAME} fit an AI engineering role?`;
const CLIENTS = `What could ${NAME} automate for my company?`;
const TECHNICAL = `What are ${NAME}'s strongest engineering skills?`;
const GENERAL = `What is ${NAME} working on now?`;

describe("askSuggestions", () => {
  it("offers four questions, one per kind of visitor, about the person by name", () => {
    expect(askSuggestions(NAME).map(({ audience, question }) => [audience, question])).toEqual([
      ["hiring", HIRING],
      ["clients", CLIENTS],
      ["technical", TECHNICAL],
      ["general", GENERAL],
    ]);
  });

  it("gives every suggestion a short label for the hero", () => {
    for (const suggestion of askSuggestions(NAME)) {
      expect(suggestion.label.length).toBeGreaterThan(0);
      expect(suggestion.label.length).toBeLessThanOrEqual(20);
    }
  });
});

describe("heroSuggestions", () => {
  it("offers at most three of the Ask suggestions, never the narrow technical one", () => {
    const hero = heroSuggestions(NAME);
    expect(hero.length).toBeGreaterThanOrEqual(2);
    expect(hero.length).toBeLessThanOrEqual(3);
    for (const suggestion of hero) expect(askSuggestions(NAME)).toContainEqual(suggestion);
    expect(hero.map((suggestion) => suggestion.audience)).not.toContain("technical");
  });
});
