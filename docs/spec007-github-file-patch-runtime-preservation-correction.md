# Spec 007 GitHub File Patch Runtime Authority Preservation Correction

## Purpose

Correct the shadow-certification issuer so it preserves the pre-existing `github_file_patch_apply_after_review` runtime certification instead of assuming runtime dispatch and apply are disabled.

## Runtime authority baseline

The specialized runtime certification was established on June 12, 2026 through a governed positive smoke and currently has dispatch and apply enabled with resource-authority, dry-run, audit-evidence, and readback guards enabled.

The shadow-certification flow must not alter that authority. Its plan hash must include the current runtime-authority snapshot, and transactional readback must prove the snapshot is unchanged.

## Scope

- Update `githubFilePatchShadowCertificationIssuer.js` to bind plans to the runtime-authority snapshot.
- Fail closed if the snapshot changes between dry-run, transaction lock, and readback.
- Update focused regression tests for the production-like runtime state.
- Correct documentation that described the specialized runtime certification as disabled.

## Exclusions

- No shadow certification is issued by this corrective PR.
- No runtime certification, capability-level apply gate, capability export, Tenant authority, or protected-branch authority is changed.
- No provider call, external runtime write, credential payload read, or secret output occurs.
