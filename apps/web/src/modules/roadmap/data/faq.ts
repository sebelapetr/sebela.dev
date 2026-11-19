/** A question about the roadmap and its answer, as the overview's FAQ shows it. */
export interface FaqEntry {
  readonly question: string;
  readonly answer: string;
}

/**
 * The overview's frequently asked questions: static website text carried over from the original
 * roadmap site, under this site's name for the roadmap and without counts that the API's totals
 * already give.
 */
export const ROADMAP_FAQ: readonly FaqEntry[] = [
  {
    question: "What is the AI Engineering Roadmap?",
    answer:
      "A structured, public learning roadmap documenting the transition from experienced " +
      "full-stack development to production AI engineering. It covers programming fundamentals, " +
      "LLM and ML theory, RAG, AI agents, LLMOps, evals and safety, platform architecture and AWS " +
      "AI certification, organized into sequential areas.",
  },
  {
    question: "Who is this roadmap for?",
    answer:
      "Developers who already have several years of software engineering experience (TypeScript, " +
      "backend frameworks, system design) and want to extend that expertise into AI-native " +
      "development, rather than starting from scratch as a beginner programmer.",
  },
  {
    question: "How is this different from a generic AI course?",
    answer:
      "Each area is scoped around building something real — a RAG service, an agent runtime with " +
      "tool orchestration, an evaluation harness with CI regression checks — instead of isolated " +
      "tutorials. Time is split roughly 40% study and 60% implementation and documentation.",
  },
  {
    question: "Is this a course I can follow, or a personal learning log?",
    answer:
      "A personal learning log kept public and structured like a course. The roadmap, resources " +
      "and diary reflect real day-by-day progress, including what worked and what didn't, rather " +
      "than a polished curriculum sold to students.",
  },
  {
    question: "What will I be able to build after completing the full roadmap?",
    answer:
      "The roadmap progresses toward a production-oriented RAG service, a multi-tool agent runtime " +
      "with audit trails and human-approval gates, an LLMOps dashboard with cost and quality " +
      "monitoring, and a small shared AI platform supporting multiple agents — each built as a " +
      "real project, not a toy demo.",
  },
  {
    question: "Which technologies and tools does the roadmap cover?",
    answer:
      "Python and FastAPI for AI-native backends, pgvector for retrieval, LangGraph and CrewAI for " +
      "agent orchestration, structured-output and tool-calling patterns across LLM providers, plus " +
      "observability, evaluation and safety tooling — building on an existing TypeScript and " +
      "Next.js background.",
  },
];
