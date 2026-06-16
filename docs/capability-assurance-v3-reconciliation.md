# Capability Assurance V3 Reconciliation

This work branch was created from the current `main` SHA after the previous branch became `diverged_same_files`.

The branch exists to reconcile the capability assurance graph without force-updating stale history. Generated artifacts must be rebuilt from canonical sources, and overlapping files must preserve current `main` changes.

- no provider call
- no production migration apply
- no deployment
- no plaintext secrets
- merge requires CI and release-readiness evidence
