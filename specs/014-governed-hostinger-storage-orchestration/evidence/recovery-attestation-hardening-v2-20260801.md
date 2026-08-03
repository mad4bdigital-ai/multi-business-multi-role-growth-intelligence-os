# Recovery and Attestation Hardening v2

- Feature: `014-governed-hostinger-storage-orchestration`
- Workstream: `recovery-attestation`
- Base: Spec 014 Integration

## Corrected boundaries

- Authorization envelopes are permitted only at exact known predicate paths and only with the four approved binding fields.
- Canonical `path_ref` and resolver `executable_path` fields are accepted only in their schema locations and with bounded safe values.
- Recovery evidence must bind the observed checkpoint producer tool ID, version, and binary SHA-256.
- Verified attestation evidence preserves recovery proof and requirement digests plus toolchain resolution, policy, and selected-tools digests for downstream authorization comparison.

## Safety

Provider dispatch, SSH/Hostinger mutation, credentials, migration, Production promotion, and automatic activation remain disabled.

`secrets_included=false`
