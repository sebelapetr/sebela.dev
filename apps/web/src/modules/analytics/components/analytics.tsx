import { connection } from "next/server";

import { createAnalyticsSettings } from "../data/settings";
import { PageViews } from "./page-views";

const settings = createAnalyticsSettings((line) => {
  process.stderr.write(`${line}\n`);
});

/**
 * The optional analytics integration, read from the server environment on every request: nothing
 * at all without usable settings, otherwise the tracker and its page views.
 */
export async function Analytics() {
  await connection();
  const config = settings(process.env);
  if (config === null) return null;
  return <PageViews scriptUrl={config.scriptUrl} websiteId={config.websiteId} />;
}
