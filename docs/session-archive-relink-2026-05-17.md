# Session Archive Relink Recovery — 2026-05-17

## Incident

After a database restore, the active GPT tool-dispatch archive pointer no longer referenced the intended session folder:

```text
Official folder expected by user:
session_f0132008-edae-44d0-8668-87b44b2fde26
folder_id = 1enrrI7OU3_R0vAaCyfm-N7Ii7IU5Q3AG
```

Drive showed the official folder stopped updating at approximately:

```text
2026-05-17T05:49:58Z
```

The runtime continued archiving to a superseded active SQL session instead:

```text
session_5dee2542-80e3-45f2-8bef-087c59d5def5
folder_id = 1cYCHu2pAX8_EGa11jCQH62kbAcvSrDza
```

## Root cause

`routes/gptToolsRoutes.js` chooses the latest active `customer_sessions` row for the caller:

```sql
SELECT session_id, tenant_id, user_id, originator, session_status, started_at,
       drive_folder_id, drive_doc_id, drive_doc_url, drive_jsonl_id, drive_jsonl_url
FROM customer_sessions
WHERE originator = 'gpt_action'
  AND tenant_id = ?
  AND (user_id <=> ?)
  AND session_status NOT IN ('completed', 'closed')
ORDER BY started_at DESC
LIMIT 1
```

After restore, the official `f013...` row was missing from `customer_sessions`, so the dispatcher selected the remaining active `5dee...` row.

## Recovery actions performed

### 1. Recreated the official session pointer

A `customer_sessions` row was recreated for:

```text
session_id = f0132008-edae-44d0-8668-87b44b2fde26
session_status = active
originator = gpt_action
```

Official Drive bindings:

```text
drive_folder_id = 1enrrI7OU3_R0vAaCyfm-N7Ii7IU5Q3AG
drive_doc_id = 1nrF8h3YREBY3PKFPCXm7-gKkWAsfoebN6K-cWZQHNgI
drive_jsonl_id = 1pdE1d9ODJN5NMnVklB21B-hwzfM-EJc7
drive_exports_folder_id = 1LACKqcTMbLLUQDJNvNajG1pM95bO-hER
```

### 2. Copied missing SQL turn records

Bounded `gpt_session_turns` rows written to the superseded session after the official folder stopped updating were copied back under the official session id.

```text
source_session_id = 5dee2542-80e3-45f2-8bef-087c59d5def5
target_session_id = f0132008-edae-44d0-8668-87b44b2fde26
source cutoff = created_at > 2026-05-17 05:49:55
copied target turn range = 114..291
```

The copied SQL rows preserve bounded previews and content hashes, not full unredacted payloads.

### 3. Closed the superseded session

The old `5dee...` session was marked completed/superseded so the dispatcher no longer selects it.

### 4. Added Drive transcript notice

A `Restore Relink Backfill — 2026-05-17` section was appended to the official Google Doc explaining the repair and pointing to the SQL rows for detailed bounded previews and hashes.

### 5. Verified current writeback

The official folder resumed updates:

```text
Tool_Calls.jsonl modifiedTime ≈ 2026-05-17T09:55:41Z
Session Transcript modifiedTime ≈ 2026-05-17T09:53:14Z
```

`customer_sessions.archive_status` for `f013...` returned to `ready`.

## SQL safety notes

The recovery used only bounded, scoped operations:

- `INSERT ... ON DUPLICATE KEY UPDATE` for the missing session pointer
- scoped `INSERT ... SELECT` from `gpt_session_turns`
- scoped `UPDATE` for `customer_sessions`
- no `DROP`
- no `TRUNCATE`
- no broad `DELETE`

## Reusable repair CLI

A reusable guarded CLI now exists for future restore/relink incidents:

```bash
cd http-generic-api
node session-archive-relink-repair.mjs \
  --target-session-id=f0132008-edae-44d0-8668-87b44b2fde26 \
  --target-drive-folder-id=1enrrI7OU3_R0vAaCyfm-N7Ii7IU5Q3AG \
  --target-drive-doc-id=1nrF8h3YREBY3PKFPCXm7-gKkWAsfoebN6K-cWZQHNgI \
  --target-drive-jsonl-id=1pdE1d9ODJN5NMnVklB21B-hwzfM-EJc7 \
  --target-drive-exports-folder-id=1LACKqcTMbLLUQDJNvNajG1pM95bO-hER \
  --superseded-session-id=5dee2542-80e3-45f2-8bef-087c59d5def5 \
  --copy-after="2026-05-17 05:49:55" \
  --start-turn-index=114 \
  --dry-run
```

Only after validating the dry-run output should `--apply` be used. The tool uses a transaction and scoped `INSERT ... ON DUPLICATE KEY UPDATE`, `INSERT ... SELECT`, and scoped `UPDATE` statements. It does not use `DROP`, `TRUNCATE`, or broad `DELETE`.

## Post-restore archive verification checklist

After every database restore or replay affecting sessions:

1. Check Drive folder metadata for the expected session folder.
2. Check `customer_sessions` has an active row with matching `drive_folder_id`, `drive_doc_id`, and `drive_jsonl_id`.
3. Check the dispatcher-selected active session:

```sql
SELECT session_id, started_at, drive_folder_id, drive_doc_id, drive_jsonl_id
FROM customer_sessions
WHERE originator='gpt_action'
  AND tenant_id='00000000-0000-0000-0000-000000000000'
  AND user_id IS NULL
  AND session_status NOT IN ('completed','closed')
ORDER BY started_at DESC
LIMIT 1;
```

4. Confirm `gpt_session_turns.MAX(created_at)` and Drive file `modifiedTime` both advance after a tool call.
5. If the wrong session is selected, recreate/relink the intended session row before continuing work.
6. Document the recovery in `Updating Registry Patch Index.md` and run GitHub Actions verification after any repo documentation change.
