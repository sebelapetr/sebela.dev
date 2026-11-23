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
export const chatCommands: readonly ChatCommand[] = [];

/** The commands matching a command being typed: a leading slash and no space yet. */
export declare function commandSuggestions(text: string): readonly ChatCommand[];

/** Reads the composer's text as a question, a command, or an invalid command explained locally. */
export declare function readComposerInput(text: string): ComposerInput;
