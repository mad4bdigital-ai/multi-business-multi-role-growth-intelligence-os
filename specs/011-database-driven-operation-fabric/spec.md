# Spec 011 — Database-Driven Operation Fabric

## Objective

Provide a governed execution fabric that can allocate an isolated managed Git worker, bind short-lived repository authority to that worker, and perform remote Git transport without exposing workspace paths or credential material.

## Current delivery slice

This delivery includes:

- **T500:** isolated ephemeral local Git checkout lifecycle;
- **T501:** short-lived in-memory repository credential binding;
- **T502:** governed remote fetch, checkout, commit, fast-forward push, and same-cycle readback;
- orchestrator integration that passes workspace, credential authority, and remote transport as non-enumerable internal dependencies;
- additive persistence and OpenAPI contracts for `ephemeral_checkout`;
- focused lifecycle, authorization, containment, cleanup, and real-Git transport regressions.

## Functional requirements

1. Each managed worker receives a unique workspace beneath a governed root.
2. Workspace creation uses argument-array process execution and rejects path escape.
3. Absolute workspace paths are never persisted, serialized, logged, or returned through public evidence.
4. Repository credentials are scoped to one worker and one owner/repository pair.
5. Credential lifetime is bounded to 30–900 seconds and cannot exceed worker lease or provider expiry.
6. Credential material remains in memory, temporary copies are zeroized, and no credential file is created.
7. Credential release is attempted before workspace cleanup on success and failure paths.
8. Remote URLs are derived from governed owner/repository scope rather than arbitrary request input.
9. Remote fetch and checkout must match the governed expected branch head before operation execution.
10. Commit and push must fail closed on local or remote head drift, reject non-fast-forward history, and forbid force push.
11. Remote push must perform same-cycle branch-head readback without exposing credentials or workspace paths.
12. Existing capability, security, ownership, artifact, and worker-finalization contracts remain intact.
13. Historical `virtual_git_tree` rows remain valid while `ephemeral_checkout` is introduced additively.

## Explicit exclusions

- migration application or live SQL mutation within the T502 code PR;
- deployment or runtime activation within the T502 code PR;
- platform credential fallback widening;
- credential output, derived secret identifiers, or persistent credential files;
- implementation-time writes against a user repository.

## Completion boundary

T500 and T501 are merged. T502 is complete only after focused tests and repository CI pass and its implementation PR is merged. The broader feature remains in progress until the additive migration is applied through governed migration authority with ledger and runtime readback evidence.
