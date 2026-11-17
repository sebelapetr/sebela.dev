/** Drops fields that are absent or `undefined`, so they stay unchanged. */
export function definedChanges<Fields extends object>(changes: object): Partial<Fields> {
  return Object.fromEntries(
    Object.entries(changes).filter(([, value]) => value !== undefined),
  ) as Partial<Fields>;
}
