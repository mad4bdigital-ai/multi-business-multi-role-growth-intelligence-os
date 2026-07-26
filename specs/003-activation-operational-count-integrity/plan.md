# Implementation Plan

## Scope

Modify only `activationAwarenessService.js`, its focused contract test, and this Spec Kit.

## Design

1. Derive a bounded blocked-surface detail array from the same source results and grouped counts already used by awareness.
2. Preserve the existing numeric blocked count as the array length.
3. Split registered, connected, pending, and error system counts.
4. Keep connector badges unchanged and installation-aware.

## Safety

- No schema or route changes.
- No provider calls or writes.
- No client-controlled SQL.
- No secret-bearing fields.
- Additive response fields, with corrected semantics for the existing connected count.

## Validation

Run the focused awareness test and the repository-required CI checks, then perform governed PR merge and production readback.
