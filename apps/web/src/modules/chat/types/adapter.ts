/** One question as a transport sends it: its request (reused by a retry) and its text. */
export interface ChatQuestion {
  readonly requestId: string;
  readonly question: string;
}

/**
 * Where the chat reads the visitor's conversation and sends a question: the one seam between the
 * chat's state and a transport. The API adapter implements it over the website's same-origin chat
 * routes; the tests implement it by hand.
 *
 * `restore` reads one page of the caller's stored conversation (the newest, or the one before the
 * message `before`) and returns it unchecked; it throws when it cannot be read. The conversation
 * checks it against the contract.
 *
 * `send` yields the attempt's raw events in arrival order — answer events and signs of life — and
 * ends when the transport has nothing more. It does not validate them: the conversation checks
 * every event against the contract (`@sebela/contracts`, chat), so a broken transport fails the
 * attempt instead of the page. A stream that ends before its terminal event is an interrupted
 * attempt. A question the API did not admit throws a `ChatAdmissionError` before any event. When
 * `signal` aborts, the adapter stops yielding; events that still arrive are ignored by the caller.
 *
 * `retry` asks the same request again under the caller's `retryId` and yields that attempt's raw
 * events as `send` does; an attempt the transport never saw end is only followed again. It throws a
 * `ChatAdmissionError` before any event when the API does not admit it (`not_retryable` when the
 * attempt is no longer the request's latest failure).
 *
 * `stop` asks the API to stop the request's open attempt: "stopped" when it was asked (the attempt's
 * stream then ends with a cancelled error), "none" when no attempt of the request was admitted, so
 * none will ever run. It throws when the API cannot be asked.
 *
 * `clear` deletes the conversation `conversationId` names and returns the API's answer unchecked
 * (whether it was cleared, the conversation now shown and whether copies are still to be deleted);
 * it throws when the API cannot be asked.
 */
export interface ChatAdapter {
  restore(options: {
    readonly before?: string | null;
    readonly signal: AbortSignal;
  }): Promise<unknown>;
  send(question: ChatQuestion, options: { readonly signal: AbortSignal }): AsyncIterable<unknown>;
  retry(
    question: ChatQuestion,
    options: { readonly retryId: string; readonly signal: AbortSignal },
  ): AsyncIterable<unknown>;
  stop(requestId: string, options: { readonly signal: AbortSignal }): Promise<"stopped" | "none">;
  clear(conversationId: string, options: { readonly signal: AbortSignal }): Promise<unknown>;
}
