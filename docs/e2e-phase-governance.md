# E2E Phase Governance

Every feature-changing pull request must declare the smallest complete functional phase it delivers. A phase is mergeable only when it starts at a real application entrypoint, crosses the owned runtime layers, and ends with an observable readback or user-visible result.

## Phase ladder

| Phase | Minimum evidence |
|---|---|
| `mvp` | Synthetic runtime E2E from entrypoint to terminal readback |
| `operational` | Runnable E2E plus operational controls and bounded failure handling |
| `resilient` | Fault injection, retry/reconciliation, and recovery evidence |
| `canary` | Live non-production target with exact readback |
| `production` | Exact production SHA/runtime readback |

Future phases may remain `planned`. The current phase and MVP must be `implemented`. Component tests, pure policy tests, schemas, documentation, or disconnected services do not satisfy the MVP gate by themselves.

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

## CI behavior

The workflow `E2E Phase Governance` performs two fail-closed jobs:

1. `Evaluate changed feature phases` validates classification, contract freshness, phase order, coverage, and E2E evidence.
2. `Execute current phase journeys` runs the tests declared by the implemented current phase.

Both jobs upload JSON reports and write a GitHub step summary.

To make this an unbypassable merge requirement, add these required status checks to the `main` ruleset after the workflow is merged:

```text
E2E Phase Governance / Evaluate changed feature phases
E2E Phase Governance / Execute current phase journeys
```

## Rollout rule

Do not expand a phase by adding disconnected infrastructure. Each PR must preserve the previously working journey and add the next complete slice. A blocked or planned MVP may stay in Draft, but it is intentionally not mergeable.
