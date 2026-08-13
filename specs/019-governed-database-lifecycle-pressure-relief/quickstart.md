# Quickstart — Spec 019

This document describes the intended read-only workflow. It is not a production runbook and does not authorize a database mutation.

1. Confirm the exact repository/main SHA and current evaluation artifacts.
2. Resolve a registered database resource and recipe; reject caller-supplied SQL.
3. Run read-only pressure inspection and capture bounded evidence.
4. Resolve an explicit policy and domain adapter.
5. Build and fingerprint an immutable plan with fixed cutoff and preservation rules.
6. Stop at `blocked_policy_missing` or `requires_domain_review` when semantics are not proven.
7. For future mutation PRs, require exact authority, typed approval, durable receipt readiness, bounded batches, and same-cycle readback.
8. Evaluate logical cleanup and physical reclaim as separate outcomes.
