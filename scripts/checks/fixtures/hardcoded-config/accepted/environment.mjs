// The environment-based equivalent of the rejected fixtures. A full-line comment is
// documentation, so it may show an address such as http://localhost:3001/health.
/*
 * So may a block comment: postgres://fixture@localhost:5440/fixture, database "fixture".
 */
export const port = Number(process.env.API_PORT);
export const host = process.env["API_HOST"];
export const healthUrl = `http://${host}:${port}/health`;
export function start(server) {
  server.listen(port);
}
export const database = process.env.DATABASE_NAME;
export const connection = { database, port: Number(process.env.API_PORT) };
export const connectionString = `postgres://${process.env.DATABASE_USER}@${host}/${database}`;
export const statement = `CREATE DATABASE "${database}"`;
export const PORT_STEP = 10;
export const timeoutMs = 30_000;
export const mode = process.env.NODE_ENV ?? "development";
export function report(transport) {
  return transport.export({ port });
}
/* Documentation before code: port 3000 on localhost. */ export const documented = port;
