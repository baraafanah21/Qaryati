# Documentation index

| Document                             | What it covers                                                                                                        |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| [../CONTEXT.md](../CONTEXT.md)       | Short rules every contributor (and AI assistant) reads first                                                          |
| [architecture.md](architecture.md)   | Modular monolith, hexagonal layers, module map, dependency rules and how they are enforced                            |
| [development.md](development.md)     | Prerequisites, setup, running with Docker, every npm script, test types, Git hooks, TypeScript strict flags           |
| [configuration.md](configuration.md) | Every environment variable, where it comes from, how it is validated                                                  |
| [database.md](database.md)           | Roles and grants, extensions, schema per module, the Drizzle instance, migrations, testing against PostGIS            |
| [workflow.md](workflow.md)           | Issue → branch → PR → review → squash merge, naming, labels, board, branch protection and the reason for each setting |
| [tech-stack.md](tech-stack.md)       | Every technology and tool: version, role, why chosen, alternatives, cost                                              |
| [adr/](adr/)                         | Architecture Decision Records; [0000-template.md](adr/0000-template.md) is the template                               |
| [plan/issues.json](plan/issues.json) | The project plan: 64 issues and milestones G0–G5 plus UI, source of the GitHub issues                                 |

Coming with later issues:

| Document                                      | Issue |
| --------------------------------------------- | ----- |
| `ci.md`: every CI job and how to reproduce it | #4    |
