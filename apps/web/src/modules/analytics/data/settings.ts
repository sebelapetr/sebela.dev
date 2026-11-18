import type { AnalyticsConfig } from "../../../config";

export function createAnalyticsSettings(
  log: (line: string) => void,
): (env: Readonly<Record<string, string | undefined>>) => AnalyticsConfig | null {
  throw new Error(`Not implemented (${typeof log})`);
}
