// The repository's uv is the lower bound of `required-version` in the root pyproject.toml. It is a
// bound, not an exact pin, because Dependabot updates uv.lock with its own, newer uv and an exact
// pin refuses it (docs/git-workflow.md, Dependency pull requests). These tests keep the version
// controlled all the same: CI installs exactly the lower bound, the build backend starts at it and
// the documents name it.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const root = path.join(import.meta.dirname, "..", "..");
const read = (...segments) => readFileSync(path.join(root, ...segments), "utf8");

const requiredVersion = /^required-version = "([^"]*)"$/m.exec(read("pyproject.toml"))?.[1];
const uvVersion = /^>=(\d+\.\d+\.\d+)$/.exec(requiredVersion ?? "")?.[1];

/** The lines of every workflow step that uses `astral-sh/setup-uv`, by `file:line`. */
function setupUvSteps() {
  const steps = new Map();
  const folder = path.join(".github", "workflows");
  for (const name of readdirSync(path.join(root, folder))) {
    const lines = read(folder, name).split("\n");
    lines.forEach((line, index) => {
      const column = line.search(/uses: astral-sh\/setup-uv@/);
      if (column === -1) return;
      const step = [];
      for (const next of lines.slice(index + 1)) {
        if (next.trim() !== "" && next.search(/\S/) < column) break;
        step.push(next.trim());
      }
      steps.set(`${folder}/${name}:${index + 1}`, step);
    });
  }
  return steps;
}

describe("the uv version", () => {
  it("is a lower bound in the root pyproject.toml, so that Dependabot's newer uv runs", () => {
    assert.ok(
      uvVersion,
      `required-version must be a lower bound such as ">=1.2.3", not ${JSON.stringify(requiredVersion)}`,
    );
  });

  it("is installed in CI as exactly that lower bound", () => {
    const steps = setupUvSteps();
    assert.ok(steps.size > 0, "no workflow installs uv");
    for (const [where, step] of steps) {
      assert.ok(step.includes("version-file: pyproject.toml"), `${where} must read pyproject.toml`);
      assert.ok(
        step.includes("resolution-strategy: lowest"),
        `${where} must install the lowest uv that required-version admits`,
      );
      assert.ok(!step.some((line) => line.startsWith("version:")), `${where} names its own uv`);
    }
  });

  it("is where the build backend of every Python member starts", () => {
    const members = readdirSync(path.join(root, "packages"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join("packages", entry.name, "pyproject.toml"));
    const backends = members.flatMap((file) => {
      let text;
      try {
        text = read(file);
      } catch {
        return [];
      }
      const requirement = /"uv_build([^"]*)"/.exec(text)?.[1];
      return requirement === undefined ? [] : [[file, requirement]];
    });
    assert.ok(backends.length > 0, "no Python member builds with uv_build");
    for (const [file, requirement] of backends) {
      assert.ok(requirement.startsWith(`>=${uvVersion},`), `${file}: uv_build${requirement}`);
    }
  });

  it("is the one the documents name", () => {
    for (const file of [
      path.join("docs", "repository-structure.md"),
      path.join("docs", "code-standards.md"),
      path.join("packages", "llm-agent", "AGENTS.md"),
    ]) {
      const named = [...read(file).matchAll(/\buv[ |]+(\d+\.\d+\.\d+)/g)].map((match) => match[1]);
      assert.ok(named.length > 0, `${file} does not name the uv version`);
      assert.deepEqual([...new Set(named)], [uvVersion], file);
    }
  });
});
