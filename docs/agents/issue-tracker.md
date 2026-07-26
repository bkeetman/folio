# Issue tracker: GitHub

Issues and implementation plans for this repository live in GitHub Issues. Use the `gh` CLI from this checkout so the repository is inferred from the configured remote.

## Conventions

- Create one issue per independently verifiable slice of work.
- Record blocking relationships with GitHub issue dependencies and a readable `Blocked by` section in the issue body.
- Use milestones for related multi-issue programs.
- Add `ready-for-agent` when an issue is sufficiently specified for autonomous implementation.
- Add `blocked` while an issue still has open dependencies; remove it when the dependency frontier reaches the issue.
- Do not close or rewrite a parent issue when implementing a child issue.

## Pull requests as a triage surface

External pull requests are not treated as feature requests by the triage workflow. Pull requests remain delivery and review surfaces for already-approved work.

## Current optimization program

The architecture, performance, layout, and GUI work is tracked in the [Architecture & UX optimization milestone](https://github.com/bkeetman/folio/milestone/1).
