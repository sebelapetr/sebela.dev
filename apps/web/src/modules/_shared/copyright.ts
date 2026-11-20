/** The footer's copyright line: "© <year> <name>", the year alone when no name could be read. */
export function copyrightLine(name: string | null, today: Date): string {
  throw new Error("not implemented", { cause: { name, today } });
}
