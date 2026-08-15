# Acceptance Checklist

## Identity

- [x] Global canonical identity is deterministic and independent of tenant scope.
- [x] Supported identity scopes are explicit and validated.
- [x] Verified hard identifiers can produce one exact match only.
- [x] Name-only and weak identifiers cannot produce exact identity.
- [x] Multiple hard matches produce conflict.
- [x] Multiple weak matches produce ambiguity.
- [x] Identity descriptor cannot imply authority.

## Privacy and authority

- [x] Tenant filtering occurs before resolver output.
- [x] Resolver output omits candidate tenant ownership.
- [x] Relationship validation cannot create grants.
- [x] Relationship and authority are separate fields and contracts.
- [x] No credential values, provider calls, or external writes occur.

## Brand lifecycle readiness

- [x] Existing target_key remains a compatibility input in the design.
- [ ] Global brand_id migration dry-run is implemented.
- [ ] Identifier claims and verification evidence repository is implemented.
- [ ] Alias collision and cycle reconciliation is implemented.
- [ ] Revision-bound update/archive/restore/merge/split operations are implemented.

## Runtime and release

- [x] Pure contract tests cover the five resolution statuses.
- [ ] Canonical Operation Registry integration is complete.
- [ ] MariaDB read-only adapter is complete.
- [ ] Staging parity evidence is complete.
- [ ] Production migration and runtime readback are complete.
