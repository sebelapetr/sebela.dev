// Maintenance adapter: uploads one file from disk over the authenticated media route (issue #201).

export interface CommandOutput {
  out(text: string): void;
  err(text: string): void;
}

export interface MediaCommandContext {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly cwd: string;
  readonly fetch: (input: string, init?: RequestInit) => Promise<Response>;
}

export async function runMediaCommand(
  args: readonly string[],
  context: MediaCommandContext,
  output: CommandOutput,
): Promise<number> {
  output.err(`Not implemented: ${args.join(" ")} in ${context.cwd}\n`);
  return Promise.resolve(3);
}
