# ADR-001 — Reuse Platform Resource Recipes and Durable Execution

## Decision

Reuse the existing platform resource registry/recipe model and durable execution authorities for Database Lifecycle operations. Do not create a parallel `database_cleanup_*` schema in PR-A.

## Rationale

The repository already models resource identity, recipes, execution plans, execution events, and mutation receipts. Reuse avoids duplicate authority and makes lifecycle operations subject to the same lease, idempotency, approval, and readback controls.

## Consequence

Future PRs must prove that an existing model cannot represent a required lifecycle invariant before proposing additive schema. Source migration presence is not live readiness; target environment readback remains mandatory.
