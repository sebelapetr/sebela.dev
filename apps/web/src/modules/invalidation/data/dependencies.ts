import type { ContentChange, ContentDomain } from "@sebela/contracts";

export type CacheScope = "profile";

export const dependencyMap: Readonly<Record<ContentDomain, readonly CacheScope[]>> = {} as Readonly<
  Record<ContentDomain, readonly CacheScope[]>
>;

export function scopesFor(changes: readonly ContentChange[]): CacheScope[] {
  throw new Error(`scopesFor is not implemented (${String(changes.length)} changes)`);
}
