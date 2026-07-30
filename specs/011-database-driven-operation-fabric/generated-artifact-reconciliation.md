# Generated Artifact Reconciliation

## Decision

Generated artifacts are reconciled from source authority after source merge. They are not manually chosen from base or branch during conflict resolution.

## Registry contract

Each generated artifact pattern declares:

- path pattern;
- generator key and version;
- source paths or source authority;
- generation stage;
- validation command key;
- merge policy;
- manual-edit policy;
- owner;
- status.

Example:

```json
{
  "path_pattern": "docs/work-maps/**",
  "generator_key": "docs_agent_work_map",
  "reconciliation_policy": "regenerate_after_source_merge",
  "run_stage": "post_reconcile",
  "manual_edit_policy": "deny",
  "status": "active"
}
```

## Reconciliation sequence

1. Detect generated paths in compare/conflict output.
2. Exclude generated content from manual source-resolution scope.
3. Merge or resolve source files.
4. Run the registered generator once in the isolated worker.
5. Validate generated output and deterministic digest.
6. Include generated changes in the final commit.
7. Verify no later automation rewrites the same branch unexpectedly.

## Policies

Supported policies:

- `regenerate_after_source_merge`
- `take_base_then_regenerate`
- `take_branch_then_validate`
- `artifact_only_not_committed`
- `manual_review_required`

The default for committed generated documentation is `regenerate_after_source_merge`.

## Bot coordination

Automation must support one of:

- skip marker for an orchestrated commit;
- operation/lease-aware suppression;
- post-operation generation owned by the orchestrator;
- generation only after reconciliation or merge.

A bot must not race the orchestrator by committing between expected-head validation and branch update.

## Acceptance

- A generated-file conflict does not require manual content selection.
- Identical source trees produce identical generated digests.
- Generator failure blocks branch completion.
- Manual edits to deny-policy generated files are rejected.
- Readback proves the final remote files match the generated digest.
