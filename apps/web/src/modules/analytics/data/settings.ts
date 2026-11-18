import { readAnalyticsConfig, type AnalyticsConfig } from "../../../config";

/**
 * Reads the analytics settings so that they can never stop a page: unusable settings turn
 * analytics off, and each distinct problem is logged once per process, naming the variable and
 * never its value (the error of `readAnalyticsConfig` carries none).
 */
export function createAnalyticsSettings(
  log: (line: string) => void,
): (env: Readonly<Record<string, string | undefined>>) => AnalyticsConfig | null {
  const reported = new Set<string>();
  return (env) => {
    try {
      return readAnalyticsConfig(env);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unreadable settings";
      if (!reported.has(message)) {
        reported.add(message);
        log(`analytics is off: ${message}`);
      }
      return null;
    }
  };
}
