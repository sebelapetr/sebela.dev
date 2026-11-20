#!/usr/bin/env node
// Release decisions for the images of a push to master (docs/release-workflow.md, "Images").

export const SERVICES = ["api", "web", "mcp-admin"];

export function affectedPackages(output) {
  throw new Error(`not implemented: ${typeof output}`);
}

export function affectedServices({ packages, changedFiles }) {
  throw new Error(`not implemented: ${String(packages)} ${String(changedFiles)}`);
}

export function comparisonBase(before) {
  throw new Error(`not implemented: ${String(before)}`);
}

export function releasePlan({ sha, affected, current }) {
  throw new Error(`not implemented: ${sha} ${String(affected)} ${String(current)}`);
}

export function formatOutputs(outputs) {
  throw new Error(`not implemented: ${String(outputs)}`);
}
