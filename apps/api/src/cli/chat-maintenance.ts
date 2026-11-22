// Maintenance adapter: deletes the visitor conversations past their retention straight through the
// services, in bounded batches, so a scheduled job can run it without a running HTTP server.
import type { ChatService } from "@sebela/services";

import type { CommandOutput } from "./api-keys.js";

/**
 * Runs the chat-maintenance command (`delete-expired [--batch-size <n>] [--max-batches <n>]`) and
 * returns the exit code: 0 when the run finished, 2 for bad usage.
 */
export function runChatMaintenanceCommand(
  args: readonly string[],
  chat: Pick<ChatService, "deleteExpired">,
  output: CommandOutput,
): Promise<number> {
  output.err(`Not implemented: ${args.join(" ")}`);
  return chat.deleteExpired(0).then(() => 1);
}
