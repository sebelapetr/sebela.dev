import type { ChatSubmission } from "@sebela/contracts";

/**
 * Where the chat sends a question and receives its answer: the one seam between the chat's state
 * and a transport. The phase 3 mock implements it in the browser; phase 7 implements it over the
 * API's chat route without touching the state or the components.
 *
 * `send` yields the attempt's raw events in arrival order and ends when the transport has nothing
 * more. It does not validate them: the conversation checks every event against the contract
 * (`@sebela/contracts`, chat), so a broken transport fails the attempt instead of the page. A
 * stream that ends before its terminal event is an interrupted attempt. When `signal` aborts, the
 * adapter stops yielding; events that still arrive are ignored by the caller.
 */
export interface ChatAdapter {
  send(
    submission: ChatSubmission,
    options: { readonly signal: AbortSignal },
  ): AsyncIterable<unknown>;
}
