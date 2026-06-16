# GitHub Repository Lifecycle And Tool Dispatch Integrity

## Status

Accepted for implementation through migration `311_sprint69_platform_tool_dispatch_binding_integrity.sql` and the shared `githubRepositoryLifecycle.js` application service.

## Context

Repository operations previously crossed several disconnected surfaces: GitHub CLI emulation, restricted REST fallback, endpoint exports, virtual Admin tools, and direct check-run reads. This allowed endpoint readiness without a callable tool, unsupported flags to be ignored, multi-file patches to race with `main`, and successful PR mutations to hide failed branch cleanup.

Local connector diagnosis also treated Cloudflare tunnel status as a proxy for the local Node service, producing unnecessary installer guidance when the transport was reachable or authorization-gated.

## Decision

1. Use one shared application service for PR close/finalize, branch deletion, CI gate aggregation, and atomic repository change sets.
2. Require expected head/base SHAs and typed confirmation for destructive or merge operations.
3. Return explicit `partial_success` when an irreversible phase succeeds and a later readback/cleanup phase fails.
4. Prove merge ancestry before deleting a work branch.
5. Prefer one Git tree/commit for a multi-file change set pinned to an expected base SHA.
6. Represent endpoint-to-tool execution through `platform_tool_dispatch_bindings` with capability, atomicity, readback, and partial-success policy metadata.
7. Audit relationship drift through `v_platform_tool_dispatch_integrity` and `platform_tool_binding_integrity_audit`.
8. Classify local connector health from tunnel evidence plus a public Node health probe.

## Core Invariants

- Protected/default branches are never deleted.
- Branch deletion is limited to governed disposable prefixes and requires expected-head SHA equality.
- Open PRs block branch deletion.
- CI finalization binds required checks to the exact approved head SHA and current base SHA.
- Branch cleanup happens only after merge ancestry readback passes.
- Active-ready endpoint status alone never proves callability.
- Mutation bindings require capability policy; every binding requires readback policy.
- Unsupported flags are rejected or represented as partial failure, never silently ignored.
- No raw provider credentials, tokens, or secret values are returned or logged.

## Failure Model

- `409`: stale SHA, blocked CI/freshness gate, open PR, or state conflict.
- `403`: protected branch or disallowed branch prefix.
- `400`: missing/invalid typed confirmation or required SHA.
- `207`-style tool result: mutation completed but ancestry or cleanup did not; the result body is `partial_success`.
- `502`: provider success could not be verified by required same-cycle readback.

## Rollout

- Merge code and tests first.
- Authorize migration 311 through the governed migration authorization process; do not add it to legacy bootstrap allowlists.
- Apply migration 311 through the governed migration runner after authorization.
- Run `platform_tool_binding_integrity_audit` and require zero critical gaps for the GitHub action family.
- Use `github_branch_delete` only after reading the actual GitHub default branch, verifying expected SHA, rejecting open PRs, proving `ahead_by=0` against the default branch, re-reading SHA immediately before deletion, and confirming same-cycle ref absence.

## Consequences

The flow adds provider reads and explicit confirmations, but removes ambiguous success states and reduces branch-race windows. Multi-file mutations become smaller in commit count and stronger in atomicity. Connector repair becomes more accurate and avoids unnecessary installer generation.
