"use client";

import { cn } from "@sebela/ui/lib/utils";

import type { ChatCommand } from "../data/commands";

/** The listbox's element ID, which the composer's combobox controls. */
export const commandMenuId = "ask-commands";

/** The element ID of the option at `index`, for the combobox's active descendant. */
export const commandOptionId = (index: number) => `${commandMenuId}-${String(index)}`;

/**
 * The composer's command suggestions: a listbox above the input, each option the command and what
 * it does. Focus stays in the input, which moves the active option with the arrow keys; a tap or
 * click chooses an option without taking focus from the input.
 */
export function CommandMenu({
  commands,
  active,
  onChoose,
}: {
  readonly commands: readonly ChatCommand[];
  /** The option the arrow keys are on; -1 for none. */
  readonly active: number;
  readonly onChoose: (command: ChatCommand) => void;
}) {
  return (
    <ul
      id={commandMenuId}
      role="listbox"
      aria-label="Commands"
      className="mb-3 flex flex-col gap-1 rounded-xl border border-border bg-background p-1"
    >
      {commands.map((command, index) => (
        <li
          key={command.name}
          id={commandOptionId(index)}
          role="option"
          aria-selected={index === active}
          className={cn(
            "flex min-h-11 cursor-pointer flex-col gap-1 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted",
            index === active && "bg-muted",
          )}
          onPointerDown={(event) => {
            // Keeps focus (and the on-screen keyboard) in the input.
            event.preventDefault();
          }}
          onClick={() => {
            onChoose(command);
          }}
        >
          <span className="font-mono text-sm font-medium">{command.name}</span>
          <span className="text-sm text-pretty text-muted-foreground">{command.description}</span>
        </li>
      ))}
    </ul>
  );
}
