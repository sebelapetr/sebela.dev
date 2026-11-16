// Deliberately hard-coded ports of a fictional server. Every code line below is a violation.
export const settings = { port: 3001 };
export const API_PORT = "3001";
export const apiPort = 3001;
export function start(server) {
  server.listen(3002);
}
export const fromEnvironment = process.env.API_PORT ?? 3001;
export const healthUrl = `http://${process.env.API_HOST}:3001/health`;
