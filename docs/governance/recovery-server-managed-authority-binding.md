# Server-Managed Recovery Authority Binding

## Scope

This document defines the repository-only binding layer between the Recovery interfaces and concrete server-managed authority handles. It does **not** activate `production_live`, provision credentials, connect to Hostinger, connect to any database, execute SQL, run migrations, apply grants, or certify a live environment.

The binding layer exists so that a separately reviewed deployment composition can supply concrete implementations without allowing GPT, an API caller, a Local Connector, or an operation payload to become an authority source. The default server composition remains fail-closed.

## Composition boundary

```text
Recovery interfaces
        |
        v
serverManagedRecoveryAuthorityBinding.js
        |
        v
serverManagedRecoveryBindingProvider.js
        |
        v
productionRecoveryCompositionFactory.js
        |
        v
Recovery Kernel route dependencies
        |
        v
separate live activation release (not present in this patch)
```

The canonical component contract is defined in [`recoveryComposition.js`](../../http-generic-api/recoveryComposition.js). A complete bundle must provide every registered component, including the seven live-authority components and the supporting issuer, store, verifier, receipt, proof, and ledger interfaces. The durable Recovery Store must retain the **same object identity** as the injected execution-ticket verifier; this prevents a store from validating tickets against a verifier that was not bound into the composition.

## Server-managed provider protocol

The server root may construct a provider with [`serverManagedRecoveryBindingProvider.js`](../../http-generic-api/serverManagedRecoveryBindingProvider.js). The provider accepts one of two repository-owned inputs:

1. An explicitly injected resolver function supplied by the server composition root.
2. A server-managed module path supplied through `RECOVERY_SERVER_MANAGED_BINDING_MODULE`, which is loaded by the server process and is never accepted from a request body or GPT action.

The resolver receives a frozen context declaring that caller credentials, GPT credentials, Local Connector authority, provider discovery, and database discovery are all forbidden. The resolver must return an envelope with `binding_source: "server_managed"`, `secrets_included: false`, and a complete adapter bundle. Credential-shaped fields, caller/GPT/Local Connector metadata, and raw SQL fields are rejected before composition creation.

Relative module paths resolve from the server process working directory and are reported only as a one-way hash. The provider does not expose the path, module contents, adapter internals, or secret material in readiness evidence.

## Concrete authority binding

[`serverManagedRecoveryAuthorityBinding.js`](../../http-generic-api/serverManagedRecoveryAuthorityBinding.js) provides the concrete binding envelope builder. It does not manufacture fake, in-memory, or dummy Production implementations. Instead, it validates explicit server-managed concrete handles against the Recovery composition contract and records only non-secret capability metadata:

| Capability | Meaning in this patch |
| --- | --- |
| `adapter_present` | All required adapter objects/functions were supplied and structurally validated. |
| `durability_capable` | The server-owned binding asserts that the supplied Recovery Store/receipt path is durable; the builder does not probe a database. |
| `attestation_capable` | A server-owned deployment identity provider is supplied; the builder does not read runtime identity or contact a deployment host. |
| `live_ready` | Always `false` in this patch. |
| `activation_eligible` | Always `false` in this patch. |

A test double may be used inside repository tests to exercise the contract, but the binding layer rejects origins containing `mock`, `dummy`, `fake`, `in-memory`, `fixture`, or `test-double`. No test double is installed as a Production adapter.

## Deployment identity binding

[`serverManagedDeploymentIdentityProvider.js`](../../http-generic-api/serverManagedDeploymentIdentityProvider.js) wraps a server-owned attestation reader. The wrapper deliberately does not forward `expected_sha`, target identity, or caller-controlled fields to that reader. Recovery Kernel validation compares the returned server-derived attestation against the immutable plan, repository, `Production` branch, manifest hash, target fingerprint, and attestation hash.

The wrapper requires the attestation to be manifest-bound, read-only, non-mutating, and secret-free. It rejects a different repository or branch, an invalid 40-character commit SHA, missing 64-character manifest or attestation hashes, a mutation claim, or a secret-material claim.

This prevents an `expected_sha` in an API request from becoming the deployment authority. The request value is only a value that the Kernel can compare against the independently read server identity; it is not a source of identity.

## Environment and activation gates

The server root now passes the binding provider hook to the factory only when the mode is explicitly `injected_non_live` and the environment is explicitly one of the non-live allowlisted environments (`staging_local_windows_docker`, `test`, or `ci`). Production and unknown environments resolve to `disabled`. The factory still rejects `createProductionRecoveryComposition({ mode: "production_live" })` with `RECOVERY_PRODUCTION_LIVE_DISABLED`.

The following properties remain false and are intentionally not changed by this patch:

```json
{
  "production_live.enabled": false,
  "production_live.repository_live_adapter_wiring": false,
  "production_live.live_provider_authority_configured": false,
  "production_live.server_managed_live_ready": false,
  "production_live.live_activation_requires_separate_release": true,
  "provider_accessed": false,
  "database_connection_performed": false,
  "database_mutation_performed": false,
  "secrets_included": false
}
```

A structurally complete injected non-live graph therefore proves composition completeness only. It does not prove staging certification, Production readiness, credential availability, network connectivity, database durability, Hostinger execution capability, or permission correctness.

## Required lifecycle invariants

The binding layer does not weaken the Kernel lifecycle. The existing Kernel remains responsible for approval-to-ticket ordering, single-use ticket semantics, exact durable `run_id` verification, claim/reservation, fenced lease ownership, heartbeat and fence assertions, same-cycle readback, verification-before-finalization, partial receipt persistence, reconciliation after unknown outcomes, artifact/checksum binding, baseline-before-ordinary-migration ordering, and runtime/governance/runtime-persistence role separation. Those contracts remain in [`recoveryKernel.js`](../../http-generic-api/recoveryKernel.js), [`recoveryExecutionTicket.js`](../../http-generic-api/recoveryExecutionTicket.js), [`recoveryExecutionBinding.js`](../../http-generic-api/recoveryExecutionBinding.js), and the Recovery manifest.

## Staging Recovery Admin surface

The repository now defines a separate Staging Recovery Admin surface at [`openapi.custom-gpt.recovery-admin.staging.yaml`](../../http-generic-api/openapi/openapi.custom-gpt.recovery-admin.staging.yaml) with the single server URI `https://activation-dev.mad4b.com`. It is deliberately not a copy of the Production Recovery schema: it advertises exactly three non-consequential `GET` operations for the Staging contract, authority readiness, and certification status.

The surface is mounted only in a declared Staging runtime by [`stagingRecoveryAdminRoutes.js`](../../http-generic-api/routes/stagingRecoveryAdminRoutes.js). Its readiness response is certification-gated and reports `production_live.requested=false`, `production_live.eligible=false`, and `production_live.enabled=false`. It accepts no caller-generated ticket, raw SQL, target selection, credential material, Production authority, or Local Connector fallback. The route can surface bounded server-managed certification evidence when a separately injected reader exists, but the read-only surface itself never executes the certification mutation.

The activation gateway exposes the Staging schema only on the Staging host and does not add the schema to the Production host mapping. [`validate-staging-recovery-admin-openapi.mjs`](../../http-generic-api/scripts/validate-staging-recovery-admin-openapi.mjs) enforces the single URI, exact path set, `GET`-only policy, private bearer security, forbidden-host isolation, non-consequential operations, and secret-free metadata.

A future live Staging certification remains a separate operational workflow. It must use a disposable or explicitly approved Staging target and the complete server-managed Recovery graph, then persist certification evidence before any independent Production activation review. This OpenAPI addition does not claim that live certification has run.

## Verification status for this repository-only phase

The focused binding tests cover complete non-live composition, every missing live authority, same-verifier identity, server-derived attestation, wrong-SHA rejection, caller/GPT/Local Connector/raw-SQL rejection, Production hard denial, and the absence of adapter/provider/database calls during readiness construction. The Staging Recovery surface tests cover the separate activation-dev URI, exact three-operation GET-only contract, route environment isolation, certification gating, and zero-mutation output. Existing Recovery Kernel and Host Breakglass tests remain the source of truth for execute-and-verify, fencing, replay, reconciliation, role mapping, and readback behavior.

No live staging certification or Production authority activation is claimed. The next operational phase must be separately authorized and must begin with an independent staging certification and fresh durable inspection; it must not be inferred from this repository contract or from a structurally complete test bundle.

## References

[1]: ../../http-generic-api/recoveryComposition.js "Recovery composition contract"
[2]: ../../http-generic-api/productionRecoveryCompositionFactory.js "Production Recovery composition factory"
[3]: ../../http-generic-api/serverManagedRecoveryBindingProvider.js "Server-managed Recovery binding provider"
[4]: ../../http-generic-api/serverManagedRecoveryAuthorityBinding.js "Server-managed Recovery authority binding"
[5]: ../../http-generic-api/serverManagedDeploymentIdentityProvider.js "Server-managed deployment identity provider"
[6]: ../../http-generic-api/recoveryKernel.js "Recovery Kernel lifecycle"
[7]: ../../http-generic-api/recoveryExecutionTicket.js "Recovery execution-ticket contract"
[8]: ../../http-generic-api/recoveryExecutionBinding.js "Recovery execution binding and attestation validation"
[9]: ../../http-generic-api/config/recovery-kernel-manifest.json "Recovery Kernel manifest"
