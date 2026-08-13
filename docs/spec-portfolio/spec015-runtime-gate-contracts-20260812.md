# Spec 015 Runtime Gate Contracts

This package converts the remaining runtime-open boundaries into deterministic local contracts. It does not execute a migration, provider mutation, DNS change, GitHub ruleset change, or database write.

## Contracts

| Contract | Purpose | Fail-closed conditions |
|---|---|---|
| `validateCanonicalIdentityPreflight` | Resolve candidate package/component identity before persistence or publication | Missing candidate, invalid key, duplicate identity, unknown selection, or missing decision reference |
| `validateMigrationReadbackContract` | Verify migration trigger, schema hash, revision, rollback contract, and readback contract | Missing trigger, schema/revision mismatch, missing rollback, or missing readback |
| `validateProviderMutationGate` | Require complete provider preflight before any external operation | Missing target, preflight, readback, rollback, typed confirmation, or presence of credential payload |
| `validateRuntimeGateBundle` | Combine identity, migration, and provider gates into one deterministic decision | Any child gate error |

## Safety invariants

Every contract reports `mutation_executed=false`, `provider_call_executed=false`, `database_mutation=false`, and `secrets_included=false`. The contracts are therefore suitable for readiness, planning, and operator preflight. They do not authorize a provider operation by themselves.

## Test coverage

`test-spec015-runtime-gate-contracts.mjs` covers duplicate identities, unresolved identity selection, schema readback mismatch, revision mismatch, missing rollback/readback, missing typed confirmation, forbidden credential payloads, provider fail-closed behavior, and a fully valid local gate bundle.

A locally valid provider gate means only that the contract is complete. The actual provider operation remains outside this package and still requires the provider-specific controller, live target readback, and operator authorization.
