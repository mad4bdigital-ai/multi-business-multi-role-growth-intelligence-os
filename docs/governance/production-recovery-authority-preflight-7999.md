# Production Recovery authority preflight — #7999

This preflight closes a repository-side observability gap without enabling Production Recovery.

## Purpose

The current Production runtime can contain the Recovery composition factory, durable control-store implementation, Recovery Action bridge, and Host Breakglass contracts while still being unable to issue a valid Production execution ticket. A configured module path or exact Production SHA is not sufficient evidence that live authority exists.

The preflight therefore reports the minimum server-owned prerequisites required before a deployment-owned Production Recovery module may even be evaluated.

## Fail-closed contract

The preflight is read-only and must never:

- load the configured Recovery binding module;
- construct a Production mutation adapter graph;
- issue an approval challenge;
- issue or verify an execution ticket;
- connect to the Recovery control database;
- execute Host Breakglass;
- dispatch GitHub workflows;
- mutate Production or any target database;
- expose database names, hosts, principals, passwords, module paths, or other secret-bearing configuration.

It reports only bounded booleans, runtime classification, binding mode state, required component names, and blocker codes.

## Required configuration boundary

Before candidate graph resolution can be attempted, all of the following must be true:

1. runtime environment resolves explicitly to `production / hostinger_autodeploy`;
2. `RECOVERY_SERVER_MANAGED_BINDING_MODULE` is configured;
3. `RECOVERY_SERVER_MANAGED_BINDING_MODE=production_live`;
4. an independent `RECOVERY_CONTROL_DB_*` configuration resolves without colliding with runtime, governance, or runtime-persistence identities.

Even when all four are true, the preflight remains blocked on:

`production_authority_graph_resolution_required`

That blocker is intentional. Configuration readiness is not live authority.

## Live authority graph still required

A future deployment-owned module must supply and independently certify the complete Recovery composition graph defined by `recoveryComposition.js`, including at minimum the live-authority subset:

- recovery store;
- execution-ticket signer;
- approval verifier;
- fenced recovery lock;
- independent role-aware readback verifier;
- Hostinger host-local mutation executor;
- deployment identity provider.

The complete graph additionally includes approval issuer/store, mutation executor, execution-ticket verifier, partial receipt store, proof resolver, and migration ledger.

No synthetic Staging authority, filesystem-generated Staging key, caller-provided token, Local Connector authority, direct SQL path, or generic GitHub comment may satisfy these Production requirements.

## Current incident linkage

Fresh post-#8156 evidence established:

- `main=ed3942f31c579fdce1bbe36a7743926ebfb40ecb`;
- `Production=049bdfaff24966843cc1c55c9b61431d788acd60`;
- Production branch/SHA identity is exact;
- Production runtime remains degraded and not current because Recovery/trusted-ingress runtime activation is incomplete;
- Migration 1051 verification remains blocked because Governance writer readiness is not ready;
- #6813 remains the active database-authority prerequisite;
- #7999 remains blocked before Production live activation.

This patch does not authorize or perform baseline reconstruction, grant repair, Migration 1051 Apply, GitHub Ruleset Apply, trusted-ingress activation, Production deployment, restart, or secret provisioning.

## Intended use

Use `inspectProductionRecoveryAuthorityPreflight()` as an explicit server-side diagnostic before attempting any future live-module candidate resolution. A `configuration_ready_for_candidate_resolution=true` result means only that the runtime/configuration boundary is complete enough for a separately governed candidate evaluation. It never means `activation_eligible=true`.
