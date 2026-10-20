# MAD4B Device Runtime — scoped files engine (P0 slice)

Status: **source implementation; no live device certification or production activation**.

## Boundaries

- Runs inside the existing Local Connector process and its existing Admin-only authorization boundary.
- `POST /device/files` additionally requires an exact `device_id` equal to `CONNECTOR_DEVICE_ID`; arbitrary device switching is denied.
- Does **not** add a public MCP route, arbitrary command execution, OAuth token exchange, PTY, or service account fallback.
- All features default **OFF**. Existing `/files`, `/shell`, `/ps` routes are unchanged.
- File paths are **relative** to one existing, exact allowlisted project root. Absolute paths, traversal, symbolic links, secrets directories, node_modules and common private dotfiles are blocked.
- Only a limited set of text extensions may be read and searched; read size 1 MiB; search reads at most 256 KiB/file, scans at most 1,500 entries and returns bounded paged matches.
- Search does not emit matching line contents; only relative path and line number.
- Patch performs exact unique-text replacement with a mandatory current SHA-256. The 1 MiB limit also applies to the result. The previous bytes are kept under a transaction identifier in the separately configured private state directory. Rollback checks the current SHA before restoring and refuses to overwrite external changes.
- This is **not yet** a multi-writer transactional file lock; a simultaneous non-cooperating writer remains a limitation.

## Required local configuration

```env
CONNECTOR_DEVICE_ID=<actual-bound-device-id>
CONNECTOR_FILE_PATHS=C:\\approved-project
CONNECTOR_DEVICE_FILES_ENABLED=true
CONNECTOR_DEVICE_FILE_ROOT=C:\\approved-project
CONNECTOR_DEVICE_FILE_WRITES_ENABLED=false
CONNECTOR_DEVICE_STATE_DIR=C:\\private-mad4b-state
CONNECTOR_DEVICE_FILE_APPROVAL_TOKEN=
```

For modification, an administrator must separately create the state directory with private filesystem permissions and set `CONNECTOR_DEVICE_FILE_WRITES_ENABLED=true` and a locally generated approval secret. Never upload that secret to GitHub or paste it into a prompt. The trusted client must inject it into the `x-mad4b-device-write-approval` header **outside the AI conversation**. The endpoint explicitly rejects an `approval_token` field in the request body.

The root is accepted only when its canonical path exactly matches a value from `CONNECTOR_FILE_PATHS`. A parent folder does not imply permission.

## API example (read-only)

```json
{"device_id":"<actual-bound-device-id>","action":"search","relative_path":".","query":"createDeviceFilesEngine","mode":"content","limit":25}
```

Available actions: `capabilities`, `list`, `info`, `read`, `search`, `patch`, `rollback`. Write/rollback require the additional private approval header. Each mutation returns a receipt with a transaction ID and before/after digests, without echoing approval secrets.

## Verification

```sh
node --test local-connector/test-device-files-engine.mjs
node --test http-generic-api/test-connector-staging-mcp-distribution.mjs
node --check local-connector/device-files-engine.mjs
node --check local-connector/server.mjs
```

Then verify a signed Connector manifest carries `device-files-engine.mjs`, install on a non-production test device, and test device-scoping, symlink escapes, SHA conflicts, request body limits, successful patch, rollback, and interrupted update. A live Windows Staging acceptance and independent OAuth Device MCP discovery are **not** covered by this slice.

## Next independent components

1. Persistent, identity-bound terminal/session engine with STDIN/PTY, streaming and restart recovery.
2. Device MCP Gateway using Streamable HTTP, proper OAuth resource binding and tool-level grants.
3. Desktop workspace and process manager, multi-device selection and Office/PDF adapters.
