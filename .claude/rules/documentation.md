# Documentation is binding

`docs/` describes how this repository works. Read the document for the area you are working in before you change it, and follow it.

| Working on | Read |
|---|---|
| New files, packages, imports, ports | `docs/repository-structure.md` |
| Anything crossing the API, access, data flow | `docs/architecture.md` |
| Canonical domain names and synonyms | `GLOSSARY.md` |
| Entity meaning, relationships, access | `docs/domain-context.md` |
| Writing code or shaping a module/interface | `docs/code-standards.md` (Deep modules), `docs/repository-structure.md` (Backend module layout), `docs/architecture.md` (Module responsibilities and composition) |
| Writing tests or evals | `docs/testing.md` |
| Branches, commits, pull requests | `docs/git-workflow.md` |
| Dispatching or acting as an agent | `docs/agents.md` |
| Unsure whether an action is allowed | `docs/permissions.md` |
| Any UI | `docs/design.md` |

- If the code and a document disagree, fix one of them in the same pull request.
- A change in behaviour or structure updates the relevant document in the same pull request.
- A decision that changes direction gets a new record in `docs/decisions/`; existing records are not rewritten.
- Module changes maintain the relevant app/package module map. Use the project-local `codebase-design` and `tdd` skills for interface design and test-first work; binding repository rules and approved issue scope remain authoritative.
