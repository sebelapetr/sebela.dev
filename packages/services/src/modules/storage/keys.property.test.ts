import fc from "fast-check";
import { describe, it } from "vitest";

import { fileNameOf, newKey, privateExtensions, storedExtensions } from "./keys.js";

/** Fixed, so a run is as long on every machine; a failure prints the seed that reproduces it. */
const numRuns = 500;

/** A folder name a storage's environment or worktree may have (`segmentPattern`). */
const folder = fc.stringMatching(/^[a-z0-9][a-z0-9-]{0,8}$/);

/** A storage's prefix: its environment, then its worktree when it has one. */
const anyPrefix = fc.array(folder, { minLength: 1, maxLength: 2 });

const extensionSets = [storedExtensions, privateExtensions] as const;

/** One accepted extension set, and an extension from it. */
const anyAccepted = fc
  .constantFrom(...extensionSets)
  .chain((extensions) =>
    fc.record({ extensions: fc.constant(extensions), extension: fc.constantFrom(...extensions) }),
  );

/** A name this storage could have generated, or one that only looks like it. */
const nameLike = fc.oneof(
  fc
    .record({ id: fc.uuid({ version: 4 }), extension: fc.constantFrom("png", "pdf", "md", "exe") })
    .map(({ id, extension }) => `${id}.${extension}`),
  fc.uuid({ version: 4 }),
);

/**
 * A key a caller may present: folders of the prefix, other folders, traversal, empty and dotted
 * segments and generated-looking names, in any order, or any text at all.
 */
function anyKeyFor(prefix: readonly string[]) {
  const segment = fc.oneof(
    fc.constantFrom(...prefix),
    folder,
    fc.constantFrom("..", ".", "", " ", "%2e%2e", "\\"),
    nameLike,
  );
  return fc.oneof(
    fc.array(segment, { minLength: 0, maxLength: 5 }).map((segments) => segments.join("/")),
    fc
      .tuple(fc.constantFrom("", "/", "./", "../"), nameLike)
      .map(([lead, name]) => [...prefix, `${lead}${name}`].join("/")),
    fc.string({ maxLength: 60 }),
  );
}

describe("storage keys (properties)", () => {
  it("every key the storage generates is accepted back, with its generated name", () => {
    fc.assert(
      fc.property(anyPrefix, anyAccepted, (prefix, { extensions, extension }) => {
        const key = newKey(prefix, extension, extensions);
        const name = fileNameOf(prefix, key, extensions);
        return name !== null && key === [...prefix, name].join("/");
      }),
      { numRuns },
    );
  });

  it("any accepted key is exactly the prefix folders and one generated name, never traversal", () => {
    fc.assert(
      fc.property(
        anyPrefix.chain((prefix) => fc.tuple(fc.constant(prefix), anyKeyFor(prefix))),
        fc.constantFrom(...extensionSets),
        ([prefix, key], extensions) => {
          const name = fileNameOf(prefix, key, extensions);
          if (name === null) return true;
          const segments = key.split("/");
          return (
            key === [...prefix, name].join("/") &&
            segments.every((segment) => segment !== "" && segment !== "." && segment !== "..") &&
            !name.includes("/") &&
            extensions.some((extension) => name.endsWith(`.${extension}`))
          );
        },
      ),
      { numRuns },
    );
  });

  it("a key generated under one prefix is never accepted by a storage with another prefix", () => {
    fc.assert(
      fc.property(anyPrefix, anyPrefix, anyAccepted, (own, other, { extensions, extension }) => {
        fc.pre(own.join("/") !== other.join("/"));
        return fileNameOf(other, newKey(own, extension, extensions), extensions) === null;
      }),
      { numRuns },
    );
  });
});
