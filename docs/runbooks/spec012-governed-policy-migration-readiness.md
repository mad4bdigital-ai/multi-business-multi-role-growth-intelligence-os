# Spec 012 T026 Governed Migration Readiness

Run from `http-generic-api`:

```bash
node scripts/spec012-governed-policy-migration-readiness.mjs
```

The default evidence file is:

```text
http-generic-api/artifacts/spec012-governed-policy-migration-readiness.json
```

An alternate JSON destination can be selected with:

```bash
node scripts/spec012-governed-policy-migration-readiness.mjs \
  --output=/tmp/spec012-t026-readiness.json
```

The command is read-only. It computes checksums and statement counts, runs the
canonical static SQL preflight, validates expected additive tables and ordering,
and blocks destructive SQL, active seed DML, or embedded migration
authorization.

`ready_for_governed_preflight` is not Apply authorization. A separate
checksum-bound authorization, exact typed confirmation, same-cycle dry-run,
single Apply, migration-ledger readback, and schema readback remain mandatory.
