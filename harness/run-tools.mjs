// What the loop's helpers (steward, preflight, phase report) share: quiet shell calls, transcripts
// of Claude Code sessions, and asking an agent for a structured answer.

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// A command's output, or null when it fails; never throws, never prints.
export function quiet(command, args, options = {}) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 30_000,
      ...options,
    });
  } catch {
    return null;
  }
}

export function readLines(file) {
  try {
    return fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
  } catch {
    return null;
  }
}

// Claude Code keeps a session's transcript under its project folder, named after the working
// directory with every character other than a letter or digit turned into "-".
export function transcriptDir(mainRoot) {
  const config = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
  return path.join(config, "projects", mainRoot.replace(/[^a-zA-Z0-9]/g, "-"));
}

// Runs a tool-less agent in print mode and returns its structured output, or null.
export function askAgent({ mainRoot, agent, prompt, schema, name, timeoutMs = 180_000 }) {
  const args = [
    "-p",
    prompt,
    "--agent",
    agent,
    "--tools",
    "",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(schema),
    "--setting-sources",
    "project,local",
    "--strict-mcp-config",
    "--name",
    name,
  ];
  return new Promise((resolve) => {
    const child = spawn("claude", args, {
      cwd: mainRoot,
      env: { ...process.env, SEBELA_UNATTENDED: "1", ENABLE_CLAUDEAI_MCP_SERVERS: "false" },
      stdio: ["ignore", "pipe", "ignore"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
    child.on("error", () => resolve(null));
    child.on("close", () => {
      clearTimeout(timer);
      try {
        resolve(JSON.parse(stdout).structured_output ?? null);
      } catch {
        resolve(null);
      }
    });
  });
}
