# Context Kernel Domain

This directory contains the framework-independent domain layer for the unified Admin and Tenant context kernel.

## Boundaries

The domain package:

- accepts normalized principal, subject, candidate, pin, and execution inputs;
- applies deterministic authorization and selection policy;
- returns immutable domain decisions and stable reason codes;
- computes context hashes, revisions, expiry state, and transitive invalidation;
- never reads SQL, HTTP requests, environment variables, credentials, or provider SDKs;
- never dispatches tools, writes external state, or repairs missing earlier stages.

Application services and infrastructure adapters may depend on this package. This package must not depend on them.

## Selection precedence

1. Explicit stable reference.
2. Verified context pin.
3. Exact governed binding.
4. Explicitly enabled low-risk fallback.
5. A single authorized candidate.
6. Otherwise return `interpretation_required` or a blocked decision.

High-risk and critical operations never use last-confirmed or fuzzy fallback.
