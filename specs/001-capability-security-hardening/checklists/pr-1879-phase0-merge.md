# PR #1879 — Phase 0 Merge Checklist

## Scope

- [x] The PR solves the defined Phase 0 containment problem T001–T009.
- [x] Later Spec Kit work T010–T114 remains separately tracked.
- [x] The PR does not authorize deployment, provider write, external send, or production promotion.
- [x] The unified 34-wave tenant reverification report is preserved as source evidence.

## Author checklist

- [x] Existing architecture and registry-first conventions are preserved.
- [x] No new dependency was added.
- [x] Backward-compatible read-only behavior is preserved.
- [x] Untrusted method/tag/action metadata is classified fail-closed.
- [x] Error behavior is explicit and stable.
- [x] Security and no-secret implications were reviewed.
- [x] Credential access now follows authorization preflight in the reviewed app-action path.
- [x] Tests were added for both P1 broad-policy bypass findings.
- [x] Containment, traceability, rollout, security, requirements, and release-readiness documents are updated.

## Testing checklist

- [x] Happy path: specifically governed mutation continues to policy-specific evaluation.
- [x] Edge case: broad generic GPT-tool policy cannot satisfy an undeclared mutation policy.
- [x] Edge case: broad generic app-action policy cannot satisfy action-specific mutation policy.
- [x] Invalid/unclassified tool and app actions fail closed.
- [x] Regression: read-only tool/app behavior remains allowed where no mutation policy is required.
- [x] Regression: app-action preflight occurs before credential lookup/refresh.
- [x] Focused mutation-policy, runtime-policy, and connect-route suites pass.
- [ ] Full final-head repository test manifest and fresh GitHub CI remain required after `main` reconciliation.

## API and contract checklist

- [x] No new public request/response field is introduced by the P1 review fix.
- [x] Existing OpenAPI 3.1 contracts remain the authority for the reviewed endpoints.
- [x] Stable error model remains consistent (`mutation_policy_required`, `mutation_classification_required`).
- [x] Auth and permission behavior becomes stricter without exposing credentials or foreign resources.
- [x] Pagination/filtering behavior is unchanged by this fix; known P1 gaps remain tracked in the tenant report.
- [x] Existing clients using properly declared mutation policies remain compatible.

## Database checklist

- [x] No database migration is required for the P1 review fix.
- [x] No destructive schema or data change is present.
- [x] No backfill is required.
- [x] Query ordering improves security by preventing credential access before preflight.

## Reviewer feedback

- [x] Review comment `3462323198`: mutation-policy requirement now runs independently of generic GPT-tool policy presence.
- [x] Review comment `3462323203`: mutating app actions now require a policy specifically targeting both app and action.
- [x] Regression fixtures prove both comments remain closed.
- [ ] Review threads should be marked resolved after the final branch update and readback.

## Merge readiness

- [x] Scope and residual risk are explicit.
- [x] Rollback controls and named owners are recorded.
- [x] No production-promotion approval is implied.
- [ ] Branch must be current with `main`.
- [ ] Required GitHub checks must pass on the new final head.
- [ ] GitHub must report clean mergeability.
- [ ] Final changed-file scope must be reviewed after reconciliation.
