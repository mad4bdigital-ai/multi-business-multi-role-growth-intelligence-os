# Platform Execution Envelope Kernel

## Purpose

T021 adds a platform execution envelope kernel that is revision-bound, expiring, and replay-resistant. It sits after the dynamic execution policy kernel and before any future adapter execution.

This PR is intentionally non-executing. It does not call providers, mutate external systems, write migrations, or cut over enforcement.

## Inputs

The kernel consumes a shadow enforcement result and optional capability envelope reference. It binds the envelope to capability envelope id, boundary key, enforcement status, revision vector hash, dynamic policy hash, obligations hash, mismatch taxonomy hash, nonce hash, idempotency key hash, and expiry timestamp.

## Replay resistance

Each envelope contains a `replay_key` derived from the capability envelope id, boundary key, nonce hash, and idempotency key hash. Validation rejects any replay key already seen or consumed by the caller-provided replay set.

The kernel also rejects terminal execution statuses such as executed, cancelled, expired, or superseded.

## Revision binding

Validation can be given a current enforcement result. The envelope remains valid only when the current revision vector, policy, obligations, and mismatch taxonomy hashes match the envelope hashes.

A context or policy change therefore invalidates stale execution envelopes before any future adapter is allowed to run.

## Expiry

Every envelope has `issued_at`, `expires_at`, and bounded `ttl_seconds`. The maximum TTL is capped at one hour. Expired envelopes validate as blocked.

## Safety guarantees

All outputs force `provider_apply_allowed: false`, `mutation_allowed: false`, `enforcement_cutover: false`, and `secrets_included: false`.

## Non-goals

This PR does not implement persistence for execution envelopes, approval decision writes, adapter execution, provider mutation, migration execution, or canary enforcement. Those remain T022, T023, T030, and pilot work.
