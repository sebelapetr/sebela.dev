#!/usr/bin/env node
// The phase report, written when the phase pull request opens (or run by hand):
//
//   node harness/phase-report.mjs <phase-folder> [--no-model]
//
// Reads the loop's logs in .worktrees/logs/<phase>/ and the transcripts they name, and writes
// report.md next to them: cost and time per issue, review rounds, eval spend, the steward's findings, guard
// refusals and the agent memory that changed. The `retrospective` agent then suggests what of
// that memory belongs in docs. Rules: lib/phase-report.mjs; intent: docs/agents.md.

import fs from "node:fs";
import path from "node:path";
import { countDispatches, iterationStats, renderReport } from "./lib/phase-report.mjs";
import { summarizeTranscript } from "./lib/steward.mjs";
import { askAgent, readLines, transcriptDir } from "./run-tools.mjs";
import { mainRootFrom } from "./worktree.mjs";

const ITERATION_LOG = /^\d{4}-.*-\d+\.json$/;
const MEMORY_CHARS = 4_000;

export const SUGGESTIONS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["suggestions"],
  properties: { suggestions: { type: "array", items: { type: "string" } } },
};

function sessionLines(dir, sessionId) {
  const main = readLines(path.join(dir, `${sessionId}.jsonl`)) ?? [];
  let subagents = [];
  try {
    const subDir = path.join(dir, sessionId, "subagents");
    subagents = fs
      .readdirSync(subDir)
      .filter((name) => name.endsWith(".jsonl"))
      .map((name) => readLines(path.join(subDir, name)) ?? []);
  } catch {
    // no subagents
  }
  return { main, subagents };
}

function changedMemory(mainRoot, since) {
  const root = path.join(mainRoot, ".claude", "agent-memory-local");
  const files = [];
  let agents;
  try {
    agents = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory());
  } catch {
    return files;
  }
  for (const { name: agent } of agents) {
    for (const file of fs.readdirSync(path.join(root, agent))) {
      const full = path.join(root, agent, file);
      if (file.endsWith(".md") && fs.statSync(full).mtimeMs >= since) {
        files.push({ agent, file, text: fs.readFileSync(full, "utf8").slice(0, MEMORY_CHARS) });
      }
    }
  }
  return files;
}

async function suggest({ mainRoot, phase, report, memory }) {
  if (memory.length === 0) return null;
  const prompt = [
    `Phase ${phase} of the unattended loop has finished. Follow your agent definition.`,
    `The phase report:\n${report}`,
    ...memory.map((m) => `Agent memory ${m.agent}/${m.file}:\n${m.text}`),
  ].join("\n\n");
  const answer = await askAgent({
    mainRoot,
    agent: "retrospective",
    prompt,
    schema: SUGGESTIONS_SCHEMA,
    name: `retrospective ${phase}`,
  });
  return answer?.suggestions?.length ? answer.suggestions.map((s) => `- ${s}`).join("\n") : null;
}

export async function writePhaseReport({ mainRoot, phase, model = true }) {
  const logDir = path.join(mainRoot, ".worktrees", "logs", phase);
  const dir = transcriptDir(mainRoot);
  const files = fs
    .readdirSync(logDir)
    .filter((name) => ITERATION_LOG.test(name))
    .sort();
  const iterations = files.map((name) => {
    const log = JSON.parse(fs.readFileSync(path.join(logDir, name), "utf8"));
    const stats = iterationStats(log);
    const { main, subagents } = stats.sessionId
      ? sessionLines(dir, stats.sessionId)
      : { main: [], subagents: [] };
    const refusals = [main, ...subagents].flatMap(
      (lines) => summarizeTranscript(lines, { windowMinutes: Infinity }).refusals,
    );
    return { ...stats, dispatches: countDispatches(main), refusals, spend: log.spend ?? null };
  });
  const steward = (readLines(path.join(logDir, "steward.jsonl")) ?? []).flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
  const since = files.length ? fs.statSync(path.join(logDir, files[0])).mtimeMs - 60 * 60_000 : 0;
  const memory = changedMemory(mainRoot, since);
  const input = { phase, iterations, steward, memory, suggestions: null };
  const draft = renderReport(input);
  const suggestions = model ? await suggest({ mainRoot, phase, report: draft, memory }) : null;
  const file = path.join(logDir, "report.md");
  fs.writeFileSync(file, renderReport({ ...input, suggestions }));
  return file;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const phase = process.argv[2];
  if (!phase) {
    console.error("usage: phase-report.mjs <phase-folder> [--no-model]");
    process.exit(64);
  }
  writePhaseReport({
    mainRoot: mainRootFrom(),
    phase,
    model: !process.argv.includes("--no-model"),
  }).then((file) => console.log(file));
}
