# Central Capability Catalog Trust Authority — v1 (PR-only)

## Scope and placement

This is a server-managed **non-authorizing read catalog issuer**, not a new write broker. Reuse System Tool Catalog V2 for canonical descriptor collision handling, while Platform Capability Assurance / effective-capability gates remain the only real authority. Catalog discovery must never mint credentials, permissions or host execution rights.

- capabilityCatalogToolCollector.js: consumes a server-owned principal/site-scoped effective tool reader; rejects incomplete, inactive, disconnected, mutating, unknown or unauthorized tools. No source or plugin names are hard-coded.
- capabilityCatalogAuthority.js: site binding is derived from the authenticated server principal, not caller fields. Source list must be complete and authoritative. A separate site-scoped Ed25519 KMS/Secret Manager handle signs exact canonical catalog digests, and the issuer immediately self-verifies.
- capabilityCatalogPersistence.js: MySQL/MariaDB key metadata reader and a shared, atomic single-use receipt ledger. SQL stores no private signing keys.
- migrations/966_capability_catalog_trust_authority.sql: additive proposal ONLY; must not be applied without separately authorized Staging schema/role preflight and independent readback.

## Enrollment and signing

The server-owned getAuthorizedSite({principal,site_id}) uses tenant membership and Site Registry and returns tenant_id, site_id, environment, origin_sha256, runtime_generation and optionally profile_digest. Unknown or out-of-scope sites fail closed. getSubjectEffectiveTools and listAuthorizedSources are separate subject-effective read gates and cannot be replaced by a catalog's claims. A truncated source set is never complete.

getSiteSigningKey({site,purpose:'capability.catalog.attestation'}) resolves exactly one active, scoped, non-revoked key. The private key stays behind a KMS or server Secret Manager. Do not reuse OAuth, Gateway ingress, Recovery, or staging artifact signing keys. Ambiguous active keys, expired or revoked enrollment, wrong issuer and cross-tenant keys must fail closed. Signature lifetime is at most 120 seconds.

## Durable replay

All runtime replicas must consume signed catalog receipts using one shared transactional unique-key database. The consumed nonce is hashed with issuer, key, tenant, site, environment, origin and runtime generation; duplicates or unavailable DB fail closed. Database rows must not be pruned before every possible receipt has expired plus skew/recovery windows. The SQL adapter is a candidate persistence implementation, not proof of deployment grants, clustered consistency or transactional acceptance.

Only consume when the signature receipt is actually admitted as authority evidence for qualification, not when a user merely views the catalog. A signed catalog still never conveys write or execute authority.

## Validation and deployment restrictions

Node 22 test suite and read-only CI workflow check signing, site isolation, key misuse, catalog completeness, role separation and nonce duplication. A test double or fake DB is not a production persistence receipt. Before any deployment require actual tenant/site enrollment, host-managed key provisioning/rotation, migration + grants, cross-replica one-time insert testing, interoperability against the WordPress #258 verifier with tenant_id binding, fault injection, audit, and independent runtime readback.

No unauthenticated HTTP route is created, and these modules are NOT mounted on auth.mad4b.com by this PR. A host-facing route must separately pass the existing OAuth/principal authentication and OpenAPI policy gates. Production stays blocked pending reviewed promotion.
