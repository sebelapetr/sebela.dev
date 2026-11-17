/**
 * The place of the hero's chat entry, between the short bio and the calls to action
 * (docs/design.md, Hero). It is sized for one input line of 48 px and one row of suggested
 * questions of 44 px with 12 px between them (104 px in all), so the chat entry (#51) fills it
 * without moving anything else. Until then it is empty space: no control, nothing that looks
 * usable.
 */
export function ChatSlot() {
  return <div data-testid="hero-chat-slot" className="min-h-26" />;
}
