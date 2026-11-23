// The composer's slash commands. Only text that starts with a slash is read as a command; a slash
// anywhere else is part of an ordinary question. An unknown command is explained on the page and
// never sent, so a command never reaches the model as authority.

/** A command the composer offers, with the help it shows. */
export interface ChatCommand {
  readonly name: string;
  readonly description: string;
}

/** What the composer's text is: a question to send, a command to run, or neither. */
export type ComposerInput =
  | { readonly kind: "question" }
  | { readonly kind: "command"; readonly name: "compact" }
  | { readonly kind: "invalid"; readonly message: string };

/** The commands the composer offers. */
export const chatCommands: readonly ChatCommand[] = [
  {
    name: "/compact",
    description:
      "Summarize the assistant's current working context. History it already leaves out is not summarized again, and your visible conversation stays as it is.",
  },
];

/** The commands matching a command being typed: a leading slash and no space yet. */
export function commandSuggestions(text: string): readonly ChatCommand[] {
  if (!text.startsWith("/") || /\s/.test(text)) return [];
  const typed = text.toLowerCase();
  return chatCommands.filter((command) => command.name.startsWith(typed));
}

/** Reads the composer's text as a question, a command, or an invalid command explained locally. */
export function readComposerInput(text: string): ComposerInput {
  if (!text.startsWith("/")) return { kind: "question" };
  const [word = "/", ...rest] = text.trim().split(/\s+/);
  if (word.toLowerCase() === "/compact") {
    return rest.length === 0
      ? { kind: "command", name: "compact" }
      : { kind: "invalid", message: "/compact takes no text after it. Nothing was sent." };
  }
  return {
    kind: "invalid",
    message: `${word} is not a command. The only command is /compact. Nothing was sent; to ask this as a question, do not start it with a slash.`,
  };
}
