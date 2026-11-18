import { connection } from "next/server";

import { getMediaFile } from "../../../modules/profile";

/**
 * A stored image on the site's own media path, the only source the image optimizer reads: the file
 * of that name directly below the media base, read fresh on every request.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ file: string }> },
): Promise<Response> {
  await connection();
  const { file } = await params;
  return getMediaFile(file);
}
