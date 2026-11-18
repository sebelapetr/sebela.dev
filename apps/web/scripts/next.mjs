// Starts `next dev` or `next start` on this checkout's own address: WEB_HOST and WEB_PORT come from
// the environment (each worktree has its own port in `.env.local`), never from a default.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const [command, ...rest] = process.argv.slice(2);
if (command !== "dev" && command !== "start") {
  console.error("Usage: next.mjs dev|start [next options]");
  process.exit(2);
}

const missing = ["WEB_HOST", "WEB_PORT"].filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`next.mjs: set ${missing.join(" and ")} (documented in .env.example)`);
  process.exit(1);
}

const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
const child = spawn(
  process.execPath,
  [next, command, "--hostname", process.env.WEB_HOST, "--port", process.env.WEB_PORT, ...rest],
  { stdio: "inherit" },
);

for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
