import { ProseMarkdown } from "../../_shared";
import type { CollaborationStepRow } from "../data/services";

/**
 * How a collaboration runs: the stored steps in their order as numbered rows. The caller leaves
 * the section out without steps.
 */
export function Collaboration({ steps }: { readonly steps: readonly CollaborationStepRow[] }) {
  return (
    <section aria-labelledby="collaboration-heading" className="flex max-w-3xl flex-col gap-10">
      <div className="flex flex-col gap-3">
        <h2 id="collaboration-heading" className="type-heading">
          How I work
        </h2>
        <p className="max-w-prose text-pretty text-muted-foreground">
          How a collaboration usually runs. The steps adapt to the project.
        </p>
      </div>
      <ol aria-label="Collaboration steps" className="grid gap-8 sm:grid-cols-2">
        {steps.map((step) => (
          <li key={step.number} className="flex flex-col gap-3 border-l border-border pl-4">
            <div className="flex flex-col gap-1">
              <span aria-hidden="true" className="type-label text-foreground">
                {step.number}
              </span>
              <h3 className="type-item">{step.title}</h3>
            </div>
            <div className="max-w-prose text-pretty text-muted-foreground [&>*+*]:mt-3">
              <ProseMarkdown>{step.description}</ProseMarkdown>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
