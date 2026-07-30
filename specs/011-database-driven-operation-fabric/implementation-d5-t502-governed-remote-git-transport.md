# T502 — Governed Remote Git Transport

## Purpose

Complete the managed Git worker chain by binding remote fetch, checkout, commit, push, and same-cycle readback to the isolated T500 workspace and the short-lived T501 credential authority.

## Execution contract

- The transport accepts only the hidden workspace path and credential binding supplied by the operation orchestrator.
- Repository scope is fixed to one worker, owner, repository, branch, and expected 40-character head SHA.
- Branch names that begin with an option prefix such as `-` are rejected before any Git process starts.
- Workspace paths must already be absolute; relative input is rejected rather than resolved against the process working directory.
- Remote URLs are derived from the governed owner/repository context; request input cannot supply arbitrary remotes.
- Git is invoked only through argument arrays with terminal prompts and persistent credential helpers disabled.
- Credential bytes are read only inside `withManagedGitRepositoryCredential`; no token is placed in arguments, files, responses, evidence, or error details.
- Fetch resolves the exact branch into a remote-tracking ref and fails closed if it differs from the governed expected head.
- Checkout resets and cleans the isolated workspace before operation execution.
- Commit requires the expected local parent and uses a bounded message and explicit non-signing identity.
- Push re-reads the remote head, rejects drift and non-fast-forward history, forbids force push, and verifies the resulting remote head in the same cycle.

## Orchestrator integration

When a managed worker has an explicit repository credential binding, the route prepares the remote transport before execution and attaches `managed_git_transport` as a non-enumerable dependency. The dependency exposes bounded `read`, `commit`, and `push` methods. Safe transport evidence is returned separately; the session, workspace path, credential, and authorization header remain non-serializable. Credential release still happens before workspace cleanup on success and failure.

## Validation

- real local Git fetch/checkout/commit/push against a disposable bare repository;
- remote-head drift rejection;
- fast-forward enforcement and no-force-push proof;
- option-like branch and relative-workspace rejection before process execution;
- credential argument/file/serialization containment;
- hidden orchestrator dependency and safe snapshot behavior;
- regression execution for T500 and T501 alongside T502.

## Scope boundary

This implementation does not apply the database migration, deploy the runtime, seed credentials, broaden platform fallback, or perform implementation-time writes against a user repository.
