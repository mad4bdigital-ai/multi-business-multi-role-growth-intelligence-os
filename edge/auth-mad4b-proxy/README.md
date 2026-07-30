# auth-mad4b-proxy

Cloudflare Worker source for the routes currently mapped to `auth-mad4b-proxy`.

## Purpose

The worker forwards requests directly to the Hostinger origin while removing client IP forwarding headers. It also converts unstructured transient origin failures into the repository-standard JSON error envelope before the response reaches clients.

## Normalized statuses

`502`, `503`, `504`, `522`, `523`, `524`, `525`, `526`, and `530` are normalized only when the upstream response is not already a structured JSON error.

The normalized response:

- uses the original transient HTTP status when available
- includes a stable `EDGE_ORIGIN_UNAVAILABLE` code
- includes a request correlation identifier
- sets `Cache-Control: no-store`
- preserves `Retry-After` when present
- never includes the upstream HTML body, stack trace, or secret-bearing payload

## Deployment contract

Production route bindings are governed separately from this source tree. A production deployment must:

1. pin the repository commit and worker content hash
2. read and retain the current deployed script for rollback
3. run the edge regression test and required repository checks
4. use a one-time typed deployment approval
5. upload only the worker script; do not mutate DNS or routes in the same change
6. read back the deployed script and verify healthy and transient-error probes
7. restore the retained script if readback or probes fail

Current governed routes:

- `auth.mad4b.com/*`
- `activation.mad4b.com/*`
