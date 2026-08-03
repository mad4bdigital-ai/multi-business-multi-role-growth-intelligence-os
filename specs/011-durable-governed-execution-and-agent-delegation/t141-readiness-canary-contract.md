# T141 Readiness and Governed Delegation Canary Contract

## Purpose

This wave prepares the remaining live delegation lifecycle work without performing it.

T141 remains open until a separately authorized Production cycle proves:

1. the canonical delegation migration is applied and present in the governed ledger;
2. the deployed runtime is on the exact expected commit;
3. the default-off MariaDB binding is explicitly certified and action-allowlisted;
4. one grant is created, inspected, revoked, and inspected again;
5. a second grant is created, inspected, expired, and inspected again;
6. every mutation receipt is reconciled through same-cycle readback;
7. no unknown outcome is followed by an automatic repeated mutation;
8. `runtime_policy_ready` is not promoted and no public route is added.

The implementation in this wave is a contract and evidence validator only. It performs no migration, database write, grant mutation, provider call, deployment, or runtime authority activation.

## Reused authorities

The contract composes the existing implementation rather than introducing a second lifecycle path:

- `delegationGrantShadowService.js` for preview semantics;
- `delegationGrantLifecycleShadowService.js` for `create`, `revoke`, and `expire` plans;
- `delegationGrantRepositoryMutationService.js` for pending receipt, transaction, mutation, and same-cycle readback semantics;
- `delegationGrantMariaDbRuntimeBinding.js` for checksum-pinned runtime execution;
- `delegationGrantMariaDbReadinessCollector.js` for migration and schema readiness;
- `governed_migration_authorization_registry` and `governed_migration_ledger` for apply authority and evidence;
- the existing deployment and Production parity readback contracts.

No new persistence table, public route, OpenAPI operation, provider adapter, or runtime authority is introduced.

## Readiness decision

`evaluateT141CanaryReadiness` returns either:

- `ready_for_governed_canary`; or
- `blocked` with structured blockers.

Readiness requires all of the following:

- environment is exactly `staging` or `production`;
- the target database is not a disposable CI/test schema;
- migration status is `verified_applied`;
- checksum pin and schema readback fingerprint are present and valid;
- a governed ledger reference exists;
- the target environment is separately authorized;
- Production additionally has explicit Production migration authorization;
- the runtime binding is enabled, certified, checksum-pinned, and allowlists `create`, `revoke`, and `expire`;
- no public route or `runtime_policy_ready` promotion exists;
- deployed and runtime commit SHAs match exactly;
- health and same-cycle deployment readback pass;
- Production additionally has Production parity evidence.

The readiness evaluator is read-only and cannot apply the migration.

## Canary contract

`buildT141CanaryContract` accepts four already-eligible lifecycle plans:

- `primary_create`;
- `primary_revoke`;
- `expiry_create`;
- `expiry_expire`.

Every mutation must have:

- a unique request fingerprint;
- a unique pending receipt;
- a unique idempotency key;
- a separately approved capability envelope and approval hold;
- a resource authority reference;
- an unexpired authorization bound to the exact request fingerprint and environment.

The primary create and revoke plans must target the same grant. The expiry create and expire plans must target a second distinct grant.

The ordered canary sequence is:

1. inspect primary grant absence;
2. create primary grant;
3. inspect primary grant as active;
4. revoke primary grant;
5. inspect primary grant as revoked;
6. create expiry candidate;
7. inspect expiry candidate as active;
8. expire expiry candidate;
9. inspect expiry candidate as expired;
10. inspect and reconcile the complete mutation receipt set.

Every step requires same-cycle readback. Mutation steps explicitly set `retry_allowed_after_unknown_outcome=false`.

## Outcome evaluation

`evaluateT141CanaryOutcome` classifies the result as:

- `reconciliation_required`;
- `failed_closed`;
- `staging_canary_verified`; or
- `production_canary_verified`.

Any `unknown`, `ambiguous`, or `timeout_after_dispatch` mutation outcome immediately produces `reconciliation_required`. Automatic mutation retry remains forbidden.

A successful staging canary proves the contract and environment path, but it does not close T141, T261, or T263.

A successful Production canary becomes completion-eligible only when all mutation/inspection/receipt evidence passes and the same evidence packet proves:

- Production migration authorization;
- Production parity;
- Production runtime readback on the exact deployed SHA.

The evaluator does not edit `tasks.md`, `completion.json`, or any closeout document. Final task closure remains a separate governed evidence PR.

## Certification boundary

The focused GitHub Actions workflow uses synthetic fixtures only. Its artifact must always state:

- T141 is not closed by the workflow;
- T261 and T263 are not closed by the workflow;
- no staging or Production canary was executed;
- no migration or grant mutation occurred;
- no Production authorization was used;
- no provider call, deployment, runtime authority change, or secret exposure occurred.

## Live execution order

When separately authorized, the live path is:

1. run metadata-only Production/staging status collection;
2. verify exact migration checksum and ledger identity;
3. verify deployment and runtime SHA parity;
4. generate four lifecycle plans from the existing preview/lifecycle services;
5. issue four distinct exact-fingerprint authorization bindings;
6. build and persist the immutable canary contract evidence;
7. execute one mutation step at a time through the existing MariaDB runtime binding;
8. stop after every mutation until same-cycle grant and receipt readback is verified;
9. on an unknown outcome, perform read-only reconciliation and do not repeat the write automatically;
10. produce a bounded outcome artifact and open a separate evidence closeout PR.

## Remaining completion boundary

After this wave merges:

- T141 remains open;
- T261 remains open;
- T263 remains open;
- T264 remains open;
- `completion.json` remains `in_progress`.

They can close only after live staging and Production evidence exists and passes the separately governed final audit.
