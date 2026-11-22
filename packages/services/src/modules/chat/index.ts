/**
 * The visitor chat: one first-party cookie identity with its single conversation, admission of a
 * question behind the bot challenge, quotas and the global spend budget, the one-use generation
 * grant, reconciling one approved result, the deadline and retention. Callers get contract
 * shapes; cookie values, grants and challenge tokens are only ever stored as one-way digests.
 */
export { chatPolicy } from "./policy.js";
export type { ChatPolicy } from "./policy.js";
export { createChatService, unconfiguredChat } from "./service.js";
export { createSiteverifyVerifier, readChatOptions, siteverifyUrl } from "./siteverify.js";
export type { SiteverifyOptions } from "./siteverify.js";
export type {
  ChallengeVerifier,
  ChatCaller,
  ChatClaimOutcome,
  ChatClearOutcome,
  ChatConfig,
  ChatDispatch,
  ChatHistoryExchange,
  ChatObservation,
  ChatOpened,
  ChatOptions,
  ChatReconcileOutcome,
  ChatRetryOutcome,
  ChatService,
  ChatServiceOptions,
  ChatStopOutcome,
  ChatSubmitResult,
} from "./types.js";
