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

As of the repository policy reviewed on 2026-10-08, `http-generic-api/config/governance-db-provider-capabilities.json` declares
`provider_key=hostinger_web_cloud_mysql`, `provider_mode=managed_hpanel_two_database_mysql`, and **all three** Governance writer capabilities `true`:

- `independent_governance_database_via_managed_control_plane`;
- `exact_direct_table_grants_on_governance_database_via_managed_control_plane`;
- `dedicated_governance_writer_contract_v1`.

The policy evidence is `user_confirmed_manual_hostinger_provisioning` (reviewed `2026-08-13`).
**Declared provider support is not live operational readiness.**
It does not prove the actual Production deployment SHA, dedicated DB/principal creation, schema inventory, current
`information_schema.TABLE_PRIVILEGES` grants, or runtime credential availability.

Use `Governance DB Privilege Readiness` and the exact Production `/deployment-info?include_governance_db_readiness=1`
readback to distinguish: provider-capability declaration, production identity, database connectivity, physical
schema readiness, and exact direct table privileges. Unavailable/unverified evidence is `UNKNOWN/BLOCKED`, never
`READY` and never authority to mutate. A genuine provider limitation must still fail closed with
`GOVERNANCE_DB_PROVIDER_CAPABILITY_UNSUPPORTED` after the policy is corrected to reflect observed limitations.

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

## Closure sequence after live readiness evidence

Only after the provider claim is independently corroborated by actual Production database/principal/schema/grant evidence and exact runtime identity may #6813 resume its existing closure sequence. If capability is actually unsupported, perform a separately governed provider migration or datastore redesign and update the policy first:

1. prove the provider-capability policy and Production environment authority;
2. configure a distinct Governance DB identity without secret disclosure;
3. run the bounded no-secret privilege readiness probe;
4. prove exact Production runtime parity;
5. obtain a fresh governed migration readiness authorization and execute readiness/dry-run only;
6. keep Migration Apply separately authorized.

The provider policy update itself must be reviewed against the actual provider state; it is evidence, not a switch that creates missing infrastructure capabilities.
