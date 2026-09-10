# Recovery Canonical Identity and Read-Only Evidence Closure

This change closes two Recovery control-plane defects without creating a second Staging/Production application surface.

## Architecture

The platform remains one shared runtime codebase. Environment-specific behavior is selected by existing deployment identity, server-managed bindings, and recovery authority profiles.

## Scope

1. Canonical deployment identity resolution is shared by the deployment manifest and Recovery trust paths, including backward-compatible `DEPLOYMENT_COMMIT_JSON` support.
2. When Production mutation authorization fails closed, an independently certified Recovery Control Store may remain available only for durable inspection/evidence use.
3. Mutation authorities remain fail closed: the mutation executor, host-local mutation executor, approval authority, signer, lock and other consequential dependencies are not recovered from the read-only path.
4. No target database, grant, migration, Production deployment, provider mutation, or secret change is performed by this patch.

## Safety invariant

A read-only Production database inspection may produce durable evidence even while `mutation_authority_available=false`. That evidence alone does not authorize remediation. Consequential execution continues to require the existing exact-SHA, approval, execution-ticket, lock, readback and mutation-store contracts.

## Acceptance

The deployed Production runtime must be able to run `database_full_inspection` and later retrieve the same run/evidence from the durable Recovery Control Store while the mutation graph can remain fail closed.
