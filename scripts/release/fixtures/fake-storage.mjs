// A fake Bunny Storage zone and Better Stack heartbeat in one in-process HTTP server, for the tests
// of infra/scripts/backup.sh and restore.sh and their round trip (backup.e2e.mjs). It speaks the
// part of the Bunny Storage HTTP API the scripts use, below `/<zone>/`:
//
//   PUT    /<zone>/<path>   stores the body (201); needs the zone's password in `AccessKey`
//   GET    /<zone>/<dir>/   lists the folder as Bunny does: a JSON array of `{ ObjectName, ... }`
//   GET    /<zone>/<path>   the stored file, or 404
//   DELETE /<zone>/<path>   removes the file (200), or 404 when there is none
//   GET    /heartbeat/<id>  a heartbeat ping (200)
//
// Every request without the right `AccessKey` is refused with 401 (the heartbeat needs none).
// `failures` makes chosen requests answer 500: `upload`, `list`, `download`, `heartbeat`, or
// `delete` with the names whose deletion fails.

import http from "node:http";

/**
 * Starts the server on a free port. Returns its base address, the zone's files (name -> Buffer,
 * the name relative to the zone), every request it answered, the heartbeat pings, the failures
 * to simulate (mutable) and `close()`.
 */
export async function startFakeStorage({ zone, password }) {
  const files = new Map();
  const requests = [];
  const failures = { upload: false, list: false, download: false, heartbeat: false, delete: [] };
  let heartbeats = 0;

  const server = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const url = new URL(request.url ?? "/", "http://storage");
      const pathname = decodeURIComponent(url.pathname);
      requests.push({ method: request.method, path: pathname, headers: request.headers });
      const answer = (status, body = "") => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(body);
      };

      if (pathname.startsWith("/heartbeat/") && request.method === "GET") {
        if (failures.heartbeat) return answer(500);
        heartbeats += 1;
        return answer(200, "OK");
      }
      const prefix = `/${zone}/`;
      if (!pathname.startsWith(prefix)) return answer(404);
      if (request.headers.accesskey !== password) return answer(401);
      const name = pathname.slice(prefix.length);

      if (request.method === "PUT") {
        if (failures.upload) return answer(500);
        files.set(name, Buffer.concat(chunks));
        return answer(201, '{"HttpCode":201,"Message":"File uploaded."}');
      }
      if (request.method === "GET" && name.endsWith("/")) {
        if (failures.list) return answer(500);
        const listed = [...files.keys()]
          .filter((key) => key.startsWith(name) && !key.slice(name.length).includes("/"))
          .map((key) => ({
            Guid: "00000000-0000-4000-8000-000000000000",
            StorageZoneName: zone,
            Path: `/${zone}/${name}`,
            ObjectName: key.slice(name.length),
            Length: files.get(key).length,
            IsDirectory: false,
          }));
        return answer(200, JSON.stringify(listed));
      }
      if (request.method === "GET") {
        if (failures.download) return answer(500);
        const file = files.get(name);
        if (!file) return answer(404);
        response.writeHead(200, { "content-type": "application/octet-stream" });
        return response.end(file);
      }
      if (request.method === "DELETE") {
        if (failures.delete.some((entry) => name.endsWith(`/${entry}`))) return answer(500);
        if (!files.delete(name)) return answer(404);
        return answer(200, '{"HttpCode":200,"Message":"File deleted successfuly."}');
      }
      return answer(405);
    });
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const address = server.address();
  // The server listens on every interface, so its own address reaches it.
  const host = address.family === "IPv6" ? `[${address.address}]` : address.address;
  return {
    base: `http://${host}:${address.port}`,
    files,
    requests,
    failures,
    heartbeats: () => heartbeats,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
