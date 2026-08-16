# Implementation Plan

## Phase 1 — Deterministic preflight

Validate Git, exact commit, WSL2, local Docker context, clean working tree, protected manifest bytes, Staging environment boundaries, and required tunnel settings before any Compose operation.

## Phase 2 — Safe image and topology

Build the Staging image from repository root with `Dockerfile.staging`, include `canonical-manifest.mjs`, keep application ports internal, start only the Staging Compose topology, and preserve schema-only database seeding boundaries.

## Phase 3 — Runtime verification

Wait for Redis, all three Staging databases, and the application health checks. On failure, capture container state and logs in durable JSONL operations records. Start Cloudflare Tunnel only after application readiness.

## Phase 4 — Recovery and maintenance

Prevent concurrent launches, tolerate Windows LF normalization without hiding content edits, fail closed on ineligible SHAs, and leave databases and Production untouched on any failure. Rollback consists of stopping Staging services only; no destructive repair is authorized.

## Validation

The implementation is validated by the Staging OpenAPI/MCP/database boundary contract, Auto Pilot closure contract, One-Click contract, operations logging contract, manifest integrity check, inventory/evaluation checks, and E2E Phase Governance contract.
