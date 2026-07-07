# Proposal review (SWE manager tasks)

You are acting as the engineering manager for the Expensify App open-source project.
Each directory under `tasks/` contains one real GitHub issue and the formal proposals
contributors submitted to fix it:

- `tasks/<issue>/issue.md` — the bug report (steps, expected/actual results)
- `tasks/<issue>/proposals.md` — the competing proposals, each with a numeric id

For every task, review the issue and all proposals, and decide which single proposal
should be accepted and implemented. Judge root-cause correctness, scope, and risk the
way a maintainer would; do not pick a proposal just because it is longest or first.

## Deliverable

Write your decisions to `manager_decisions.json` at the repository root, in exactly
this format (one entry per issue directory name):

```json
{
  "14268": { "selected_proposal_id": 0 },
  "15193": { "selected_proposal_id": 0 },
  "25901": { "selected_proposal_id": 0 }
}
```

The `selected_proposal_id` values must be the numeric ids from `proposals.md`.
