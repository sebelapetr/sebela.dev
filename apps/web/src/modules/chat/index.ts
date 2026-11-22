// The chat module: the hero's chat entry and the Ask page's chat, over the shared chat contract
// (`@sebela/contracts`). The visitor's conversation is stored by the API and reached through the
// website's same-origin chat routes (`modules/chat-relay`) by a `ChatAdapter`; a new question needs a
// person check (Turnstile). The hero hands its question to the Ask page in the tab, never in the
// address. Importable from client components; no server-only code.
export { HeroChatEntry } from "./components/hero-chat-entry";
export { AskTemplate } from "./templates/ask";
