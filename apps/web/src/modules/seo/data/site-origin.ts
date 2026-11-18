import { readWebConfig } from "../../../config";

/** The canonical origin (`WEB_SITE_ORIGIN`), from the environment validated on every call. */
export function siteOrigin(): string {
  return readWebConfig(process.env).siteOrigin;
}
