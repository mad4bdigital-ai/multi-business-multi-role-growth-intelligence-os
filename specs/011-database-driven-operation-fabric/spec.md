# Spec 011 — Database-Driven Operation Fabric

## Objective

Provide a governed execution fabric that can allocate an isolated managed Git worker, bind short-lived repository authority to that worker, and later perform remote Git transport without exposing workspace paths or credential material.

## Current delivery slice

This reconciliation delivers:

- **T500:** isolated ephemeral local Git checkout lifecycle;
- **T501:** short-lived in-memory repository credential binding;
- orchestrator integration that passes workspace and credential authority as non-enumerable internal dependencies;
- additive persistence and OpenAPI contracts for `ephemeral_checkout`;
- focused lifecycle, authorization, containment, and cleanup regressions.

## Functional requirements

1. Each managed worker receives a unique workspace beneath a governed root.
2. Workspace creation uses argument-array process execution and rejects path escape.
3. Absolute workspace paths are never persisted, serialized, logged, or returned through public evidence.
4. Repository credentials are scoped to one worker and one owner/repository pair.
5. Credential lifetime is bounded to 30–900 seconds and cannot exceed worker lease or provider expiry.
6. Credential material remains in memory, temporary copies are zeroized, and no credential file is created.
7. Credential release is attempted before workspace cleanup on success and failure paths.
8. Existing capability, security, ownership, artifact, and worker-finalization contracts remain intact.
9. Historical `virtual_git_tree` rows remain valid while `ephemeral_checkout` is introduced additively.

## Explicit exclusions

- T502 clone, fetch, remote checkout, commit, push, or other remote Git transport;
- migration application or live SQL mutation;
- deployment or runtime activation;
- platform credential fallback widening;
- credential output, derived secret identifiers, or persistent credential files.

## Completion boundary

T500 and T501 are complete only after focused tests and repository CI pass and the reconciliation PR is merged. The broader feature remains in progress until T502 is delivered and the additive migration is applied through governed migration authority with readback evidence.