/** The principles the roadmap follows and how its weights are meant, as a card under the tree. */
export function LearningApproach() {
  return (
    <section aria-labelledby="learning-approach-heading" className="rounded-lg bg-card p-4 sm:p-6">
      <div className="space-y-4">
        <div>
          <h2 id="learning-approach-heading" className="text-sm font-medium text-foreground">
            Learning approach
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            The roadmap follows three principles:
          </p>
        </div>
        <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
          <li>
            Build on existing software-engineering experience instead of starting again as a junior
            developer.
          </li>
          <li>
            Prioritize production systems, measurable quality, and reliability over framework
            knowledge or isolated demos.
          </li>
          <li>
            Spend approximately 40% of learning time on study and 60% on implementation,
            experimentation, and documentation.
          </li>
        </ol>
        <p className="text-xs text-muted-foreground">
          Some resources are long-term commitments (like books) and topics often overlap across
          resources. You&apos;ll encounter concepts you&apos;ve already learned, but also discover
          new perspectives and extensions. This means you&apos;ll spend less time on each resource
          than if you studied them in complete isolation - the knowledge compounds.
        </p>
        <p className="text-xs text-muted-foreground">
          The dots beside each area show its recommended share of the total learning effort.
        </p>
      </div>
    </section>
  );
}
