# Production auto-deploy content retrigger — 2026-07-29

This record preserves the Production-only deployment parity history that would otherwise be lost while reconciling the diverged `main` and `Production` branches.

A documentation-only content change was intentionally promoted through the protected `Production` branch to retrigger the configured Hostinger GitHub auto-deploy after ancestry-only promotions did not advance the deployed runtime. Before this trigger, GitHub `Production` was observed at `bf0df9260d1b7fb9ec11e223986014387ce8ff86`, while the deployment manifest still reported `8a3eeeaa1ee3b73b0227bb9c940440881bf5782e`.

The record changed no runtime logic, API contract, database schema, feature flag, scheduler, or delivery behavior; it performed no SSH operation, provider call, credential payload read, migration apply, external send, or external write, and included no secrets.

Completion required same-cycle readback proving the deployment manifest reported the exact resulting `Production` merge SHA and the production health endpoint was healthy. Until both checks passed, runtime parity remained blocked and the retrigger could not be described as a successful deployment.

This historical record is non-authoritative for current deployment state. Current promotion and runtime parity must be proven against the latest exact candidate SHA through fresh branch, Hostinger, `/health`, and `/version` readback.
