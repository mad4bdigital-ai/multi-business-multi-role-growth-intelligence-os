# Governance DB Provider Capability

## Purpose

Issue #6813 requires a dedicated Governance DB writer identity with exact direct table-scoped privileges while ordinary runtime reads remain on the normal DB identity. That architecture is valid only when the Production database provider can represent both identities against the same authoritative control-plane tables.

This document records the fail-closed provider-capability gate. It does not provision a database account, execute `GRANT`, write Hostinger secrets, move data, deploy Production, or authorize a migration.

## Repository authority

The machine-readable authority is:

`http-generic-api/config/governance-db-provider-capabilities.json`

`resolveGovernanceProductionPreflight()` evaluates that policy before Governance DB credential readiness. A provider that cannot represent the writer contract fails with:

`GOVERNANCE_DB_PROVIDER_CAPABILITY_UNSUPPORTED`

An absent or unknown environment policy fails with:

`GOVERNANCE_DB_PROVIDER_CAPABILITY_UNRESOLVED`

Both failures are no-secret and occur before a database connection or SQL execution.

## Current Production capability

The current Production policy identifies the managed database surface as `hostinger_web_cloud_mysql` / `managed_hpanel_mysql` and marks the following required control-plane capabilities unavailable:

- a second principal for the same database through the managed control plane;
- exact direct table-scoped grants through the managed control plane;
- the complete dedicated Governance writer contract.

Therefore current Production must not be treated as awaiting only `GOVERNANCE_DB_USER` / `GOVERNANCE_DB_PASSWORD` configuration. Credential prompting, copying the ordinary runtime identity, broadening `DB_USER`, or repeated privilege probes cannot repair a provider capability mismatch.

## Same-identity prohibition

`GOVERNANCE_DB_USER` must be a genuinely distinct database identity from `DB_USER`. `resolveGovernanceDbConfig()` rejects an exact same username with `GOVERNANCE_DB_IDENTITY_NOT_DEDICATED` even when a different password is supplied.

This is intentionally stricter than merely disabling environment-variable fallback. It prevents a provider limitation from being hidden by copying runtime credentials into Governance variable names.

## Remediation fork

When the provider capability gate is unsupported, only these architecture classes are valid follow-up candidates:

1. **Provider migration** — move the authoritative SQL runtime to a database environment that supports multiple principals on the same authoritative database and exact direct table-scoped grants required by the reviewed Governance writer matrix.
2. **Governance datastore redesign** — separately design and review a different datastore/read-write/transaction topology. This is not equivalent to setting `GOVERNANCE_DB_NAME` to another database because current runtime envelope and authority reads use the ordinary pool and existing transaction semantics assume shared authoritative tables.

Neither remediation is authorized by the source-only provider-capability repair.

## Explicitly forbidden workarounds

Do not:

- copy `DB_USER` into `GOVERNANCE_DB_USER`;
- broaden the ordinary runtime DB identity to schema-wide write authority;
- use `GRANT ALL` or administrative account privileges;
- mark provider capability supported merely because MariaDB as an engine supports multiple accounts;
- point `GOVERNANCE_DB_NAME` at a second database without a separately reviewed read/write and transaction redesign;
- retry Migration readiness while the provider capability gate is unsupported.

## Closure sequence after a future remediation

Only after a separately governed provider migration or datastore redesign is completed and the repository provider policy is truthfully updated to supported may #6813 resume the existing closure sequence:

1. prove the provider-capability policy and Production environment authority;
2. configure a distinct Governance DB identity without secret disclosure;
3. run the bounded no-secret privilege readiness probe;
4. prove exact Production runtime parity;
5. obtain a fresh governed migration readiness authorization and execute readiness/dry-run only;
6. keep Migration Apply separately authorized.

The provider policy update itself must be reviewed against the actual provider state; it is evidence, not a switch that creates missing infrastructure capabilities.
