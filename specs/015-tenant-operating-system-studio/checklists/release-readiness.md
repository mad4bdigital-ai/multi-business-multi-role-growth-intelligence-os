# Release and Closeout Checklist

## Specification readiness

- [ ] Manifest and file inventory are current.
- [ ] JSON Schemas and OpenAPI parse successfully.
- [ ] Requirements, tasks, operation paths, acceptance cases, and risks are traceable.
- [ ] Work Map and schema-domain classification are current.
- [ ] PR #3922 and #4432 convergence classifications are reviewed.
- [ ] Duplicate Spec 014 identity has a canonical resolution plan.
- [ ] Required open decisions for the next implementation slice are closed.

## Implementation readiness

- [ ] Current-main brownfield inventory exists.
- [ ] Existing authority reuse versus new persistence is proven field by field.
- [ ] Allowed paths, forbidden actions, tests, evidence, rollback, and owners are explicit.
- [ ] Candidate branches are reconstructed or synchronized without stale-evidence reuse.
- [ ] No runtime behavior is inferred from a specification-only contract.

## Pilot readiness

- [ ] Package/component/installation registries and compiler pass contract tests.
- [ ] Exact Tenant/Workspace/Brand installation binding is proven.
- [ ] Two-client isolation suite passes.
- [ ] Delegation and revocation suite passes.
- [ ] AI draft-only and manual fallback suite passes.
- [ ] Forms/client links and file policies pass negative tests.
- [ ] Sandbox/sample-data isolation passes.
- [ ] Backup, rollback, observability, support, and runbooks exist.
- [ ] Pilot scopes, effect classes, packages, users, success thresholds, and stop rules are approved.

## Production readiness

- [ ] Exact candidate CI and acceptance evidence pass.
- [ ] Required migrations are applied through governed flow and read back from Production.
- [ ] Runtime and generated surface parity are verified.
- [ ] Provider/connection readiness and unknown-outcome recovery are tested.
- [ ] Load, concurrency, restart, queue, cache invalidation, backup/restore, and rollback rehearsals pass.
- [ ] Client/agency handover continuity is demonstrated.
- [ ] Security/privacy/retention/marketplace/commercial policies are approved.
- [ ] Production canary is bounded and monitored.
- [ ] Main/Production version and migration parity are verified.
- [ ] Unresolved work is explicitly classified as blocked, deferred, owned backlog, not applicable, or retired.

## Completion rule

The product is not complete merely because:

- this Spec merges;
- package schemas validate;
- a package compiles;
- generated UI appears;
- a sandbox run succeeds;
- a child package is reconstructed.

Completion requires operational use by the intended Tenant models, exact production evidence, isolation, fallback, rollback, support, handover, and documented unresolved scope.