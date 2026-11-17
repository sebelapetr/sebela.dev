import { ProseMarkdown, anchorId } from "../../_shared";
import type { ExplorationRow } from "../data/explorations";

/**
 * The independent R&D block: unreleased side work and experiments, apart from the career timeline,
 * as editorial rows in their order. Each names the exploration, then its stored status as visible
 * text with what it means (a designed one reads as an unimplemented design), one sentence and the
 * concepts involved in their stored order. The caller leaves the block out without explorations.
 */
export function IndependentRd({
  explorations,
}: {
  readonly explorations: readonly ExplorationRow[];
}) {
  return (
    <section
      id={anchorId({ kind: "independent-rd" })}
      tabIndex={-1}
      aria-labelledby="independent-rd-heading"
      className="anchor-target flex max-w-3xl flex-col gap-10"
    >
      <div className="flex flex-col gap-3">
        <h2 id="independent-rd-heading" className="type-heading">
          Independent R&amp;D
        </h2>
        <p className="max-w-prose text-pretty text-muted-foreground">
          Side work and experiments of my own, outside employment and client work. Each says how far
          it went.
        </p>
      </div>
      <ol aria-label="Explorations" className="flex flex-col gap-8">
        {explorations.map((exploration) => (
          <li
            key={exploration.slug}
            id={exploration.anchor}
            tabIndex={-1}
            className="anchor-target flex flex-col gap-3 border-l border-border pl-4"
          >
            <div className="flex flex-col gap-1.5">
              <h3 className="type-item">{exploration.name}</h3>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="type-tag rounded-sm border border-border px-1.5">
                  {exploration.statusLabel}
                </span>
                <span className="type-label text-balance">{exploration.statusMeaning}</span>
              </p>
            </div>
            <div className="max-w-prose text-muted-foreground [&>*+*]:mt-3">
              <ProseMarkdown>{exploration.summary}</ProseMarkdown>
            </div>
            {exploration.concepts.length === 0 ? null : (
              <ul
                aria-label={`${exploration.name} concepts`}
                className="type-label flex flex-wrap gap-x-3 gap-y-1"
              >
                {exploration.concepts.map((concept) => (
                  <li key={concept}>{concept}</li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
