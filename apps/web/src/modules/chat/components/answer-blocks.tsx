import type { ChatBlock, ChatSource } from "@sebela/contracts";

/** One typed block of an answer, shown only when its whole payload validates. */
export function AnswerBlock(props: { readonly block: ChatBlock }): never {
  throw new Error(`not implemented for ${props.block.type}`);
}

/** The places an answer rests on, in order; nothing without any. */
export function AnswerSources(props: { readonly sources: readonly ChatSource[] }): never {
  throw new Error(`not implemented for ${String(props.sources.length)} sources`);
}
