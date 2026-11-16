import { test } from "node:test";
import assert from "node:assert/strict";
import { checkCommitMessage } from "./commit-message.mjs";

function errorsOf(message) {
  return checkCommitMessage(message).errors;
}

test("accepts Conventional Commits headers with the documented types", () => {
  for (const message of [
    "feat(api): add experience endpoints",
    "fix: keep the slot when setup fails",
    "docs: describe manual cleanup of worktree databases",
    "refactor(db): split the profile repositories",
    "test(services): cover technology replacement",
    "chore(config): bump typescript-eslint",
    "ci: cache the pnpm store",
    "feat(api)!: drop the legacy profile route",
    "feat(mcp-admin): add the publish tool",
    "fix(api): accept OpenAPI 3.1 documents",
  ]) {
    assert.deepEqual(errorsOf(message), [], message);
  }
});

test("accepts a body and trailers after one blank line", () => {
  const message = [
    "feat(harness): check commit messages",
    "",
    "The commit-msg hook validates the header.",
    "",
    "Co-Authored-By: Fixture Person <fixture@example.invalid>",
    "",
  ].join("\n");
  assert.deepEqual(errorsOf(message), []);
});

test("ignores comment lines and everything below the scissors line", () => {
  const message = [
    "fix: trim the summary",
    "# Please enter the commit message for your changes.",
    "# ------------------------ >8 ------------------------",
    "diff --git a/x b/x",
    "This Is Not Part Of The Message.",
  ].join("\n");
  assert.deepEqual(errorsOf(message), []);
});

test("accepts messages that Git itself generates", () => {
  for (const message of [
    "Merge branch 'phase/01-foundation' into feat/19-handoff-quality-checks",
    "Merge remote-tracking branch 'origin/phase/01-foundation'",
    'Revert "feat(api): add experience endpoints"',
    "fixup! feat(api): add experience endpoints",
    "squash! feat(api): add experience endpoints",
    "amend! feat(api): add experience endpoints",
  ]) {
    assert.deepEqual(errorsOf(message), [], message);
  }
});

test("rejects a header that is not in Conventional Commits form", () => {
  for (const message of [
    "Add experience endpoints",
    "feat add endpoints",
    "feat:add endpoints",
    "feat(): add",
  ]) {
    const errors = errorsOf(message);
    assert.equal(errors.length, 1, message);
    assert.match(errors[0], /<type>\(<scope>\): <summary>/);
  }
});

test("rejects an unknown type and names the allowed ones", () => {
  const [error] = errorsOf("feature(api): add experience endpoints");
  assert.match(error, /"feature"/);
  assert.match(error, /feat, fix, docs, refactor, test, chore, ci/);
});

test("rejects a type or scope that is not lower case", () => {
  assert.equal(errorsOf("Feat(api): add endpoints").length, 1);
  assert.equal(errorsOf("feat(API): add endpoints").length, 1);
  assert.equal(errorsOf("feat(my scope): add endpoints").length, 1);
});

test("rejects a summary that starts with a capital letter or ends with a period", () => {
  assert.match(errorsOf("feat(api): Add experience endpoints")[0], /lower case/);
  assert.match(errorsOf("feat(api): add experience endpoints.")[0], /period/);
  assert.equal(errorsOf("feat(api): Add experience endpoints.").length, 2);
});

test("rejects a body that does not follow a blank line", () => {
  assert.match(errorsOf("feat(api): add endpoints\nMore text here")[0], /blank line/);
});

test("rejects an empty message", () => {
  assert.match(errorsOf("")[0], /empty/);
  assert.match(errorsOf("\n# only a comment\n")[0], /empty/);
});

test("reports validity alongside the errors", () => {
  assert.equal(checkCommitMessage("feat: add endpoints").valid, true);
  assert.equal(checkCommitMessage("Add endpoints").valid, false);
});

test("can refuse autosquash markers, which only an issue branch's squash merge removes", () => {
  for (const message of [
    "fixup! feat(api): add experience endpoints",
    "squash! feat(api): add experience endpoints",
    "amend! feat(api): add experience endpoints",
  ]) {
    const { valid, errors } = checkCommitMessage(message, { autosquash: false });
    assert.equal(valid, false, message);
    assert.match(errors[0], /squash/, message);
  }
  assert.deepEqual(
    checkCommitMessage("Merge pull request #7 from owner/phase/01-foundation", {
      autosquash: false,
    }).errors,
    [],
  );
});

test("can refuse merge headers, for a title that becomes a squash commit", () => {
  const { valid, errors } = checkCommitMessage("Merge branch 'phase/01-foundation'", {
    merge: false,
  });
  assert.equal(valid, false);
  assert.match(errors[0], /<type>\(<scope>\): <summary>/);
  assert.deepEqual(
    checkCommitMessage('Revert "feat(api): add experience endpoints"', { merge: false }).errors,
    [],
  );
});
