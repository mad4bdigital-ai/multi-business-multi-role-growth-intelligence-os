# Synthetic Executor Attestation Fixture v2

- Workstream: `synthetic-executor`
- Parent integration: Recovery/Attestation provenance v3.
- Scope: upgrade synthetic executor fixtures to the canonical attestation evidence integrity, Recovery, selected-tool, and release-provenance bindings.
- The fixture computes its Approval set, toolchain provenance, selected-tools digest, and attestation Evidence digest from the actual canonical structures.
- Required tests: synthetic execution, unknown-outcome recovery, and reserve release.
- No provider dispatch, Hostinger/SSH access, credentials, deployment, migration, or Production action is enabled.
