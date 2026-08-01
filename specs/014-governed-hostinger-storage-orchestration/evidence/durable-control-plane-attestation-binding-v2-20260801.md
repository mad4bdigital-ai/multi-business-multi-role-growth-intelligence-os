# Durable Control Plane Attestation Binding v2

- Workstream: `durable-control-plane`
- Scope: bind verified attestation evidence to the effective approval set, recovery proof and requirement binding, and exact toolchain resolution used by the execution authorization bundle.
- Head lineage starts from Spec 014 Integration after Recovery/Attestation hardening v2.
- Fail-closed outcomes: missing signed bindings are rejected; mismatched approval, recovery, or toolchain values are rejected; provider dispatch remains disabled.
- Required tests: `test-hostinger-storage-execution-authorization.mjs` and `test-hostinger-storage-control-plane-repository.mjs`.
- Production, deployment, migration, credentials, Hostinger SSH, and provider mutation remain out of scope.
