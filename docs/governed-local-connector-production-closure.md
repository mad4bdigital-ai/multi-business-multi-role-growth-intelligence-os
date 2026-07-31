# Governed Local Connector Production Closure

## Purpose

The `Governed Local Connector Production Closure` workflow closes a merged Local Connector release without relying on an untracked branch-local workflow or manual database commands.

Run it by adding this exact comment to the merged pull request whose base branch is `Production`:

```text
/run-local-connector-production-closure
```

Only the repository administrator account `mad4bdigital-ai` may trigger the workflow. The workflow always loads from the default branch and derives the release merge SHA from the commented pull request.

## Release contract

Before any runtime or repair action, the runner requires all of the following:

- the target is a merged pull request;
- its base branch is exactly `Production`;
- GitHub returns a full merge commit SHA;
- the pull request changes at least one recognized Local Connector release surface;
- the current protected `Production` head contains that merge commit without force or reset.

A comment on an open PR, a PR targeting another branch, or an unrelated release fails closed.

## Runtime parity

The runner reads the current `Production` head in the same cycle and requires:

- `GET /health` returns a healthy response;
- `GET /version` contains the current Production SHA;
- `GET /deployment-info` contains the same SHA;
- `GET /connector-agent/version` reports the connector-agent surface ready;
- `Production` has not moved between parity readback and acceptance.

A filesystem checkout, GitHub merge, or Hostinger build acceptance alone is not sufficient.

## Connector acceptance

The read-only Local Manager status must show:

- watchdog installed;
- `last_health_at` no older than ten minutes;
- at least one enabled registered route;
- an enabled healthy `cloudflare_tunnel` route with successful readback;
- a watchdog heartbeat event no older than ten minutes;
- no secret-bearing evidence.

If those conditions already pass, no repair command is created.

## Governed repair path

When acceptance is incomplete, the runner:

1. invokes the registered admin self-repair diagnosis;
2. reads status again;
3. only if still incomplete, enqueues the existing `repair_connector` Local Manager desktop command;
4. waits for claimed/completed command readback;
5. waits for fresh heartbeat and route acceptance.

The desktop command uses the existing linked Local Manager identity and signed installer path. It does not expose installer credentials or connector secrets in workflow logs or artifacts.

## Safety boundary

The workflow does not:

- accept arbitrary shell or SQL;
- run a migration or direct database command;
- return `BACKEND_API_KEY`, connector secrets, tokens, or installer bodies;
- mutate `main` or `Production`;
- bypass the merged-PR, protected-ref, runtime-parity, device-identity, or no-secret gates;
- claim success from an enqueued or claimed command without final heartbeat and route readback.

The workflow publishes bounded start/outcome comments and a 30-day evidence artifact. Repeated exact comments are serialized per Production PR; a later run first checks current acceptance and skips unnecessary repair.
