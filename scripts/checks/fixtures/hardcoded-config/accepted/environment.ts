// Typed configuration read once from the environment.
export interface Config {
  readonly apiUrl: string;
  readonly webPort: number;
  readonly databaseName: string;
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const apiUrl = env["API_URL"];
  const webPort = Number(env["WEB_PORT"]);
  const databaseName = env["DATABASE_NAME"];
  if (!apiUrl || !Number.isInteger(webPort) || !databaseName) {
    throw new Error("API_URL, WEB_PORT and DATABASE_NAME must be set");
  }
  return { apiUrl, webPort, databaseName };
}
