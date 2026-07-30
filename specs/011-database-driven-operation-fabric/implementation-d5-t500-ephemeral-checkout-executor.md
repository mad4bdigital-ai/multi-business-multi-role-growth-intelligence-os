# D5 T500 Implementation — Isolated Ephemeral Checkout Executor

## Purpose

Replace virtual lease-only workspace claims with a real, isolated local Git workspace lifecycle while deliberately excluding credential handling and remote Git transport, which belong to T501 and T502.

## Executor contract

`managedGitEphemeralCheckoutExecutor.js` creates a unique directory beneath a configured managed workspace root, applies directory mode `0700`, initializes a local Git repository with `git init`, verifies the repository with `git rev-parse --is-inside-work-tree`, and returns a safe handle.

The absolute workspace path is stored only in non-enumerable symbol properties on the in-memory handle. It is not written to SQL, included in JSON, accepted from operation input, returned by the public API, or included in execution evidence.

The safe handle reports:

- `checkout_strategy=ephemeral_checkout`;
- `workspace_created=true`;
- `git_repository_initialized=true`;
- `remote_fetch_performed=false`;
- `remote_checkout_performed=false`;
- `credentials_read=false`;
- `workspace_path_exposed=false`.

## Cleanup

Cleanup removes the workspace recursively, verifies that the path no longer exists, and returns bounded evidence with `workspace_released=true` and `cleanup_verified=true`. Partial workspace creation is removed when local Git initialization or verification fails.

Worker identifiers are restricted to a bounded safe form, and every workspace path is checked to remain a strict child of the configured root. The executor uses `execFile` with an argument array rather than a shell command string.

## Persistence compatibility

The additive migration expands `operation_managed_git_worker_leases.checkout_strategy` from `virtual_git_tree` to both `virtual_git_tree` and `ephemeral_checkout`. Historical rows remain valid. The migration does not rewrite data and is not applied by this change.

Rollback requires confirming that no `ephemeral_checkout` rows remain before narrowing the enum back to `virtual_git_tree`.

## Scope boundaries

T500 creates and releases only a local isolated Git repository. It does not resolve credentials, clone, fetch, set a remote, checkout a remote revision, commit, push, call a provider, perform an external write, deploy, merge, or change runtime activation. Lifecycle integration, route dependency injection, OpenAPI updates, and regression tests are completed in subsequent commits of the same T500 change set.
