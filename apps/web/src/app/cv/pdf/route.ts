import { connection } from "next/server";

import { cvPdfResponse } from "../../../modules/cv";
import { getCvPdfFile } from "../../../modules/profile";

/**
 * The CV PDF's download: the current manually uploaded file, read on every request. Without a PDF
 * it sends the visitor to the live CV; a file that cannot be served sends them to the failure page.
 */
export async function GET(): Promise<Response> {
  await connection();
  return cvPdfResponse(await getCvPdfFile());
}
