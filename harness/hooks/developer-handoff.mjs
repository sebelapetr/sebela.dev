#!/usr/bin/env node
// Handoff gate for developer agents (docs/permissions.md, "Hooks"). Runs lint and typecheck of what
// the developer changed, in its worktree (../lib/handoff.mjs), and returns failures to it:
//
// - PreToolUse on SubagentHandback: a failing check refuses the handback, so the report does not
//   reach the caller until the checks pass.
// - SubagentStop: a failing check keeps the developer working once. When it stops again while still
//   failing (stop_hook_active), the failure is reported instead of blocking again, so the hook
//   cannot keep a developer in an endless loop.
//
// A general agent (`general-purpose`) does the work no developer agent owns: `.github/`,
// `scripts/`, `infra/` and `harness/` (docs/agents.md, Roles). It gets the same gate when a
// worktree it edited or committed in has changes under one of those folders, and none otherwise:
// a general agent that researched, reviewed, ran tests or changed only documentation hands back
// unchecked. Commands that only read or test, and the folder its session runs in, do not make a
// worktree its work.
//
// Other agents and the main session are not checked. Checks that cannot run count as failing.

import path from "node:path";
import fs from "node:fs";
import { GENERAL_AGENT_AREAS, checkHandoff } from "../lib/handoff.mjs";
import { mainRootFrom } from "../worktree.mjs";
import { readHookInput } from "./read-input.mjs";

const DEVELOPERS = new Set(["backend-developer", "frontend-developer", "ai-developer"]);
const GENERAL = "general-purpose";

// Claude Code keeps a subagent's transcript in `<session>/subagents/agent-<id>.jsonl` next to the
// session transcript; SubagentStop names it, PreToolUse only names the session's.
function transcriptOf(input) {
  if (input.agent_transcript_path) return input.agent_transcript_path;
  const session = input.transcript_path;
  if (!session) throw new Error("the hook input names no transcript");
  const own = `agent-${input.agent_id}.jsonl`;
  if (path.basename(session) === own) return session;
  return path.join(path.dirname(session), path.basename(session, ".jsonl"), "subagents", own);
}

function failureReport(input) {
  const mainRoot = mainRootFrom(process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd());
  let transcriptText;
  try {
    transcriptText = fs.readFileSync(transcriptOf(input), "utf8");
  } catch (error) {
    throw new Error(
      `could not read the agent's transcript to find its worktree (${error.message})`,
      { cause: error },
    );
  }
  const { results } = checkHandoff({
    mainRoot,
    cwd: input.cwd,
    transcriptText,
    areas: input.agent_type === GENERAL ? GENERAL_AGENT_AREAS : null,
    editsOnly: input.agent_type === GENERAL,
  });
  const failed = results.filter((result) => !result.ok);
  if (!failed.length) return null;
  return failed
    .map((result) => `In ${result.worktree}, \`${result.command}\` failed:\n\n${result.report}`)
    .join("\n\n");
}

function respond(output) {
  process.stdout.write(JSON.stringify(output));
}

const INTRO =
  "Handoff checks failed: lint and typecheck must pass for what you changed before you hand off (docs/permissions.md).";
const NEXT =
  "Fix the failures in that worktree and finish again. If they cannot be fixed within this issue, " +
  "stop and describe the failure instead of handing off.";

const input = await readHookInput().catch((error) => {
  process.stderr.write(`developer-handoff hook could not read its input: ${error.message}\n`);
  process.exit(1);
});

if (DEVELOPERS.has(input.agent_type) || input.agent_type === GENERAL) {
  let report;
  try {
    report = failureReport(input);
  } catch (error) {
    report = `The handoff checks could not run: ${error.message}`;
  }
  if (report) {
    const reason = `${INTRO}\n\n${report}\n\n${NEXT}`;
    if (input.hook_event_name === "PreToolUse") {
      respond({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: reason,
        },
      });
    } else if (input.stop_hook_active) {
      process.stderr.write(`${reason}\n`);
      respond({
        systemMessage: `${input.agent_type} stopped while its handoff checks still fail:\n\n${report}`,
      });
    } else {
      respond({ decision: "block", reason });
    }
  }
}
