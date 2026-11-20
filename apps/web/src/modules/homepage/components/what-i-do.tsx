// The site's own words for the three kinds of work (.plan/done/03-web/prd.md, Homepage): no profile
// record holds them. They describe kinds of work only, never results, numbers or clients, and the
// AI engineering column says it is the current focus rather than a delivered track record.
const AREAS = [
  {
    title: "Software systems",
    sentence: "Web applications and their backends, built to be maintained long after launch.",
  },
  {
    title: "Integrations & automation",
    sentence: "Connecting the tools a team already uses and taking repetitive steps off its hands.",
  },
  {
    title: "AI engineering",
    sentence: "My current focus: useful AI features in real software, explored in independent R&D.",
  },
] as const;

/** Three short columns that say what kinds of work the person does; one sentence each. */
export function WhatIDo() {
  return (
    <section aria-labelledby="what-i-do-heading" className="flex flex-col gap-8">
      <h2 id="what-i-do-heading" className="type-heading">
        What I do
      </h2>
      <ul className="grid gap-8 sm:grid-cols-3 sm:gap-6 lg:gap-8">
        {AREAS.map((area) => (
          <li key={area.title} className="flex flex-col gap-2">
            <h3 className="type-item">{area.title}</h3>
            <p className="text-pretty text-muted-foreground">{area.sentence}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
