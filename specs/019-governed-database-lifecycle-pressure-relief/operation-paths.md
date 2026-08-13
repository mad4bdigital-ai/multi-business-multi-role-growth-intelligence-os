# Operation Paths — Spec 019 Governed Database Lifecycle and Pressure Relief

## Read-Only Pressure Inspection

```text
request: inspect pressure
  -> resolve caller/read authority
  -> resolve exact database resource registry
  -> collect bounded usage/quota/data_free evidence
  -> discover largest tables and growth
  -> classify coverage and unknowns
  -> return structured pressure evidence
```

No mutation or policy override is possible in this path.

## Read-Only Planning

```text
resource + recipe
  -> resolve domain adapter
  -> resolve policy revision
  -> freeze cutoff and resource version
  -> discover candidates and preservation dependencies
  -> estimate rows/bytes/reclaim
  -> build canonical plan
  -> fingerprint plan
  -> return plan or fail closed
```

Missing policy, unknown semantics, missing parent lineage, or unresolved classification returns a machine-readable blocker.

## Bounded Mutation

```text
approved plan
  -> verify exact resource/recipe/fingerprint/cutoff
  -> resolve authority and unexpired lease
  -> create or reconcile durable mutation receipt
  -> execute registered operation in bounded batch
  -> persist batch evidence
  -> same-cycle readback
  -> reconcile receipt and plan state
```

A disconnect after dispatch is `unknown_outcome`. Retry requires reconciliation and cannot change the frozen candidate set.

## Response-Chunk Pilot

The response-chunk adapter uses `expires_at <= cutoff_at`, preserves rows newer than the cutoff and rows inserted after planning, and emits logical cleanup evidence. It may produce a separate physical-reclaim assessment only after the table is empty and safety checks pass. Automatic `TRUNCATE`, `OPTIMIZE`, rebuild, or compaction is out of scope for the pilot.

## Repo-Audit Supersession

The adapter requires completed parent run, policy cutoff, newer observation for the same file, and deterministic non-latest status. It preserves the newest observation, parent runs, distinct files, and non-terminal runs. The latest observation is ordered by `created_at DESC, finding_id DESC`.

## Engine-Run Assessment

The adapter returns classification, payload sizing, lineage checks, archive recommendation, and `execution_allowed=false` when the retention/archive policy is absent. It does not delete or null payload fields.

## Physical Reclaim Assessment

Physical reclaim is a separate diagnostic and approval path. It checks engine, table reconstructibility, empty-table/concurrent-writer conditions, free capacity, maintenance window, rollback, and post-readback requirements. Logical deletion never automatically authorizes reclaim.
