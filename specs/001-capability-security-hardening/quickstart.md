# Quickstart for Implementers

## 1. Load governing context

Read in this order:

1. `.specify/memory/constitution.md`
2. `spec.md`
3. `research.md`
4. `data-model.md`
5. `contracts/capability-resolution.openapi.yaml`
6. `acceptance-matrix.md`
7. `tasks.md`

Then inspect the live repository and map actual modules to the planned API/application/domain/infrastructure boundaries.

## 2. Establish a safety baseline

Before changing behavior:

- capture current action/tool alias inventory
- capture dual-surface capabilities
- identify tenant-exposed admin tools
- record current resolver decisions for the acceptance fixtures
- verify kill switches
- confirm no production mutation is part of baseline collection

## 3. Implement the smallest vertical slice

Recommended first slice:

```text
strict selector validator
→ canonical alias lookup
→ surface/principal authorization
→ fail-closed decision
→ structured trace
```

Do not integrate credential or device execution until this slice passes tests.

## 4. Core invariant

Use one shared assertion before dispatch:

```text
dispatchReady =
  canonicalCapabilityResolved
  AND finalDecision == allow
  AND every required gate == pass
  AND mode == execute
```

Preview responses may state policy eligibility, but MUST set:

```text
willExecute = false
executionOccurred = false
```

## 5. Test commands

Use the repository's existing commands discovered from package/build configuration. At minimum run:

- unit tests for normalization and policy
- integration tests for API and registry
- security fixture matrix
- OpenAPI validation
- lint/type checking
- migration validation
- secret/redaction tests

## 6. Staging verification

Use governed preview calls for all matrix cases. Mutation tests require:

- explicit approval
- isolated test resources
- idempotency key
- before snapshot
- execution
- same-cycle readback
- cleanup/rollback evidence

## 7. Definition of done

The feature is not done until:

- P0 containment remains active
- all requirements have test coverage
- all P0/P1 matrix cases pass
- no required gate is unevaluated in allowed decisions
- OpenAPI and implementation match
- security review is approved
- rollback is tested
- monitoring dashboards and alerts are active
