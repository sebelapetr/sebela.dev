// Deliberately hard-coded values behind type annotations and parameter defaults.
const port: number = 3000;
export function listen(apiPort: number = 3001): number {
  return apiPort;
}
export const DATABASE_NAME: string = "fixture_app";
export class Server {
  readonly port: number = 3002;
  private adminPort?: number | undefined = 3004;
}
export { port };
