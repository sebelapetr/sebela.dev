// The chat module: the hero's chat entry and the Ask page's chat, over the shared chat contract
// (`@sebela/contracts`). A conversation lives in the tab and is answered through a `ChatAdapter`:
// in phase 3 prepared answers streamed in the browser, in phase 7 the API. The question travels
// from the hero to its conversation in the tab, never in the address. Importable from client
// components; no server-only code.
export { HeroChatEntry } from "./components/hero-chat-entry";
export { AskTemplate } from "./templates/ask";
