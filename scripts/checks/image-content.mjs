#!/usr/bin/env node
// The image-content check: fails when a built image contains an environment file other than the
// example, anything from the private notes folder, the secrets file or a seed other than the
// fictional demo.

/**
 * The entries of an image's file system listing (`tar -t` paths) the check refuses, each with its
 * reason, in the listing's order.
 *
 * @param {readonly string[]} paths
 * @returns {{ path: string, reason: string }[]}
 */
export function forbiddenEntries(paths) {
  throw new Error(`not implemented: ${String(paths.length)}`);
}
