import { receiveInvalidation } from "../../../modules/invalidation";

/**
 * The API's signed invalidation notifications after committed content writes. POST only; every
 * other method is answered 405 by Next.
 */
export function POST(request: Request): Promise<Response> {
  return receiveInvalidation(request);
}
