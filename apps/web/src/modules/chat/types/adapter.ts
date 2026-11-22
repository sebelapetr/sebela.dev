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
 */
export interface ChatAdapter {
  restore(options: {
    readonly before?: string | null;
    readonly signal: AbortSignal;
  }): Promise<unknown>;
  send(question: ChatQuestion, options: { readonly signal: AbortSignal }): AsyncIterable<unknown>;
}
