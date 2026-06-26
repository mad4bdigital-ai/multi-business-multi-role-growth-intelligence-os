# Rollout and Rollback

## Stage 0

Merge specification, tests, generation, and lifecycle ownership only. No DNS/GPT Action change.

## Stage 1

Publish corrected/split schemas while current origin routes remain available. Schema changes require review.

## Stage 2

Dark-deploy gateway to an isolated hostname and test liveness, route/method rejection, auth pass-through, header stripping, limits, and manifest tamper.

## Stage 3

Bind `activation.mad4b.com` only after same-cycle DNS/TLS readback.

## Stage 4

Dual-run old and new routes; compare status, deterministic response hashes, authorization, latency, errors, and versions.

## Stage 5

Move fixed Activation operations from core schemas. Dynamic MCP tools remain SQL-backed through list/call.

## Stage 6

Sunset legacy only after usage measurement, replacement documentation, deprecation period, zero authorized callers, and rollback rehearsal.

## Rollback

Restore prior schema hashes, gateway manifest/worker, and GPT Action configuration; keep additive SQL tool versions; run principal-isolation smoke and record evidence.
