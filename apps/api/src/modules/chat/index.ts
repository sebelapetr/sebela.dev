/**
 * The visitor chat over HTTP: the cookie-authorised visitor routes, the internal control routes the
 * AI service calls with its own token, the event stream of an operation, and the supervised
 * dispatch of admitted questions with its deadline watcher.
 */
export {
  chatCookieName,
  chatRouteDocumentation,
  registerChatRoutes,
  type ChatDispatcher,
  type ChatRouteOptions,
} from "./routes.js";
export type { ChatTiming } from "./stream.js";
export {
  createChatSupervisor,
  type ChatSupervisor,
  type ChatSupervisorOptions,
} from "./supervisor.js";
