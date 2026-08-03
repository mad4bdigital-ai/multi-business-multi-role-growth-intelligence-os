# Recovery and Attestation Provenance v3

- Workstream: `recovery-attestation`
- Scope: carry the effective approved toolchain release-provenance digest into the signed storage-plan attestation subject and verified evidence.
- The digest is required, SHA-256 bound, included in the subject digest, and rejected when altered after signing.
- Downstream Durable Control Plane must compare this signed value with the effective authorization bundle provenance before returning `authorization_ready`.
- Required test: `test-hostinger-storage-attestation.mjs`.
- Provider dispatch, Hostinger/SSH mutation, credentials, deployment, migration, and Production actions remain disabled.
