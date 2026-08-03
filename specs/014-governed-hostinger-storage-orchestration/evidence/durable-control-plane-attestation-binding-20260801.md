# Durable Control Plane — Canonical Attestation Binding Evidence

- Feature: `014-governed-hostinger-storage-orchestration`
- Workstream: `durable-control-plane`
- Branch: `gpt/014-hostinger/control-plane-attestation-binding-20260801`
- Implementation commit: `5e8ec8282c3035ec45fe812e217f5b5b1183dff3`
- Regression commit: `77119f0738f387989d2dc07ecf912fd3fb3e8fc6`
- Target branch: `gpt/hostinger-safe-storage-cleanup-ssh-20260801`

## Bound evidence

The V2 execution authorization bundle rejects verified attestation evidence unless it carries immutable bindings for:

- operation ID;
- plan ID;
- target ID;
- plan hash;
- candidate-set hash;
- authority-context hash;
- current execution lease ID;
- canonical attestation evidence digest.

The bundle persists the normalized binding and rejects later evidence-digest drift.

## Regression coverage

`http-generic-api/test-hostinger-storage-execution-authorization.mjs` covers:

- complete canonical binding;
- missing immutable fields;
- mismatched plan identity;
- mismatched execution lease;
- attestation evidence-digest drift;
- provider dispatch remaining disabled.

## Safety boundary

No deployment, provider dispatch, Hostinger or SSH access, credentials, migration, Production promotion, or runtime mutation was performed.

`secrets_included=false`
