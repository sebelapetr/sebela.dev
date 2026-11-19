import type { Hono } from "hono";

import type { McpAdminConfig } from "./config.js";

export type Logger = (line: string) => void;

export interface McpAdminApp {
  readonly app: Hono;
  close(): Promise<void>;
}

export interface McpAdminOptions {
  readonly config: McpAdminConfig;
  readonly fetch?: (request: Request) => Promise<Response>;
  readonly log?: Logger;
  readonly now?: () => number;
}

export function createMcpAdminApp(options: McpAdminOptions): McpAdminApp {
  throw new Error(`Not implemented for ${options.config.apiUrl}`);
}

export function startMcpAdminServer(options: {
  config: McpAdminConfig;
  log?: Logger;
}): Promise<{ url: string; close(): Promise<void> }> {
  return Promise.reject(new Error(`Not implemented for ${options.config.apiUrl}`));
}
