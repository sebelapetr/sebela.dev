const DEFAULT_GREETING = "Hello";

/**
 * Greets `name` with the greeting configured for the environment: `"Ahoj, Petr!"`.
 *
 * The greeting is `TRIAL_GREETING`. In a worktree it comes from that worktree's `.env.local`,
 * which Node loads when started with `--env-file-if-exists=.env.local`. Without it, or when it
 * is empty, the greeting is `"Hello"`.
 *
 * @param {string} name
 * @param {Record<string, string | undefined>} [env] the environment to read; `process.env` by default
 * @returns {string}
 */
export function greet(name, env = process.env) {
  const greeting = env.TRIAL_GREETING || DEFAULT_GREETING;
  return `${greeting}, ${name}!`;
}
