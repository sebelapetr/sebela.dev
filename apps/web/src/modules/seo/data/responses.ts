import type { HomepageProfile, HomepageResult } from "../../profile";

export function profileTextResponse(
  result: HomepageResult,
  contentType: string,
  render: (profile: HomepageProfile) => string,
): Response {
  throw new Error(`not implemented: ${result.status} ${contentType} ${typeof render}`);
}

export function textResponse(body: string, contentType: string): Response {
  throw new Error(`not implemented: ${body} ${contentType}`);
}
