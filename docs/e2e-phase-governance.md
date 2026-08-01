# E2E Phase Governance

Every feature-changing pull request must declare the smallest complete functional phase it delivers. A phase is mergeable only when it starts at a real application entrypoint, crosses the owned runtime layers, and ends with an observable readback or user-visible result.

## Phase ladder

| Phase | Minimum evidence |
|---|---|
| `mvp` | Synthetic runtime E2E from entrypoint to terminal readback |
| `operational` | Runnable E2E plus operational controls and bounded failure handling |
| `resilient` | Fault injection, retry/reconciliation, and recovery evidence |
| `canary` | Live non-production target with exact readback |
| `production` | Exact Production SHA/runtime readback |

Future phases may remain `planned`. The current phase and MVP must be `implemented` on the integration PR. Component tests, pure policy tests, schemas, documentation, or disconnected services do not satisfy the MVP gate by themselves.

## Contract locations

For a Spec Kit change, add:

```text
specs/<feature-key>/e2e-phases.json
```

For a feature change without a Spec Kit, add:

```text
.changes/e2e/<feature-key>.json
```

The contract must be changed in the same pull request and its `scope.include` patterns must cover every changed runtime file.

## Helpers

Create or preview a safe blocked contract from the current diff:

```bash
node http-generic-api/scripts/e2e-phase-init.mjs \
  --feature-key <feature-key> \
  --dry-run
```

Write it after review by removing `--dry-run`. For an existing contract, use `--refresh-scope` to add newly changed runtime files without replacing the phase plan.

Generate a draft parallel plan from the current diff:

```bash
node http-generic-api/scripts/e2e-parallel-plan-init.mjs \
  --contract specs/<feature-key>/e2e-phases.json \
  --dry-run
```

The helper groups work into Contracts, Data, Runtime, Worker, Frontend, and Verification where those surfaces exist. It uses exact changed-file scopes and starts every workstream as `planned`. Remove `--dry-run` only after checking the generated ownership and dependency graph.

The JSON Schema is available at:

```text
.specify/schemas/e2e-phases.schema.json
```

## Executable journey

Each implemented phase contains one or more `e2e_journeys`. Every journey declares:

- actor;
- runtime entrypoint;
- ordered steps;
- terminal observable outcome;
- assertions;
- E2E level;
- executable `node` or `npm` tests;
- evidence paths.

Test descriptors are structured and run with `shell: false`. Free-form shell commands are not accepted.

## Parallel work model

Set `parallel_work.enabled=true` when a feature is divided between people or AI agents. The contract uses a dependency DAG, not an informal task list.

Each workstream declares:

- stable `id` and title;
- `owner_type`: `human`, `ai_agent`, `mixed`, or `unassigned`;
- branch pattern;
- exclusive file scope;
- dependencies;
- deliverables;
- integration points;
- required executable tests;
- commit evidence when ready.

The lifecycle is:

```text
planned
  → in_progress
  → ready_for_integration
  → integrated
```

`blocked` may be used at any point with an explicit reason in the surrounding feature contract.

### Workstream PR

A workstream branch must match its declared `branch_pattern` and target a branch matching `parallel_work.integration.branch_pattern`. It cannot target `main` directly.

Before merge into the integration branch, the workstream must be `ready_for_integration` and contain:

- required tests;
- exact work commit SHAs;
- a recorded workstream head SHA;
- dependencies that are already `ready_for_integration` or `integrated`.

The CI executes only that workstream's tests. It does not require the full feature MVP to be implemented yet.

### Integration PR

The integration branch collects the tested work commits. The final integration PR is the only path that evaluates the full phase contract and executes:

1. integration convergence tests;
2. the complete current-phase E2E journeys.

When the current phase becomes `implemented`, every required workstream must be `integrated`, its commit evidence must be present in the integration head, and convergence tests must be executable.

### Stacked PR head isolation

Do not reuse the exact same head commit as the source of multiple open pull requests with different base branches. GitHub associates check runs with the head SHA, while this governance evaluates each pull request against its event-specific base. A valid integration result can therefore coexist with an intentionally failing workstream or synchronization result on the same commit and make the final evidence ambiguous.

Before the integration PR is marked ready or merged:

- close or merge temporary synchronization PRs that use its head branch;
- create a final meaningful integration commit after the last stacked synchronization;
- confirm that the final head SHA belongs only to the integration PR under review;
- accept only E2E artifacts whose `base_ref`, `head_ref`, and changed-file set match that PR.

A successful run against another base branch does not satisfy the integration gate, and a failure from another stacked PR must not be silently dismissed without producing a unique final head and a fresh exact-head run.

### File ownership and overlap

Scopes are exclusive by default. A changed runtime file must belong to the active workstream. Two workstreams may share a file only through `declared_overlaps`, which must name:

- the participating workstreams;
- exact overlap patterns;
- the reason;
- the integration coordinator.

This prevents parallel agents from silently editing the same surface and discovering the conflict only during rollup.

### Parallel commit rule

Work commits may be created independently and in parallel. The integration branch may merge or cherry-pick them, but the contract records the exact SHAs. A workstream is not considered integrated merely because its branch exists or its component tests pass.

Partial feature merge to `main` is forbidden by `no_partial_feature_merge=true`.

## CI behavior

The workflow `E2E Phase Governance` performs two stable required checks:

1. `Evaluate changed feature phases`
   - classifies the PR;
   - validates the phase contract;
   - validates the parallel DAG, scopes, dependencies, branch target, and commit evidence;
   - chooses `workstream`, `integration`, or `standard` mode.
2. `Execute current phase journeys`
   - runs active workstream tests for workstream PRs;
   - runs convergence plus full phase E2E tests for integration PRs;
   - runs full phase E2E tests for ordinary feature PRs.

Both jobs upload JSON evidence and write GitHub step summaries.

To make this unbypassable, add these required status checks to the `main` ruleset after the workflow is merged:

```text
E2E Phase Governance / Evaluate changed feature phases
E2E Phase Governance / Execute current phase journeys
```

The workflow also supports GitHub merge queues through the `merge_group` event.

## Rollout rule

Do not expand a phase by adding disconnected infrastructure. Each integration PR must preserve the previously working journey and add the next complete slice. A blocked or planned MVP may stay in Draft, but it is intentionally not mergeable to `main`.
